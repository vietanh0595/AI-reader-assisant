from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# --- OpenAI structured-output models ---

class ExtractedNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str = Field(max_length=120)
    type: Literal["theme", "concept", "argument", "character"]
    summary: str = Field(max_length=400)
    importance: float = Field(ge=0.0, le=1.0)
    paragraph_ids: list[str] = Field(serialization_alias="passage_ids")
    chapter: Optional[int] = None  # chapter index (1-based), None = whole-book node


class ExtractedEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_id: str = Field(serialization_alias="from")
    to_id: str = Field(serialization_alias="to")
    label: str = Field(max_length=60)


class ChapterExtractionResult(BaseModel):
    nodes: list[ExtractedNode]
    edges: list[ExtractedEdge]
    genre: Optional[str] = None
    summary: Optional[str] = None  # 1–2 sentence summary of the whole chapter


class ConsolidationResult(BaseModel):
    genre: str
    nodes: list[ExtractedNode]
    edges: list[ExtractedEdge]


# --- API response schemas ---

class MindMapStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    data: Optional[dict[str, Any]] = None
    error: Optional[str] = None
