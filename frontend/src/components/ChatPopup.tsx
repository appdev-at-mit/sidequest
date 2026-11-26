import { apiFetch } from "../api";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import useDismissible from "../hooks/useDismissible";
import type { Request } from "../data/requests";
import { uploadImage } from "../data/imageUpload";
import type { UploadedImage } from "../data/imageUpload";
import "./ChatPopup.css";

type Message = { sender: string; text: string; images?: string[]; createdAt: string; own?: boolean };
type InboxItem = { request: Request; counterpart: string; preview: string; updatedAt: string | null };
type Props = { request?: Request; currentKerb: string; open: boolean; onClose: () => void; onUnreadChange: (unread: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null> };

export default function ChatPopup({ request: routedRequest, currentKerb, open, onClose, onUnreadChange, triggerRef }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxSearch, setInboxSearch] = useState("");
  const [activeQuestId, setActiveQuestId] = useState("");
  const [inboxLoading, setInboxLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<UploadedImage[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const chatRef = useDismissible<HTMLElement>(open, onClose, "global-popover", [triggerRef]);
  const request = routedRequest ?? inbox.find(item => String(item.request.id) === activeQuestId)?.request;
  const key = request ? `sidequest-chat-read-${request.id}` : "";

  useEffect(() => { onUnreadChange(unread); }, [unread, onUnreadChange]);

  useEffect(() => { if (open && !routedRequest) setActiveQuestId(""); }, [open, routedRequest?.id]);

  useEffect(() => {
    if (!open || routedRequest) return;
    const controller = new AbortController();
    setInboxLoading(true);
    apiFetch("/api/my-quests", { signal: controller.signal })
      .then(async response => { const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.msg ?? "Could not load your messages."); return result?.data ?? []; })
      .then(async quests => Promise.all(quests.filter((quest: any) => quest.helper && [quest.requester, quest.helper].includes(currentKerb) && quest.status !== "open").map(async (quest: any) => {
        const otherKerb = quest.requester === currentKerb ? quest.helper : quest.requester;
        const [profileResponse, messageResponse] = await Promise.all([
          apiFetch(`/api/user-profiles/${encodeURIComponent(otherKerb)}`, { signal: controller.signal }).catch(() => null),
          apiFetch(`/api/requests/${quest._id}/messages`, { signal: controller.signal }).catch(() => null),
        ]);
        const profileData = profileResponse?.ok ? await profileResponse.json().catch(() => null) : null;
        const messageData = messageResponse?.ok ? await messageResponse.json().catch(() => null) : null;
        const thread: Message[] = messageData?.data ?? [];
        const request: Request = { id: quest._id, title: quest.title ?? quest.description, description: quest.description, category: quest.category ?? "Quest", reward: Number(quest.pay ?? 0).toFixed(2), location: quest.pickup ?? "", distance: "", posted: "", lat: quest.lat ?? null, lng: quest.lng ?? null, poster: profileData?.name ?? otherKerb, requester: quest.requester, helper: quest.helper, status: quest.status };
        const last = thread.at(-1);
        return { request, counterpart: profileData?.name ?? otherKerb, preview: last?.text ?? "Start a conversation", updatedAt: last?.createdAt ?? quest.acceptedAt ?? quest.createdAt ?? null };
      })))
      .then(items => { if (!controller.signal.aborted) setInbox(items.sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""))); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your messages."); })
      .finally(() => { if (!controller.signal.aborted) setInboxLoading(false); });
    return () => controller.abort();
  }, [open, routedRequest?.id, currentKerb]);

  useEffect(() => {
    if (!request || !open) return;
    const controller = new AbortController();
    setUnread(false);
    const load = () => apiFetch(`/api/requests/${request.id}/messages`, { signal: controller.signal })
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
    const check = () => apiFetch(`/api/requests/${request.id}/messages?since=${encodeURIComponent(sessionStorage.getItem(key) ?? "")}`, { signal: controller.signal })
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
    if (!request || (!text && !attachments.length) || uploadingImages || sending) return;
    setSending(true);
    try {
      const response = await apiFetch(`/api/requests/${request.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, imageIds: attachments.map(image => image.id) }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not send this message.");
      setMessages(current => [...current, result.data]); setDraft(""); setAttachments([]); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send this message."); }
    finally { setSending(false); }
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length || uploadingImages) return;
    const availableSlots = 3 - attachments.length;
    if (files.length > availableSlots) {
      setError(`You can attach up to 3 photos per message. ${availableSlots ? `Choose ${availableSlots} or fewer.` : "Remove a photo first."}`);
      return;
    }
    setUploadingImages(true); setError("");
    try {
      const results = await Promise.allSettled(files.map(file => uploadImage(file, "message")));
      const uploaded = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (uploaded.length) setAttachments(current => [...current, ...uploaded].slice(0, 3));
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") setError(failure.reason instanceof Error ? failure.reason.message : "Could not upload that photo.");
    } finally { setUploadingImages(false); }
  }

  return <section ref={chatRef} role="dialog" aria-label={request ? `Chat about ${request.title}` : "Messages"} aria-hidden={!open} className={`chat-popover ${open ? "chat-popover-open" : "chat-popover-closed"}`}>
    <header className="flex items-center gap-3 border-b border-[#BED8D4] bg-white px-4 py-3">
      {request && !routedRequest && <button type="button" aria-label="Back to messages" onClick={() => { setActiveQuestId(""); setError(""); }} className="rounded-md p-1 hover:bg-[#BED8D4]/30"><Icon name="arrow" size={18} /></button>}
      {request && <Avatar initials={request.poster.slice(0, 1).toUpperCase()} />}
      <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold">{request?.poster ?? "Messages"}</h2>{request && <p className="truncate text-sm text-slate-500">{request.title}</p>}</div>
      <button type="button" aria-label="Close chat" onClick={onClose} className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={18} /></button>
    </header>
    {!request ? <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4">
      <label className="mb-3 flex items-center gap-2 rounded-full border border-[#BED8D4] px-4 py-3 text-slate-500"><Icon name="search" size={18} /><span className="sr-only">Search messages</span><input value={inboxSearch} onChange={event => setInboxSearch(event.target.value)} placeholder="Search messages" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      {inboxLoading ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading messages…</p> : inbox.filter(item => `${item.counterpart} ${item.request.title} ${item.preview}`.toLowerCase().includes(inboxSearch.toLowerCase())).length ? <div className="divide-y divide-[#D8DEDE]">{inbox.filter(item => `${item.counterpart} ${item.request.title} ${item.preview}`.toLowerCase().includes(inboxSearch.toLowerCase())).map(item => <button type="button" key={item.request.id} onClick={() => { setActiveQuestId(String(item.request.id)); setError(""); }} className="flex w-full items-center gap-3 py-4 text-left hover:bg-[#F7F9F9]"><Avatar initials={item.counterpart.slice(0, 1).toUpperCase()} /><span className="min-w-0 flex-1"><strong className="block truncate">{item.counterpart}</strong><span className="block truncate text-sm text-[#496A9A]">{item.request.title}</span><span className="block truncate text-sm text-slate-500">{item.preview}</span></span><time className="shrink-0 text-xs text-slate-500">{item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</time></button>)}</div> : !error && <p className="py-8 text-center text-sm text-slate-500">No conversations yet.</p>}
      {error && <p role="status" className="py-3 text-center text-xs text-slate-600">{error}</p>}
    </div> : <>
    <div className="flex-1 space-y-3 overflow-y-auto bg-[#F7F9F9] p-4" aria-live="polite">
      {!messages.length && !error && <p className="mt-8 text-center text-sm text-slate-500">Start a conversation about this quest.</p>}
      {messages.map((message, index) => <div key={`${message.createdAt}-${index}`} className={`flex ${message.own ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 ${message.own ? "rounded-br-sm bg-[#2081C3] text-white" : "rounded-bl-sm bg-[#DCEBED] text-[#102A3A]"}`}>{message.text && <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>}{!!message.images?.length && <div className={`grid gap-2 ${message.text ? "mt-2" : ""}`}>{message.images.map((src, imageIndex) => <img key={src} src={src} alt={`Photo ${imageIndex + 1} attached to message`} className="max-h-56 max-w-full rounded-lg object-contain" />)}</div>}<time className={`mt-1 block text-right text-[10px] ${message.own ? "text-white/75" : "text-slate-500"}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>)}
      {error && <p role="status" className="rounded-md bg-white p-3 text-center text-xs text-slate-600">{error}</p>}
    </div>
    {attachments.length > 0 && <div className="flex gap-2 overflow-x-auto border-t border-[#BED8D4] bg-white px-3 pt-2">{attachments.map(image => <div key={image.id} className="relative shrink-0"><img src={image.url} alt={`Selected photo ${image.width} by ${image.height}`} className="h-14 w-14 rounded-lg border border-[#BED8D4] object-cover" /><button type="button" onClick={() => setAttachments(current => current.filter(item => item.id !== image.id))} aria-label="Remove attached photo" className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#102A3A] text-white"><Icon name="x" size={12} /></button></div>)}</div>}
    <form onSubmit={send} className="flex items-center gap-2 border-t border-[#BED8D4] p-3"><input ref={photoInput} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Choose photos to attach" onChange={event => void addPhotos(event)} /><button type="button" disabled={!request || uploadingImages || attachments.length >= 3} onClick={() => photoInput.current?.click()} aria-label="Add photo" title="Add photo" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#BED8D4] text-[#08679e] disabled:opacity-40"><Icon name="plus" size={20} /></button><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder={uploadingImages ? "Uploading photo…" : "Write a message…"} className="min-w-0 flex-1 rounded-full border border-[#BED8D4] px-4 py-2.5 text-sm outline-[#2081C3]" /><button type="submit" disabled={!request || (!draft.trim() && !attachments.length) || uploadingImages || sending} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#2081C3] text-white disabled:opacity-40"><Icon name="send" size={18} /></button></form></>}
  </section>;
}
