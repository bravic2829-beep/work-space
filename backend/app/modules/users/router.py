import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user, require_admin
from app.modules.users import hr_service, repository
from app.modules.users.models import User, UserStatus
from app.modules.users.schemas import DirectoryEntry, UserCreate, UserPublic, UserUpdate

router = APIRouter(tags=["users"])


# Declared before /users/{user_id} so that "me" is not read as an id.
@router.get("/users/me", response_model=UserPublic)
async def get_me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/directory/users", response_model=list[DirectoryEntry])
async def search_directory(
    q: str | None = Query(None, max_length=100, description="Search in code and name"),
    ids: list[uuid.UUID] = Query(default=[], max_length=100, description="Look people up by id"),
    limit: int = Query(20, ge=1, le=50),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[User]:
    """Colleagues (code and name only), for choosing and showing people in user fields.

    Without `ids`: active employees matching `q`. With `ids`: those employees, even if they
    left, so that a name on an old record stays readable. Open to every signed-in employee,
    unlike /users (HR, admins only), and it shows nothing but what a picker needs.
    """
    if ids:
        return await repository.get_many(session, organization_id=actor.organization_id, ids=ids)
    return await repository.search_active(
        session, organization_id=actor.organization_id, query=q, limit=limit
    )


@router.get("/users", response_model=Page[UserPublic])
async def list_users(
    q: str | None = Query(None, max_length=100, description="Search in code and name"),
    status: UserStatus | None = None,
    department_id: uuid.UUID | None = None,
    limit: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(None, max_length=200),
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Page[UserPublic]:
    return await hr_service.list_users(
        session,
        actor,
        query=q,
        status=status,
        department_id=department_id,
        limit=limit,
        cursor=cursor,
    )


@router.post("/users", status_code=201, response_model=UserPublic)
async def create_user(
    body: UserCreate,
    response: Response,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    user = await hr_service.create_user(session, actor, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/users/{user.id}"
    return user


@router.get("/users/{user_id}", response_model=UserPublic)
async def get_user(
    user_id: uuid.UUID,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    return await hr_service.get_user(session, actor, user_id)


@router.patch("/users/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    user = await hr_service.update_user(session, actor, user_id, body)
    await session.commit()
    return user
