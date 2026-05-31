from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
from .schemas import AssistRequest, AssistResponse


settings = get_settings()
assistant = OpenAIAssistant(settings)

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
