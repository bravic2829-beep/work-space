from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_app_settings, get_session
from app.core.config import Settings
from app.core.errors import FORBIDDEN, ProblemError
from app.modules.auth import service
from app.modules.auth.service import AuthContext
from app.modules.permissions.service import is_org_admin
from app.modules.users.models import User


async def get_auth_context(
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_app_settings),
) -> AuthContext:
    """The signed-in user and session, or a 401 when the cookie is missing or not valid."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise service.unauthenticated()
    context = await service.authenticate(session, settings, token)
    if context is None:
        raise service.unauthenticated()
    return context


async def get_user_pending_password(context: AuthContext = Depends(get_auth_context)) -> User:
    """The signed-in user, even while they still have to change a temporary password."""
    return context.user


async def get_current_user(user: User = Depends(get_user_pending_password)) -> User:
    """The signed-in user. Until a temporary password is replaced, nothing else is open."""
    if user.must_change_password:
        raise ProblemError(403, "You must change your temporary password first.")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Only organization admins (owner or admin) pass. Everyone else gets 403."""
    if not is_org_admin(user):
        raise ProblemError(403, FORBIDDEN)
    return user
