from __future__ import annotations

import uuid
from typing import Any, Optional

from pydantic import BaseModel, Field

from .models import BookAnswer, BookSource, EvidenceSet
from .prompts import BOOK_ANSWER_SYSTEM_PROMPT, build_book_answer_prompt

_INSUFFICIENT_EVIDENCE_EYEBROW = "Insufficient evidence"
_INSUFFICIENT_EVIDENCE_BODY = (
    "The retrieved excerpts do not contain enough information to answer this question."
)


class ModelBookAnswer(BaseModel):
    supported: bool
    eyebrow: str = Field(max_length=40)
    body: str = Field(max_length=1200)
    citation_ids: list[str] = Field(max_length=3)


class BookAnswerer:
    def __init__(
        self,
        client: Any,
        model: str,
        reasoning_effort: Optional[str] = None,
        max_output_tokens: int = 500,
    ) -> None:
        self._client = client
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._max_output_tokens = max_output_tokens

    def answer(self, question: str, evidence: EvidenceSet) -> BookAnswer:
        request_id = str(uuid.uuid4())
        valid_source_ids = {item.source_id for item in evidence.items}

        kwargs: dict[str, Any] = dict(
            model=self._model,
            instructions=BOOK_ANSWER_SYSTEM_PROMPT,
            input=build_book_answer_prompt(question, evidence),
            max_output_tokens=self._max_output_tokens,
            text_format=ModelBookAnswer,
        )
        if self._reasoning_effort:
            kwargs["reasoning"] = {"effort": self._reasoning_effort}

        response = self._client.responses.parse(**kwargs)
        parsed: ModelBookAnswer = response.output_parsed

        if not parsed.supported:
            return BookAnswer(
                request_id=request_id,
                eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                body=_INSUFFICIENT_EVIDENCE_BODY,
                supported=False,
                sources=[],
            )

        sources = _build_sources(parsed.citation_ids, evidence, valid_source_ids)

        if not sources:
            return BookAnswer(
                request_id=request_id,
                eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                body=_INSUFFICIENT_EVIDENCE_BODY,
                supported=False,
                sources=[],
            )

        return BookAnswer(
            request_id=request_id,
            eyebrow=parsed.eyebrow,
            body=parsed.body,
            supported=True,
            sources=sources,
        )


def _build_sources(
    citation_ids: list[str],
    evidence: EvidenceSet,
    valid_source_ids: set[str],
) -> list[BookSource]:
    items_by_id = {item.source_id: item for item in evidence.items}
    seen: set[str] = set()
    sources: list[BookSource] = []

    for cid in citation_ids:
        if cid not in valid_source_ids or cid in seen:
            continue
        seen.add(cid)
        item = items_by_id[cid]
        para_id = item.paragraph_ids[0] if item.paragraph_ids else ""
        source_ref = item.source_refs[0] if item.source_refs else {}
        sources.append(
            BookSource(
                id=cid,
                paragraph_id=para_id,
                chapter_title=item.chapter_title,
                excerpt=item.raw_text[:200],
                page_index=item.page_start,
                page_label=None,
                source_ref=source_ref,
            )
        )
        if len(sources) >= 3:
            break

    return sources
