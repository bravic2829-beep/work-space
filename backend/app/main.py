from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.csrf import install_origin_check
from app.core.db import create_engine, create_sessionmaker
from app.core.errors import install_error_handlers
from app.modules.auth.rate_limiter import LoginFailureLimiter


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.app_env != "test":
            # Fail at startup, not on the first login, when the signing secret is missing.
            settings.require_jwt_secret()
        engine = create_engine(settings.database_url) if settings.database_url else None
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine) if engine else None
        try:
            yield
        finally:
            if engine is not None:
                await engine.dispose()

    app = FastAPI(
        title="WorkBase API",
        docs_url=None if settings.app_env == "production" else "/docs",
        redoc_url=None,
        openapi_url=None if settings.app_env == "production" else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.login_limiter = LoginFailureLimiter(
        max_failures=settings.login_max_failures,
        lock_seconds=settings.login_lock_minutes * 60,
    )

    install_error_handlers(app)
    install_origin_check(app, settings.cors_allowed_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "If-Match"],
        expose_headers=["ETag", "Location", "Retry-After"],
    )
    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
