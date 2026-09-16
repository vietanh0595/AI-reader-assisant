from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .models import BookAnswer, BookSource, EvidenceSet
from .prompts import BOOK_ANSWER_SYSTEM_PROMPT, build_book_answer_prompt

logger = logging.getLogger(__name__)

from .conversational import INSUFFICIENT_EVIDENCE_BODY as _INSUFFICIENT_EVIDENCE_BODY

_INSUFFICIENT_EVIDENCE_EYEBROW = "Nothing found"

# Evidence is fed to the model as bracketed labels — "[s0-1]" (agent rounds),
# "[source-1]" (single-shot answerer), "[ctx0]" (current-page tool). Those IDs
# belong in the structured citation_ids field, which renders as the SOURCES
# list. Models inline them into the prose as well; the prompts now forbid it,
# and this removes any that survive. Narrow by construction: only these three
# shapes match, so real bracketed prose ("[sic]", "[Chapter 3]") is untouched.
#
# Whitespace on both sides is captured so the gap can be closed correctly. Only
# the space a marker actually displaced is touched — an earlier version scrubbed
# every space-before-punctuation in the body and mangled "knowledge: ...".
_CITATION_RUN = re.compile(
    r"([ \t]*)((?:\[(?:s\d+-\d+|source-\d+|ctx\d+)\])+)([ \t]*)"
)


def _close_gap(match: "re.Match[str]") -> str:
    lead, _, trail = match.groups()
    # Space on both sides means the marker sat between two words, so one space
    # has to stay. Otherwise it hugged punctuation or a line edge, and the text
    # should close up as if it had never been written.
    return " " if lead and trail else ""


def strip_citation_markers(body: str) -> str:
    """Remove inline evidence labels from answer prose, closing the gaps they leave."""
    cleaned = _CITATION_RUN.sub(_close_gap, body)
    return "\n".join(line.rstrip() for line in cleaned.split("\n")).strip()


class ModelBookAnswer(BaseModel):
    # "chat" means the reader's message was not a request for information from the
    # book — a greeting, thanks, an aside. Such a reply needs no evidence and is
    # forbidden from asserting anything about the book, so it is safe to return
    # without citations; that is what keeps this from becoming a hole in the
    # grounding rule. Defaulted so the many places that construct this for tests do
    # not have to care; the model is always required to emit it.
    kind: Literal["answer", "chat"] = "answer"
    supported: bool
    eyebrow: str = Field(max_length=40)
    body: str = Field(max_length=1800)
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
        parsed: Optional[ModelBookAnswer] = response.output_parsed

        if parsed is not None and parsed.kind == "chat":
            # Nothing was looked up and nothing is being claimed, so there is nothing
            # to cite and nothing to refuse.
            return BookAnswer(
                request_id=request_id,
                eyebrow=parsed.eyebrow,
                body=strip_citation_markers(parsed.body),
                supported=True,
                sources=[],
            )

        if parsed is None:
            logger.error(
                "output_parsed is None — model=%s output=%r",
                self._model,
                getattr(response, "output", None),
            )
            return BookAnswer(
                request_id=request_id,
                eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                body=_INSUFFICIENT_EVIDENCE_BODY,
                supported=False,
                sources=[],
            )

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
            body=strip_citation_markers(parsed.body),
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
        page_label = source_ref.get("pageLabel") if isinstance(source_ref, dict) else None
        sources.append(
            BookSource(
                id=cid,
                paragraph_id=para_id,
                chapter_title=item.chapter_title,
                excerpt=item.raw_text[:200],
                page_index=item.page_start,
                page_label=page_label,
                source_ref=source_ref,
            )
        )
        if len(sources) >= 3:
            break

    return sources
