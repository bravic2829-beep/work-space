"""Errors as RFC 9457 Problem Details (see docs/api-conventions.md)."""

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"

FORBIDDEN = "You do not have permission to do this."
STALE_RECORD = "The record was changed by somebody else. Reload it and try again."


class ProblemError(Exception):
    """Raise this from services and routers to answer with a Problem Details body."""

    def __init__(
        self,
        status: int,
        detail: str | None = None,
        *,
        headers: Mapping[str, str] | None = None,
        errors: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(detail or HTTPStatus(status).phrase)
        self.status = status
        self.detail = detail
        self.headers = dict(headers or {})
        self.errors = errors


def problem_response(
    status: int,
    detail: str | None = None,
    *,
    instance: str | None = None,
    headers: Mapping[str, str] | None = None,
    errors: list[dict[str, str]] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": HTTPStatus(status).phrase,
        "status": status,
    }
    if detail:
        body["detail"] = detail
    if instance:
        body["instance"] = instance
    if errors:
        body["errors"] = errors
    return JSONResponse(
        body, status_code=status, headers=dict(headers or {}), media_type=PROBLEM_MEDIA_TYPE
    )


async def _handle_problem(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ProblemError)
    return problem_response(
        exc.status,
        exc.detail,
        instance=request.url.path,
        headers=exc.headers,
        errors=exc.errors,
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    headers = dict(exc.headers) if exc.headers else None
    return problem_response(exc.status_code, None, instance=request.url.path, headers=headers)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # Only the location and the message are returned. The submitted value is never echoed,
    # because it may be a password.
    errors = [
        {
            "field": ".".join(str(part) for part in error["loc"] if part != "body"),
            "message": str(error["msg"]),
        }
        for error in exc.errors()
    ]
    return problem_response(
        422, "One or more fields are invalid.", instance=request.url.path, errors=errors
    )


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    # The details stay in the server log. The client only learns that something went wrong.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return problem_response(500, None, instance=request.url.path)


# PostgreSQL SQLSTATE codes for text it cannot store: a NUL character (22021, also 22P05 for
# a \u0000 escape inside JSONB). Every text a client sends can contain one, so this is answered
# for all endpoints instead of being a 500.
_UNSTORABLE_TEXT = {"22021", "22P05"}


async def _handle_database_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DBAPIError)
    if getattr(exc.orig, "sqlstate", None) in _UNSTORABLE_TEXT:
        return problem_response(
            422, "Text cannot contain the NUL character.", instance=request.url.path
        )
    return await _handle_unexpected(request, exc)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemError, _handle_problem)
    app.add_exception_handler(DBAPIError, _handle_database_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(Exception, _handle_unexpected)
