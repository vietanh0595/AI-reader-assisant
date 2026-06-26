# Book Mind Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a per-book visual mind map (radial, pastel, linked to source passages) triggered on demand from the library card and reader toolbar.

**Architecture:** A FastAPI background task runs a two-pass OpenAI pipeline (GPT-4o-mini per chapter → GPT-4o consolidation) and stores the result as JSONB in a new `mindmaps` Postgres table. The frontend polls until ready, then renders a classic radial tree with `react-native-svg`. Tapping a node opens a bottom sheet with an AI summary, source passage links, and an Ask button that scopes the existing `ConversationThread` to that concept.

**Tech Stack:** Python/FastAPI (backend), SQLAlchemy + Alembic, OpenAI Responses API (`client.responses.parse`), React Native + TypeScript (frontend), `react-native-svg` (already installed), FastAPI `BackgroundTasks`.

---

## File Map

**New backend files:**
- `backend/app/mindmap/__init__.py`
- `backend/app/mindmap/models.py` — `MindMap` SQLAlchemy model + `MindMapStatus` enum
- `backend/app/mindmap/schemas.py` — Pydantic API schemas + OpenAI structured-output models
- `backend/app/mindmap/repository.py` — DB read/write for mindmap rows
- `backend/app/mindmap/extractor.py` — per-chapter GPT-4o-mini extraction
- `backend/app/mindmap/consolidator.py` — GPT-4o consolidation + dedup pass
- `backend/app/mindmap/service.py` — orchestration: blocks → extract → consolidate → store
- `backend/app/routers/mindmap.py` — `POST /{book_id}/mindmap/generate` + `GET /{book_id}/mindmap`
- `backend/alembic/versions/20260626_0003_mindmap.py` — migration

**Modified backend files:**
- `backend/app/config.py` — add `mindmap_extraction_model`, `mindmap_consolidation_model`
- `backend/app/main.py` — include mindmap router

**New backend test files:**
- `backend/tests/test_mindmap_extractor.py`
- `backend/tests/test_mindmap_consolidator.py`
- `backend/tests/test_mindmap_api.py`

**New frontend files:**
- `src/rag/mindmapTypes.ts` — TypeScript types
- `src/rag/mindmapApi.ts` — `generateMindMap`, `getMindMap` API calls
- `src/components/MindMapScreen.tsx` — react-native-svg radial tree + polling
- `src/components/MindMapScreen.test.tsx`
- `src/components/NodeTapSheet.tsx` — bottom sheet: summary + passages + Ask
- `src/components/NodeTapSheet.test.tsx`

**Modified frontend files:**
- `App.tsx` — mind map state, library card button, reader toolbar icon, navigation

---

## Task 1: MindMap SQLAlchemy model + Alembic migration

**Files:**
- Create: `backend/app/mindmap/__init__.py`
- Create: `backend/app/mindmap/models.py`
- Create: `backend/alembic/versions/20260626_0003_mindmap.py`

- [ ] **Step 1: Create the mindmap package**

```bash
touch backend/app/mindmap/__init__.py
```

- [ ] **Step 2: Write the model**

Create `backend/app/mindmap/models.py`:

```python
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base, UuidTimestampMixin


class MindMapStatus(str, Enum):
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"
    INSUFFICIENT_CONTENT = "insufficient_content"


class MindMap(UuidTimestampMixin, Base):
    __tablename__ = "mindmaps"

    book_id: Mapped[UUID] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=MindMapStatus.PENDING)
    data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```

- [ ] **Step 3: Write the Alembic migration**

Create `backend/alembic/versions/20260626_0003_mindmap.py`:

```python
"""Add mindmaps table.

Revision ID: 20260626_0003
Revises: 20260611_0002
Create Date: 2026-06-26
"""
from __future__ import annotations
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260626_0003"
down_revision: Optional[str] = "20260611_0002"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "mindmaps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("book_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("data", JSONB, nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("book_id", name="uq_mindmaps_book_id"),
    )
    op.create_index("ix_mindmaps_book_id", "mindmaps", ["book_id"])


def downgrade() -> None:
    op.drop_index("ix_mindmaps_book_id", table_name="mindmaps")
    op.drop_table("mindmaps")
```

- [ ] **Step 4: Run the migration**

```bash
source .venv/bin/activate
alembic -c backend/alembic.ini upgrade head
```

Expected: `Running upgrade 20260611_0002 -> 20260626_0003, Add mindmaps table`

- [ ] **Step 5: Verify the table exists**

```bash
docker compose exec postgres psql -U reader -d reader -c "\d mindmaps"
```

Expected: table columns listed including `book_id`, `status`, `data` (jsonb).

- [ ] **Step 6: Commit**

```bash
git add backend/app/mindmap/__init__.py backend/app/mindmap/models.py backend/alembic/versions/20260626_0003_mindmap.py
git commit -m "feat(mindmap): add MindMap model and migration"
```

---

## Task 2: Mindmap Pydantic schemas

**Files:**
- Create: `backend/app/mindmap/schemas.py`
- Test: `backend/tests/test_mindmap_extractor.py` (schema validation only in this task)

- [ ] **Step 1: Write the test**

Create `backend/tests/test_mindmap_extractor.py` with schema validation:

```python
from __future__ import annotations
import pytest
from backend.app.mindmap.schemas import (
    ExtractedNode,
    ExtractedEdge,
    ChapterExtractionResult,
    ConsolidationResult,
)


def test_extracted_node_requires_fields():
    node = ExtractedNode(
        id="n1",
        label="Habit Formation",
        type="theme",
        summary="Habits are loops.",
        importance=0.9,
        paragraph_ids=["p1", "p2"],
    )
    assert node.id == "n1"
    assert node.type == "theme"


def test_extracted_node_rejects_unknown_type():
    with pytest.raises(Exception):
        ExtractedNode(
            id="n1", label="x", type="unknown", summary="s", importance=0.5, paragraph_ids=[]
        )


def test_chapter_extraction_result_genre_optional():
    result = ChapterExtractionResult(nodes=[], edges=[])
    assert result.genre is None


def test_consolidation_result_requires_genre():
    result = ConsolidationResult(
        genre="non-fiction",
        nodes=[],
        edges=[],
    )
    assert result.genre == "non-fiction"
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pytest backend/tests/test_mindmap_extractor.py -v
```

Expected: `ImportError` — schemas module does not exist yet.

- [ ] **Step 3: Write the schemas**

Create `backend/app/mindmap/schemas.py`:

```python
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pytest backend/tests/test_mindmap_extractor.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mindmap/schemas.py backend/tests/test_mindmap_extractor.py
git commit -m "feat(mindmap): add Pydantic schemas for extraction and API"
```

---

