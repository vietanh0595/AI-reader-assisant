from __future__ import annotations

import pytest
from backend.app.mindmap.schemas import (
    ExtractedNode,
    ExtractedEdge,
    ChapterExtractionResult,
    ConsolidationResult,
)


def test_extracted_node_requires_fields():
    node = ExtractedNode(
        id="n1",
        label="Habit Formation",
        type="theme",
        summary="Habits are loops.",
        importance=0.9,
        paragraph_ids=["p1", "p2"],
    )
    assert node.id == "n1"
    assert node.type == "theme"


def test_extracted_node_rejects_unknown_type():
    with pytest.raises(Exception):
        ExtractedNode(
            id="n1", label="x", type="unknown", summary="s", importance=0.5, paragraph_ids=[]
        )


def test_chapter_extraction_result_genre_optional():
    result = ChapterExtractionResult(nodes=[], edges=[])
    assert result.genre is None


def test_consolidation_result_requires_genre():
    result = ConsolidationResult(
        genre="non-fiction",
        nodes=[],
        edges=[],
    )
    assert result.genre == "non-fiction"
