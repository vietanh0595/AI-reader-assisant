from __future__ import annotations

import gzip
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..db.models import User
from ..db.session import session_dependency
from ..indexing.schemas import (
    BatchUploadResponse,
    CreateIndexRequest,
    CreateIndexResponse,
    IndexBatchRequest,
    IndexStatus,
)
from ..indexing.service import MAX_DECOMPRESSED_BYTES, IndexingService

router = APIRouter(prefix="/library/books", tags=["indexing"])


def get_session(request: Request) -> Session:
    return next(session_dependency(request.app.state.session_factory)())


def get_service(request: Request, session: Session = Depends(get_session)) -> IndexingService:
    return IndexingService(session)


@router.post("/index", response_model=CreateIndexResponse)
def create_or_resume(
    index_request: CreateIndexRequest,
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> CreateIndexResponse:
    return service.create_or_resume(user.id, index_request)


@router.put(
    "/{book_id}/index/versions/{version_id}/batches/{sequence_number}",
    response_model=BatchUploadResponse,
)
async def upload_batch(
    book_id: UUID,
    version_id: UUID,
    sequence_number: int,
    request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    payload_sha256: str = Header(..., alias="X-Payload-SHA256"),
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> BatchUploadResponse:
    raw = await request.body()

    computed_hash = hashlib.sha256(raw).hexdigest()
    if computed_hash != payload_sha256:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload SHA256 mismatch.",
        )

    if request.headers.get("content-encoding", "").lower() == "gzip":
        try:
            raw = gzip.decompress(raw)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid gzip payload.",
            )

    if len(raw) > MAX_DECOMPRESSED_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Batch payload exceeds 4 MiB after decompression.",
        )

    try:
        batch = IndexBatchRequest.model_validate_json(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return service.store_batch(
        user.id,
        book_id,
        version_id,
        sequence_number,
        idempotency_key=idempotency_key,
        payload_hash=payload_sha256,
        request=batch,
    )


@router.post("/{book_id}/index/versions/{version_id}/commit", response_model=IndexStatus)
def commit(
    book_id: UUID,
    version_id: UUID,
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> IndexStatus:
    return service.commit(user.id, book_id, version_id)


@router.get("/{book_id}/index/status", response_model=IndexStatus)
def get_status(
    book_id: UUID,
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> IndexStatus:
    return service.get_status(user.id, book_id)


@router.post("/{book_id}/index/versions/{version_id}/retry", response_model=IndexStatus)
def retry(
    book_id: UUID,
    version_id: UUID,
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> IndexStatus:
    return service.retry(user.id, book_id, version_id)


@router.delete("/{book_id}/index", status_code=status.HTTP_204_NO_CONTENT)
def delete_index(
    book_id: UUID,
    user: User = Depends(get_current_user),
    service: IndexingService = Depends(get_service),
) -> None:
    service.delete_book_index(user.id, book_id)
