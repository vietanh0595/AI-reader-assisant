from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from backend.app.mindmap.schemas import (
    ChapterExtractionResult,
    ConsolidationResult,
    ExtractedEdge,
    ExtractedNode,
)
from backend.app.mindmap.models import MindMapStatus
from backend.app.mindmap.service import MindMapService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_node(node_id: str) -> ExtractedNode:
    return ExtractedNode(
        id=node_id,
        label=f"Node {node_id}",
        type="concept",
        summary="A test concept.",
        importance=0.8,
        paragraph_ids=["p1"],
    )


def _make_chapter_result(n_nodes: int = 1) -> ChapterExtractionResult:
    return ChapterExtractionResult(
        nodes=[_make_node(f"ch1-n{i}") for i in range(n_nodes)],
        edges=[],
        genre="non-fiction",
    )


def _make_consolidation_result(n_nodes: int = 3) -> ConsolidationResult:
    return ConsolidationResult(
        genre="non-fiction",
        nodes=[_make_node(f"n{i}") for i in range(n_nodes)],
        edges=[],
    )


def _make_service(
    extractor_result: ChapterExtractionResult | Exception | None = None,
    consolidation_result: ConsolidationResult | None = None,
    chapters: list | None = None,
) -> tuple[MindMapService, MagicMock, MagicMock, MagicMock]:
    """Build a MindMapService with all collaborators mocked."""
    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=None)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_session.begin.return_value = mock_ctx

    mock_factory = MagicMock(return_value=mock_session)

    mock_extractor = MagicMock()
    if isinstance(extractor_result, Exception):
        mock_extractor.extract.side_effect = extractor_result
    elif extractor_result is not None:
        mock_extractor.extract.return_value = extractor_result

    mock_consolidator = MagicMock()
    if consolidation_result is not None:
        mock_consolidator.consolidate.return_value = consolidation_result

    service = MindMapService(
        session_factory=mock_factory,
        extractor=mock_extractor,
        consolidator=mock_consolidator,
    )

    # Override _load_chapters to avoid DB queries
    if chapters is not None:
        service._load_chapters = MagicMock(return_value=chapters)

    return service, mock_extractor, mock_consolidator, mock_session


# ---------------------------------------------------------------------------
# initiate() tests
# ---------------------------------------------------------------------------

class TestInitiate:
    def test_raises_when_already_generating(self):
        """initiate() raises RuntimeError('already_generating') if status is GENERATING."""
        _, _, _, mock_session = _make_service()

        mock_book = MagicMock()
        mock_book.user_id = (user_id := uuid4())
        mock_session.get.return_value = mock_book

        mock_mindmap = MagicMock()
        mock_mindmap.status = MindMapStatus.GENERATING
        mock_session.scalar.return_value = mock_mindmap

        service = MindMapService(
            session_factory=MagicMock(return_value=mock_session),
            extractor=MagicMock(),
            consolidator=MagicMock(),
        )
        book_id = uuid4()
        mock_book.user_id = user_id

        with pytest.raises(RuntimeError, match="already_generating"):
            service.initiate(user_id=user_id, book_id=book_id)

    def test_raises_when_book_not_found(self):
        """initiate() raises ValueError when session.get returns None."""
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=None)
        ctx.__exit__ = MagicMock(return_value=False)
        mock_session.begin.return_value = ctx
        mock_session.get.return_value = None

        service = MindMapService(
            session_factory=MagicMock(return_value=mock_session),
            extractor=MagicMock(),
            consolidator=MagicMock(),
        )

        with pytest.raises(ValueError, match="Book not found"):
            service.initiate(user_id=uuid4(), book_id=uuid4())

    def test_raises_when_wrong_user(self):
        """initiate() raises ValueError when book belongs to a different user."""
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=None)
        ctx.__exit__ = MagicMock(return_value=False)
        mock_session.begin.return_value = ctx

        mock_book = MagicMock()
        mock_book.user_id = uuid4()  # different user
        mock_session.get.return_value = mock_book

        service = MindMapService(
            session_factory=MagicMock(return_value=mock_session),
            extractor=MagicMock(),
            consolidator=MagicMock(),
        )

        with pytest.raises(ValueError, match="Book not found"):
            service.initiate(user_id=uuid4(), book_id=uuid4())


# ---------------------------------------------------------------------------
# generate() / _run_pipeline() tests
# ---------------------------------------------------------------------------

