from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class BookAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question: str = Field(min_length=1, max_length=1000)
    current_paragraph_id: str = Field(alias="currentParagraphId", min_length=1, max_length=160)
    current_reading_order: int = Field(alias="currentReadingOrder", ge=0)
    current_chapter_id: Optional[str] = Field(default=None, alias="currentChapterId", max_length=160)
    include_whole_book: bool = Field(default=False, alias="includeWholeBook")


class BookSourceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    paragraph_id: str = Field(alias="paragraphId")
    chapter_title: Optional[str] = Field(default=None, alias="chapterTitle")
    excerpt: str
    page_index: Optional[int] = Field(default=None, alias="pageIndex")
    page_label: Optional[str] = Field(default=None, alias="pageLabel")
    source_ref: dict[str, Any] = Field(alias="sourceRef")


class BookAskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: str = Field(alias="requestId")
    eyebrow: str
    body: str
    supported: bool
    sources: list[BookSourceResponse] = Field(max_length=3)
