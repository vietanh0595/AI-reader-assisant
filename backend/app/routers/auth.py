from fastapi import APIRouter, Depends

from ..auth.dependencies import get_current_user
from ..auth.schemas import CurrentUserResponse
from ..db.models import User


router = APIRouter(prefix="/auth")


@router.get("/me", response_model=CurrentUserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(user_id=current_user.id)