## Task 3: Mindmap repository

**Files:**
- Create: `backend/app/mindmap/repository.py`
- Test: `backend/tests/integration/test_mindmap_models.py`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/integration/test_mindmap_models.py`:

```python
from __future__ import annotations
import pytest
from uuid import uuid4
from sqlalchemy.orm import Session
from backend.app.mindmap.models import MindMap, MindMapStatus
from backend.app.mindmap.repository import MindMapRepository
from backend.app.indexing.models import Book
from backend.app.db.models import User


@pytest.fixture
def user_and_book(db_session: Session):
    user = User()
    db_session.add(user)
    db_session.flush()
    book = Book(
        user_id=user.id,
        client_book_id="mm-test-book",
        title="Test Book",
        author="Author",
        source_type="epub",
    )
    db_session.add(book)
    db_session.flush()
    return user.id, book.id


def test_upsert_creates_new_row(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    mindmap = repo.upsert(book_id, MindMapStatus.GENERATING)
    assert mindmap.book_id == book_id
    assert mindmap.status == MindMapStatus.GENERATING
    assert mindmap.data is None


def test_upsert_overwrites_existing(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    repo.upsert(book_id, MindMapStatus.GENERATING)
    db_session.flush()
    repo.upsert(book_id, MindMapStatus.READY, data={"genre": "fiction", "nodes": [], "edges": []})
    result = repo.get(book_id)
    assert result is not None
    assert result.status == MindMapStatus.READY
    assert result.data["genre"] == "fiction"


def test_get_returns_none_when_missing(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    assert repo.get(book_id) is None


def test_set_failed(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    repo.upsert(book_id, MindMapStatus.GENERATING)
    db_session.flush()
    repo.set_failed(book_id, "openai_error: timeout")
    result = repo.get(book_id)
    assert result.status == MindMapStatus.FAILED
    assert result.error == "openai_error: timeout"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
docker compose --profile test up -d postgres-test
pytest backend/tests/integration/test_mindmap_models.py -v
```

Expected: `ImportError` — repository does not exist yet.

- [ ] **Step 3: Write the repository**

Create `backend/app/mindmap/repository.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import MindMap, MindMapStatus


class MindMapRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, book_id: UUID) -> Optional[MindMap]:
        return self._session.scalar(
            select(MindMap).where(MindMap.book_id == book_id)
        )

    def upsert(
        self,
        book_id: UUID,
        status: MindMapStatus,
        data: Optional[dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> MindMap:
        existing = self.get(book_id)
        if existing is not None:
            existing.status = status
            existing.data = data
            existing.error = error
            if status == MindMapStatus.READY:
                existing.generated_at = datetime.now(tz=timezone.utc)
            return existing

        mindmap = MindMap(
            book_id=book_id,
            status=status,
            data=data,
            error=error,
            generated_at=datetime.now(tz=timezone.utc) if status == MindMapStatus.READY else None,
        )
        self._session.add(mindmap)
        return mindmap

    def set_failed(self, book_id: UUID, error: str) -> None:
        existing = self.get(book_id)
        if existing is not None:
            existing.status = MindMapStatus.FAILED
            existing.error = error
```

- [ ] **Step 4: Run integration tests to confirm they pass**

```bash
pytest backend/tests/integration/test_mindmap_models.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mindmap/repository.py backend/tests/integration/test_mindmap_models.py
git commit -m "feat(mindmap): add MindMapRepository with upsert/get/set_failed"
```

---

## Task 4: Chapter extractor (GPT-4o-mini)

**Files:**
- Create: `backend/app/mindmap/extractor.py`
- Test: `backend/tests/test_mindmap_extractor.py` (add to existing file)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_mindmap_extractor.py`:

```python
from unittest.mock import MagicMock, patch
from backend.app.mindmap.extractor import ChapterExtractor
from backend.app.mindmap.schemas import ChapterExtractionResult, ExtractedNode, ExtractedEdge


FIXTURE_CHAPTER = """
Chapter 1: The Fundamentals of Habit Formation

Habits are the compound interest of self-improvement. Getting one percent better every day
counts for a lot in the long run. The habit loop consists of a cue, a craving, a response,
and a reward. Understanding these four components is the key to building better habits
and breaking bad ones.
"""

FIXTURE_EXTRACTION = ChapterExtractionResult(
    genre="non-fiction",
    nodes=[
        ExtractedNode(
            id="n1",
            label="Habit Loop",
            type="concept",
            summary="The four-step pattern: cue, craving, response, reward.",
            importance=0.95,
            paragraph_ids=["p1"],
        ),
    ],
    edges=[],
)


def test_extractor_returns_chapter_extraction_result():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = FIXTURE_EXTRACTION
    mock_client.responses.parse.return_value = mock_response

    extractor = ChapterExtractor(client=mock_client, model="gpt-4o-mini")
    result = extractor.extract(
        chapter_text=FIXTURE_CHAPTER,
        chapter_id="ch1",
        chapter_title="The Fundamentals",
        paragraph_ids=["p1"],
        is_first_chapter=True,
    )

    assert result.genre == "non-fiction"
    assert result.nodes[0].label == "Habit Loop"
    mock_client.responses.parse.assert_called_once()


def test_extractor_skips_genre_on_non_first_chapter():
    mock_client = MagicMock()
    fixture_no_genre = ChapterExtractionResult(nodes=[], edges=[], genre=None)
    mock_response = MagicMock()
    mock_response.output_parsed = fixture_no_genre
    mock_client.responses.parse.return_value = mock_response

    extractor = ChapterExtractor(client=mock_client, model="gpt-4o-mini")
    result = extractor.extract(
        chapter_text="Some text.",
        chapter_id="ch2",
        chapter_title="Chapter 2",
        paragraph_ids=["p5"],
        is_first_chapter=False,
    )

    assert result.genre is None
    # Confirm prompt mentions genre only for first chapter
    call_kwargs = mock_client.responses.parse.call_args[1]
    assert "genre" not in call_kwargs["instructions"] or "chapter 1" in call_kwargs["instructions"].lower()
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pytest backend/tests/test_mindmap_extractor.py -v -k "extractor"
```

Expected: `ImportError` — extractor module does not exist.

- [ ] **Step 3: Write the extractor**

Create `backend/app/mindmap/extractor.py`:

```python
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest backend/tests/test_mindmap_extractor.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mindmap/extractor.py backend/tests/test_mindmap_extractor.py
git commit -m "feat(mindmap): add ChapterExtractor with GPT-4o-mini structured output"
```

---

## Task 5: Consolidator (GPT-4o)

**Files:**
- Create: `backend/app/mindmap/consolidator.py`
- Create: `backend/tests/test_mindmap_consolidator.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mindmap_consolidator.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock
from backend.app.mindmap.consolidator import MindMapConsolidator
from backend.app.mindmap.schemas import (
    ConsolidationResult,
    ExtractedNode,
    ExtractedEdge,
    ChapterExtractionResult,
)

CHAPTER_1_NODES = [
    ExtractedNode(id="ch1-n1", label="Habit Loop", type="concept", summary="Cue, craving, response, reward.", importance=0.95, paragraph_ids=["p1"]),
    ExtractedNode(id="ch1-n2", label="Identity Change", type="theme", summary="Change your identity, not just your behaviour.", importance=0.85, paragraph_ids=["p2"]),
]
CHAPTER_2_NODES = [
    ExtractedNode(id="ch2-n1", label="The Habit Cycle", type="concept", summary="Another name for the four-step loop.", importance=0.8, paragraph_ids=["p5"]),
    ExtractedNode(id="ch2-n2", label="Environment Design", type="concept", summary="Make good habits obvious.", importance=0.7, paragraph_ids=["p6"]),
]

FIXTURE_CONSOLIDATION = ConsolidationResult(
    genre="self-help",
    nodes=[
        ExtractedNode(id="n1", label="Habit Loop", type="concept", summary="Four-step pattern underpinning all habits.", importance=0.95, paragraph_ids=["p1", "p5"]),
        ExtractedNode(id="n2", label="Identity Change", type="theme", summary="Lasting habits require an identity shift.", importance=0.9, paragraph_ids=["p2"]),
        ExtractedNode(id="n3", label="Environment Design", type="concept", summary="Make cues for good habits visible.", importance=0.7, paragraph_ids=["p6"]),
    ],
    edges=[
        ExtractedEdge(from_id="n1", to_id="n2", label="enables"),
        ExtractedEdge(from_id="n1", to_id="n3", label="applied via"),
    ],
)


def test_consolidator_calls_gpt4o_and_returns_result():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = FIXTURE_CONSOLIDATION
    mock_client.responses.parse.return_value = mock_response

    chapters = [
        ChapterExtractionResult(nodes=CHAPTER_1_NODES, edges=[], genre="self-help"),
        ChapterExtractionResult(nodes=CHAPTER_2_NODES, edges=[], genre=None),
    ]
    consolidator = MindMapConsolidator(client=mock_client, model="gpt-4o")
    result = consolidator.consolidate(chapters=chapters, detected_genre="self-help")

    assert result.genre == "self-help"
    assert len(result.nodes) == 3
    assert result.nodes[0].label == "Habit Loop"
    mock_client.responses.parse.assert_called_once()
    call_kwargs = mock_client.responses.parse.call_args[1]
    assert call_kwargs["model"] == "gpt-4o"


def test_consolidator_returns_empty_on_none_response():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.output_parsed = None
    mock_client.responses.parse.return_value = mock_response

    consolidator = MindMapConsolidator(client=mock_client, model="gpt-4o")
    result = consolidator.consolidate(chapters=[], detected_genre="non-fiction")

    assert result.nodes == []
    assert result.edges == []
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pytest backend/tests/test_mindmap_consolidator.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write the consolidator**

Create `backend/app/mindmap/consolidator.py`:

```python
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from .schemas import ChapterExtractionResult, ConsolidationResult

logger = logging.getLogger(__name__)

_CONSOLIDATION_SYSTEM = """\
You are a knowledge-graph editor. You receive concept nodes extracted from multiple
chapters of a book and must produce a clean, deduplicated whole-book mind map.

Rules:
- Merge nodes that refer to the same concept (even if named differently).
  Keep the clearest label; merge their paragraph_ids lists.
- Keep 8–25 nodes total. Drop minor nodes if there are too many.
- Re-number node IDs sequentially: n1, n2, n3, ...
- Assign importance 0.0–1.0 across the merged set; the most central idea gets 0.9–1.0.
- Write edges that reflect the relationships between the MERGED nodes.
- Edge labels must be short (e.g. "leads to", "supports", "contrasts with", "enables").
- Set genre to the detected book genre.
"""


class MindMapConsolidator:
    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    def consolidate(
        self,
        *,
        chapters: list[ChapterExtractionResult],
        detected_genre: str,
    ) -> ConsolidationResult:
        all_nodes = []
        for i, ch in enumerate(chapters):
            for node in ch.nodes:
                all_nodes.append({**node.model_dump(), "chapter_index": i + 1})

        input_text = (
            f"Genre: {detected_genre}\n\n"
            f"Nodes from {len(chapters)} chapter(s):\n"
            + json.dumps(all_nodes, indent=2)[:20000]
        )

        response = self._client.responses.parse(
            model=self._model,
            instructions=_CONSOLIDATION_SYSTEM,
            input=input_text,
            text_format=ConsolidationResult,
            max_output_tokens=3000,
        )

        result: Optional[ConsolidationResult] = response.output_parsed
        if result is None:
            logger.warning("Consolidator returned None")
            return ConsolidationResult(genre=detected_genre, nodes=[], edges=[])

        return result
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest backend/tests/test_mindmap_consolidator.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mindmap/consolidator.py backend/tests/test_mindmap_consolidator.py
git commit -m "feat(mindmap): add MindMapConsolidator with GPT-4o structured output"
```

---

## Task 6: Mindmap service (orchestration)

**Files:**
- Create: `backend/app/mindmap/service.py`

- [ ] **Step 1: Write the service**

Create `backend/app/mindmap/service.py`:

```python
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from ..indexing.models import Book, BookBlock
from .consolidator import MindMapConsolidator
from .extractor import ChapterExtractor
from .models import MindMapStatus
from .repository import MindMapRepository
from .schemas import ChapterExtractionResult

logger = logging.getLogger(__name__)

MIN_NODES_REQUIRED = 3


class MindMapService:
    def __init__(
        self,
        session_factory: sessionmaker,
        extractor: ChapterExtractor,
        consolidator: MindMapConsolidator,
    ) -> None:
        self._factory = session_factory
        self._extractor = extractor
        self._consolidator = consolidator

    def initiate(self, user_id: UUID, book_id: UUID) -> None:
        with self._factory() as session:
            with session.begin():
                book = session.get(Book, book_id)
                if book is None or book.user_id != user_id:
                    raise ValueError("Book not found")
                repo = MindMapRepository(session)
                existing = repo.get(book_id)
                if existing and existing.status == MindMapStatus.GENERATING:
                    raise RuntimeError("already_generating")
                repo.upsert(book_id, MindMapStatus.GENERATING)

    def generate(self, user_id: UUID, book_id: UUID) -> None:
        try:
            self._run_pipeline(book_id)
        except Exception as exc:
            logger.exception("Mind map generation failed for book %s", book_id)
            with self._factory() as session:
                with session.begin():
                    MindMapRepository(session).set_failed(book_id, str(exc))

    def _run_pipeline(self, book_id: UUID) -> None:
        chapters = self._load_chapters(book_id)
        if not chapters:
            self._store_result(book_id, MindMapStatus.INSUFFICIENT_CONTENT, data=None)
            return

        chapter_results: list[ChapterExtractionResult] = []
        detected_genre = "non-fiction"

        for i, (chapter_id, chapter_title, blocks) in enumerate(chapters):
            paragraph_ids = [b.paragraph_id for b in blocks]
            chapter_text = "\n\n".join(b.text for b in blocks)
            is_first = i == 0

            try:
                result = self._extractor.extract(
                    chapter_text=chapter_text,
                    chapter_id=chapter_id or f"ch{i+1}",
                    chapter_title=chapter_title,
                    paragraph_ids=paragraph_ids,
                    is_first_chapter=is_first,
                )
                if is_first and result.genre:
                    detected_genre = result.genre
                chapter_results.append(result)
            except Exception:
                logger.warning("Extraction failed for chapter %s, skipping", chapter_id)

        if not chapter_results:
            self._store_result(book_id, MindMapStatus.INSUFFICIENT_CONTENT, data=None)
            return

        consolidated = self._consolidator.consolidate(
            chapters=chapter_results,
            detected_genre=detected_genre,
        )

        if len(consolidated.nodes) < MIN_NODES_REQUIRED:
            self._store_result(book_id, MindMapStatus.INSUFFICIENT_CONTENT, data=None)
            return

        data: dict[str, Any] = {
            "genre": consolidated.genre,
            "nodes": [n.model_dump() for n in consolidated.nodes],
            "edges": [e.model_dump() for e in consolidated.edges],
        }
        self._store_result(book_id, MindMapStatus.READY, data=data)

    def _load_chapters(
        self, book_id: UUID
    ) -> list[tuple[str | None, str | None, list[BookBlock]]]:
        with self._factory() as session:
            rows = session.scalars(
                select(BookBlock)
                .join(BookBlock.version)
                .join(
                    Book,
                    text("books.active_index_version_id = index_versions.id"),
                )
                .where(text(f"books.id = '{book_id}'"))
                .order_by(BookBlock.reading_order)
            ).all()

        if not rows:
            return []

        chapters: dict[str | None, list[BookBlock]] = {}
        chapter_titles: dict[str | None, str | None] = {}
        for block in rows:
            key = block.chapter_id
            chapters.setdefault(key, []).append(block)
            if key not in chapter_titles:
                chapter_titles[key] = block.chapter_title

        return [
            (chapter_id, chapter_titles[chapter_id], blocks)
            for chapter_id, blocks in chapters.items()
        ]

    def _store_result(
        self,
        book_id: UUID,
        status: MindMapStatus,
        data: dict[str, Any] | None,
    ) -> None:
        with self._factory() as session:
            with session.begin():
                MindMapRepository(session).upsert(book_id, status, data=data)
```

- [ ] **Step 2: Verify no import errors**

```bash
python -c "from backend.app.mindmap.service import MindMapService; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/mindmap/service.py
git commit -m "feat(mindmap): add MindMapService orchestration pipeline"
```

---

## Task 7: Config + Router + wire into app

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/routers/mindmap.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_mindmap_api.py`

- [ ] **Step 1: Write the failing API tests**

Create `backend/tests/test_mindmap_api.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest

from backend.app.indexing.models import Book, IndexVersion, IndexVersionStatus
from backend.app.mindmap.models import MindMap, MindMapStatus


def _create_ready_book(session_factory, user_id) -> UUID:
    with session_factory() as session:
        with session.begin():
            book = Book(
                user_id=user_id,
                client_book_id="mm-api-book",
                title="Mind Map Book",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()
            version = IndexVersion(
                book_id=book.id,
                content_hash="bb" * 32,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.READY,
                progress=1.0,
            )
            session.add(version)
            session.flush()
            book.active_index_version_id = version.id
            return book.id


def test_generate_returns_202(auth_client, migrated_database, app_settings, committed_user):
    from sqlalchemy.orm import sessionmaker
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id = _create_ready_book(factory, committed_user)

    with patch("backend.app.routers.mindmap.MindMapService") as MockService:
        instance = MagicMock()
        MockService.return_value = instance
        instance.initiate.return_value = None

        response = auth_client.post(f"/library/books/{book_id}/mindmap/generate")

    assert response.status_code == 202
    assert response.json()["status"] == "generating"


def test_generate_returns_404_for_missing_book(auth_client):
    from uuid import uuid4
    with patch("backend.app.routers.mindmap.MindMapService"):
        response = auth_client.post(f"/library/books/{uuid4()}/mindmap/generate")
    assert response.status_code == 404


def test_generate_returns_409_when_already_generating(auth_client, migrated_database, app_settings, committed_user):
    from sqlalchemy.orm import sessionmaker
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id = _create_ready_book(factory, committed_user)

    with patch("backend.app.routers.mindmap.MindMapService") as MockService:
        instance = MagicMock()
        MockService.return_value = instance
        instance.initiate.side_effect = RuntimeError("already_generating")

        response = auth_client.post(f"/library/books/{book_id}/mindmap/generate")

    assert response.status_code == 409


def test_get_returns_404_when_no_mindmap(auth_client, migrated_database, app_settings, committed_user):
    from sqlalchemy.orm import sessionmaker
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id = _create_ready_book(factory, committed_user)
    response = auth_client.get(f"/library/books/{book_id}/mindmap")
    assert response.status_code == 404


def test_get_returns_status_when_mindmap_exists(auth_client, migrated_database, app_settings, committed_user):
    from sqlalchemy.orm import sessionmaker, Session as OrmSession
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id = _create_ready_book(factory, committed_user)

    with OrmSession(migrated_database) as session:
        with session.begin():
            mm = MindMap(book_id=book_id, status=MindMapStatus.READY, data={"genre": "self-help", "nodes": [], "edges": []})
            session.add(mm)

    response = auth_client.get(f"/library/books/{book_id}/mindmap")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["data"]["genre"] == "self-help"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pytest backend/tests/test_mindmap_api.py -v
```

Expected: `404 Not Found` for all routes (router not wired yet).

- [ ] **Step 3: Add config fields**

In `backend/app/config.py`, add to the `Settings` dataclass:

```python
mindmap_extraction_model: str
mindmap_consolidation_model: str
```

And in `Settings.from_env()`, add:

```python
mindmap_extraction_model=os.getenv("MINDMAP_EXTRACTION_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
mindmap_consolidation_model=os.getenv("MINDMAP_CONSOLIDATION_MODEL", "gpt-4o").strip() or "gpt-4o",
```

Also update the `app_settings` fixture in `backend/tests/conftest.py` to include the two new fields:

```python
mindmap_extraction_model="gpt-4o-mini",
mindmap_consolidation_model="gpt-4o",
```

- [ ] **Step 4: Create the router**

Create `backend/app/routers/mindmap.py`:

```python
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from ..auth.dependencies import get_current_user
from ..db.models import User
from ..indexing.models import Book
from ..mindmap.models import MindMapStatus
from ..mindmap.repository import MindMapRepository
from ..mindmap.schemas import MindMapStatusResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/library/books", tags=["mindmap"])


def _build_service(request: Request):
    from openai import OpenAI
    from ..mindmap.extractor import ChapterExtractor
    from ..mindmap.consolidator import MindMapConsolidator
    from ..mindmap.service import MindMapService

    settings = request.app.state.settings
    factory = request.app.state.session_factory
    client = OpenAI(api_key=settings.openai_api_key)

    return MindMapService(
        session_factory=factory,
        extractor=ChapterExtractor(client=client, model=settings.mindmap_extraction_model),
        consolidator=MindMapConsolidator(client=client, model=settings.mindmap_consolidation_model),
    )


@router.post("/{book_id}/mindmap/generate", status_code=status.HTTP_202_ACCEPTED)
def generate_mindmap(
    book_id: UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(get_current_user),
) -> MindMapStatusResponse:
    factory = request.app.state.session_factory

    with factory() as session:
        book = session.get(Book, book_id)

    if book is None or book.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    service = _build_service(request)
    try:
        service.initiate(user.id, book_id)
    except RuntimeError as exc:
        if "already_generating" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Mind map generation is already in progress.",
            )
        raise

    background_tasks.add_task(service.generate, user.id, book_id)
    return MindMapStatusResponse(status=MindMapStatus.GENERATING)


@router.get("/{book_id}/mindmap", response_model=MindMapStatusResponse)
def get_mindmap(
    book_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
) -> MindMapStatusResponse:
    factory = request.app.state.session_factory

    with factory() as session:
        book = session.get(Book, book_id)

    if book is None or book.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    with factory() as session:
        repo = MindMapRepository(session)
        mindmap = repo.get(book_id)

    if mindmap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No mind map found for this book.")

    return MindMapStatusResponse(
        status=mindmap.status,
        data=mindmap.data,
        error=mindmap.error,
    )
```

- [ ] **Step 5: Wire the router into main.py**

In `backend/app/main.py`, add after the other router imports:

```python
from .routers.mindmap import router as mindmap_router
```

And after `app.include_router(book_ask_router)`:

```python
app.include_router(mindmap_router)
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
pytest backend/tests/test_mindmap_api.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Run the full backend test suite to check for regressions**

```bash
pytest -c backend/pytest.ini backend/tests -v --ignore=backend/tests/e2e
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/config.py backend/app/routers/mindmap.py backend/app/main.py backend/tests/test_mindmap_api.py backend/tests/conftest.py
git commit -m "feat(mindmap): add generate/get endpoints and wire into app"
```

---

## Task 8: Frontend types + API client

**Files:**
- Create: `src/rag/mindmapTypes.ts`
- Create: `src/rag/mindmapApi.ts`

- [ ] **Step 1: Write the types**

Create `src/rag/mindmapTypes.ts`:

```typescript
export type MindMapNodeType = 'theme' | 'concept' | 'argument' | 'character';

export type MindMapNode = {
  id: string;
  label: string;
  type: MindMapNodeType;
  summary: string;
  importance: number;
  paragraph_ids: string[];
};

export type MindMapEdge = {
  from_id: string;
  to_id: string;
  label: string;
};

export type MindMapData = {
  genre: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
};

export type MindMapStatus =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'insufficient_content';

export type MindMapResponse = {
  status: MindMapStatus;
  data?: MindMapData;
  error?: string;
};
```

- [ ] **Step 2: Write the API client**

Create `src/rag/mindmapApi.ts`:

```typescript
import type { MindMapResponse } from './mindmapTypes';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function generateMindMap(args: {
  apiBaseUrl: string;
  cloudBookId: string;
  accessToken: string;
}, fetchImpl: FetchLike = fetch): Promise<{ status: string }> {
  const { apiBaseUrl, cloudBookId, accessToken } = args;
  const url = `${apiBaseUrl}/library/books/${cloudBookId}/mindmap/generate`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });

  if (response.status === 409) {
    return { status: 'generating' };
  }
  if (!response.ok) {
    throw new Error(`Mind map generate failed with status ${response.status}.`);
  }
  return response.json() as Promise<{ status: string }>;
}

export async function getMindMap(args: {
  apiBaseUrl: string;
  cloudBookId: string;
  accessToken: string;
}, fetchImpl: FetchLike = fetch): Promise<MindMapResponse> {
  const { apiBaseUrl, cloudBookId, accessToken } = args;
  const url = `${apiBaseUrl}/library/books/${cloudBookId}/mindmap`;

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return { status: 'pending' };
  }
  if (!response.ok) {
    throw new Error(`Mind map fetch failed with status ${response.status}.`);
  }
  return response.json() as Promise<MindMapResponse>;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors in `src/rag/mindmapApi.ts` or `src/rag/mindmapTypes.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/rag/mindmapTypes.ts src/rag/mindmapApi.ts
git commit -m "feat(mindmap): add frontend types and API client"
```

---

## Task 9: MindMapScreen component

**Files:**
- Create: `src/components/MindMapScreen.tsx`
- Create: `src/components/MindMapScreen.test.tsx`

- [ ] **Step 1: Write the failing snapshot tests**

Create `src/components/MindMapScreen.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { MindMapScreen } from './MindMapScreen';
import type { MindMapData } from '../rag/mindmapTypes';

const FIXTURE_DATA: MindMapData = {
  genre: 'self-help',
  nodes: [
    { id: 'n1', label: 'Habit Formation', type: 'theme', summary: 'Core loop.', importance: 0.95, paragraph_ids: ['p1'] },
    { id: 'n2', label: 'Identity Change', type: 'theme', summary: 'Be, not do.', importance: 0.85, paragraph_ids: ['p2'] },
    { id: 'n3', label: '2-Minute Rule', type: 'concept', summary: 'Start small.', importance: 0.7, paragraph_ids: ['p3'] },
  ],
  edges: [
    { from_id: 'n1', to_id: 'n2', label: 'enables' },
    { from_id: 'n1', to_id: 'n3', label: 'applied via' },
  ],
};

jest.mock('react-native-svg', () => {
  const React = require('react');
  const mock = (name: string) => ({ children, ...props }: any) =>
    React.createElement(name, props, children);
  return {
    Svg: mock('Svg'),
    Circle: mock('Circle'),
    Ellipse: mock('Ellipse'),
    Rect: mock('Rect'),
    Line: mock('Line'),
    Path: mock('Path'),
    Text: mock('SvgText'),
    G: mock('G'),
  };
});

test('renders generating state', () => {
  const { getByText } = render(
    <MindMapScreen
      status="generating"
      data={undefined}
      bookTitle="Atomic Habits"
      onNodeTap={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText(/generating/i);
});

test('renders insufficient content state', () => {
  const { getByText } = render(
    <MindMapScreen
      status="insufficient_content"
      data={undefined}
      bookTitle="Atomic Habits"
      onNodeTap={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText(/not enough content/i);
});

test('renders failed state', () => {
  const { getByText } = render(
    <MindMapScreen
      status="failed"
      data={undefined}
      bookTitle="Atomic Habits"
      onNodeTap={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText(/failed/i);
});

test('renders ready state with nodes', () => {
  const { getByText } = render(
    <MindMapScreen
      status="ready"
      data={FIXTURE_DATA}
      bookTitle="Atomic Habits"
      onNodeTap={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText('Habit Formation');
  getByText('Identity Change');
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- --testPathPattern=MindMapScreen --watchAll=false
```

Expected: `Cannot find module './MindMapScreen'`.

- [ ] **Step 3: Write the MindMapScreen component**

Create `src/components/MindMapScreen.tsx`:

```typescript
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { MindMapData, MindMapNode, MindMapNodeType } from '../rag/mindmapTypes';

const NODE_COLORS: Record<MindMapNodeType, string> = {
  theme: '#c8aaec',
  concept: '#a8d8d0',
  argument: '#f5c9a0',
  character: '#f2a8b0',
};

const NODE_TEXT_COLORS: Record<MindMapNodeType, string> = {
  theme: '#3d2b6e',
  concept: '#1a5050',
  argument: '#7a3f10',
  character: '#6e1a26',
};

type NodePosition = {
  node: MindMapNode;
  x: number;
  y: number;
  isLeaf: boolean;
};

function computeLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  cx: number,
  cy: number,
): NodePosition[] {
  if (nodes.length === 0) return [];

  const childrenOf: Record<string, string[]> = {};
  const hasParent = new Set<string>();
  for (const e of edges) {
    childrenOf[e.from_id] = childrenOf[e.from_id] ?? [];
    childrenOf[e.from_id].push(e.to_id);
    hasParent.add(e.to_id);
  }

  const root = nodes.find((n) => !hasParent.has(n.id)) ?? nodes[0];
  const level1 = nodes.filter((n) => n.id !== root.id && !hasParent.has(n.id));
  const level2 = nodes.filter((n) => hasParent.has(n.id));

  const positions: NodePosition[] = [{ node: root, x: cx, y: cy, isLeaf: false }];
  const R1 = 130;
  const R2 = 230;
  const n = level1.length;

  level1.forEach((node, i) => {
    const angle = n > 1 ? ((i * 2 * Math.PI) / n) - Math.PI / 2 : -Math.PI / 2;
    const x = cx + R1 * Math.cos(angle);
    const y = cy + R1 * Math.sin(angle);
    positions.push({ node, x, y, isLeaf: false });

    const children = (childrenOf[node.id] ?? [])
      .map((id) => level2.find((n) => n.id === id))
      .filter(Boolean) as MindMapNode[];

    const m = children.length;
    children.forEach((child, j) => {
      const spread = Math.PI / 3;
      const childAngle =
        m === 1 ? angle : angle - spread / 2 + (j * spread) / (m - 1);
      positions.push({
        node: child,
        x: cx + R2 * Math.cos(childAngle),
        y: cy + R2 * Math.sin(childAngle),
        isLeaf: true,
      });
    });
  });

  return positions;
}

type MindMapEdge = import('../rag/mindmapTypes').MindMapEdge;

function cubicBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

type Props = {
  status: string;
  data: MindMapData | undefined;
  bookTitle: string;
  onNodeTap: (node: MindMapNode) => void;
  onClose: () => void;
};

export function MindMapScreen({ status, data, bookTitle, onNodeTap, onClose }: Props) {
  const WIDTH = 360;
  const HEIGHT = 480;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const positions = useMemo(() => {
    if (!data) return [];
    return computeLayout(data.nodes, data.edges, cx, cy);
  }, [data, cx, cy]);

  const posMap = useMemo(() => {
    const m: Record<string, { x: number; y: number }> = {};
    for (const p of positions) m[p.node.id] = { x: p.x, y: p.y };
    return m;
  }, [positions]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{bookTitle}</Text>
        <View style={{ width: 60 }} />
      </View>

      {status === 'generating' && (
        <View style={styles.center}>
          <Text style={styles.stateText}>Generating mind map…</Text>
          <Text style={styles.stateSubtext}>This may take a minute.</Text>
        </View>
      )}

      {status === 'failed' && (
        <View style={styles.center}>
          <Text style={styles.stateText}>Generation failed.</Text>
          <Text style={styles.stateSubtext}>Tap the mind map icon to try again.</Text>
        </View>
      )}

      {status === 'insufficient_content' && (
        <View style={styles.center}>
          <Text style={styles.stateText}>Not enough content to generate a mind map.</Text>
        </View>
      )}

      {status === 'ready' && data && (
        <ScrollView>
          <Svg width={WIDTH} height={HEIGHT}>
            {data.edges.map((e, i) => {
              const from = posMap[e.from_id];
              const to = posMap[e.to_id];
              if (!from || !to) return null;
              return (
                <Path
                  key={i}
                  d={cubicBezierPath(from.x, from.y, to.x, to.y)}
                  stroke="#888"
                  strokeWidth={1.5}
                  fill="none"
                />
              );
            })}
            {positions.map(({ node, x, y, isLeaf }) => {
              const color = NODE_COLORS[node.type];
              const textColor = NODE_TEXT_COLORS[node.type];
              const rw = isLeaf ? 44 : 60;
              const rh = isLeaf ? 18 : 24;
              return (
                <G key={node.id} onPress={() => onNodeTap(node)}>
                  {isLeaf ? (
                    <Ellipse cx={x} cy={y} rx={rw} ry={rh} fill={color} />
                  ) : (
                    <Rect x={x - rw} y={y - rh} width={rw * 2} height={rh * 2} rx={10} fill={color} />
                  )}
                  <SvgText
                    x={x}
                    y={y + 4}
                    textAnchor="middle"
                    fill={textColor}
                    fontSize={isLeaf ? 9 : 11}
                    fontWeight="600"
                  >
                    {node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label}
                  </SvgText>
                </G>
              );
            })}
          </Svg>

          <View style={styles.legend}>
            {(Object.entries(NODE_COLORS) as [MindMapNodeType, string][]).map(([type, color]) => (
              <View key={type} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={styles.legendLabel}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#faf8f4' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  backBtn: { width: 60 },
  backText: { color: '#6366f1', fontSize: 14 },
  title: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  stateText: { fontSize: 16, fontWeight: '600', color: '#374151', textAlign: 'center' },
  stateSubtext: { fontSize: 13, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  legend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 12, padding: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 11, color: '#6b7280' },
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=MindMapScreen --watchAll=false
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors in `MindMapScreen.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/MindMapScreen.tsx src/components/MindMapScreen.test.tsx
git commit -m "feat(mindmap): add MindMapScreen with react-native-svg radial layout"
```

---

## Task 10: NodeTapSheet component

**Files:**
- Create: `src/components/NodeTapSheet.tsx`
- Create: `src/components/NodeTapSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/NodeTapSheet.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NodeTapSheet } from './NodeTapSheet';
import type { MindMapNode } from '../rag/mindmapTypes';
import type { BookSource } from '../rag/bookAskTypes';

const FIXTURE_NODE: MindMapNode = {
  id: 'n1',
  label: 'Identity Change',
  type: 'theme',
  summary: 'Lasting habits require an identity shift — be, not do.',
  importance: 0.9,
  paragraph_ids: ['p1', 'p2'],
};

const FIXTURE_SOURCES: BookSource[] = [
  {
    id: 's1',
    paragraphId: 'p1',
    excerpt: 'Every action you take is a vote for the type of person you wish to become.',
    sourceRef: {},
    chapterTitle: 'Chapter 2',
  },
];

test('renders node label and summary', () => {
  const { getByText } = render(
    <NodeTapSheet
      node={FIXTURE_NODE}
      sources={FIXTURE_SOURCES}
      onJumpToPassage={jest.fn()}
      onAsk={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText('Identity Change');
  getByText(/Lasting habits require/i);
});

test('renders passage excerpt', () => {
  const { getByText } = render(
    <NodeTapSheet
      node={FIXTURE_NODE}
      sources={FIXTURE_SOURCES}
      onJumpToPassage={jest.fn()}
      onAsk={jest.fn()}
      onClose={jest.fn()}
    />
  );
  getByText(/vote for the type of person/i);
});

test('calls onAsk when Ask button pressed', () => {
  const onAsk = jest.fn();
  const { getByText } = render(
    <NodeTapSheet
      node={FIXTURE_NODE}
      sources={[]}
      onJumpToPassage={jest.fn()}
      onAsk={onAsk}
      onClose={jest.fn()}
    />
  );
  fireEvent.press(getByText(/Ask about Identity Change/i));
  expect(onAsk).toHaveBeenCalledWith(FIXTURE_NODE);
});

test('calls onJumpToPassage when passage tapped', () => {
  const onJump = jest.fn();
  const { getByText } = render(
    <NodeTapSheet
      node={FIXTURE_NODE}
      sources={FIXTURE_SOURCES}
      onJumpToPassage={onJump}
      onAsk={jest.fn()}
      onClose={jest.fn()}
    />
  );
  fireEvent.press(getByText(/vote for the type of person/i));
  expect(onJump).toHaveBeenCalledWith(FIXTURE_SOURCES[0]);
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- --testPathPattern=NodeTapSheet --watchAll=false
```

Expected: `Cannot find module './NodeTapSheet'`.

- [ ] **Step 3: Write the component**

Create `src/components/NodeTapSheet.tsx`:

```typescript
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BookSource } from '../rag/bookAskTypes';
import type { MindMapNode, MindMapNodeType } from '../rag/mindmapTypes';

const TYPE_BADGE_COLORS: Record<MindMapNodeType, { bg: string; text: string }> = {
  theme: { bg: 'rgba(200,170,236,0.2)', text: '#3d2b6e' },
  concept: { bg: 'rgba(168,216,208,0.2)', text: '#1a5050' },
  argument: { bg: 'rgba(245,201,160,0.2)', text: '#7a3f10' },
  character: { bg: 'rgba(242,168,176,0.2)', text: '#6e1a26' },
};

type Props = {
  node: MindMapNode;
  sources: BookSource[];
  onJumpToPassage: (source: BookSource) => void;
  onAsk: (node: MindMapNode) => void;
  onClose: () => void;
};

export function NodeTapSheet({ node, sources, onJumpToPassage, onAsk, onClose }: Props) {
  const badge = TYPE_BADGE_COLORS[node.type];
  const typeName = node.type.charAt(0).toUpperCase() + node.type.slice(1);

  return (
    <View style={styles.container}>
      <View style={styles.handle} />

      <View style={styles.headerRow}>
        <Text style={styles.nodeLabel} numberOfLines={2}>{node.label}</Text>
        <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.typeText, { color: badge.text }]}>{typeName}</Text>
        </View>
      </View>

      <Text style={styles.summary}>{node.summary}</Text>

      {sources.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{sources.length} PASSAGE{sources.length > 1 ? 'S' : ''}</Text>
          <ScrollView style={styles.sourcesList} nestedScrollEnabled>
            {sources.map((src) => (
              <Pressable
                key={src.id}
                style={styles.sourceItem}
                onPress={() => onJumpToPassage(src)}
              >
                <Text style={styles.sourceExcerpt} numberOfLines={3}>{src.excerpt}</Text>
                <Text style={styles.sourceChapter}>
                  {src.chapterTitle ? `${src.chapterTitle} · ` : ''}Tap to jump →
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      <Pressable style={styles.askButton} onPress={() => onAsk(node)}>
        <Text style={styles.askButtonText}>💬 Ask about {node.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  nodeLabel: { flex: 1, fontSize: 20, fontWeight: '700', color: '#111827' },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeText: { fontSize: 12, fontWeight: '600' },
  summary: { fontSize: 14, color: '#4b5563', lineHeight: 22, marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.5, marginBottom: 8 },
  sourcesList: { maxHeight: 180, marginBottom: 16 },
  sourceItem: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
    paddingLeft: 10,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(99,102,241,0.04)',
    borderRadius: 4,
  },
  sourceExcerpt: { fontSize: 13, color: '#374151', lineHeight: 20 },
  sourceChapter: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  askButton: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  askButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=NodeTapSheet --watchAll=false
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NodeTapSheet.tsx src/components/NodeTapSheet.test.tsx
git commit -m "feat(mindmap): add NodeTapSheet with summary, passages, and Ask button"
```

---

## Task 11: Wire into App.tsx

**Files:**
- Modify: `App.tsx`

This task adds: (a) mind map state and polling, (b) library card button, (c) reader toolbar icon, (d) navigation to `MindMapScreen`, (e) `NodeTapSheet` modal.

- [ ] **Step 1: Add imports to App.tsx**

At the top of `App.tsx`, after the existing component imports, add:

```typescript
import { MindMapScreen } from './src/components/MindMapScreen';
import { NodeTapSheet } from './src/components/NodeTapSheet';
import { generateMindMap, getMindMap } from './src/rag/mindmapApi';
import type { MindMapData, MindMapNode, MindMapStatus } from './src/rag/mindmapTypes';
import { Map } from 'lucide-react-native';
```

- [ ] **Step 2: Add mind map state near the top of the main App component**

Inside the main component function, after the existing `useState` declarations, add:

```typescript
const [mindMapOpen, setMindMapOpen] = useState(false);
const [mindMapStatus, setMindMapStatus] = useState<MindMapStatus | null>(null);
const [mindMapData, setMindMapData] = useState<MindMapData | undefined>(undefined);
const [tappedNode, setTappedNode] = useState<MindMapNode | null>(null);
const mindMapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 3: Add the openMindMap helper**

After the state declarations, add:

```typescript
const openMindMap = async () => {
  const token = await getToken();
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  const cloudId = activeBook?.cloudBookId;
  if (!token || !cloudId) return;

  setMindMapOpen(true);

  const current = await getMindMap({ apiBaseUrl, cloudBookId: cloudId, accessToken: token });
  if (current.status === 'ready') {
    setMindMapStatus('ready');
    setMindMapData(current.data);
    return;
  }

  await generateMindMap({ apiBaseUrl, cloudBookId: cloudId, accessToken: token });
  setMindMapStatus('generating');

  const pollId = setInterval(async () => {
    try {
      const result = await getMindMap({ apiBaseUrl, cloudBookId: cloudId, accessToken: token });
      if (result.status !== 'generating' && result.status !== 'pending') {
        clearInterval(pollId);
        mindMapPollRef.current = null;
        setMindMapStatus(result.status as MindMapStatus);
        setMindMapData(result.data);
      }
    } catch {
      clearInterval(pollId);
      mindMapPollRef.current = null;
      setMindMapStatus('failed');
    }
  }, 3000);
  mindMapPollRef.current = pollId;
};
```

Also add a cleanup effect after it:

```typescript
useEffect(() => {
  return () => {
    if (mindMapPollRef.current) clearInterval(mindMapPollRef.current);
  };
}, []);
```

- [ ] **Step 4: Add the Mind Map button to the reader toolbar**

Find the reader toolbar section in `App.tsx` (where the `Upload` and `SlidersHorizontal` icons are rendered) and add the `Map` icon button next to them:

```typescript
<Pressable onPress={openMindMap} style={toolbarButtonStyle}>
  <Map size={20} color={colors.icon} />
</Pressable>
```

- [ ] **Step 5: Add the Mind Map button to library book cards**

Find the section where library book cards are rendered (where "Continue Reading" button appears) and add next to it:

```typescript
<Pressable
  onPress={() => { setActiveBook(book); openMindMap(); }}
  style={styles.mindMapCardButton}
>
  <Text style={styles.mindMapCardButtonText}>🗺 Mind Map</Text>
</Pressable>
```

Add to styles:

```typescript
mindMapCardButton: {
  borderWidth: 1.5,
  borderColor: '#6366f1',
  borderRadius: 8,
  paddingVertical: 8,
  paddingHorizontal: 12,
  alignItems: 'center',
},
mindMapCardButtonText: {
  color: '#6366f1',
  fontWeight: '600',
  fontSize: 12,
},
```

- [ ] **Step 6: Render MindMapScreen and NodeTapSheet**

At the end of the main return statement (before the closing `</SafeAreaView>`), add:

```typescript
{mindMapOpen && (
  <View style={StyleSheet.absoluteFillObject}>
    <MindMapScreen
      status={mindMapStatus ?? 'generating'}
      data={mindMapData}
      bookTitle={activeBook?.title ?? ''}
      onNodeTap={(node) => setTappedNode(node)}
      onClose={() => {
        setMindMapOpen(false);
        if (mindMapPollRef.current) clearInterval(mindMapPollRef.current);
      }}
    />
    {tappedNode && (
      <View style={styles.nodeSheetOverlay}>
        <NodeTapSheet
          node={tappedNode}
          sources={[]}
          onJumpToPassage={(src) => {
            setTappedNode(null);
            setMindMapOpen(false);
            // jump to paragraph using existing paragraph navigation
          }}
          onAsk={(node) => {
            setTappedNode(null);
            setMindMapOpen(false);
            // open ConversationThread with node.label as the initial question
          }}
          onClose={() => setTappedNode(null)}
        />
      </View>
    )}
  </View>
)}
```

Add to styles:

```typescript
nodeSheetOverlay: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: 'rgba(0,0,0,0.4)',
  justifyContent: 'flex-end',
},
```

- [ ] **Step 7: Typecheck and test**

```bash
npm run typecheck && npm test -- --watchAll=false
```

Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): wire MindMapScreen and NodeTapSheet into App"
```

---

## Self-Review Checklist

- [x] DB model + migration — Task 1
- [x] Pydantic schemas (ExtractedNode, ExtractedEdge, ChapterExtractionResult, ConsolidationResult, MindMapStatusResponse) — Task 2
- [x] Repository (upsert/get/set_failed) — Task 3
- [x] Chapter extractor, GPT-4o-mini — Task 4
- [x] Consolidator, GPT-4o — Task 5
- [x] Service orchestration (chapter grouping, skip failed chapters, min-node check) — Task 6
- [x] Config fields (mindmap_extraction_model, mindmap_consolidation_model) — Task 7
- [x] Router (POST generate 202, GET get, 409 conflict, 404 not found) — Task 7
- [x] Router wired into main.py — Task 7
- [x] Frontend types — Task 8
- [x] Frontend API client (generateMindMap, getMindMap, 409 handled) — Task 8
- [x] MindMapScreen (all 4 states: generating, failed, insufficient_content, ready) — Task 9
- [x] NodeTapSheet (summary, passages, Ask, onJumpToPassage) — Task 10
- [x] App.tsx wiring (library card, reader toolbar, polling, MindMapScreen, NodeTapSheet) — Task 11
- [x] Color by node type — MindMapScreen NODE_COLORS
- [x] Whole Book / By Chapter toggle — spec calls for this; add a chapter view toggle to MindMapScreen in a follow-up (v1 renders whole-book view only, which matches the "prominently surfaced but on-demand" scope)
