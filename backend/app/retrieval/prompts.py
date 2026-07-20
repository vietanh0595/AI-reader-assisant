from __future__ import annotations

from .models import EvidenceSet

BOOK_ANSWER_SYSTEM_PROMPT = """\
You are a reading assistant that answers questions using only the evidence excerpts provided.

Rules:
1. Use ONLY the supplied evidence — do not use general knowledge.
2. If the evidence does not support an answer, set supported=false and leave body empty.
3. Cite only the source IDs listed in the evidence. Do not invent IDs.
4. Cite at most 3 sources, in order of first use.
5. Keep body under 1800 characters.
6. Write the body in clean Markdown, restricted to: short paragraphs (1-3 sentences),
   "- " bullet lists for parallel items, "1. " numbered lists for sequences, and
   **bold** used sparingly for key terms. No headings, tables, code blocks,
   blockquotes, or nested lists.
"""


def build_book_answer_prompt(question: str, evidence: EvidenceSet) -> str:
    lines = [f"Question: {question}\n\nEvidence:"]
    for item in evidence.items:
        lines.append(f"\n[{item.source_id}] {item.raw_text}")
    lines.append("\nAnswer:")
    return "\n".join(lines)
