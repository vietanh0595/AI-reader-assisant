from __future__ import annotations

from unittest.mock import MagicMock

from backend.app.anki_cards import (
    AnkiNoteInput,
    CardBatchResult,
    GeneratedCard,
    _build_user_input,
    generate_anki_cards,
)


def _note(note_id: str, **overrides) -> AnkiNoteInput:
    # Passage text is unique per note (embeds note_id) so tests can identify a
    # note's presence in a given prompt input by its passage — the real
    # note_id itself is never rendered in the prompt (see _build_user_input),
    # only a positional index, so it can't be grepped for directly anymore.
    defaults = dict(
        note_id=note_id,
        action="highlight",
        passage=f"A passage about {note_id}.",
        answer=None,
        user_note=None,
    )
    defaults.update(overrides)
    return AnkiNoteInput(**defaults)


def _response_for(notes: list[AnkiNoteInput]) -> MagicMock:
    # The model is given positional ids ("0", "1", ...) for a chunk, not the
    # real note_id (see _build_user_input) — mirror that here by returning
    # cards keyed by position within `notes`, the same list _generate_chunk
    # uses to build its position -> real-note_id mapping.
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[
            GeneratedCard(note_id=str(index), front=f"Q for {note.note_id}", back=f"A for {note.note_id}")
            for index, note in enumerate(notes)
        ]
    )
    return response


def test_generates_one_card_per_note_within_a_single_chunk():
    notes = [_note("n1"), _note("n2")]
    client = MagicMock()
    client.responses.parse.return_value = _response_for(notes)

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert client.responses.parse.call_count == 1
    assert {card.note_id for card in cards} == {"n1", "n2"}


def test_splits_more_than_five_notes_into_multiple_chunks():
    notes = [_note(f"n{i}") for i in range(10)]

    def fake_parse(**kwargs):
        # Identify which notes are in this call's input via their unique
        # passage text, since the real note_id is no longer in the prompt.
        chunk_notes = [note for note in notes if note.passage in kwargs["input"]]
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
    # The model only returned a card for the note at position 0 (n1) — n2 was
    # too vague to quiz on.
    response.output_parsed = CardBatchResult(cards=[GeneratedCard(note_id="0", front="Q", back="A")])
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_drops_a_card_whose_note_id_was_never_sent():
    notes = [_note("n1")]
    client = MagicMock()
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[
            GeneratedCard(note_id="0", front="Q", back="A"),
            GeneratedCard(note_id="hallucinated", front="Q2", back="A2"),
        ]
    )
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_a_failing_chunk_does_not_prevent_other_chunks_from_returning():
    # 10 notes split into two equal 5-note chunks, so the assertion below reflects
    # exactly one whole chunk surviving, not a partial one.
    notes = [_note(f"n{i}") for i in range(10)]

    def fake_parse(**kwargs):
        if notes[0].passage in kwargs["input"]:
            raise RuntimeError("upstream failure")
        chunk_notes = [note for note in notes if note.passage in kwargs["input"]]
        return _response_for(chunk_notes)

    client = MagicMock()
    client.responses.parse.side_effect = fake_parse

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    returned_ids = {card.note_id for card in cards}
    assert "n0" not in returned_ids
    assert len(returned_ids) == 5  # the other chunk's 5 notes all came back


def test_returns_empty_list_for_empty_notes_without_calling_openai():
    client = MagicMock()

    cards = generate_anki_cards(client, "gpt-5-mini", [])

    assert cards == []
    assert client.responses.parse.call_count == 0


def test_note_id_with_a_colon_round_trips_correctly():
    # Regression test for the real bug: real note ids look like
    # "highlight:abc123" or "insight:xyz789" (colon-prefixed, per
    # createHighlightId/createSavedInsightId in App.tsx). A real model call
    # was observed dropping everything before the colon when asked to echo an
    # id like that back verbatim, corrupting the round trip and silently
    # discarding an otherwise-good card. The positional-id indirection means
    # the model never sees or echoes the real id, so this must survive
    # regardless of what characters it contains.
    notes = [_note("highlight:abc123")]
    client = MagicMock()
    client.responses.parse.return_value = _response_for(notes)

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["highlight:abc123"]


def test_build_user_input_never_leaks_the_real_note_id():
    # Passage text overridden here (unlike the shared `_note` default) so it
    # doesn't coincidentally contain the id substring itself.
    notes = [
        _note("highlight:abc123", passage="Some passage text."),
        _note("insight:xyz789", passage="Some other passage text."),
    ]

    prompt = _build_user_input(notes)

    assert "highlight:abc123" not in prompt
    assert "insight:xyz789" not in prompt
    assert "note_id: 0" in prompt
    assert "note_id: 1" in prompt


def test_build_user_input_includes_the_existing_question_when_present():
    # An 'ask' note with a selection carries its original (possibly vague)
    # question as context, so the model can decide whether to keep it or
    # rewrite it into something self-contained.
    notes = [_note("chat:abc", action="ask", answer="An existing answer.", question="give me an example")]

    prompt = _build_user_input(notes)

    assert "existing question: give me an example" in prompt


def test_ask_action_is_accepted():
    note = _note("chat:abc", action="ask", answer="An existing answer.", question="what does it mean")
    assert note.action == "ask"
