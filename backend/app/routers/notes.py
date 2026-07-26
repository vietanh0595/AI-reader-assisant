from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from openai import OpenAI

from ..anki_cards import AnkiCardsRequest, AnkiCardsResponse, generate_anki_cards
from ..rate_limit import check_anki_cards_rate_limit

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("/anki-cards", response_model=AnkiCardsResponse)
def anki_cards(
    ask_request: AnkiCardsRequest,
    request: Request,
    _rate_limit: None = Depends(check_anki_cards_rate_limit),
) -> AnkiCardsResponse:
    settings = request.app.state.settings
    client = OpenAI(api_key=settings.openai_api_key)
    cards = generate_anki_cards(client, settings.openai_model, ask_request.notes)
    return AnkiCardsResponse(cards=cards)
