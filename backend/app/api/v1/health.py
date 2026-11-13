import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)

READINESS_TIMEOUT_SECONDS = 3


class HealthResponse(BaseModel):
    status: Literal["ok"]


class ReadyResponse(BaseModel):
    status: Literal["ok", "unavailable"]
    database: Literal["ok", "error"]


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Liveness check. It does not touch the database."""
    return HealthResponse(status="ok")


@router.get(
    "/health/ready",
    response_model=ReadyResponse,
    responses={503: {"model": ReadyResponse, "description": "Database is not reachable"}},
)
async def get_ready(request: Request, response: Response) -> ReadyResponse:
    """Readiness check: the app is only ready when it can run a query on PostgreSQL."""
    sessionmaker = request.app.state.sessionmaker
    if sessionmaker is not None:
        try:
            async with asyncio.timeout(READINESS_TIMEOUT_SECONDS):
                async with sessionmaker() as session:
                    await session.execute(text("SELECT 1"))
            return ReadyResponse(status="ok", database="ok")
        except Exception:
            # The reason is logged server-side only, never returned to the client.
            logger.exception("Readiness check failed")
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadyResponse(status="unavailable", database="error")
