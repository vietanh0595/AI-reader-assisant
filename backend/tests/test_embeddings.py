from __future__ import annotations

from unittest.mock import MagicMock, call

import pytest
from backend.app.indexing.embeddings import OpenAIEmbeddingProvider


def _fake_openai(responses: list[list[list[float]]] | None = None):
    client = MagicMock()
    default = [[[1.0, 0.0], [0.0, 1.0]]]
    pages = responses or default

    def _create(**kwargs):
        page = pages.pop(0) if pages else []
        result = MagicMock()
        result.data = [MagicMock(embedding=vec) for vec in page]
        return result

    client.embeddings.create.side_effect = _create
    return client


def test_embed_documents_preserves_input_order():
    fake = _fake_openai([[[1.0, 0.0], [0.0, 1.0]]])
    provider = OpenAIEmbeddingProvider(fake, model="text-embedding-3-small", dimensions=1536)
    result = provider.embed_documents(["first", "second"])
    assert result == [[1.0, 0.0], [0.0, 1.0]]
    fake.embeddings.create.assert_called_once_with(
        model="text-embedding-3-small",
        dimensions=1536,
        encoding_format="float",
        input=["first", "second"],
    )


def test_embed_documents_batches_at_64():
    texts = [f"text {i}" for i in range(70)]
    batch1 = [[float(i), 0.0] for i in range(64)]
    batch2 = [[float(i), 0.0] for i in range(6)]
    fake = _fake_openai([batch1, batch2])
    provider = OpenAIEmbeddingProvider(fake, model="text-embedding-3-small", dimensions=1536)
    result = provider.embed_documents(texts)
    assert len(result) == 70
    assert fake.embeddings.create.call_count == 2
    first_call_input = fake.embeddings.create.call_args_list[0].kwargs["input"]
    assert len(first_call_input) == 64


def test_embed_documents_rejects_empty_input():
    fake = _fake_openai()
    provider = OpenAIEmbeddingProvider(fake, model="text-embedding-3-small", dimensions=1536)
    with pytest.raises(ValueError, match="empty"):
        provider.embed_documents([])


def test_embed_query_returns_single_vector():
    fake = _fake_openai([[[0.5, 0.5]]])
    provider = OpenAIEmbeddingProvider(fake, model="text-embedding-3-small", dimensions=1536)
    result = provider.embed_query("a question")
    assert result == [0.5, 0.5]


def test_embed_documents_verifies_returned_count():
    client = MagicMock()
    bad_result = MagicMock()
    bad_result.data = [MagicMock(embedding=[1.0])]  # only 1 vector for 2 inputs
    client.embeddings.create.return_value = bad_result
    provider = OpenAIEmbeddingProvider(client, model="text-embedding-3-small", dimensions=1536)
    with pytest.raises(ValueError, match="count"):
        provider.embed_documents(["a", "b"])
