from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from openai import OpenAI

from ..anki_cards import AnkiCardsRequest, AnkiCardsResponse, generate_anki_cards
from ..rate_limit import check_anki_cards_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("/anki-cards", response_model=AnkiCardsResponse)
def anki_cards(
    ask_request: AnkiCardsRequest,
    request: Request,
    _rate_limit: None = Depends(check_anki_cards_rate_limit),
) -> AnkiCardsResponse:
    settings = request.app.state.settings
    client = OpenAI(api_key=settings.openai_api_key)
    logger.info(
        "anki-cards request: %d notes (%s)",
        len(ask_request.notes),
        ", ".join(f"{n.note_id}:{n.action}:{len(n.passage or '')}chars" for n in ask_request.notes),
    )
    cards = generate_anki_cards(client, settings.openai_model, ask_request.notes)
    logger.info(
        "anki-cards response: %d/%d cards (%s)",
        len(cards),
        len(ask_request.notes),
        ", ".join(c.note_id for c in cards) or "none",
    )
    return AnkiCardsResponse(cards=cards)
