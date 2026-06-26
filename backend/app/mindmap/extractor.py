from __future__ import annotations

import logging
from typing import Any, Optional

from .schemas import ChapterExtractionResult

logger = logging.getLogger(__name__)

_EXTRACTION_SYSTEM = """\
You are a concept extraction assistant. Extract the key concepts, themes, arguments,
and characters from a book chapter and return them as a structured graph.

Node types:
- theme: a major recurring idea or argument the author builds
- concept: a defined term, framework, or named model
- argument: a specific claim the author makes and defends with evidence
- character: a person, place, or organisation that plays a meaningful role

Rules:
- Extract 3–12 nodes per chapter. Prefer quality over quantity.
- importance is 0.0–1.0; the most central idea in the chapter should be 0.8–1.0.
- paragraph_ids must come only from the provided list.
- summary must be 1–2 sentences describing what the book says about this concept.
- Edge labels should be short relationship descriptions (e.g. "leads to", "supports", "contrasts with").
- Node IDs must be unique within this chapter (use "ch<N>-n<M>" format).
"""

_FIRST_CHAPTER_SUFFIX = """
Also detect the book's genre. Set genre to one of: fiction, non-fiction, biography,
history, philosophy, science, self-help, other.
"""


class ChapterExtractor:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    def extract(
        self,
        *,
        chapter_text: str,
        chapter_id: str,
        chapter_title: Optional[str],
        paragraph_ids: list[str],
        is_first_chapter: bool,
    ) -> ChapterExtractionResult:
        instructions = _EXTRACTION_SYSTEM
        if is_first_chapter:
            instructions += _FIRST_CHAPTER_SUFFIX

        para_list = ", ".join(paragraph_ids[:50])
        user_input = (
            f"Chapter: {chapter_title or chapter_id}\n"
            f"Available paragraph IDs: [{para_list}]\n\n"
            f"{chapter_text[:12000]}"
        )

        response = self._client.responses.parse(
            model=self._model,
            instructions=instructions,
            input=user_input,
            text_format=ChapterExtractionResult,
            max_output_tokens=1500,
        )

        result: Optional[ChapterExtractionResult] = response.output_parsed
        if result is None:
            logger.warning("Extractor returned None for chapter %s", chapter_id)
            return ChapterExtractionResult(nodes=[], edges=[], genre=None)

        return result
