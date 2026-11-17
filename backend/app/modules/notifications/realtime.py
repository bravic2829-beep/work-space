"""Telling connected browsers that they have a new notification (docs/usecases.md UC-N1).

Only a "something changed" signal travels over the WebSocket, never the notification itself:
the browser then asks the normal API, which checks permissions as always. So the socket cannot
leak data even if it were connected to the wrong person.

The signal is sent only after the database transaction has committed. A notification that is
rolled back is never announced, and one that is announced can already be read.

The hub lives in the memory of one process. That is enough for the MVP (a single backend
instance, no Redis, see docs/context.md); with several instances each would only reach its own
connections and a message bus would be needed.
"""

import asyncio
import logging
import uuid
from collections import defaultdict

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MESSAGE = {"type": "notifications.changed"}
_PENDING_KEY = "notify_after_commit"


class Hub:
    """The open WebSockets, by person."""

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    def connect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            del self._connections[user_id]

    def count(self, user_id: uuid.UUID) -> int:
        return len(self._connections.get(user_id, ()))

    def connected(self) -> set[uuid.UUID]:
        """The people who have at least one open socket."""
        return set(self._connections)

    async def publish(
        self, user_ids: set[uuid.UUID], message: dict[str, str] | None = None
    ) -> None:
        for user_id in user_ids:
            for websocket in list(self._connections.get(user_id, ())):
                try:
                    await websocket.send_json(message or MESSAGE)
                except Exception:  # a closed or broken socket: forget it, never fail the caller
                    self.disconnect(user_id, websocket)


hub = Hub()
_tasks: set[asyncio.Task[None]] = set()


def announce_after_commit(session: Session, user_ids: set[uuid.UUID]) -> None:
    """Remember who to tell once this session commits (called inside the transaction)."""
    if user_ids:
        session.info.setdefault(_PENDING_KEY, set()).update(user_ids)


@event.listens_for(Session, "after_commit")
def _send_after_commit(session: Session) -> None:
    pending: set[uuid.UUID] | None = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # committed outside an event loop (a script): nobody to tell
        return
    task = loop.create_task(hub.publish(pending))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _forget_after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)
