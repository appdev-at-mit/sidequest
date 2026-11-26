import { apiFetch } from "../api";
import { useState, type FormEvent } from "react";
import Icon from "./Icon";

export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not send feedback.");
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send feedback.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-[110] grid place-items-center bg-[#102A3A]/45 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="w-full max-w-lg rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-6 text-[#102A3A] shadow-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="feedback-title" className="text-2xl font-extrabold">Send feedback</h2>
        <button type="button" onClick={onClose} aria-label="Close feedback" className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={20} /></button>
      </div>
      {sent ? <div role="status" className="py-5">
        <p className="font-bold">Thanks for helping improve SideQuest.</p>
        <button type="button" onClick={onClose} className="mt-5 rounded-lg bg-[#08679e] px-5 py-3 text-sm font-bold text-white hover:bg-[#075785]">Done</button>
      </div> : <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1 text-sm font-semibold">Feedback type
          <select value={kind} onChange={event => setKind(event.target.value)} className="rounded-lg border border-[#BED8D4] bg-white px-3 py-3 font-normal">
            <option value="idea">Suggestion</option><option value="bug">Report a problem</option><option value="other">Other</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Your feedback
          <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} rows={5} required className="resize-y rounded-lg border border-[#BED8D4] bg-white px-3 py-3 font-normal" placeholder="Tell us what you think…" />
        </label>
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-[#08679e] px-5 py-3 text-sm font-bold text-white hover:bg-[#075785] disabled:opacity-60">{busy ? "Sending…" : "Send feedback"}</button>
      </form>}
    </section>
  </div>;
}
