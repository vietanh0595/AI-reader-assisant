from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..auth.dependencies import get_current_user
from ..db.models import User
from ..indexing.models import Book, IndexVersionStatus
from ..retrieval.repository import RetrievalRepository
from ..retrieval.schemas import BookAskRequest, BookAskResponse, BookSourceResponse
from ..retrieval.service import RetrievalService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/library/books", tags=["book-ask"])


def _build_retrieval_service(request: Request) -> RetrievalService:
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    from openai import OpenAI
    from ..indexing.embeddings import OpenAIEmbeddingProvider

    embedder = OpenAIEmbeddingProvider(
        OpenAI(api_key=settings.openai_api_key),
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )
    repo = RetrievalRepository(factory)
    return RetrievalService(
        repo=repo,
        embedder=embedder,
        vector_candidates=settings.rag_vector_candidates,
        keyword_candidates=settings.rag_keyword_candidates,
        fused_candidates=settings.rag_fused_candidates,
        rrf_k=settings.rag_rrf_k,
        min_vector_similarity=settings.rag_min_vector_similarity,
        context_max_chars=settings.rag_context_max_chars,
    )


def _build_agent(request: Request):
    from openai import OpenAI
    from ..retrieval.agent import BookAgent
    settings = request.app.state.settings
    client = OpenAI(api_key=settings.openai_api_key)
    retrieval = _build_retrieval_service(request)
    return BookAgent(
        client=client,
        model=settings.openai_model,
        retrieval=retrieval,
        reasoning_effort=settings.openai_reasoning_effort,
    )


@router.post("/{book_id}/ask", response_model=BookAskResponse)
def ask_book(
    book_id: UUID,
    ask_request: BookAskRequest,
    request: Request,
    user: User = Depends(get_current_user),
) -> BookAskResponse:
    factory = request.app.state.session_factory

    with factory() as session:
        book = session.get(Book, book_id)

    if book is None or book.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    if book.active_index_version_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"status": "not_indexed", "message": "Book has no active index."},
        )

    with factory() as session:
        from ..indexing.models import IndexVersion
        version = session.get(IndexVersion, book.active_index_version_id)

    if version is None or version.status != IndexVersionStatus.READY:
        current_status = version.status if version else "unknown"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"status": current_status, "message": "Index is not ready."},
        )

    agent = _build_agent(request)
    answer = agent.answer(
        user_id=user.id,
        book_id=book_id,
        question=ask_request.question,
        history=[t.model_dump() for t in ask_request.history],
        selected_text=ask_request.selected_text,
        quoted_answer=ask_request.quoted_answer,
        current_reading_order=ask_request.current_reading_order,
        include_whole_book=ask_request.include_whole_book,
        allow_general_knowledge=ask_request.allow_general_knowledge,
    )

    return BookAskResponse(
        requestId=answer.request_id,
        eyebrow=answer.eyebrow,
        body=answer.body,
        supported=answer.supported,
        sources=[
            BookSourceResponse(
                id=s.id,
                paragraphId=s.paragraph_id,
                chapterTitle=s.chapter_title,
                excerpt=s.excerpt,
                pageIndex=s.page_index,
                pageLabel=s.page_label,
                sourceRef=s.source_ref,
            )
            for s in answer.sources
        ],
    )
