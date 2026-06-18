from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from .models import EvidenceItem, EvidenceSet
from .repository import RetrievalRepository
from .rrf import reciprocal_rank_fusion

logger = logging.getLogger(__name__)

_DEFAULT_VECTOR_CANDIDATES = 30
_DEFAULT_KEYWORD_CANDIDATES = 30
_DEFAULT_FUSED_CANDIDATES = 8
_DEFAULT_RRF_K = 60
_DEFAULT_MIN_VECTOR_SIMILARITY = 0.35
_DEFAULT_CONTEXT_MAX_CHARS = 18_000


class RetrievalService:
    def __init__(
        self,
        repo: RetrievalRepository,
        embedder,
        vector_candidates: int = _DEFAULT_VECTOR_CANDIDATES,
        keyword_candidates: int = _DEFAULT_KEYWORD_CANDIDATES,
        fused_candidates: int = _DEFAULT_FUSED_CANDIDATES,
        rrf_k: int = _DEFAULT_RRF_K,
        min_vector_similarity: float = _DEFAULT_MIN_VECTOR_SIMILARITY,
        context_max_chars: int = _DEFAULT_CONTEXT_MAX_CHARS,
    ) -> None:
        self._repo = repo
        self._embedder = embedder
        self._vector_candidates = vector_candidates
        self._keyword_candidates = keyword_candidates
        self._fused_candidates = fused_candidates
        self._rrf_k = rrf_k
        self._min_similarity = min_vector_similarity
        self._max_chars = context_max_chars

    def retrieve(
        self,
        user_id: UUID,
        book_id: UUID,
        question: str,
        include_whole_book: bool,
        current_reading_order: Optional[int],
    ) -> EvidenceSet:
        max_reading_order = None if include_whole_book else current_reading_order

        query_embedding = self._embedder.embed_query(question)

        vector_results = self._repo.vector_search(
            user_id=user_id,
            book_id=book_id,
            query_embedding=query_embedding,
            limit=self._vector_candidates,
            max_reading_order=max_reading_order,
        )
        keyword_results = self._repo.keyword_search(
            user_id=user_id,
            book_id=book_id,
            query=question,
            limit=self._keyword_candidates,
            max_reading_order=max_reading_order,
        )

        best_similarity = max(
            (c.vector_similarity or 0.0 for c in vector_results),
            default=0.0,
        )
        logger.info(
            "retrieval: book=%s question=%r best_similarity=%.3f vector=%d keyword=%d",
            book_id, question, best_similarity, len(vector_results), len(keyword_results),
        )

        # Only gate on truly empty results — structural queries like "summarize chapter 5"
        # score low on both vector similarity and keyword FTS but still return relevant
        # chunks; let the model decide if the evidence is sufficient.
        if not vector_results and not keyword_results:
            return EvidenceSet(items=[], supported=False, reason="no_results")

        if max_reading_order is not None:
            vector_results = [c for c in vector_results if c.end_reading_order <= max_reading_order]
            keyword_results = [c for c in keyword_results if c.end_reading_order <= max_reading_order]

        fused = reciprocal_rank_fusion(vector_results, keyword_results, k=self._rrf_k)
        top = fused[: self._fused_candidates]

        items: list[EvidenceItem] = []
        seen_paragraph_ids: set[str] = set()
        total_chars = 0

        for i, fused_item in enumerate(top):
            c = fused_item.candidate
            para_key = frozenset(c.paragraph_ids)
            if para_key & seen_paragraph_ids:
                continue
            seen_paragraph_ids |= set(c.paragraph_ids)
            text_chars = len(c.raw_text)
            if total_chars + text_chars > self._max_chars and items:
                break
            total_chars += text_chars
            items.append(
                EvidenceItem(
                    source_id=f"source-{i}",
                    chunk_id=c.chunk_id,
                    chunk_order=c.chunk_order,
                    raw_text=c.raw_text,
                    start_reading_order=c.start_reading_order,
                    end_reading_order=c.end_reading_order,
                    chapter_id=c.chapter_id,
                    chapter_title=c.chapter_title,
                    page_start=c.page_start,
                    page_end=c.page_end,
                    paragraph_ids=c.paragraph_ids,
                    source_refs=c.source_refs,
                    rrf_score=fused_item.score,
                )
            )

        return EvidenceSet(items=items, supported=True)

    def read_current_context(
        self,
        user_id: UUID,
        book_id: UUID,
        current_reading_order: int,
        radius: int = 2,
    ) -> str:
        blocks = self._repo.read_context_window(
            user_id=user_id,
            book_id=book_id,
            center_reading_order=current_reading_order,
            radius=radius,
        )
        if not blocks:
            return "No surrounding text is available at the current position."
        return "\n\n".join(b.text for b in blocks)
