from __future__ import annotations

from collections import defaultdict
from typing import Sequence
from uuid import UUID

from .models import FusedCandidate, RetrievalCandidate


def reciprocal_rank_fusion(
    *rankings: Sequence[RetrievalCandidate],
    k: int = 60,
) -> list[FusedCandidate]:
    scores: dict[UUID, float] = defaultdict(float)
    candidates: dict[UUID, RetrievalCandidate] = {}

    for ranking in rankings:
        for rank, candidate in enumerate(ranking, start=1):
            scores[candidate.chunk_id] += 1.0 / (k + rank)
            candidates[candidate.chunk_id] = candidate

    return sorted(
        (
            FusedCandidate(candidate=candidates[chunk_id], score=score)
            for chunk_id, score in scores.items()
        ),
        key=lambda item: (-item.score, item.candidate.chunk_order),
    )
