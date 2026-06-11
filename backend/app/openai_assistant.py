import logging
import re
from time import perf_counter
from typing import Optional

from openai import OpenAI, OpenAIError

from .config import Settings
from .prompts import SYSTEM_PROMPT, build_user_prompt
from .schemas import AssistRequest, AssistResponse, OcrRequest, OcrResponse, OcrTextBlock


logger = logging.getLogger(__name__)
OCR_BLOCK_DELIMITER = "<<<BLOCK>>>"
OCR_END_MARKER = "<<<END_OF_PAGE>>>"
OCR_INITIAL_OUTPUT_TOKENS = 4200
OCR_RETRY_OUTPUT_TOKENS = 8000


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

    def extract_text(self, request: OcrRequest) -> OcrResponse:
        try:
            api_key = self._settings.require_openai_api_key()
        except RuntimeError as exc:
            raise AssistantConfigurationError(str(exc)) from exc

        client = OpenAI(api_key=api_key)
        request_options: dict[str, object] = {
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "Extract the readable text from this captured book or document page. "
                                "Preserve reading order and reflow visual line wrapping into natural paragraphs. "
                                f"Put {OCR_BLOCK_DELIMITER} on its own line between headings, paragraphs, or list items. "
                                "Transcribe the entire page from top to bottom without stopping early. "
                                f"Finish with {OCR_END_MARKER} on its own line. If no readable text is present, "
                                f"return only {OCR_END_MARKER}."
                            ),
                        },
                        {
                            "type": "input_image",
                            "image_url": request.image_data_url,
                        },
                    ],
                }
            ],
            "instructions": OCR_SYSTEM_PROMPT,
            "max_output_tokens": OCR_INITIAL_OUTPUT_TOKENS,
            "model": self._settings.openai_model,
        }

        if self._settings.openai_reasoning_effort:
            request_options["reasoning"] = {"effort": self._settings.openai_reasoning_effort}

        response = self._request_ocr(client, request_options, attempt=1)
        transcript = response.output_text.strip()

        if not self._is_complete_ocr_response(response.status, transcript):
            logger.warning(
                "OpenAI OCR attempt 1 was incomplete (status=%s, chars=%d); retrying",
                response.status,
                len(transcript),
            )
            retry_options = dict(request_options)
            retry_options["max_output_tokens"] = OCR_RETRY_OUTPUT_TOKENS
            response = self._request_ocr(client, retry_options, attempt=2)
            transcript = response.output_text.strip()

        if not self._is_complete_ocr_response(response.status, transcript):
            logger.error(
                "OpenAI OCR remained incomplete after retry (status=%s, chars=%d)",
                response.status,
                len(transcript),
            )
            raise AssistantServiceError(
                "The full page could not be read. Try holding the camera closer or scanning the page in two sections."
            )

        transcript = transcript[: -len(OCR_END_MARKER)].rstrip()
        blocks = self._parse_ocr_blocks(transcript)
        title = self._infer_ocr_title(blocks)

        return OcrResponse(
            author="Scanned page",
            blocks=blocks,
            language=None,
            text="\n\n".join(block.text for block in blocks),
            title=title,
        )

    @staticmethod
    def _request_ocr(client: OpenAI, request_options: dict[str, object], attempt: int):
        request_started_at = perf_counter()

        try:
            response = client.responses.create(**request_options)
        except OpenAIError as exc:
            raise AssistantServiceError(f"OpenAI OCR request failed: {exc}") from exc

        logger.info(
            "OpenAI OCR attempt %d completed in %.0f ms (status=%s, chars=%d)",
            attempt,
            (perf_counter() - request_started_at) * 1000,
            response.status,
            len(response.output_text),
        )
        return response

    @staticmethod
    def _is_complete_ocr_response(status: Optional[str], transcript: str) -> bool:
        return status == "completed" and transcript.rstrip().endswith(OCR_END_MARKER)

    @staticmethod
    def _parse_ocr_blocks(transcript: str) -> list[OcrTextBlock]:
        if not transcript:
            return []

        raw_blocks = re.split(rf"\s*{re.escape(OCR_BLOCK_DELIMITER)}\s*", transcript)
        blocks: list[OcrTextBlock] = []

        for raw_block in raw_blocks:
            text = re.sub(r"[ \t]+", " ", raw_block)
            text = re.sub(r"\s*\n\s*", " ", text).strip()

            if text:
                blocks.append(OcrTextBlock(confidence=None, text=text[:4000]))

        return blocks[:80]

    @staticmethod
    def _infer_ocr_title(blocks: list[OcrTextBlock]) -> str:
        if not blocks:
            return "Scanned page"

        candidate = blocks[0].text.strip()
        word_count = len(candidate.split())
        looks_like_heading = len(candidate) <= 120 and word_count <= 12 and (
            candidate.isupper() or candidate[-1:] not in ".!?"
        )
        return candidate if looks_like_heading else "Scanned page"


OCR_SYSTEM_PROMPT = """
You are the OCR extraction service for an AI book reader.

Return only the page transcription. Do not explain or summarize the page.
Transcribe visible text as faithfully as possible while preserving reading order.
Reflow wrapped printed lines into complete paragraphs. Keep headings and list
items as separate blocks. Separate every block using the exact marker
<<<BLOCK>>> on its own line. Do not use JSON, Markdown fences, or any other
metadata. Transcribe the entire visible page from top to bottom. End every
response with the exact marker <<<END_OF_PAGE>>> on its own line. Ignore page
furniture, watermarks, UI chrome, and decorative marks unless they are part of
the text.
""".strip()
