from openai import OpenAI, OpenAIError

from .config import Settings
from .prompts import SYSTEM_PROMPT, build_user_prompt
from .schemas import AssistRequest, AssistResponse


class AssistantConfigurationError(Exception):
    """Raised when the AI service cannot be configured locally."""


class AssistantServiceError(Exception):
    """Raised when the upstream AI service fails or returns unusable output."""


class OpenAIAssistant:
    def __init__(self, settings: Settings):
        self._settings = settings

    def generate(self, request: AssistRequest) -> AssistResponse:
        try:
            api_key = self._settings.require_openai_api_key()
        except RuntimeError as exc:
            raise AssistantConfigurationError(str(exc)) from exc

        client = OpenAI(api_key=api_key)
        request_options: dict[str, object] = {
            "input": build_user_prompt(request),
            "instructions": SYSTEM_PROMPT,
            "max_output_tokens": 220,
            "model": self._settings.openai_model,
            "text_format": AssistResponse,
        }

        if self._settings.openai_reasoning_effort:
            request_options["reasoning"] = {"effort": self._settings.openai_reasoning_effort}

        try:
            response = client.responses.parse(**request_options)
        except OpenAIError as exc:
            raise AssistantServiceError(f"OpenAI request failed: {exc}") from exc

        if response.output_parsed is None:
            raise AssistantServiceError("OpenAI returned no structured answer.")

        return response.output_parsed
