# Book Mind Map — Design Spec

**Date:** 2026-06-26
**Branch:** `feature/book-mindmap` (based on `feature/conversational-ask`)
**Status:** Approved

---

## Overview

Auto-generate a visual mind map for any imported book. The user triggers generation on demand; the map appears as a classic radial diagram with pastel-colored nodes grouped by concept type. Tapping a node reveals an AI summary of the concept, the source passages it was drawn from (with jump-to-reader links), and an Ask button that opens the existing `ConversationThread` pre-scoped to that concept.

This feature occupies an empty market position: no mainstream reading app offers automatically-generated, source-linked concept maps on mobile.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Whole-book + chapter drill-down | Best of both: big picture + detail |
| Node types | AI picks by genre | Fits non-fiction (themes/arguments) and fiction (characters/entities) |
| Generation | On demand, prominently surfaced | Saves cost; user intent signals value |
| Entry points | Library card + reader toolbar | Maximum visibility without being intrusive |
| Node tap | Summary + passages + Ask | Leverages existing citation and conversation infrastructure |
| Extraction model | GPT-4o-mini (per chapter) | High volume, structured task, cheap |
| Consolidation model | GPT-4o (one call per book) | Quality-critical synthesis step |
| Storage | JSONB in Postgres | No new infrastructure; sufficient for per-book graphs |
| Visual style | Classic radial, pastel, light canvas | Immediately recognizable; labels readable; warmer than dark graph |
| Color coding | By node type (see below) | Communicates book structure at a glance |

---

## Visual Design

**Style:** Classic radial mind map — book title or central theme at center, main concept nodes branching outward, leaf sub-concepts at the edges. Curved arrows with direction. Light cream/white canvas. Rounded rectangles for branch nodes, ovals for leaf nodes (matching the reference style).

**Color by node type:**

| Type | Color | Used for |
|---|---|---|
| Theme | Lavender `#c8aaec` | Major recurring idea or argument |
| Concept | Teal `#a8d8d0` | Defined term, framework, or named model |
| Argument | Peach `#f5c9a0` | Claim the author makes and defends |
| Character / Entity | Rose `#f2a8b0` | Person, place, organisation |

**Node size:** Maps to the `importance` score (0–1) returned by the LLM — the most central ideas render largest.

**Legend:** Small color key at the bottom of the map screen.

**Two views toggled at the bottom:**
- `Whole Book` — root node is the book's central thesis; level-1 nodes are the major themes
- `By Chapter` — a horizontal scrollable row of chapter pills appears below the toggle; tapping a pill redraws the map rooted at that chapter's nodes

**Rendering:** WebView with D3.js radial tree layout. Node tap events posted to React Native via the JS bridge (`window.ReactNativeWebView.postMessage`).

---

## Entry Points

**1. Library card** — "🗺 Mind Map" button alongside "Continue Reading" on every book card. Always visible; zero taps from the library screen.

**2. Reader toolbar** — Mind map icon (🗺) in the top-right toolbar next to the existing text settings and import icons. Accessible mid-read without leaving the book.

Both entry points navigate to the same mind map screen. If a map has already been generated, it loads immediately. If not, tapping shows a generation loading state.

---

## Node Tap Sheet

A React Native bottom sheet slides up when the user taps any node. Contents:

1. **Node label** (title) + **type badge** (Theme / Concept / Argument / Character)
2. **AI summary** — 1–2 sentence description of what the book says about this concept (stored in the node's `summary` field, generated during extraction)
3. **Source passages** — scrollable list of the passages attributed to this node; each passage shows a truncated quote and chapter reference; tapping jumps to that paragraph in the reader
4. **"Ask about [concept]" button** — opens the existing `ConversationThread` with the node label pre-loaded as the conversation scope, using the same RAG pipeline from `feature/conversational-ask`

---

## Data Model

### `mindmaps` table (new)

```sql
CREATE TABLE mindmaps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | generating | ready | failed | insufficient_content
  data          JSONB,
  generated_at  TIMESTAMP WITH TIME ZONE,
  error         TEXT
);
CREATE UNIQUE INDEX mindmaps_book_id_idx ON mindmaps(book_id);
```

### JSONB `data` shape

```json
{
  "genre": "non-fiction",
  "nodes": [
    {
      "id": "n1",
      "label": "Habit Formation",
      "type": "theme",
      "summary": "Clear argues habits are three-step loops of cue, routine, and reward that can be deliberately engineered.",
      "passage_ids": ["p123", "p456"],
      "chapter": null,
      "importance": 0.95
    }
  ],
  "edges": [
    {
      "from": "n1",
      "to": "n2",
      "label": "leads to"
    }
  ]
}
```

`chapter: null` means the node spans the whole book (root-level). `chapter: 2` means it was surfaced in chapter 2 and is shown in the chapter drill-down view.

---

## API Endpoints

```
POST /books/{book_id}/mindmap/generate
  → 202 Accepted: { "status": "generating" }
  → 409 Conflict if already generating
  → Overwrites existing map if status is ready/failed

GET /books/{book_id}/mindmap
  → 200: { "status": "ready", "data": { ... } }
  → 200: { "status": "generating" }
  → 200: { "status": "failed", "error": "..." }
  → 404 if no mindmap record exists yet
```

Frontend polls `GET` every 3 seconds while `status === "generating"`, then renders on `ready`.

---

## Backend Generation Pipeline

Runs on the existing `worker_main.py` background worker.

### Pass 1 — Per-chapter extraction (GPT-4o-mini)

For each chapter:
- Send chapter text with structured output schema requesting: `nodes[]` (id, label, type, summary, importance, passage_ids) and `edges[]` (from, to, label)
- On chapter 1, also request `genre` detection
- Chapters processed sequentially to respect rate limits
- If a single chapter fails: log the error, skip the chapter, continue — partial map is better than no map

### Pass 2 — Consolidation (GPT-4o, one call)

- Send all chapter-level nodes together
- GPT-4o merges duplicate concepts (same concept named differently across chapters), promotes top cross-chapter nodes to root level, finalises edge labels and the whole-book edge structure
- Result written to `mindmaps.data` with `status = ready`

### Minimum content check

If Pass 2 produces fewer than 3 nodes, set `status = insufficient_content`. Frontend shows: "This book doesn't have enough content to generate a mind map."

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Generation failure (API error) | `status = failed`, `error` field set. Frontend shows retry button. |
| Single chapter extraction fails | Log and skip; continue with remaining chapters. |
| Fewer than 3 nodes extracted | `status = insufficient_content`; graceful UI message. |
| User taps "generate" on existing map | Overwrites — useful after re-import or content change. |
| User taps "generate" while already generating | Return 409; frontend shows "Already generating…" state. |

---

## Testing

**Backend:**
- Unit tests for extraction prompt output parsing (fixture chapters)
- Unit test for consolidation deduplication logic
- Integration test: mock OpenAI calls → full generate→poll→ready flow → assert JSONB shape

**Frontend:**
- Snapshot tests for the mind map screen (loading, ready, failed, insufficient_content states)
- Snapshot test for the node tap bottom sheet
- Unit test for the JS bridge node-tap event handler

---

## Out of Scope (v1)

- Cross-book / library-wide knowledge graph (future: Neo4j migration path)
- User-editable nodes or manual connections
- Exporting the mind map as an image or PDF
- Mind map generation during book import (on-demand only for v1)
- Push notification when generation completes (polling only)
