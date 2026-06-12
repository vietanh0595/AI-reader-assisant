from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class RetrievalCandidate:
    chunk_id: UUID
    chunk_order: int
    raw_text: str
    start_reading_order: int
    end_reading_order: int
    chapter_id: str | None
    chapter_title: str | None
    page_start: int | None
    page_end: int | None
    paragraph_ids: list[str]
    source_refs: list[dict[str, Any]]
    vector_similarity: float | None = None
    keyword_rank: float | None = None


@dataclass(frozen=True)
class FusedCandidate:
    candidate: RetrievalCandidate
    score: float


@dataclass(frozen=True)
class EvidenceItem:
    source_id: str
    chunk_id: UUID
    chunk_order: int
    raw_text: str
    start_reading_order: int
    end_reading_order: int
    chapter_id: str | None
    chapter_title: str | None
    page_start: int | None
    page_end: int | None
    paragraph_ids: list[str]
    source_refs: list[dict[str, Any]]
    rrf_score: float


@dataclass(frozen=True)
class EvidenceSet:
    items: list[EvidenceItem]
    supported: bool
    reason: str | None = None


@dataclass(frozen=True)
class BookSource:
    id: str
    paragraph_id: str
    chapter_title: str | None
    excerpt: str
    page_index: int | None
    page_label: str | None
    source_ref: dict[str, Any]


@dataclass(frozen=True)
class BookAnswer:
    request_id: str
    eyebrow: str
    body: str
    supported: bool
    sources: list[BookSource]
