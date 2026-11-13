from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ProblemError


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One database session per request.

    Nothing is committed automatically: the router commits after the service succeeded.
    Leaving without a commit rolls the work back.
    """
    sessionmaker = request.app.state.sessionmaker
    if sessionmaker is None:
        raise ProblemError(503, "The database is not configured.")
    async with sessionmaker() as session:
        yield session
