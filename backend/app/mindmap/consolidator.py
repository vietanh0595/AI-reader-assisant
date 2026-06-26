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
