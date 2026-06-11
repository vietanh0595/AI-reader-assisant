from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SelectionKind = Literal["word", "phrase", "paragraph"]
AssistAction = Literal["explain", "example", "rephrase", "ask", "simpler", "summarize"]
AssistContextScope = Literal["paragraph", "visiblePage", "chapter"]


class AssistContextBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    block_kind: Optional[str] = Field(default=None, alias="blockKind", max_length=40)
    id: str = Field(min_length=1, max_length=160)
    paragraph_id: str = Field(alias="paragraphId", min_length=1, max_length=160)
    source_ref: Optional[dict[str, Any]] = Field(default=None, alias="sourceRef")
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("block_kind", "id", "paragraph_id", "text", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value

class AssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    action: AssistAction
    author: str = Field(min_length=1, max_length=200)
    book_title: str = Field(alias="bookTitle", min_length=1, max_length=200)
    context_blocks: list[AssistContextBlock] = Field(default_factory=list, alias="contextBlocks", max_length=80)
    context_scope: AssistContextScope = Field(default="paragraph", alias="contextScope")
    paragraph_text: Optional[str] = Field(default=None, alias="paragraphText", max_length=8000)
    question: Optional[str] = Field(default=None, max_length=1000)
    selected_text: Optional[str] = Field(default=None, alias="selectedText", max_length=4000)
    selection_kind: Optional[SelectionKind] = Field(default=None, alias="selectionKind")

    @field_validator("author", "book_title", "paragraph_text", "question", "selected_text", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value

    @model_validator(mode="after")
    def validate_context(self) -> "AssistRequest":
        selected_text = self.selected_text or ""

        if self.action != "summarize" and not selected_text:
            raise ValueError("selectedText is required unless action is summarize.")

        if self.action != "summarize" and self.selection_kind is None:
            raise ValueError("selectionKind is required unless action is summarize.")

        if not self.context_blocks and self.paragraph_text:
            self.context_blocks = [
                AssistContextBlock(
                    blockKind="body",
                    id="legacy-paragraph",
                    paragraphId="legacy-paragraph",
                    text=self.paragraph_text,
                )
            ]

        if not self.context_blocks and selected_text:
            self.context_blocks = [
                AssistContextBlock(
                    blockKind="body",
                    id="selected-text",
                    paragraphId="selected-text",
                    text=selected_text,
                )
            ]

        if not self.context_blocks:
            raise ValueError("contextBlocks or paragraphText is required.")

        total_context_chars = sum(len(block.text) for block in self.context_blocks)
        if total_context_chars > 24_000:
            raise ValueError("contextBlocks total text must be 24000 characters or fewer.")

        return self


class AssistResponse(BaseModel):
    eyebrow: str = Field(min_length=1, max_length=40)
    body: str = Field(min_length=1, max_length=600)


class OcrRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    image_data_url: str = Field(alias="imageDataUrl", min_length=32, max_length=8_000_000)

    @field_validator("image_data_url", mode="before")
    @classmethod
    def strip_image_data_url(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value

    @field_validator("image_data_url")
    @classmethod
    def validate_image_data_url(cls, value: str) -> str:
        if not value.startswith("data:image/") or ";base64," not in value:
            raise ValueError("imageDataUrl must be a base64 image data URL.")

        return value


class OcrTextBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confidence: Optional[float] = Field(ge=0, le=1)
    text: str = Field(min_length=1, max_length=4000)

    @field_validator("text", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value


class OcrResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    author: str = Field(min_length=1, max_length=120)
    blocks: list[OcrTextBlock] = Field(max_length=80)
    language: Optional[str] = Field(max_length=40)
    text: str = Field(max_length=50_000)
    title: str = Field(min_length=1, max_length=160)

    @field_validator("author", "language", "text", "title", mode="before")
    @classmethod
    def strip_response_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value
