"""LLM-as-judge scoring for AI reading-assistant responses.

The judge is deliberately given the *same* context the app had (selected text +
context blocks) so it can check groundedness rather than just plausibility. A
judge that only sees the answer can tell you it reads well; it cannot tell you
the model invented a definition the passage never gave.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from openai import OpenAI


DEFAULT_JUDGE_MODEL = "gpt-4o"

# Derived from backend/app/prompts.py SYSTEM_PROMPT — if that prompt changes,
# these criteria should change with it.
JUDGE_SYSTEM_PROMPT = """
You are evaluating an inline reading-assistant answer shown inside a book reader app.

The app's own rules for these answers are:
- Use ONLY the selected text and the supplied context blocks.
- Do not spoil later parts of the book.
- Plain language, but never condescending.
- Prefer one compact paragraph; at most two short sentences unless more is genuinely needed.

Score each dimension 1-5 (5 = best) and be strict. A fluent answer that adds facts
absent from the supplied context must score LOW on groundedness, however correct
those facts may be in the real world.

The app MAY add outside knowledge when the passage genuinely does not answer the reader's
need, but it must then set a `beyond_book` flag, which shows the reader a visible
"Not from this book" marker. The sin is UNLABELLED outside knowledge, not outside
knowledge itself.

Dimensions:
- groundedness: every claim is either supported by the supplied context, or is outside
  knowledge that was correctly flagged (you are told the flag's value). Unflagged outside
  claims = 1-2. Claiming the passage explains something it explicitly defers = 1-2, even
  if flagged.
  IMPORTANT - do not manufacture violations. Paraphrasing the passage in different words
  is grounded. Restating what the passage says about the book's own structure (e.g. that a
  topic is deferred to a later chapter) is grounded. Unpacking a definition the passage
  itself supplies is grounded. Penalise only claims a careful reader could NOT verify from
  the supplied context.
- task_fit: performs the REQUESTED action. "explain" that gives an analogy instead of a
  meaning, or "rephrase" that adds new information, is a task_fit failure even if useful.
- concision: respects the compact-answer rule. Rambling = low.
- clarity: plain, readable, not condescending, not jargon-padded.

Also return:
- spoiler_free: false if it reveals plot/content beyond the supplied context.
- rationale: one or two sentences, concrete. Quote the offending phrase when you penalise.
""".strip()


JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "groundedness",
        "task_fit",
        "concision",
        "clarity",
        "spoiler_free",
        "rationale",
    ],
    "properties": {
        "groundedness": {"type": "integer", "minimum": 1, "maximum": 5},
        "task_fit": {"type": "integer", "minimum": 1, "maximum": 5},
        "concision": {"type": "integer", "minimum": 1, "maximum": 5},
        "clarity": {"type": "integer", "minimum": 1, "maximum": 5},
        "spoiler_free": {"type": "boolean"},
        "rationale": {"type": "string"},
    },
}


@dataclass(frozen=True)
class Verdict:
    groundedness: int
    task_fit: int
    concision: int
    clarity: int
    spoiler_free: bool
    rationale: str

    @property
    def passed(self) -> bool:
        """Gate on the dimensions that represent real defects, not polish.

        Concision and clarity are tracked as quality signals but do not fail a
        case on their own — a slightly long answer is a P2, an ungrounded one
        is a correctness bug.
        """
        return (
            self.groundedness >= 4
            and self.task_fit >= 4
            and self.spoiler_free
            and self.clarity >= 3
        )

    @property
    def scores(self) -> dict[str, int]:
        return {
            "groundedness": self.groundedness,
            "task_fit": self.task_fit,
            "concision": self.concision,
            "clarity": self.clarity,
        }


def build_judge_input(case: dict[str, Any], answer: str, beyond_book: bool | None = None) -> str:
    context = "\n".join(
        f"[{i}] {block['text']}" for i, block in enumerate(case.get("contextBlocks", []), start=1)
    )
    expectation = case.get("expect")
    traps = case.get("traps") or []

    parts = [
        f"ACTION REQUESTED: {case['action']}",
        f"BOOK: {case.get('bookTitle', '?')} by {case.get('author', '?')}",
        f"SELECTED TEXT: {case.get('selectedText') or '(none — summarize action)'}",
        f"SUPPLIED CONTEXT BLOCKS:\n{context or '(none)'}",
        f"ANSWER UNDER TEST:\n{answer}",
    ]

    if beyond_book is not None:
        parts.append(
            f"beyond_book FLAG THE APP SET: {beyond_book}. "
            + (
                "The app declared this answer contains information not in the passage, so "
                "the reader sees a 'Not from this book' marker."
                if beyond_book
                else "The app declared every claim is supported by the passage. If that is "
                "false, groundedness must score 1-2."
            )
        )

    if expectation:
        parts.append(f"WHAT A GOOD ANSWER LOOKS LIKE: {expectation}")

    if traps:
        joined = "\n".join(f"- {trap}" for trap in traps)
        parts.append(
            "KNOWN FAILURE MODES for this case — check each explicitly:\n" + joined
        )

    return "\n\n".join(parts)


def judge_answer(
    client: OpenAI,
    case: dict[str, Any],
    answer: str,
    model: str = DEFAULT_JUDGE_MODEL,
    beyond_book: bool | None = None,
) -> Verdict:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": build_judge_input(case, answer, beyond_book)},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "verdict", "schema": JUDGE_SCHEMA, "strict": True},
        },
        temperature=0,
    )

    import json

    payload = json.loads(response.choices[0].message.content or "{}")
    return Verdict(**payload)


def judge_ask_answer(
    client: OpenAI,
    question: str,
    answer: str,
    citations: list[dict[str, Any]],
    expect_refusal: Optional[bool],
    model: str = DEFAULT_JUDGE_MODEL,
) -> Verdict:
    """Judge a whole-book Ask answer, where citations are the grounding evidence."""
    cited = "\n".join(
        f"[{i}] {c.get('excerpt', '')}" for i, c in enumerate(citations, start=1)
    ) or "(no citations returned)"

    refusal_note = ""
    if expect_refusal is True:
        refusal_note = (
            "\n\nIMPORTANT: this question is NOT answerable from the book. "
            "Refusing or saying there is not enough information is the CORRECT behaviour "
            "and should score 5 on task_fit. Confidently answering anyway is a failure."
        )
    elif expect_refusal is False:
        refusal_note = (
            "\n\nIMPORTANT: this question IS answerable (the assistant may blend book "
            "evidence with clearly-labelled general knowledge). Refusing or replying "
            "'not enough information' is a FAILURE and should score 1 on task_fit."
        )

    user = (
        f"QUESTION: {question}\n\n"
        f"CITATIONS THE ASSISTANT RETRIEVED:\n{cited}\n\n"
        f"ANSWER UNDER TEST:\n{answer}"
        f"{refusal_note}"
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "verdict", "schema": JUDGE_SCHEMA, "strict": True},
        },
        temperature=0,
    )

    import json

    payload = json.loads(response.choices[0].message.content or "{}")
    return Verdict(**payload)
