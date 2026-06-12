from __future__ import annotations

import os
from typing import Any
from uuid import UUID


class SqsJobDispatcher:
    def __init__(self, queue_url: str, client: Any) -> None:
        self._queue_url = queue_url
        self._client = client

    def enqueue(self, job_id: UUID) -> None:
        self._client.send_message(
            QueueUrl=self._queue_url,
            MessageBody=str(job_id),
        )

    @classmethod
    def from_env(cls) -> "SqsJobDispatcher":
        import boto3

        endpoint = os.environ.get("LOCALSTACK_ENDPOINT")
        if not endpoint:
            raise RuntimeError("LOCALSTACK_ENDPOINT is not configured")

        queue_url = os.environ["SQS_QUEUE_URL"]
        client = boto3.client(
            "sqs",
            endpoint_url=endpoint,
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        return cls(queue_url=queue_url, client=client)
