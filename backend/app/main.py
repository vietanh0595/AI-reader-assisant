from __future__ import annotations

import logging
from time import perf_counter

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .auth.jwt import JwtValidator
from .config import Settings, get_settings
from .db.session import create_session_factory
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
from .routers.auth import router as auth_router
from .routers.indexing import router as indexing_router
from .schemas import AssistRequest, AssistResponse, OcrRequest, OcrResponse


logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"model": app_settings.openai_model, "status": "ok"}

    @app.post("/ai/assist", response_model=AssistResponse)
    def assist(request: AssistRequest) -> AssistResponse:
        try:
            return assistant.generate(request)
        except AssistantConfigurationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        except AssistantServiceError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @app.post("/ocr/extract", response_model=OcrResponse)
    def extract_ocr(request: OcrRequest, response: Response) -> OcrResponse:
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
