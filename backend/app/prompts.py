from __future__ import annotations

from typing import Any

from .schemas import AssistContextBlock, AssistRequest


SYSTEM_PROMPT = """
You are an inline reading companion inside a book reader.

Your job is to help the reader understand the selected text or current reading context without pulling
them away from reading. Keep the answer short, concrete, and useful.

Rules:
- Use only the selected text and supplied context blocks.
- Do not spoil later parts of a book.
- Do not turn the answer into an open-ended chat unless the action is ask.
- Use plain language, but do not talk down to the reader.
- Prefer one compact paragraph. Use at most two short sentences unless needed.
- Return only the structured response requested by the API schema.
""".strip()


ACTION_INSTRUCTIONS = {
    "ask": "Answer the user's question using the selected text or chosen context scope.",
    "example": "Give one concrete example that illustrates the reader's question or selected idea.",
    "explain": "Explain what the selected word, phrase, or passage means in this context.",
    "rephrase": "Rewrite the selected text in clearer, simpler wording without changing its meaning.",
    "simpler": "Explain the selected text in an even simpler and more direct way.",
    "summarize": "Summarize the supplied page or passage context for the reader.",
}


EYEBROW_GUIDANCE = {
    "ask": "Answer",
    "example": "Example",
    "explain": "Definition if selectionKind is word; otherwise Short version",
    "rephrase": "Rephrased",
    "simpler": "Simpler",
    "summarize": "Summary",
}


CONTEXT_SCOPE_GUIDANCE = {
    "chapter": "Answer using only the current chapter context supplied below.",
    "paragraph": "Answer using the selected text and its paragraph context.",
    "visiblePage": "Answer using only the currently visible page context supplied below.",
}


def build_user_prompt(request: AssistRequest) -> str:
    question_line = f"\nReader question: {request.question}" if request.question else ""
    selected_text = request.selected_text or "No manual text selection."
    selection_kind = request.selection_kind or "none"
    context_text = format_context_blocks(request.context_blocks)

    return f"""
Book: {request.book_title}
Author: {request.author}
Action: {request.action}
Action instruction: {ACTION_INSTRUCTIONS[request.action]}
Eyebrow guidance: {EYEBROW_GUIDANCE[request.action]}
Context scope: {request.context_scope}
Context guidance: {CONTEXT_SCOPE_GUIDANCE[request.context_scope]}
Selection kind: {selection_kind}

Selected text:
{selected_text}

Context blocks:
{context_text}{question_line}
""".strip()


def format_context_blocks(context_blocks: list[AssistContextBlock]) -> str:
    return "\n\n".join(format_context_block(index, block) for index, block in enumerate(context_blocks, start=1))


def format_context_block(index: int, block: AssistContextBlock) -> str:
    block_kind = block.block_kind or "body"
    source_label = format_source_ref(block.source_ref)
    label = f"[{index}] {block_kind}"

    if source_label:
        label = f"{label} - {source_label}"

    return f"{label}\n{block.text}"


def format_source_ref(source_ref: dict[str, Any] | None) -> str | None:
    if not source_ref:
        return None

    source = source_ref.get("source")
    page_label = source_ref.get("pageLabel")
    page_index = source_ref.get("pageIndex")
    block_index = source_ref.get("blockIndex")
    source_label = str(source).upper() if isinstance(source, str) else None

    if source_label and isinstance(page_label, str) and page_label:
        return f"{source_label} {page_label}"

    if source_label and isinstance(page_index, int):
        return f"{source_label} page {page_index + 1}"

    if source_label and isinstance(block_index, int):
        return f"{source_label} block {block_index + 1}"

    return source_label
