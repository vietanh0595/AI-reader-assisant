from __future__ import annotations

import json
import logging
import uuid
from dataclasses import replace
from typing import Any, Optional
from uuid import UUID

from .answerer import (
    ModelBookAnswer,
    _build_sources,
    _INSUFFICIENT_EVIDENCE_BODY,
    _INSUFFICIENT_EVIDENCE_EYEBROW,
)
from .models import BookAnswer, EvidenceItem, EvidenceSet

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 3

SYSTEM_PROMPT = """\
You are a reading assistant answering questions about a single book, using only
evidence you retrieve with your tools. Decide which tool to use based on the question
and the conversation so far. Prefer the narrowest sufficient context.

Tools:
- read_current_context: the page the reader is currently on. Use for "this page", "here",
  or questions about what the reader is looking at right now.
- search_book: semantic + keyword search across the book. Use for broad or specific
  questions whose answer is not on the current page. Write a focused, standalone query
  (resolve pronouns from the conversation).

When you have enough evidence, answer. Set supported=false with an empty body if the
evidence does not support an answer. Cite only the source IDs present in search results.
Cite at most 3. Keep the body under 1200 characters."""

TOOLS = [
    {
        "type": "function",
        "name": "search_book",
        "description": "Semantic + keyword search across the book. Returns labeled evidence excerpts.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Standalone search query."}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "read_current_context",
        "description": "Return the text of the page the reader is currently on.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


class BookAgent:
    def __init__(self, client: Any, model: str, retrieval: Any,
                 reasoning_effort: Optional[str] = None, max_output_tokens: int = 700) -> None:
        self._client = client
        self._model = model
        self._retrieval = retrieval
        self._reasoning_effort = reasoning_effort
        self._max_output_tokens = max_output_tokens

    def answer(self, *, user_id: UUID, book_id: UUID, question: str,
               history: list[dict], selected_text: Optional[str],
               current_reading_order: int, include_whole_book: bool) -> BookAnswer:
        request_id = str(uuid.uuid4())
        max_reading_order = None if include_whole_book else current_reading_order
        evidence_by_id: dict[str, EvidenceItem] = {}
        input_items: list[Any] = self._build_input(history, question, selected_text)

        for round_index in range(MAX_TOOL_ROUNDS):
            response = self._call(input_items, with_tools=True)
            calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
            if not calls:
                return self._finalize(request_id, response.output_parsed, evidence_by_id)
            # Echo back ALL output items (reasoning + function calls), not just the
            # calls. Reasoning models (e.g. gpt-5-mini) pair each function_call with a
            # reasoning item; the Responses API rejects a function_call sent on the next
            # turn without its required reasoning item.
            input_items.extend(response.output)
            for call in calls:
                output = self._execute(
                    call,
                    user_id=user_id, book_id=book_id,
                    current_reading_order=current_reading_order,
                    max_reading_order=max_reading_order,
                    round_index=round_index, evidence_by_id=evidence_by_id,
                )
                input_items.append({
                    "type": "function_call_output", "call_id": call.call_id, "output": output,
                })

        input_items.append({
            "role": "user",
            "content": "Answer now using the evidence gathered so far. Do not call any more tools.",
        })
        response = self._call(input_items, with_tools=False)
        return self._finalize(request_id, response.output_parsed, evidence_by_id)

    def _build_input(self, history: list[dict], question: str, selected_text: Optional[str]) -> list[Any]:
        items: list[Any] = []
        for turn in history:
            role = turn["role"] if isinstance(turn, dict) else turn.role
            content = turn["content"] if isinstance(turn, dict) else turn.content
            items.append({"role": role, "content": content})
        # Append selected_text inline so the model treats it as informational context,
        # not a constraint. A separate preceding message caused the model to anchor on
        # it and abstain when the question ranged beyond that passage.
        user_content = question
        if selected_text:
            user_content = f"{question}\n\nFor context, I was reading: \"{selected_text}\""
        items.append({"role": "user", "content": user_content})
        return items

    def _call(self, input_items: list[Any], *, with_tools: bool):
        kwargs: dict[str, Any] = dict(
            model=self._model, instructions=SYSTEM_PROMPT, input=input_items,
            text_format=ModelBookAnswer, max_output_tokens=self._max_output_tokens,
        )
        if with_tools:
            kwargs["tools"] = TOOLS
        if self._reasoning_effort:
            kwargs["reasoning"] = {"effort": self._reasoning_effort}
        return self._client.responses.parse(**kwargs)

    def _execute(self, call, *, user_id, book_id, current_reading_order,
                 max_reading_order, round_index, evidence_by_id) -> str:
        try:
            if call.name == "read_current_context":
                return self._retrieval.read_current_context(
                    user_id=user_id, book_id=book_id, current_reading_order=current_reading_order)
            if call.name == "search_book":
                try:
                    args = json.loads(call.arguments or "{}")
                except json.JSONDecodeError:
                    return "Tool error: could not parse search query arguments."
                query = args.get("query", "")
                evidence: EvidenceSet = self._retrieval.retrieve(
                    user_id=user_id, book_id=book_id, question=query,
                    include_whole_book=(max_reading_order is None),
                    current_reading_order=current_reading_order)
                lines = []
                for i, item in enumerate(evidence.items):
                    sid = f"s{round_index}-{i}"
                    evidence_by_id[sid] = self._rekey(item, sid)
                    lines.append(f"[{sid}] {item.raw_text}")
                return "\n\n".join(lines) if lines else "No matching passages found."
            return f"Unknown tool: {call.name}"
        except Exception as exc:
            logger.exception("tool %s failed", getattr(call, "name", "?"))
            return f"Tool error: {exc}"

    @staticmethod
    def _rekey(item: EvidenceItem, sid: str) -> EvidenceItem:
        return replace(item, source_id=sid)

    def _finalize(self, request_id: str, parsed: Optional[ModelBookAnswer],
                  evidence_by_id: dict[str, EvidenceItem]) -> BookAnswer:
        if parsed is None or not parsed.supported:
            return BookAnswer(request_id=request_id, eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                              body=_INSUFFICIENT_EVIDENCE_BODY, supported=False, sources=[])
        evidence = EvidenceSet(items=list(evidence_by_id.values()), supported=True)
        valid_ids = set(evidence_by_id.keys())
        sources = _build_sources(parsed.citation_ids, evidence, valid_ids)
        if not sources:
            return BookAnswer(request_id=request_id, eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                              body=_INSUFFICIENT_EVIDENCE_BODY, supported=False, sources=[])
        return BookAnswer(request_id=request_id, eyebrow=parsed.eyebrow, body=parsed.body,
                          supported=True, sources=sources)
