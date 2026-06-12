from __future__ import annotations

from typing import Any, Protocol, Sequence

_BATCH_SIZE = 64


class EmbeddingProvider(Protocol):
    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class OpenAIEmbeddingProvider:
    def __init__(self, client: Any, model: str, dimensions: int) -> None:
        self._client = client
        self._model = model
        self._dimensions = dimensions

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            raise ValueError("embed_documents called with empty input")

        results: list[list[float]] = []
        items = list(texts)

        for start in range(0, len(items), _BATCH_SIZE):
            batch = items[start : start + _BATCH_SIZE]
            response = self._client.embeddings.create(
                model=self._model,
                dimensions=self._dimensions,
                encoding_format="float",
                input=batch,
            )
            vectors = [item.embedding for item in response.data]
            if len(vectors) != len(batch):
                raise ValueError(
                    f"OpenAI returned wrong count: expected {len(batch)}, got {len(vectors)}"
                )
            results.extend(vectors)

        return results

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]
