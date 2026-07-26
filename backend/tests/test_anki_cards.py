from __future__ import annotations

from unittest.mock import MagicMock

from backend.app.anki_cards import (
    AnkiNoteInput,
    CardBatchResult,
    GeneratedCard,
    generate_anki_cards,
)


def _note(note_id: str, **overrides) -> AnkiNoteInput:
    defaults = dict(note_id=note_id, action="highlight", passage="A passage.", answer=None, user_note=None)
    defaults.update(overrides)
    return AnkiNoteInput(**defaults)


def _response_for(notes: list[AnkiNoteInput]) -> MagicMock:
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[GeneratedCard(note_id=note.note_id, front=f"Q for {note.note_id}", back=f"A for {note.note_id}") for note in notes]
    )
    return response


def test_generates_one_card_per_note_within_a_single_chunk():
    notes = [_note("n1"), _note("n2")]
    client = MagicMock()
    client.responses.parse.return_value = _response_for(notes)

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert client.responses.parse.call_count == 1
    assert {card.note_id for card in cards} == {"n1", "n2"}


def test_splits_more_than_eight_notes_into_multiple_chunks():
    notes = [_note(f"n{i}") for i in range(10)]

    def fake_parse(**kwargs):
        # Identify which notes are in this call's input so chunking is verified
        # regardless of thread execution order.
        chunk_notes = [note for note in notes if note.note_id in kwargs["input"]]
        return _response_for(chunk_notes)

    client = MagicMock()
    client.responses.parse.side_effect = fake_parse

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert client.responses.parse.call_count == 2
    assert {card.note_id for card in cards} == {note.note_id for note in notes}


def test_omits_a_note_the_model_left_out_of_its_response():
    notes = [_note("n1"), _note("n2")]
    client = MagicMock()
    response = MagicMock()
    # The model only returned a card for n1 — n2 was too vague to quiz on.
    response.output_parsed = CardBatchResult(cards=[GeneratedCard(note_id="n1", front="Q", back="A")])
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_drops_a_card_whose_note_id_was_never_sent():
    notes = [_note("n1")]
    client = MagicMock()
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[GeneratedCard(note_id="n1", front="Q", back="A"), GeneratedCard(note_id="hallucinated", front="Q2", back="A2")]
    )
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_a_failing_chunk_does_not_prevent_other_chunks_from_returning():
    # 16 notes split into two equal 8-note chunks, so the assertion below reflects
    # exactly one whole chunk surviving, not a partial one.
    notes = [_note(f"n{i}") for i in range(16)]

    def fake_parse(**kwargs):
        if "n0" in kwargs["input"]:
            raise RuntimeError("upstream failure")
        chunk_notes = [note for note in notes if note.note_id in kwargs["input"]]
        return _response_for(chunk_notes)

    client = MagicMock()
    client.responses.parse.side_effect = fake_parse

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    returned_ids = {card.note_id for card in cards}
    assert "n0" not in returned_ids
    assert len(returned_ids) == 8  # the other chunk's 8 notes all came back
