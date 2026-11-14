"use client";

import { MessageSquare, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, Avatar, Button, LoadingState, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createComment, deleteComment, listComments } from "./api";
import type { CommentItem } from "./schema";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: CommentItem[]; nextCursor: string | null };

/** The comments of one record: read them, add one, delete your own. */
export function CommentsPanel({
  recordId,
  currentUserId,
}: {
  recordId: string;
  currentUserId: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const page = await listComments(recordId, null, controller.signal);
        setState({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Could not load the comments.",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [recordId]);

  async function loadMore() {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    setBusy(true);
    try {
      const page = await listComments(recordId, state.nextCursor);
      setState({
        kind: "ready",
        items: [...state.items, ...page.items],
        nextCursor: page.next_cursor,
      });
    } catch {
      setMessage("Could not load more comments.");
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await createComment(recordId, text.trim());
      setState({ ...state, items: [...state.items, created] });
      setText("");
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 403
          ? "You can read this discussion but not write in it."
          : error instanceof ApiError
            ? error.message
            : "Could not add the comment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: CommentItem) {
    if (state.kind !== "ready" || !window.confirm("Delete this comment?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteComment(comment.id);
      setState({ ...state, items: state.items.filter((item) => item.id !== comment.id) });
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not delete the comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Comments" className="grid gap-3">
      <h3 className="m-0 flex items-center gap-2">
        <MessageSquare className="size-4 text-muted" aria-hidden />
        Comments
      </h3>
      {state.kind === "loading" && <LoadingState>Loading comments…</LoadingState>}
      {state.kind === "error" && <Alert>{state.message}</Alert>}
      {state.kind === "ready" && (
        <>
          {state.items.length === 0 ? (
            <p className="m-0 text-sm text-muted">No comments yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {state.items.map((comment) => (
                <li key={comment.id} className="flex gap-2.5">
                  <Avatar name={comment.author.full_name} />
                  <div className="min-w-0 flex-1 rounded-lg bg-surface-muted px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm">
                        <strong>{comment.author.full_name}</strong>{" "}
                        <small>{new Date(comment.created_at).toLocaleString()}</small>
                      </span>
                      {comment.author.id === currentUserId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label="Delete comment"
                          disabled={busy}
                          onClick={() => void remove(comment)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                    <p className="m-0 mt-1 text-sm break-words whitespace-pre-wrap">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {state.nextCursor !== null && (
            <div>
              <Button size="sm" disabled={busy} onClick={() => void loadMore()}>
                Load more comments
              </Button>
            </div>
          )}
          <form
            onSubmit={(event) => void add(event)}
            className="grid gap-2"
            aria-label="Add comment"
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Write a comment
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={5000}
                rows={3}
              />
            </label>
            <div>
              <Button
                type="submit"
                variant="primary"
                icon={Send}
                disabled={busy || text.trim() === ""}
              >
                Comment
              </Button>
            </div>
          </form>
        </>
      )}
      {message && <Alert>{message}</Alert>}
    </section>
  );
}
