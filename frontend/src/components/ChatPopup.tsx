import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import type { Request } from "../data/requests";
import "./ChatPopup.css";

type Message = { sender: string; text: string; createdAt: string; own?: boolean };
type Props = { request?: Request; open: boolean; onClose: () => void; onUnreadChange: (unread: boolean) => void };

export default function ChatPopup({ request, open, onClose, onUnreadChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
  const key = request ? `sidequest-chat-read-${request.id}` : "";

  useEffect(() => { onUnreadChange(unread); }, [unread, onUnreadChange]);

  useEffect(() => {
    if (!request || !open) return;
    const controller = new AbortController();
    setUnread(false);
    const load = () => fetch(`/api/requests/${request.id}/messages`, { signal: controller.signal })
      .then(async response => { const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.msg ?? "Chat is available after this quest is assigned."); return result; })
      .then(result => {
        const data: Message[] = result.data ?? [];
        setMessages(data);
        if (data.length) sessionStorage.setItem(key, data[data.length - 1].createdAt);
        setError("");
      }).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); });
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [request?.id, open, key]);

  useEffect(() => {
    if (!request || open) return;
    const controller = new AbortController();
    const check = () => fetch(`/api/requests/${request.id}/messages?since=${encodeURIComponent(sessionStorage.getItem(key) ?? "")}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (result?.data?.some((message: Message) => !message.own)) setUnread(true); })
      .catch(() => {});
    void check();
    const timer = window.setInterval(() => { void check(); }, 8000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [request?.id, open, key]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!request || !text) return;
    try {
      const response = await fetch(`/api/requests/${request.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not send this message.");
      setMessages(current => [...current, result.data]); setDraft(""); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send this message."); }
  }

  return <section role="dialog" aria-label={request ? `Chat about ${request.title}` : "Messages"} aria-hidden={!open} className={`chat-popover ${open ? "chat-popover-open" : "chat-popover-closed"}`}>
    <header className="flex items-center gap-3 border-b border-[#BED8D4] bg-[#F7F9F9] px-4 py-3">
      {request && <Avatar initials={request.poster.slice(0, 1).toUpperCase()} />}
      <div className="min-w-0 flex-1"><h2 className="truncate font-bold">{request?.poster ?? "Messages"}</h2>{request && <p className="truncate text-xs text-slate-500">{request.title}</p>}</div>
      <button type="button" aria-label="Close chat" onClick={onClose} className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={18} /></button>
    </header>
    <div className="flex-1 space-y-3 overflow-y-auto bg-[#F7F9F9] p-4" aria-live="polite">
      {!request && <p className="mt-8 text-center text-sm text-slate-500">Post or accept a quest to start a conversation.</p>}
      {request && !messages.length && !error && <p className="mt-8 text-center text-sm text-slate-500">Start a conversation about this quest.</p>}
      {messages.map((message, index) => <div key={`${message.createdAt}-${index}`} className={`flex ${message.own ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 ${message.own ? "rounded-br-sm bg-[#2081C3] text-white" : "rounded-bl-sm bg-[#DCEBED] text-[#102A3A]"}`}><p className="whitespace-pre-wrap break-words text-sm">{message.text}</p><time className={`mt-1 block text-right text-[10px] ${message.own ? "text-white/75" : "text-slate-500"}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>)}
      {error && <p role="status" className="rounded-md bg-white p-3 text-center text-xs text-slate-600">{error}</p>}
    </div>
    <form onSubmit={send} className="flex items-center gap-2 border-t border-[#BED8D4] p-3"><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder="Write a message…" className="min-w-0 flex-1 rounded-full border border-[#BED8D4] px-4 py-2.5 text-sm outline-[#2081C3]" /><button type="submit" disabled={!request || !draft.trim()} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#2081C3] text-white disabled:opacity-40"><Icon name="send" size={18} /></button></form>
  </section>;
}
