from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from backend.app.retrieval.models import EvidenceSet, FusedCandidate, RetrievalCandidate
from backend.app.retrieval.service import RetrievalService


def make_candidate(
    chunk_order: int,
    reading_order_start: int,
    reading_order_end: int,
    chapter_id: str = "ch1",
    similarity: float = 0.8,
) -> RetrievalCandidate:
    return RetrievalCandidate(
        chunk_id=uuid4(),
        chunk_order=chunk_order,
        raw_text=f"Chunk {chunk_order} text content.",
        start_reading_order=reading_order_start,
        end_reading_order=reading_order_end,
        chapter_id=chapter_id,
        chapter_title=f"Chapter for {chapter_id}",
        page_start=None,
        page_end=None,
        paragraph_ids=[f"p{chunk_order}"],
        source_refs=[{"source": "epub"}],
        vector_similarity=similarity,
    )


def fake_repo(
    vector_results: list[RetrievalCandidate],
    keyword_results: list[RetrievalCandidate],
) -> MagicMock:
    repo = MagicMock()
    repo.vector_search.return_value = vector_results
    repo.keyword_search.return_value = keyword_results
    repo.get_neighbors.return_value = []
    return repo


def fake_embedder(embedding: list[float] | None = None) -> MagicMock:
    emb = MagicMock()
    emb.embed_query.return_value = embedding or [0.1] * 1536
    return emb


def test_book_so_far_excludes_chunks_after_current_position():
    candidates = [
        make_candidate(0, 0, 10),
        make_candidate(1, 11, 20),
        make_candidate(2, 51, 60),
    ]
    repo = fake_repo(candidates, [])
    service = RetrievalService(repo=repo, embedder=fake_embedder())

    evidence = service.retrieve(
        user_id=uuid4(),
        book_id=uuid4(),
        question="question",
        include_whole_book=False,
        current_reading_order=50,
    )
    assert all(item.end_reading_order <= 50 for item in evidence.items)


def test_whole_book_includes_all_chunks():
    candidates = [
        make_candidate(0, 0, 10),
        make_candidate(1, 100, 110),
    ]
    repo = fake_repo(candidates, [])
    service = RetrievalService(repo=repo, embedder=fake_embedder())

    evidence = service.retrieve(
        user_id=uuid4(),
        book_id=uuid4(),
        question="question",
        include_whole_book=True,
        current_reading_order=10,
    )
    assert len(evidence.items) == 2


def test_weak_evidence_abstains():
    candidates = [make_candidate(0, 0, 10, similarity=0.12)]
    repo = fake_repo(candidates, [])
    service = RetrievalService(repo=repo, embedder=fake_embedder(), min_vector_similarity=0.35)

    evidence = service.retrieve(
        user_id=uuid4(),
        book_id=uuid4(),
        question="question",
        include_whole_book=True,
        current_reading_order=None,
    )
    assert evidence.supported is False
    assert evidence.reason == "weak_retrieval"


def test_strong_evidence_is_supported():
    candidates = [make_candidate(0, 0, 10, similarity=0.85)]
    repo = fake_repo(candidates, candidates)
    service = RetrievalService(repo=repo, embedder=fake_embedder(), min_vector_similarity=0.35)

    evidence = service.retrieve(
        user_id=uuid4(),
        book_id=uuid4(),
        question="question",
        include_whole_book=True,
        current_reading_order=None,
    )
    assert evidence.supported is True


def test_evidence_capped_at_fused_candidates():
    candidates = [make_candidate(i, i * 10, i * 10 + 9, similarity=0.8) for i in range(20)]
    repo = fake_repo(candidates, [])
    service = RetrievalService(repo=repo, embedder=fake_embedder(), fused_candidates=5)

    evidence = service.retrieve(
        user_id=uuid4(),
        book_id=uuid4(),
        question="question",
        include_whole_book=True,
        current_reading_order=None,
    )
    assert len(evidence.items) <= 5
