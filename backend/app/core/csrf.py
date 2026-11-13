from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from app.core.errors import problem_response

_STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def install_origin_check(app: FastAPI, allowed_origins: list[str]) -> None:
    """CSRF defense for cookie authentication (docs/adr/0001).

    A browser always sends the `Origin` header on a cross-site request that changes state. If it
    is present and not one of our own origins, the request is refused. Requests without the
    header (curl, scripts) are not browser-driven, so they cannot be cross-site forgeries.
    The session cookie is also SameSite=Lax, which is a second layer.
    """
    allowed = set(allowed_origins)

    @app.middleware("http")
    async def origin_check(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method in _STATE_CHANGING_METHODS:
            origin = request.headers.get("origin")
            if origin is not None and origin not in allowed:
                return problem_response(
                    403, "Cross-site request refused.", instance=request.url.path
                )
        return await call_next(request)
