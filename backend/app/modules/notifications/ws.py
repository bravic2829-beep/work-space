"""The WebSocket of a signed-in person: `/api/v1/ws`.

It authenticates with the same HttpOnly session cookie as the rest of the API and refuses a
browser origin that is not ours (a cross-site page must not be able to open it with the
person's cookie). While it is open the session is checked every `RECHECK_SECONDS`, so a person
who signs out, is disabled or whose session expires is disconnected soon after.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.modules.auth import service as auth
from app.modules.notifications.realtime import hub

router = APIRouter(tags=["notifications"])

RECHECK_SECONDS = 30.0
CLOSE_SESSION_ENDED = 4401
MAX_MESSAGE_BYTES = 1024


@router.websocket("/ws")
async def notifications_socket(websocket: WebSocket) -> None:
    settings = websocket.app.state.settings
    sessionmaker = websocket.app.state.sessionmaker

    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_allowed_origins:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    token = websocket.cookies.get(settings.session_cookie_name)
    if not token or sessionmaker is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async def session_is_valid() -> auth.AuthContext | None:
        async with sessionmaker() as session:
            return await auth.authenticate(session, settings, token)

    context = await session_is_valid()
    if context is None or context.user.must_change_password:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = context.user.id
    await websocket.accept()
    hub.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "ready"})
        while True:
            try:
                text = await asyncio.wait_for(websocket.receive_text(), timeout=RECHECK_SECONDS)
            except TimeoutError:
                if await session_is_valid() is None:
                    await websocket.close(code=CLOSE_SESSION_ENDED)
                    return
                await websocket.send_json({"type": "ping"})
                continue
            # The browser only ever says "ping". Anything else is ignored, never acted on.
            if text == "ping" and len(text) <= MAX_MESSAGE_BYTES:
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(user_id, websocket)
