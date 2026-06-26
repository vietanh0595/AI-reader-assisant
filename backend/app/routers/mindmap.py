from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from ..auth.dependencies import get_current_user
from ..db.models import User
from ..indexing.models import Book
from ..mindmap.consolidator import MindMapConsolidator
from ..mindmap.extractor import ChapterExtractor
from ..mindmap.models import MindMapStatus
from ..mindmap.repository import MindMapRepository
from ..mindmap.schemas import MindMapStatusResponse
from ..mindmap.service import AlreadyGeneratingError, MindMapService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/library/books", tags=["mindmap"])


def _build_mindmap_service(request: Request) -> MindMapService:
    from openai import OpenAI

    settings = request.app.state.settings
    factory = request.app.state.session_factory
    client = OpenAI(api_key=settings.openai_api_key)
    extractor = ChapterExtractor(client=client, model=settings.mindmap_extraction_model)
    consolidator = MindMapConsolidator(client=client, model=settings.mindmap_consolidation_model)
    return MindMapService(
        session_factory=factory,
        extractor=extractor,
        consolidator=consolidator,
    )


@router.post(
    "/{book_id}/mindmap/generate",
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_mindmap(
    book_id: UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(get_current_user),
) -> dict:
    service = _build_mindmap_service(request)
    try:
        service.initiate(user_id=user.id, book_id=book_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except AlreadyGeneratingError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mind map generation is already in progress.",
        ) from exc

    background_tasks.add_task(service.generate, user_id=user.id, book_id=book_id)
    return {"status": "generating"}


@router.get("/{book_id}/mindmap", response_model=MindMapStatusResponse)
def get_mindmap(
    book_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
) -> MindMapStatusResponse:
    factory = request.app.state.session_factory
    with factory() as session:
        book = session.get(Book, book_id)
        if book is None or book.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found.")
        repo = MindMapRepository(session)
        mindmap = repo.get(book_id)

    if mindmap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No mind map found for this book.")

    return MindMapStatusResponse(
        status=mindmap.status,
        data=mindmap.data,
        error=mindmap.error,
    )
