"""Copy for the moments when the book has no answer.

Kept apart from the retrieval code because it is writing, not logic, and because the
same sentence has to read well from both the single-shot answerer and the agent.
"""

# The sentence a reader meets whenever the book cannot answer them, so it is the one
# they see most often when the app is not helping. "The retrieved excerpts do not
# contain enough information" is the retrieval pipeline describing itself; a reader
# has no idea what an excerpt is or why one was retrieved.
INSUFFICIENT_EVIDENCE_BODY = (
    "I couldn't find anything in this book that answers that. "
    "Try asking about something specific from the text."
)
