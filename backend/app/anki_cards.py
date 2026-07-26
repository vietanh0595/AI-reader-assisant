from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal, Optional

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)

CHUNK_SIZE = 8
# Caps concurrent OpenAI calls per export the same way MAX_EXTRACTION_WORKERS
# caps mind-map chapter extraction (backend/app/mindmap/service.py) — enough
# parallelism to keep latency flat as note count grows, without fanning a large
# export into more simultaneous requests than is reasonable.
MAX_WORKERS = 8

AnkiNoteAction = Literal["highlight", "explain", "example", "rephrase", "simpler", "summarize"]


# --- API request/response schemas ---

class AnkiNoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    note_id: str = Field(alias="noteId", min_length=1, max_length=100)
    action: AnkiNoteAction
    passage: Optional[str] = Field(default=None, max_length=4000)
    answer: Optional[str] = Field(default=None, max_length=4000)
    user_note: Optional[str] = Field(default=None, alias="userNote", max_length=2000)

    @field_validator("passage", "answer", "user_note", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class AnkiCardsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    notes: list[AnkiNoteInput] = Field(min_length=1, max_length=200)


class AnkiCardResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    note_id: str = Field(alias="noteId")
    front: str
    back: str


class AnkiCardsResponse(BaseModel):
    cards: list[AnkiCardResult]


# --- OpenAI structured-output schemas (internal, one chunk's worth of notes) ---

class GeneratedCard(BaseModel):
    note_id: str
    front: str = Field(max_length=300)
    back: str = Field(max_length=1000)


class CardBatchResult(BaseModel):
    cards: list[GeneratedCard]


_SYSTEM_PROMPT = """
You turn a reader's saved book notes into Anki flashcards. Each note has a
note_id and either a passage the reader highlighted, an AI explanation of a
passage, or both.

For each note, write a clear front/back flashcard:
- front: a specific, self-contained quiz question. Never just repeat the passage verbatim.
- back: the answer, in your own words, grounded only in the note's content.

If a note's content is too vague, generic, or fragmentary to support a real
quiz question, omit it from your output entirely — do not force a low-quality
card. Only include a note_id in your response for notes you actually turned
into a card.
""".strip()


def _build_user_input(notes: list[AnkiNoteInput]) -> str:
    lines: list[str] = []
    for note in notes:
        lines.append(f"note_id: {note.note_id}")
        lines.append(f"action: {note.action}")
        if note.passage:
            lines.append(f"passage: {note.passage}")
        if note.answer:
            lines.append(f"answer: {note.answer}")
        if note.user_note:
            lines.append(f"reader's own note: {note.user_note}")
        lines.append("")
    return "\n".join(lines)


def _generate_chunk(client: OpenAI, model: str, notes: list[AnkiNoteInput]) -> list[AnkiCardResult]:
    response = client.responses.parse(
        model=model,
        instructions=_SYSTEM_PROMPT,
        input=_build_user_input(notes),
        text_format=CardBatchResult,
        max_output_tokens=1500,
    )
    result: Optional[CardBatchResult] = response.output_parsed
    if result is None:
        return []

    valid_ids = {note.note_id for note in notes}
    return [
        AnkiCardResult(note_id=card.note_id, front=card.front, back=card.back)
        for card in result.cards
        if card.note_id in valid_ids
    ]


def generate_anki_cards(client: OpenAI, model: str, notes: list[AnkiNoteInput]) -> list[AnkiCardResult]:
    chunks = [notes[i : i + CHUNK_SIZE] for i in range(0, len(notes), CHUNK_SIZE)]
    cards: list[AnkiCardResult] = []

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(chunks))) as pool:
        futures = {pool.submit(_generate_chunk, client, model, chunk): chunk for chunk in chunks}
        for future in as_completed(futures):
            chunk = futures[future]
            try:
                cards.extend(future.result())
            except Exception:
                logger.warning(
                    "Anki card generation failed for a chunk of %d notes, skipping", len(chunk), exc_info=True
                )

    return cards
