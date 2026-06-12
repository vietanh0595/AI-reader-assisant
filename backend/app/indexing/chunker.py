from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import tiktoken


_ENCODING_NAME = "cl100k_base"
_HEADING_KINDS = {"chapterNumber", "chapterTitle", "sectionHeading", "subheading"}


@dataclass(frozen=True)
class ChunkDraft:
    raw_text: str
    embedding_input_text: str
    token_count: int
    overlap_token_count: int
    reading_order_start: int
    reading_order_end: int
    paragraph_ids: list[str]
    chapter_id: str | None
    chapter_title: str | None
    source_refs: list[dict[str, Any]]


class StructureAwareChunker:
    def __init__(
        self,
        target_tokens: int = 600,
        min_tokens: int = 100,
        max_tokens: int = 800,
        overlap_max_tokens: int = 100,
    ) -> None:
        self._target = target_tokens
        self._min = min_tokens
        self._max = max_tokens
        self._overlap_max = overlap_max_tokens
        self._enc = tiktoken.get_encoding(_ENCODING_NAME)

    def _count(self, text: str) -> int:
        return len(self._enc.encode(text))

    def _truncate_to_tokens(self, text: str, max_tok: int) -> str:
        tokens = self._enc.encode(text)
        if len(tokens) <= max_tok:
            return text
        return self._enc.decode(tokens[-max_tok:])

    def chunk(self, blocks: list[Any]) -> list[ChunkDraft]:  # Any = BookBlock
        if not blocks:
            return []

        chunks: list[ChunkDraft] = []
        pending_headings: list[Any] = []
        window: list[Any] = []  # blocks in the current chunk
        window_tokens: int = 0
        prev_body_block: Any = None  # last flushed body block for overlap
        current_chapter_id: str | None = None
        current_chapter_title: str | None = None

        def flush(overlap_block: Any | None = None) -> None:
            nonlocal window, window_tokens, prev_body_block

            if not window:
                return

            overlap_text = ""
            overlap_tokens = 0
            if overlap_block is not None:
                overlap_text = self._truncate_to_tokens(
                    overlap_block.text, self._overlap_max
                )
                overlap_tokens = self._count(overlap_text)

            raw_parts = [b.text for b in window]
            raw_text = "\n".join(raw_parts)

            embed_parts: list[str] = []
            if overlap_text:
                embed_parts.append(overlap_text)
            embed_parts.extend(raw_parts)
            embedding_input_text = "\n".join(embed_parts)

            total_tokens = self._count(embedding_input_text)

            chunk_chapter_id = window[0].chapter_id if window else current_chapter_id
            chunk_chapter_title = window[0].chapter_title if window else current_chapter_title
            for b in window:
                if b.chapter_id:
                    chunk_chapter_id = b.chapter_id
                    chunk_chapter_title = b.chapter_title
                    break

            chunks.append(
                ChunkDraft(
                    raw_text=raw_text,
                    embedding_input_text=embedding_input_text,
                    token_count=total_tokens,
                    overlap_token_count=overlap_tokens,
                    reading_order_start=window[0].reading_order,
                    reading_order_end=window[-1].reading_order,
                    paragraph_ids=[b.paragraph_id for b in window],
                    chapter_id=chunk_chapter_id,
                    chapter_title=chunk_chapter_title,
                    source_refs=[b.source_ref for b in window],
                )
            )

            prev_body_block = next(
                (b for b in reversed(window) if b.block_kind not in _HEADING_KINDS), None
            )
            window = []
            window_tokens = 0

        for block in blocks:
            block_tokens = self._count(block.text)
            is_heading = block.block_kind in _HEADING_KINDS

            chapter_changed = (
                block.chapter_id is not None
                and block.chapter_id != current_chapter_id
                and current_chapter_id is not None
            )

            if chapter_changed and window:
                flush(prev_body_block)
                pending_headings = []

            if is_heading:
                if window and not chapter_changed:
                    flush(prev_body_block)
                pending_headings.append(block)
                if block.chapter_id:
                    current_chapter_id = block.chapter_id
                    current_chapter_title = block.chapter_title
                continue

            if block.chapter_id:
                current_chapter_id = block.chapter_id
                current_chapter_title = block.chapter_title

            for ph in pending_headings:
                heading_tokens = self._count(ph.text)
                window.append(ph)
                window_tokens += heading_tokens
            pending_headings = []

            if window_tokens + block_tokens > self._max and window:
                flush(prev_body_block)

            window.append(block)
            window_tokens += block_tokens

            if window_tokens >= self._target:
                flush(prev_body_block)

        for ph in pending_headings:
            window.append(ph)
        if window:
            flush(prev_body_block)

        return chunks