class TestGenerate:
    def _chapter_tuple(self, chapter_id: str = "ch1") -> tuple:
        return (chapter_id, "Chapter 1", [MagicMock(text="text", paragraph_id="p1")])

    def test_stores_ready_when_pipeline_succeeds_with_enough_nodes(self):
        """generate() stores READY when consolidation returns ≥3 nodes."""
        chapter = self._chapter_tuple()
        extraction = _make_chapter_result(n_nodes=2)
        consolidation = _make_consolidation_result(n_nodes=3)

        service, mock_extractor, mock_consolidator, _ = _make_service(
            extractor_result=extraction,
            consolidation_result=consolidation,
            chapters=[chapter],
        )
        service._store_result = MagicMock()

        service._run_pipeline(book_id=uuid4())

        service._store_result.assert_called_once()
        call_args = service._store_result.call_args
        assert call_args[0][1] == MindMapStatus.READY
        stored_data = call_args.kwargs["data"]
        assert stored_data is not None
        assert "nodes" in stored_data
        assert "edges" in stored_data
        assert "genre" in stored_data

    def test_stores_insufficient_content_when_few_nodes(self):
        """generate() stores INSUFFICIENT_CONTENT when consolidation returns <3 nodes."""
        chapter = self._chapter_tuple()
        extraction = _make_chapter_result(n_nodes=1)
        consolidation = _make_consolidation_result(n_nodes=2)

        service, _, _, _ = _make_service(
            extractor_result=extraction,
            consolidation_result=consolidation,
            chapters=[chapter],
        )
        service._store_result = MagicMock()

        service._run_pipeline(book_id=uuid4())

        service._store_result.assert_called_once()
        assert service._store_result.call_args[0][1] == MindMapStatus.INSUFFICIENT_CONTENT

    def test_stores_insufficient_content_when_no_chapters(self):
        """_run_pipeline() stores INSUFFICIENT_CONTENT when book has no chapters."""
        service, _, _, _ = _make_service(chapters=[])
        service._store_result = MagicMock()

        service._run_pipeline(book_id=uuid4())

        service._store_result.assert_called_once()
        assert service._store_result.call_args[0][1] == MindMapStatus.INSUFFICIENT_CONTENT

    def test_stores_failed_when_all_chapters_fail(self):
        """_run_pipeline() calls set_failed when all chapter extractions raise."""
        chapter = self._chapter_tuple()

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=None)
        ctx.__exit__ = MagicMock(return_value=False)
        mock_session.begin.return_value = ctx
        mock_factory = MagicMock(return_value=mock_session)

        mock_extractor = MagicMock()
        mock_extractor.extract.side_effect = RuntimeError("LLM error")

        service = MindMapService(
            session_factory=mock_factory,
            extractor=mock_extractor,
            consolidator=MagicMock(),
        )
        service._load_chapters = MagicMock(return_value=[chapter])

        # Patch MindMapRepository to capture set_failed call
        with patch("backend.app.mindmap.service.MindMapRepository") as MockRepo:
            service._run_pipeline(book_id=uuid4())
            MockRepo.return_value.set_failed.assert_called_once()
            call_args = MockRepo.return_value.set_failed.call_args[0]
            assert "All chapter extractions failed" in call_args[1]

    def test_single_chapter_failure_is_skipped(self):
        """A single failing chapter is skipped; successful chapters continue."""
        good_chapter = ("ch1", "Chapter 1", [MagicMock(text="good text", paragraph_id="p1")])
        bad_chapter = ("ch2", "Chapter 2", [MagicMock(text="bad text", paragraph_id="p2")])
        consolidation = _make_consolidation_result(n_nodes=3)

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=None)
        ctx.__exit__ = MagicMock(return_value=False)
        mock_session.begin.return_value = ctx
        mock_factory = MagicMock(return_value=mock_session)

        good_result = _make_chapter_result(n_nodes=2)

        mock_extractor = MagicMock()
        # First call succeeds, second raises
        mock_extractor.extract.side_effect = [good_result, RuntimeError("fail")]

        mock_consolidator = MagicMock()
        mock_consolidator.consolidate.return_value = consolidation

        service = MindMapService(
            session_factory=mock_factory,
            extractor=mock_extractor,
            consolidator=mock_consolidator,
        )
        service._load_chapters = MagicMock(return_value=[good_chapter, bad_chapter])
        service._store_result = MagicMock()

        service._run_pipeline(book_id=uuid4())

        # Consolidator should be called with one successful result
        mock_consolidator.consolidate.assert_called_once()
        chapters_arg = mock_consolidator.consolidate.call_args[1]["chapters"]
        assert len(chapters_arg) == 1

        # Final status should be READY (enough nodes)
        service._store_result.assert_called_once()
        assert service._store_result.call_args[0][1] == MindMapStatus.READY

    def test_serialized_data_uses_spec_aliases(self):
        """Stored data uses 'passage_ids' and 'from'/'to' keys (spec JSONB shape)."""
        chapter = self._chapter_tuple()
        extraction = _make_chapter_result(n_nodes=2)
        node = _make_node("n1")
        edge = ExtractedEdge(from_id="n1", to_id="n2", label="leads to")
        consolidation = ConsolidationResult(
            genre="non-fiction",
            nodes=[node, _make_node("n2"), _make_node("n3")],
            edges=[edge],
        )

        service, _, _, _ = _make_service(
            extractor_result=extraction,
            consolidation_result=consolidation,
            chapters=[chapter],
        )
        service._store_result = MagicMock()

        service._run_pipeline(book_id=uuid4())

        stored_data = service._store_result.call_args.kwargs["data"]
        assert "passage_ids" in stored_data["nodes"][0], "nodes must use passage_ids alias"
        assert "paragraph_ids" not in stored_data["nodes"][0]
        assert "from" in stored_data["edges"][0], "edges must use 'from' alias"
        assert "to" in stored_data["edges"][0], "edges must use 'to' alias"
        assert "from_id" not in stored_data["edges"][0]
        assert "to_id" not in stored_data["edges"][0]
