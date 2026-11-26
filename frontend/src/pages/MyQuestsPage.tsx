import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Icon from "../components/Icon";
import { useAuth } from "../AuthContext";

type Quest = {
  _id: string;
  requester?: string | null;
  helper?: string | null;
  status?: string;
  expired?: boolean;
  title?: string;
  description: string;
  category?: string;
  pay: number;
  start: string | null;
  end: string | null;
  createdAt?: string;
  acceptedAt?: string | null;
  completionSubmission?: { submittedAt?: string | null } | null;
  requesterApprovedAt?: string | null;
  paymentSentAt?: string | null;
  paymentConfirmedAt?: string | null;
};
type Tab = "posted" | "accepted" | "past";
const activeStatuses = new Set(["open", "in_progress", "pending_review", "awaiting_payment", "payment_sent", "disputed"]);
const inputClass = "mt-1 w-full rounded-lg border border-[#BED8D4] bg-white p-3";
const tabs: { id: Tab; label: string }[] = [{ id: "posted", label: "Posted quests" }, { id: "accepted", label: "Accepted quests" }, { id: "past", label: "Past quests" }];

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function MyQuestsPage({ refreshKey, editQuestId, onEditOpened, onPostQuest, onChanged, onViewQuest }: {
  refreshKey: number; editQuestId: string; onEditOpened: () => void; onPostQuest: () => void; onChanged: () => void; onViewQuest: (id: string) => void;
}) {
  const { userKerb } = useAuth();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tab, setTab] = useState<Tab>("posted");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Quest | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/my-quests", { signal: controller.signal })
      .then(async response => {
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.msg ?? "Could not load your quests.");
        return result?.data as Quest[];
      })
      .then(data => setQuests(data ?? []))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your quests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!editQuestId) return;
    const quest = quests.find(item => item._id === editQuestId);
    if (quest) { setTab("posted"); setEditing(quest); setActionError(""); onEditOpened(); }
  }, [editQuestId, quests, onEditOpened]);

  const visibleQuests = useMemo(() => quests.filter(quest => {
    const terminal = !activeStatuses.has(quest.status ?? "open") || quest.expired;
    if (tab === "past") return terminal;
    if (terminal) return false;
    return tab === "posted" ? quest.requester === userKerb : quest.helper === userKerb;
  }), [quests, tab, userKerb]);
  const showFirstPostPrompt = !loading && !error && tab === "posted" && visibleQuests.length === 0;

  async function removeQuest(quest: Quest) {
    if (!window.confirm("Delete this open quest?")) return;
    setActionError("");
    try {
      const response = await fetch(`/api/requests/${quest._id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not delete the quest.");
      setQuests(current => current.filter(item => item._id !== quest._id));
      onChanged();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not reach SideQuest."); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const values = new FormData(event.currentTarget);
    setActionError("");
    if (!Number.isFinite(Number(values.get("pay"))) || Number(values.get("pay")) < 3) { setActionError("The reward must be at least $3."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/requests/${editing._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: String(values.get("description")).trim(), category: String(values.get("category")),
          pay: Number(values.get("pay")), start: new Date(String(values.get("start"))).toISOString(), end: new Date(String(values.get("end"))).toISOString(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not update the quest.");
      setEditing(null); onChanged();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update the quest."); }
    finally { setSaving(false); }
  }

  return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
    <section className="mx-auto max-w-5xl">
      <header className="mb-6"><h1 className="text-3xl font-extrabold tracking-tight">My quests</h1></header>
      <nav aria-label="Quest sections" className="grid grid-cols-3 border-b border-[#BED8D4]">
        {tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setActionError(""); }} className={`border-b-2 px-2 py-4 text-sm font-bold transition sm:text-base ${tab === item.id ? "border-[#2081C3] text-[#08679e]" : "border-transparent text-slate-500 hover:text-[#102A3A]"}`}>{item.label}</button>)}
      </nav>
      {tab === "posted" && !showFirstPostPrompt && <div className="flex justify-end py-5"><button type="button" onClick={onPostQuest} className="rounded-lg bg-[#08679e] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#075785]">+ Post a quest</button></div>}
      {actionError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {loading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Loading your quests…</p> : error ? <p role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">{error}</p> : visibleQuests.length === 0 ? <div className="rounded-xl border border-[#BED8D4] bg-white p-8 text-center"><p className="font-semibold">{tab === "posted" ? "You haven’t posted a quest yet." : tab === "accepted" ? "Accept a quest to view accepted quests." : "No past quests"}</p>{tab === "posted" && <button type="button" onClick={onPostQuest} className="mt-4 rounded-lg bg-[#08679e] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#075785]">Post a quest</button>}</div> : <div className="grid gap-3">{visibleQuests.map(quest => {
        const isOwnPost = quest.requester === userKerb;
        const isOpen = (quest.status ?? "open") === "open" && !quest.expired;
        return <article key={quest._id} role="link" tabIndex={0} onClick={() => onViewQuest(quest._id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onViewQuest(quest._id); } }} className="cursor-pointer rounded-xl border border-[#BED8D4] bg-white p-4 shadow-sm transition hover:border-[#2081C3] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2081C3] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold capitalize ${quest.expired ? "bg-slate-100 text-slate-600" : quest.status === "open" ? "bg-emerald-50 text-emerald-700" : quest.status === "completed" ? "bg-slate-100 text-slate-600" : "bg-sky-50 text-sky-700"}`}>{quest.expired && quest.status === "open" ? "Expired" : (quest.status ?? "open").replaceAll("_", " ")}</span><h2 className="mt-3 text-lg font-extrabold">{quest.title ?? quest.description}</h2><p className="mt-1 line-clamp-2 text-sm text-slate-600">{quest.description}</p><p className="mt-2 text-xs text-slate-500">{isOwnPost ? "Posted by you" : "Accepted by you"}{quest.end ? ` · Due ${new Date(quest.end).toLocaleString()}` : ""}{quest.category ? ` · ${quest.category}` : ""}</p></div><div className="shrink-0 text-right"><span className="block text-xs text-slate-500">Reward</span><span className="text-3xl font-extrabold text-[#2081C3]">${Number(quest.pay).toFixed(2)}</span></div></div>
          {(isOwnPost || quest.helper === userKerb) && <details onClick={event => event.stopPropagation()} className="mt-4 border-t border-[#BED8D4] pt-3"><summary className="cursor-pointer text-sm font-bold">Quest progress <span className="font-semibold capitalize text-slate-500">· {(quest.status ?? "open").replaceAll("_", " ")}</span></summary><ol aria-label="Quest progress timeline" className="mt-3 grid gap-3 border-l-2 border-[#BED8D4] pl-4 text-sm">{[
            { label: "Quest posted", at: quest.createdAt },
            { label: "Quest accepted", at: quest.acceptedAt },
            { label: "Completion submitted", at: quest.completionSubmission?.submittedAt },
            { label: "Completion approved", at: quest.requesterApprovedAt },
            { label: "Reward sent", at: quest.paymentSentAt },
            { label: "Payment confirmed", at: quest.paymentConfirmedAt },
          ].map(item => <li key={item.label} className="relative"><span className={`absolute -left-[1.35rem] top-1 h-3 w-3 rounded-full border-2 ${item.at ? "border-[#2081C3] bg-[#2081C3]" : "border-slate-300 bg-white"}`} /><span className={item.at ? "font-semibold" : "text-slate-400"}>{item.label}</span>{item.at && <time className="ml-2 text-xs text-slate-500">{new Date(item.at).toLocaleString()}</time>}</li>)}</ol></details>}
          <div className="mt-4 flex flex-wrap justify-end gap-2 pt-4">{tab === "posted" && isOpen && <><button type="button" onClick={event => { event.stopPropagation(); setEditing(quest); setActionError(""); }} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold hover:bg-[#EAF3F2]">Edit quest</button><button type="button" onClick={event => { event.stopPropagation(); void removeQuest(quest); }} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50">Delete quest</button></>}{tab === "accepted" && <button type="button" onClick={event => { event.stopPropagation(); onViewQuest(quest._id); }} className="rounded-lg bg-[#08679e] px-4 py-2 text-sm font-bold text-white">View progress</button>}{tab === "past" && <span className="text-sm text-slate-500">{isOwnPost ? "Posted by you" : "Accepted by you"}</span>}</div>
        </article>;
      })}</div>}
    </section>
    {editing && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#102A3A]/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="edit-quest-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[#F7F9F9] p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 id="edit-quest-title" className="text-xl font-extrabold">Edit quest</h2><button type="button" onClick={() => setEditing(null)} aria-label="Close edit quest" className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={20} /></button></div><form className="grid gap-4" onSubmit={event => void saveEdit(event)}><label className="text-sm font-semibold">Description<textarea name="description" className={inputClass} rows={3} maxLength={150} defaultValue={editing.description} required /></label><label className="text-sm font-semibold">Category<select name="category" className={inputClass} defaultValue={editing.category ?? "Delivery"} required>{["Delivery", "Moving", "Home Help", "Tech", "Academic"].map(category => <option key={category}>{category}</option>)}</select></label><label className="text-sm font-semibold">Reward<input name="pay" type="number" min="3" step="0.01" className={inputClass} defaultValue={editing.pay} required /></label><label className="text-sm font-semibold">Starts at<input name="start" type="datetime-local" className={inputClass} defaultValue={localDateTime(editing.start)} required /></label><label className="text-sm font-semibold">Deadline<input name="end" type="datetime-local" className={inputClass} defaultValue={localDateTime(editing.end)} required /></label><p className="text-xs text-slate-500">Pickup and drop-off locations remain as currently posted.</p>{actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-[#08679e] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button></div></form></section></div>}
  </main>;
}
