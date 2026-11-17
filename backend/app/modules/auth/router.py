from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_app_settings, get_session
from app.core.config import Settings
from app.modules.auth import service
from app.modules.auth.dependencies import get_auth_context
from app.modules.auth.rate_limiter import LoginFailureLimiter
from app.modules.auth.schemas import ChangePasswordRequest, LoginRequest
from app.modules.auth.service import AuthContext
from app.modules.users.schemas import UserPublic

router = APIRouter(tags=["sessions"])

CURRENT_SESSION_PATH = "/api/v1/sessions/current"


@router.post("/sessions", status_code=201, response_model=UserPublic)
async def create_session(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_app_settings),
) -> object:
    """Sign in. The token is returned only in an HttpOnly cookie, never in the body."""
    limiter: LoginFailureLimiter = request.app.state.login_limiter
    result = await service.login(
        session,
        settings,
        limiter,
        employee_code=body.employee_code,
        password=body.password,
        remember_me=body.remember_me,
    )
    await session.commit()

    response.set_cookie(
        settings.session_cookie_name,
        result.token,
        max_age=result.max_age_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.headers["Location"] = CURRENT_SESSION_PATH
    return result.user


@router.put("/users/me/password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    context: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Change my own password. Every other device is signed out; this one stays signed in."""
    limiter: LoginFailureLimiter = request.app.state.login_limiter
    await service.change_password(
        session,
        limiter,
        context,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    await session.commit()


@router.delete("/sessions/current", status_code=204)
async def delete_current_session(
    response: Response,
    context: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_app_settings),
) -> None:
    """Sign out. The token is revoked on the server, so it stops working right away."""
    await service.logout(session, session_id=context.session_id)
    await session.commit()
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
