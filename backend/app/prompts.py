from .schemas import AssistRequest


SYSTEM_PROMPT = """
You are an inline reading companion inside a book reader.

Your job is to help the reader understand the selected text without pulling
them away from reading. Keep the answer short, concrete, and useful.

Rules:
- Answer only the user's selected text and nearby paragraph context.
- Do not spoil later parts of a book.
- Do not turn the answer into an open-ended chat unless the action is ask.
- Use plain language, but do not talk down to the reader.
- Prefer one compact paragraph. Use at most two short sentences unless needed.
- Return only the structured response requested by the API schema.
""".strip()


ACTION_INSTRUCTIONS = {
    "ask": "Answer the user's question about the selected text.",
    "example": "Give one concrete example that makes the selected idea easier to grasp.",
    "explain": "Explain what the selected word, phrase, or passage means in this context.",
    "rephrase": "Rewrite the selected text in clearer, simpler wording without changing its meaning.",
    "simpler": "Explain the selected text in an even simpler and more direct way.",
}


EYEBROW_GUIDANCE = {
    "ask": "Answer",
    "example": "Example",
    "explain": "Definition if selectionKind is word; otherwise Short version",
    "rephrase": "Rephrased",
    "simpler": "Simpler",
}


def build_user_prompt(request: AssistRequest) -> str:
    question_line = f"\nReader question: {request.question}" if request.question else ""

    return f"""
Book: {request.book_title}
Author: {request.author}
Action: {request.action}
Action instruction: {ACTION_INSTRUCTIONS[request.action]}
Eyebrow guidance: {EYEBROW_GUIDANCE[request.action]}
Selection kind: {request.selection_kind}

Selected text:
{request.selected_text}

Nearby paragraph:
{request.paragraph_text}{question_line}
""".strip()
