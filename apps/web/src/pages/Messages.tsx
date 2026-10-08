import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, ArrowUpRight } from "lucide-react";
import { io } from "socket.io-client";
import { api, type Quest } from "../api";
import {
  useAuth,
  Page,
  QueryState,
  useAction,
  ActionStatus,
} from "../components";
export function Conversations() {
  const [page, setPage] = useState(1);
  const query = useQuery<Quest[]>({
    queryKey: ["my-quests", page],
    queryFn: () => api(`/users/me/quests?page=${page}`),
  });
  const quests = query.data?.filter((q) => q.performerId) || [];
  return (
    <Page
      title="Conversations"
      subtitle="A quick hello makes every handoff easier."
    >
      <QueryState query={query} />
      {quests.map((q) => (
        <Link
          key={q._id}
          to={`/messages/${q._id}`}
          className="panel conversation-row"
        >
          <MessageCircle size={24} />
          <div>
            <h3>{q.title}</h3>
            <p>
              {q.requesterId.displayName} & {q.performerId!.displayName} ·{" "}
              {q.status}
            </p>
          </div>
          <ArrowUpRight />
        </Link>
      ))}
      {!query.isPending && !query.isError && !quests.length && (
        <p className="state">Chat starts when a quest is accepted.</p>
      )}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(query.data?.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </Page>
  );
}
export function Chat() {
  const { questId } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const action = useAction();
  const quest = useQuery<Quest>({
    queryKey: ["quest", questId],
    queryFn: () => api(`/quests/${questId}`),
  });
  const query = useQuery<any[]>({
    queryKey: ["messages", questId, page],
    queryFn: () => api(`/quests/${questId}/messages?page=${page}`),
    refetchInterval: 10000,
  });
  useEffect(() => {
    const socket = io({
      transports: ["websocket"],
      auth: { csrfToken: auth.csrfToken },
    });
    socket.on("connect", () => socket.emit("join", questId));
    socket.on("message", () =>
      client.invalidateQueries({ queryKey: ["messages", questId] }),
    );
    return () => {
      socket.disconnect();
    };
  }, [auth.csrfToken, client, questId]);
  const writable =
    quest.data &&
    ["ACCEPTED", "DISPUTED"].includes(quest.data.status) &&
    auth.user?.accountStatus === "ACTIVE";
  return (
    <Page title={quest.data?.title || "Quest conversation"}>
      <Link to={`/quests/${questId}`}>View quest details →</Link>
      <QueryState query={quest} />
      <QueryState query={query} />
      {!query.isError && (
        <div className="panel chat-panel">
          <div className="pagination">
            <button
              disabled={(query.data?.length || 0) < 20}
              onClick={() => setPage(page + 1)}
            >
              Older
            </button>
            <span>Page {page}</span>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Newer
            </button>
          </div>
          <div className="chat-history">
            {query.data?.map((m) => (
              <div
                key={m._id}
                className={`chat-message ${m.senderId._id === auth.user!._id ? "own" : ""}`}
              >
                <small>{m.senderId.displayName}</small>
                <p>{m.content}</p>
                <small>
                  {new Date(m.createdAt).toLocaleTimeString()} ·{" "}
                  <Link to={`/support?questId=${questId}&messageId=${m._id}`}>
                    Report
                  </Link>
                </small>
              </div>
            ))}
            {query.data?.length === 0 && (
              <p className="state">Say hello and coordinate your handoff.</p>
            )}
          </div>
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate(
                {
                  path: `/quests/${questId}/messages`,
                  data: { content: text },
                },
                {
                  onSuccess: () => {
                    setText("");
                    setPage(1);
                  },
                },
              );
            }}
          >
            <input
              aria-label="Message"
              placeholder={
                writable ? "Write a message…" : "This conversation is read only"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              disabled={!writable}
            />
            <button
              className="button"
              disabled={!writable || !text.trim() || action.isPending}
            >
              Send
            </button>
          </form>
          <ActionStatus action={action} />
        </div>
      )}
    </Page>
  );
}
