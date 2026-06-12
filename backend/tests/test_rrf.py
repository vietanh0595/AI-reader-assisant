from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from backend.app.retrieval.models import FusedCandidate, RetrievalCandidate
from backend.app.retrieval.rrf import reciprocal_rank_fusion


def candidate(tag: str) -> RetrievalCandidate:
    return RetrievalCandidate(
        chunk_id=UUID(int=abs(hash(tag)) % (2**128)),
        chunk_order=ord(tag[0]),
        raw_text=f"Text for {tag}",
        start_reading_order=0,
        end_reading_order=1,
        chapter_id=None,
        chapter_title=None,
        page_start=None,
        page_end=None,
        paragraph_ids=[],
        source_refs=[],
    )


def test_rrf_rewards_candidates_present_in_both_rankings():
    vector = [candidate("a"), candidate("b"), candidate("c")]
    keyword = [candidate("c"), candidate("a"), candidate("d")]
    fused = reciprocal_rank_fusion(vector, keyword, k=60)
    assert [item.candidate.raw_text[:6] for item in fused[:2]] == ["Text f", "Text f"]
    top_tags = {item.candidate.raw_text.split()[-1] for item in fused[:2]}
    assert top_tags == {"a", "c"}


def test_rrf_deduplicates_same_chunk():
    fused = reciprocal_rank_fusion([candidate("a")], [candidate("a")], k=60)
    assert len(fused) == 1


def test_rrf_returns_all_unique_chunks():
    vector = [candidate("a"), candidate("b")]
    keyword = [candidate("c"), candidate("d")]
    fused = reciprocal_rank_fusion(vector, keyword, k=60)
    assert len(fused) == 4


def test_rrf_higher_score_for_dual_ranked():
    dual = candidate("a")
    single = candidate("b")
    fused = reciprocal_rank_fusion([dual], [dual, single], k=60)
    dual_result = next(r for r in fused if r.candidate.chunk_id == dual.chunk_id)
    single_result = next(r for r in fused if r.candidate.chunk_id == single.chunk_id)
    assert dual_result.score > single_result.score


def test_rrf_empty_rankings_returns_empty():
    assert reciprocal_rank_fusion([], [], k=60) == []
