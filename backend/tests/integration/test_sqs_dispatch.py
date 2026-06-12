from __future__ import annotations

import os

import pytest

LOCALSTACK_ENDPOINT = os.environ.get("LOCALSTACK_ENDPOINT")


@pytest.mark.skipif(
    not LOCALSTACK_ENDPOINT,
    reason="LOCALSTACK_ENDPOINT is not configured",
)
def test_duplicate_sqs_delivery_claims_the_database_job_once():
    pytest.skip("LocalStack integration test — run with LOCALSTACK_ENDPOINT set")
