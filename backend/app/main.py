import logging
from time import perf_counter

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
from .schemas import AssistRequest, AssistResponse, OcrRequest, OcrResponse


settings = get_settings()
assistant = OpenAIAssistant(settings)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Book Reader API")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_headers=["*"],
    allow_methods=["*"],
    allow_origins=list(settings.cors_allow_origins),
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"model": settings.openai_model, "status": "ok"}


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
