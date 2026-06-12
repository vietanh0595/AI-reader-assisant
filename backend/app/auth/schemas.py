from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CurrentUserResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: UUID = Field(alias="userId")
