from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# --- OpenAI structured-output models ---

class ExtractedNode(BaseModel):
    id: str
    label: str = Field(max_length=120)
    type: Literal["theme", "concept", "argument", "character"]
    summary: str = Field(max_length=400)
    importance: float = Field(ge=0.0, le=1.0)
    paragraph_ids: list[str]


class ExtractedEdge(BaseModel):
    from_id: str
    to_id: str
    label: str = Field(max_length=60)


class ChapterExtractionResult(BaseModel):
    nodes: list[ExtractedNode]
    edges: list[ExtractedEdge]
    genre: Optional[str] = None


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
