from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, or_, select, func
from sqlalchemy.orm import Session, sessionmaker

from .models import IndexJob, JobStatus

_LEASE_SECONDS = 60
_MAX_ATTEMPTS = 5
_BACKOFF_BASE = 30


class JobRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._factory = session_factory

    def claim(self, worker_id: str) -> Optional[IndexJob]:
        with self._factory() as session:
            with session.begin():
                now = datetime.now(tz=timezone.utc)
                job = session.scalar(
                    select(IndexJob)
                    .where(
                        or_(
                            # Normal QUEUED/RETRY path
                            and_(
                                IndexJob.status.in_([JobStatus.QUEUED, JobStatus.RETRY]),
                                IndexJob.next_attempt_at <= now,
                                or_(
                                    IndexJob.lease_expires_at.is_(None),
                                    IndexJob.lease_expires_at < now,
                                ),
                            ),
                            # Reclaim RUNNING jobs whose lease expired (crashed worker)
                            and_(
                                IndexJob.status == JobStatus.RUNNING,
                                IndexJob.lease_expires_at < now,
                            ),
                        )
                    )
                    .order_by(IndexJob.created_at)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if job is None:
                    return None

                job.status = JobStatus.RUNNING
                job.lease_owner = worker_id
                job.lease_expires_at = now + timedelta(seconds=_LEASE_SECONDS)
                job.heartbeat_at = now
                job.attempts = (job.attempts or 0) + 1
                session.flush()

                return _detached_copy(session, job)

    def heartbeat(self, job_id: UUID, worker_id: str) -> None:
        with self._factory() as session:
            with session.begin():
                job = session.get(IndexJob, job_id)
                if job and job.lease_owner == worker_id:
                    now = datetime.now(tz=timezone.utc)
                    job.heartbeat_at = now
                    job.lease_expires_at = now + timedelta(seconds=_LEASE_SECONDS)

    def complete(self, job_id: UUID, worker_id: str) -> None:
        with self._factory() as session:
            with session.begin():
                job = session.get(IndexJob, job_id)
                if job and job.lease_owner == worker_id:
                    job.status = JobStatus.COMPLETE
                    job.lease_owner = None
                    job.lease_expires_at = None

    def fail_retryable(self, job_id: UUID, worker_id: str, error_code: str, error_message: str) -> None:
        with self._factory() as session:
            with session.begin():
                job = session.get(IndexJob, job_id)
                if not job or job.lease_owner != worker_id:
                    return
                attempts = job.attempts or 0
                if attempts >= _MAX_ATTEMPTS:
                    job.status = JobStatus.FAILED
                else:
                    backoff = min(_BACKOFF_BASE * (2 ** (attempts - 1)), 3600)
                    job.status = JobStatus.RETRY
                    job.next_attempt_at = datetime.now(tz=timezone.utc) + timedelta(seconds=backoff)
                job.error_code = error_code
                job.error_message = error_message
                job.lease_owner = None
                job.lease_expires_at = None

    def fail_permanent(self, job_id: UUID, worker_id: str, error_code: str, error_message: str) -> None:
        with self._factory() as session:
            with session.begin():
                job = session.get(IndexJob, job_id)
                if not job or job.lease_owner != worker_id:
                    return
                job.status = JobStatus.FAILED
                job.error_code = error_code
                job.error_message = error_message
                job.lease_owner = None
                job.lease_expires_at = None


def _detached_copy(session: Session, job: IndexJob) -> IndexJob:
    """Return job attributes as a simple namespace to avoid expired-state errors."""
    import types
    ns = types.SimpleNamespace()
    ns.id = job.id
    ns.index_version_id = job.index_version_id
    ns.status = job.status
    ns.attempts = job.attempts
    ns.lease_owner = job.lease_owner
    ns.lease_expires_at = job.lease_expires_at
    return ns  # type: ignore[return-value]
