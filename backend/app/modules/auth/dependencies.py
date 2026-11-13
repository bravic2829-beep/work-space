from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_app_settings, get_session
from app.core.config import Settings
from app.core.errors import ProblemError
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


async def get_current_user(context: AuthContext = Depends(get_auth_context)) -> User:
    return context.user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Only organization admins (owner or admin) pass. Everyone else gets 403."""
    if not is_org_admin(user):
        raise ProblemError(403, "You do not have permission to do this.")
    return user
