from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import MindMap, MindMapStatus


class MindMapRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, book_id: UUID) -> Optional[MindMap]:
        return self._session.scalar(
            select(MindMap).where(MindMap.book_id == book_id)
        )

    def upsert(
        self,
        book_id: UUID,
        status: MindMapStatus,
        data: Optional[dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> MindMap:
        existing = self.get(book_id)
        if existing is not None:
            existing.status = status
            existing.data = data
            existing.error = error
            if status == MindMapStatus.READY:
                existing.generated_at = datetime.now(tz=timezone.utc)
            return existing

        mindmap = MindMap(
            book_id=book_id,
            status=status,
            data=data,
            error=error,
            generated_at=datetime.now(tz=timezone.utc) if status == MindMapStatus.READY else None,
        )
        self._session.add(mindmap)
        return mindmap

    def set_failed(self, book_id: UUID, error: str) -> None:
        existing = self.get(book_id)
        if existing is not None:
            existing.status = MindMapStatus.FAILED
            existing.error = error
