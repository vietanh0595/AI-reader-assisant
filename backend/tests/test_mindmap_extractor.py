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


from unittest.mock import MagicMock, patch
from backend.app.mindmap.extractor import ChapterExtractor


FIXTURE_CHAPTER = """
Chapter 1: The Fundamentals of Habit Formation

Habits are the compound interest of self-improvement. Getting one percent better every day
counts for a lot in the long run. The habit loop consists of a cue, a craving, a response,
and a reward. Understanding these four components is the key to building better habits
and breaking bad ones.
"""

FIXTURE_EXTRACTION = ChapterExtractionResult(
    genre="non-fiction",
    nodes=[
        ExtractedNode(
            id="n1",
            label="Habit Loop",
            type="concept",
            summary="The four-step pattern: cue, craving, response, reward.",
            importance=0.95,
            paragraph_ids=["p1"],
        ),
    ],
    edges=[],
)


def test_extractor_returns_chapter_extraction_result():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = FIXTURE_EXTRACTION
    mock_client.responses.parse.return_value = mock_response

    extractor = ChapterExtractor(client=mock_client, model="gpt-4o-mini")
    result = extractor.extract(
        chapter_text=FIXTURE_CHAPTER,
        chapter_id="ch1",
        chapter_title="The Fundamentals",
        paragraph_ids=["p1"],
        is_first_chapter=True,
    )

    assert result.genre == "non-fiction"
    assert result.nodes[0].label == "Habit Loop"
    mock_client.responses.parse.assert_called_once()


def test_extractor_skips_genre_on_non_first_chapter():
    mock_client = MagicMock()
    fixture_no_genre = ChapterExtractionResult(nodes=[], edges=[], genre=None)
    mock_response = MagicMock()
    mock_response.output_parsed = fixture_no_genre
    mock_client.responses.parse.return_value = mock_response

    extractor = ChapterExtractor(client=mock_client, model="gpt-4o-mini")
    result = extractor.extract(
        chapter_text="Some text.",
        chapter_id="ch2",
        chapter_title="Chapter 2",
        paragraph_ids=["p5"],
        is_first_chapter=False,
    )

    assert result.genre is None
    call_kwargs = mock_client.responses.parse.call_args[1]
    assert "Also detect the book" not in call_kwargs["instructions"]
