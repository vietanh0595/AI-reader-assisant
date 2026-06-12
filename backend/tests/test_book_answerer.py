from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from backend.app.retrieval.answerer import BookAnswerer
from backend.app.retrieval.models import EvidenceItem, EvidenceSet


def make_evidence(source_ids: list[str]) -> EvidenceSet:
    items = [
        EvidenceItem(
            source_id=sid,
            chunk_id=uuid4(),
            chunk_order=i,
            raw_text=f"Evidence text for {sid}.",
            start_reading_order=i * 10,
            end_reading_order=i * 10 + 9,
            chapter_id="ch1",
            chapter_title="Chapter 1",
            page_start=None,
            page_end=None,
            paragraph_ids=[f"p{i}"],
            source_refs=[{"source": "epub"}],
            rrf_score=0.9,
        )
        for i, sid in enumerate(source_ids)
    ]
    return EvidenceSet(items=items, supported=True)


def fake_client(
    supported: bool = True,
    body: str = "The policy changes borrowing costs.",
    citation_ids: list[str] | None = None,
) -> MagicMock:
    from backend.app.retrieval.answerer import ModelBookAnswer

    client = MagicMock()
    parsed = ModelBookAnswer(
        supported=supported,
        eyebrow="Book answer",
        body=body,
        citation_ids=citation_ids or ["source-1"],
    )
    response = MagicMock()
    response.output_parsed = parsed
    client.responses.parse.return_value = response
    return client


def test_answerer_removes_citations_not_in_retrieved_sources():
    client = fake_client(citation_ids=["source-1", "invented-source"])
    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(question="Why?", evidence=make_evidence(["source-1"]))
    assert [s.id for s in result.sources] == ["source-1"]


def test_no_valid_citation_becomes_insufficient_evidence():
    client = fake_client(citation_ids=["invented-source"])
    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(question="Why?", evidence=make_evidence(["source-1"]))
    assert result.supported is False


def test_model_returns_unsupported_directly():
    client = fake_client(supported=False, citation_ids=[])
    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(question="Why?", evidence=make_evidence(["source-1"]))
    assert result.supported is False


def test_duplicate_citations_deduplicated():
    client = fake_client(citation_ids=["source-1", "source-1", "source-2"])
    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(question="Why?", evidence=make_evidence(["source-1", "source-2"]))
    ids = [s.id for s in result.sources]
    assert len(ids) == len(set(ids))


def test_citations_capped_at_three():
    from backend.app.retrieval.answerer import ModelBookAnswer
    # Bypass Pydantic validation by using construct/model_construct to simulate
    # the model returning 4 IDs (a misbehaving model scenario)
    client = MagicMock()
    parsed = MagicMock(spec=ModelBookAnswer)
    parsed.supported = True
    parsed.eyebrow = "Book answer"
    parsed.body = "Some body"
    parsed.citation_ids = ["source-1", "source-2", "source-3", "source-4"]
    response = MagicMock()
    response.output_parsed = parsed
    client.responses.parse.return_value = response

    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(
        question="Why?",
        evidence=make_evidence(["source-1", "source-2", "source-3", "source-4"]),
    )
    assert len(result.sources) <= 3


def test_answer_includes_request_id():
    client = fake_client()
    answerer = BookAnswerer(client=client, model="gpt-5-mini")
    result = answerer.answer(question="Why?", evidence=make_evidence(["source-1"]))
    assert result.request_id and len(result.request_id) > 0
