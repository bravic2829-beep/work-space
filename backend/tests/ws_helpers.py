"""Talk to a WebSocket endpoint of the app in memory (no network, same event loop as the test)."""

import asyncio
import json
from types import TracebackType
from typing import Any, Self

from fastapi import FastAPI
from httpx import AsyncClient

WS_PATH = "/api/v1/ws"


def app_of(client: AsyncClient) -> FastAPI:
    app: FastAPI = client._transport.app  # type: ignore[attr-defined]
    return app


class Socket:
    """One WebSocket connection. Use it with `async with`; `opened` says if the app accepted."""

    def __init__(
        self,
        client: AsyncClient,
        *,
        cookie: dict[str, str] | None = None,
        origin: str | None = None,
        include_records: bool = False,
    ) -> None:
        # "records.changed" is a second signal (a record someone can see changed). Tests about
        # notifications do not want it in the way, so it is skipped unless asked for.
        self._include_records = include_records
        headers = [(b"host", b"test")]
        for key, value in (cookie or {}).items():
            headers.append((key.lower().encode(), value.encode()))
        if origin is not None:
            headers.append((b"origin", origin.encode()))
        self._scope: dict[str, Any] = {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "scheme": "ws",
            "path": WS_PATH,
            "raw_path": WS_PATH.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": headers,
            "client": ("test", 1),
            "server": ("test", 80),
            "subprotocols": [],
        }
        self._app = app_of(client)
        self._to_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._from_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None
        self.opened = False
        self.close_code: int | None = None

    async def __aenter__(self) -> Self:
        await self._to_app.put({"type": "websocket.connect"})
        self._task = asyncio.create_task(
            self._app(self._scope, self._to_app.get, self._from_app.put)  # type: ignore[arg-type]
        )
        first = await asyncio.wait_for(self._from_app.get(), timeout=5)
        if first["type"] == "websocket.accept":
            self.opened = True
        else:
            self.close_code = first.get("code")
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        if self._task is None:
            return
        if not self._task.done():
            await self._to_app.put({"type": "websocket.disconnect", "code": 1000})
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except TimeoutError:
                self._task.cancel()
        self._task = None

    async def send_text(self, text: str) -> None:
        await self._to_app.put({"type": "websocket.receive", "text": text})

    async def receive(self, timeout: float = 2.0) -> dict[str, Any] | None:
        """The next JSON message, or None when the app closed the socket (see `close_code`)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            message = await asyncio.wait_for(
                self._from_app.get(), timeout=max(0.0, deadline - loop.time())
            )
            if message["type"] == "websocket.close":
                self.close_code = message.get("code", 1000)
                return None
            assert message["type"] == "websocket.send", message
            parsed: dict[str, Any] = json.loads(message["text"])
            if parsed.get("type") == "records.changed" and not self._include_records:
                continue
            return parsed

    async def is_quiet(self, seconds: float = 0.3) -> bool:
        """True when nothing arrives for a short while."""
        try:
            await self.receive(timeout=seconds)
        except TimeoutError:
            return True
        return False
