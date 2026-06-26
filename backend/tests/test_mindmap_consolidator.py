from __future__ import annotations

from unittest.mock import MagicMock
from backend.app.mindmap.consolidator import MindMapConsolidator
from backend.app.mindmap.schemas import (
    ConsolidationResult,
    ExtractedNode,
    ExtractedEdge,
    ChapterExtractionResult,
)

CHAPTER_1_NODES = [
    ExtractedNode(id="ch1-n1", label="Habit Loop", type="concept", summary="Cue, craving, response, reward.", importance=0.95, paragraph_ids=["p1"]),
    ExtractedNode(id="ch1-n2", label="Identity Change", type="theme", summary="Change your identity, not just your behaviour.", importance=0.85, paragraph_ids=["p2"]),
]
CHAPTER_2_NODES = [
    ExtractedNode(id="ch2-n1", label="The Habit Cycle", type="concept", summary="Another name for the four-step loop.", importance=0.8, paragraph_ids=["p5"]),
    ExtractedNode(id="ch2-n2", label="Environment Design", type="concept", summary="Make good habits obvious.", importance=0.7, paragraph_ids=["p6"]),
]

FIXTURE_CONSOLIDATION = ConsolidationResult(
    genre="self-help",
    nodes=[
        ExtractedNode(id="n1", label="Habit Loop", type="concept", summary="Four-step pattern underpinning all habits.", importance=0.95, paragraph_ids=["p1", "p5"]),
        ExtractedNode(id="n2", label="Identity Change", type="theme", summary="Lasting habits require an identity shift.", importance=0.9, paragraph_ids=["p2"]),
        ExtractedNode(id="n3", label="Environment Design", type="concept", summary="Make cues for good habits visible.", importance=0.7, paragraph_ids=["p6"]),
    ],
    edges=[
        ExtractedEdge(from_id="n1", to_id="n2", label="enables"),
        ExtractedEdge(from_id="n1", to_id="n3", label="applied via"),
    ],
)


def test_consolidator_calls_gpt4o_and_returns_result():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = FIXTURE_CONSOLIDATION
    mock_client.responses.parse.return_value = mock_response

    chapters = [
        ChapterExtractionResult(nodes=CHAPTER_1_NODES, edges=[], genre="self-help"),
        ChapterExtractionResult(nodes=CHAPTER_2_NODES, edges=[], genre=None),
    ]
    consolidator = MindMapConsolidator(client=mock_client, model="gpt-4o")
    result = consolidator.consolidate(chapters=chapters, detected_genre="self-help")

    assert result.genre == "self-help"
    assert len(result.nodes) == 3
    assert result.nodes[0].label == "Habit Loop"
    mock_client.responses.parse.assert_called_once()
    call_kwargs = mock_client.responses.parse.call_args[1]
    assert call_kwargs["model"] == "gpt-4o"


def test_consolidator_returns_empty_on_none_response():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = None
    mock_client.responses.parse.return_value = mock_response

    consolidator = MindMapConsolidator(client=mock_client, model="gpt-4o")
    result = consolidator.consolidate(chapters=[], detected_genre="non-fiction")

    assert result.nodes == []
    assert result.edges == []
