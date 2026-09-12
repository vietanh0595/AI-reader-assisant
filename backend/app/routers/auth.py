from typing import Generator

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.schemas import CurrentUserResponse
from ..db.models import User


router = APIRouter(prefix="/auth")


def get_session(request: Request) -> Generator[Session, None, None]:
    # Generator, not a plain return: FastAPI runs the code after yield as cleanup
    # once the request finishes, which is what closes the `with` block and returns
    # the connection to the pool. Same reasoning as the indexing router.
    with request.app.state.session_factory() as session:
        yield session


@router.get("/me", response_model=CurrentUserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(userId=current_user.id)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete the caller's account and everything it owns.

    Apple guideline 5.1.1(v): an app that offers account creation must offer
    in-app account deletion.

    Deleting the user row is the whole operation — every table that holds their
    data hangs off it with ON DELETE CASCADE (identities, books, index versions,
    book blocks, upload batches, RAG chunks, index jobs, mind maps), so the
    database removes it all in one statement.

    Note for callers: the access token stays valid after this, and
    get_current_user provisions a user from the token when none exists. Any
    authenticated request made after this one will therefore create a fresh,
    empty account. The client must sign out immediately and make no authenticated
    call in between.
    """
    with session.begin():
        user = session.get(User, current_user.id)
        if user is not None:
            session.delete(user)
