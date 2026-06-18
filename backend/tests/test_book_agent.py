from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest

from backend.app.retrieval.agent import BookAgent, MAX_TOOL_ROUNDS
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

    def retrieve(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return self.evidence

    def read_current_context(self, **kwargs):
        return "current page text"


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
    assert retrieval.retrieve_calls[0]["max_reading_order"] is None


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
    assert retrieval.retrieve_calls[0]["max_reading_order"] == 42


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
    dumped = repr(client.calls[0]["input"])
    assert "first q" in dumped and "first a" in dumped and "highlighted passage" in dumped
