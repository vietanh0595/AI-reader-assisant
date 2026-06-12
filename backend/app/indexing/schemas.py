from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class IndexBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    paragraph_id: str = Field(alias="paragraphId", min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=5000)
    reading_order: int = Field(alias="readingOrder", ge=0)
    block_kind: str = Field(alias="blockKind", max_length=40)
    chapter_id: Optional[str] = Field(default=None, alias="chapterId", max_length=160)
    chapter_title: Optional[str] = Field(default=None, alias="chapterTitle", max_length=300)
    source_ref: dict[str, Any] = Field(alias="sourceRef")


class CreateIndexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    client_book_id: str = Field(alias="clientBookId", min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(min_length=1, max_length=300)
    source_type: Literal["epub", "pdf", "scan"] = Field(alias="sourceType")
    file_name: Optional[str] = Field(default=None, alias="fileName", max_length=500)
    content_hash: str = Field(alias="contentHash", pattern=r"^[a-f0-9]{64}$")
    block_count: int = Field(alias="blockCount", ge=1, le=100_000)
    parser_schema_version: int = Field(alias="parserSchemaVersion", ge=1)


class CreateIndexResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    book_id: str = Field(alias="bookId")
    version_id: str = Field(alias="versionId")
    reused: bool
    acknowledged_batches: int = Field(default=0, alias="acknowledgedBatches")


class IndexBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocks: list[IndexBlock] = Field(min_length=1, max_length=250)


class BatchUploadResponse(BaseModel):
    replayed: bool
    sequence_number: int = Field(alias="sequenceNumber")
    block_count: int = Field(alias="blockCount")

    model_config = ConfigDict(populate_by_name=True)


class IndexStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    progress: float
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    error_message: Optional[str] = Field(default=None, alias="errorMessage")
    version_id: Optional[str] = Field(default=None, alias="versionId")
