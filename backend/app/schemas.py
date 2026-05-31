from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


SelectionKind = Literal["word", "phrase", "paragraph"]
AssistAction = Literal["explain", "example", "rephrase", "ask", "simpler"]


class AssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    action: AssistAction
    author: str = Field(min_length=1, max_length=200)
    book_title: str = Field(alias="bookTitle", min_length=1, max_length=200)
    paragraph_text: str = Field(alias="paragraphText", min_length=1, max_length=8000)
    question: str | None = Field(default=None, max_length=1000)
    selected_text: str = Field(alias="selectedText", min_length=1, max_length=4000)
    selection_kind: SelectionKind = Field(alias="selectionKind")

    @field_validator("author", "book_title", "paragraph_text", "question", "selected_text", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()

        return value


class AssistResponse(BaseModel):
    eyebrow: str = Field(min_length=1, max_length=40)
    body: str = Field(min_length=1, max_length=600)
