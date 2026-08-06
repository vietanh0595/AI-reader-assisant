from __future__ import annotations

import logging
import logging.config
from time import perf_counter

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"default": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "default"}},
    "root": {"level": "INFO", "handlers": ["console"]},
})

import sentry_sdk
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .auth.dependencies import get_current_user
from .auth.jwt import JwtValidator
from .config import Settings, get_settings
from .db.models import User
from .db.session import create_session_factory
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
from .rate_limit import check_ai_assist_rate_limit
from .routers.auth import router as auth_router
from .routers.book_ask import router as book_ask_router
from .routers.indexing import router as indexing_router
from .routers.mindmap import router as mindmap_router
from .routers.notes import router as notes_router
from .schemas import AssistRequest, AssistResponse, OcrRequest, OcrResponse


logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()

    # No DSN (e.g. local dev) means this is a no-op - sentry_sdk's global client stays
    # unset, so every sentry_sdk call elsewhere silently does nothing.
    if app_settings.sentry_dsn:
        sentry_sdk.init(dsn=app_settings.sentry_dsn, traces_sample_rate=1.0)

    assistant = OpenAIAssistant(app_settings)
    session_factory = create_session_factory(app_settings)
    oidc_values = (
        app_settings.oidc_issuer_url,
        app_settings.oidc_audience,
        app_settings.oidc_jwks_url,
    )
    configured_oidc_values = sum(bool(value) for value in oidc_values)

    if configured_oidc_values not in (0, len(oidc_values)):
        raise RuntimeError(
            "OIDC settings must be configured together: "
            "OIDC_ISSUER_URL, OIDC_AUDIENCE, OIDC_JWKS_URL"
        )

    jwt_validator = (
        JwtValidator(app_settings.require_oidc_settings())
        if configured_oidc_values == len(oidc_values)
        else None
    )
    app = FastAPI(title="AI Book Reader API")
    app.state.settings = app_settings
    app.state.assistant = assistant
    app.state.session_factory = session_factory
    app.state.jwt_validator = jwt_validator
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=False,
        allow_headers=["*"],
        allow_methods=["*"],
        allow_origins=list(app_settings.cors_allow_origins),
    )
    app.include_router(auth_router)
    app.include_router(indexing_router)
    app.include_router(book_ask_router)
    app.include_router(mindmap_router)
    app.include_router(notes_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"model": app_settings.openai_model, "status": "ok"}

    @app.post("/ai/assist", response_model=AssistResponse)
    def assist(
        request: AssistRequest,
        _rate_limit: None = Depends(check_ai_assist_rate_limit),
    ) -> AssistResponse:
        try:
            return assistant.generate(request)
        except AssistantConfigurationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        except AssistantServiceError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @app.post("/ocr/extract", response_model=OcrResponse)
    def extract_ocr(
        request: OcrRequest,
        response: Response,
        user: User = Depends(get_current_user),
    ) -> OcrResponse:
        started_at = perf_counter()

        try:
            result = assistant.extract_text(request)
        except AssistantConfigurationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        except AssistantServiceError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        processing_ms = (perf_counter() - started_at) * 1000
        response.headers["Server-Timing"] = f"ocr;dur={processing_ms:.0f}"
        response.headers["X-OCR-Processing-Ms"] = f"{processing_ms:.0f}"
        logger.info("OCR request completed in %.0f ms", processing_ms)
        return result

    return app


app = create_app()
