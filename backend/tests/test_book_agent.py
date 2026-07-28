from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest

from backend.app.retrieval.agent import (
    BookAgent,
    HYBRID_SYSTEM_PROMPT,
    MAX_TOOL_ROUNDS,
    SYSTEM_PROMPT,
)
from backend.app.retrieval.answerer import ModelBookAnswer
from backend.app.retrieval.models import EvidenceItem, EvidenceSet

USER_ID = uuid4()
BOOK_ID = uuid4()


@dataclass
class FakeFunctionCall:
    name: str
    arguments: str
    call_id: str
    type: str = "function_call"


@dataclass
class FakeResponse:
    output: list
    output_parsed: Any


class FakeOpenAI:
    """Returns queued responses in order; records the inputs it was given."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.responses = self  # so .responses.parse works

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


def _evidence(source_id, text="evidence text"):
    return EvidenceItem(
        source_id=source_id, chunk_id=uuid4(), chunk_order=0, raw_text=text,
        start_reading_order=0, end_reading_order=1, chapter_id="c1",
        chapter_title="Chapter 1", page_start=1, page_end=1,
        paragraph_ids=["p-1"], source_refs=[{"source": "epub"}], rrf_score=1.0,
    )


class FakeRetrieval:
    def __init__(self):
        self.retrieve_calls = []
        self.evidence = EvidenceSet(items=[_evidence("s0-0")], supported=True)
        # None means "no surrounding text available"; tests that want a real
        # read_current_context result set this to an EvidenceItem (source_id is
        # ignored/overwritten by the agent, same as the real service's contract).
        self.current_context_item = None

    def retrieve(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return self.evidence

    def read_current_context(self, **kwargs):
        return self.current_context_item


def test_agent_runs_tool_then_answers_with_validated_citation():
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="search_book", arguments='{"query": "best strategy"}', call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(
            output=[],
            output_parsed=ModelBookAnswer(
                supported=True, eyebrow="Strategy", body="Start early.", citation_ids=["s0-0"],
            ),
        ),
    ])
    retrieval = FakeRetrieval()
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)

    answer = agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="best strategy?",
        history=[], selected_text=None, current_reading_order=10, include_whole_book=True,
    )

    assert answer.supported is True
    assert answer.body == "Start early."
    assert [s.id for s in answer.sources] == ["s0-0"]
    assert retrieval.retrieve_calls[0]["include_whole_book"] is True


def test_agent_can_cite_the_current_page_as_evidence():
    # Regression test: a question answered from read_current_context (e.g. "what does
    # it mean" about the passage the reader is looking at right now) used to always be
    # forced to "insufficient evidence", because that tool's output was never registered
    # as citable evidence — only search_book results were. See _execute's read_current_context
    # branch.
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="read_current_context", arguments="{}", call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(
            output=[],
            output_parsed=ModelBookAnswer(
                supported=True, eyebrow="Explanation", body="It means X.", citation_ids=["ctx0"],
            ),
        ),
    ])
    retrieval = FakeRetrieval()
    retrieval.current_context_item = _evidence("placeholder-id", text="the current page's text")
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)

    answer = agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="what does it mean",
        history=[], selected_text="the current page's text",
        current_reading_order=10, include_whole_book=False,
    )

    assert answer.supported is True
    assert answer.body == "It means X."
    assert [s.id for s in answer.sources] == ["ctx0"]


def test_agent_handles_no_current_context_available():
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="read_current_context", arguments="{}", call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=False, eyebrow="Insufficient evidence", body="", citation_ids=[])),
    ])
    retrieval = FakeRetrieval()
    retrieval.current_context_item = None
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)

    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="what's here?", history=[],
                          selected_text=None, current_reading_order=10, include_whole_book=False)

    assert answer.supported is False
    tool_output = client.calls[1]["input"][-1]["output"]
    assert tool_output == "No surrounding text is available at the current position."


def test_agent_applies_spoiler_cap_when_book_so_far():
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="search_book", arguments='{"query": "x"}', call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["s0-0"])),
    ])
    retrieval = FakeRetrieval()
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)
    agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                 selected_text=None, current_reading_order=42, include_whole_book=False)
    assert retrieval.retrieve_calls[0]["include_whole_book"] is False
    assert retrieval.retrieve_calls[0]["current_reading_order"] == 42


def test_agent_drops_invalid_citation_ids():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["does-not-exist"])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True)
    assert answer.supported is False
    assert answer.sources == []


def test_agent_stops_at_round_cap():
    looping = [
        FakeResponse(output=[FakeFunctionCall(name="search_book", arguments='{"query":"x"}', call_id=f"c{i}")],
                     output_parsed=None)
        for i in range(MAX_TOOL_ROUNDS + 2)
    ]
    looping.append(FakeResponse(output=[], output_parsed=ModelBookAnswer(
        supported=False, eyebrow="Insufficient evidence", body="", citation_ids=[])))
    client = FakeOpenAI(looping)
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True)
    assert answer.supported is False
    assert len(client.calls) == MAX_TOOL_ROUNDS + 1


def test_agent_includes_history_and_selection_in_input():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="follow up",
        history=[{"role": "user", "content": "first q"}, {"role": "assistant", "content": "first a"}],
        selected_text="highlighted passage", current_reading_order=0, include_whole_book=True,
    )
    sent = client.calls[0]["input"]
    contents = [item["content"] for item in sent if isinstance(item, dict) and "content" in item]
    joined = " ".join(contents)
    assert "first q" in joined
    assert "first a" in joined
    assert "highlighted passage" in joined


def test_agent_phrases_quoted_answer_honestly_not_as_book_text():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="example of this",
        history=[{"role": "user", "content": "Explain this passage"},
                  {"role": "assistant", "content": "consumer purchases drive economic activity"}],
        selected_text=None, current_reading_order=0, include_whole_book=True,
        quoted_answer="consumer purchases drive economic activity",
    )
    sent = client.calls[0]["input"]
    last = sent[-1]
    assert "consumer purchases drive economic activity" in last["content"]
    assert "your own earlier answer" in last["content"]
    assert "I was reading" not in last["content"]


def test_agent_prefers_selected_text_over_quoted_answer_when_both_present():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
        selected_text="real book text", current_reading_order=0, include_whole_book=True,
        quoted_answer="an old answer",
    )
    sent = client.calls[0]["input"]
    last = sent[-1]
    assert "real book text" in last["content"]
    assert "an old answer" not in last["content"]


def test_grounded_mode_uses_strict_prompt_and_refuses_without_sources():
    # Default (allow_general_knowledge=False): no citations -> refuse.
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True)
    assert client.calls[0]["instructions"] == SYSTEM_PROMPT
    assert answer.supported is False
    assert answer.sources == []


def test_hybrid_mode_uses_hybrid_prompt():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["s0-0"])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                 selected_text=None, current_reading_order=0, include_whole_book=True,
                 allow_general_knowledge=True)
    assert client.calls[0]["instructions"] == HYBRID_SYSTEM_PROMPT


def test_hybrid_mode_returns_general_knowledge_answer_without_book_sources():
    # The book had nothing relevant, so the model answers from general knowledge
    # with no citations. Hybrid mode must NOT refuse.
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="Real-world", body="From general knowledge: ...",
            citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True,
                          allow_general_knowledge=True)
    assert answer.supported is True
    assert answer.body == "From general knowledge: ..."
    assert answer.sources == []


@dataclass
class FakeReasoning:
    id: str
    type: str = "reasoning"


def test_agent_echoes_reasoning_items_to_next_round():
    # gpt-5-mini pairs each function_call with a reasoning item; both must be
    # echoed back or the Responses API rejects the next request.
    reasoning = FakeReasoning(id="rs_1")
    client = FakeOpenAI([
        FakeResponse(
            output=[reasoning, FakeFunctionCall(name="search_book", arguments='{"query":"x"}', call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["s0-0"])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                 selected_text=None, current_reading_order=0, include_whole_book=True)
    second_input = client.calls[1]["input"]
    assert reasoning in second_input  # reasoning item echoed back
