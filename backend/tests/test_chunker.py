from __future__ import annotations

from types import SimpleNamespace

import pytest
from backend.app.indexing.chunker import StructureAwareChunker


def _block(
    paragraph_id: str,
    text: str,
    reading_order: int,
    block_kind: str = "body",
    chapter_id: str | None = None,
    chapter_title: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=None,
        index_version_id=None,
        paragraph_id=paragraph_id,
        reading_order=reading_order,
        block_kind=block_kind,
        text=text,
        text_hash="",
        source_ref={"source": "epub"},
        chapter_id=chapter_id,
        chapter_title=chapter_title,
    )


def blocks_fixture() -> list[BookBlock]:
    body_text = "Word " * 50  # ~50 tokens each
    return [
        _block("h1", "Chapter 1", 0, "chapterTitle", "chapter-1", "Chapter 1"),
        _block("p1", body_text, 1, "body", "chapter-1"),
        _block("p2", body_text, 2, "body", "chapter-1"),
        _block("p3", body_text, 3, "body", "chapter-1"),
        _block("p4", body_text, 4, "body", "chapter-1"),
        _block("p5", body_text, 5, "body", "chapter-1"),
        _block("p6", body_text, 6, "body", "chapter-1"),
        _block("p7", body_text, 7, "body", "chapter-1"),
        _block("p8", body_text, 8, "body", "chapter-1"),
        _block("p9", body_text, 9, "body", "chapter-1"),
        _block("p10", body_text, 10, "body", "chapter-1"),
        _block("h2", "Chapter 2", 11, "chapterTitle", "chapter-2", "Chapter 2"),
        _block("p11", body_text, 12, "body", "chapter-2"),
        _block("p12", body_text, 13, "body", "chapter-2"),
    ]


def long_blocks_fixture() -> list[BookBlock]:
    body_text = "Word " * 60  # ~60 tokens each
    return [
        _block("h1", "Chapter 1", 0, "chapterTitle", "chapter-1", "Chapter 1"),
        *[_block(f"p{i}", body_text, i + 1, "body", "chapter-1") for i in range(20)],
    ]


def test_chunker_keeps_heading_with_body_and_stops_at_chapter():
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(
        blocks_fixture()
    )
    assert chunks[0].embedding_input_text.startswith("Chapter 1\n")
    assert chunks[0].chapter_id == "chapter-1"
    assert all(chunk.token_count <= 800 for chunk in chunks)
    assert not any(
        chunk.chapter_id == "chapter-1" and "Chapter 2" in chunk.raw_text
        for chunk in chunks
    )


def test_chunker_overlap_is_capped_at_one_hundred_tokens():
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(
        long_blocks_fixture()
    )
    assert len(chunks) >= 2
    assert chunks[1].overlap_token_count <= 100


def test_chunker_all_paragraphs_are_covered():
    fixture = blocks_fixture()
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(fixture)
    all_paragraph_ids = {pid for chunk in chunks for pid in chunk.paragraph_ids}
    expected = {b.paragraph_id for b in fixture}
    assert all_paragraph_ids == expected


def test_chunker_chapter_boundary_starts_new_chunk():
    fixture = blocks_fixture()
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(fixture)
    chapter_1_ids = {c.chapter_id for c in chunks}
    assert "chapter-1" in chapter_1_ids
    assert "chapter-2" in chapter_1_ids
    for chunk in chunks:
        assert chunk.chapter_id in ("chapter-1", "chapter-2")


def test_chunker_empty_input_returns_empty():
    chunks = StructureAwareChunker().chunk([])
    assert chunks == []


def test_chunker_single_block_produces_one_chunk():
    blocks = [_block("p1", "Hello world.", 0, "body", "ch1")]
    chunks = StructureAwareChunker().chunk(blocks)
    assert len(chunks) == 1
    assert "Hello world." in chunks[0].raw_text
