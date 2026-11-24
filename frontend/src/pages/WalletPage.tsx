import { useEffect, useState } from "react";

type WalletProfile = { preferredPaymentMethod?: string; paymentInstructions?: string; totalConfirmedEarningsCents?: number };
const METHODS = ["Cash", "PayPal", "Venmo", "Cash App", "Zelle", "Other"];

export default function WalletPage() {
  const [method, setMethod] = useState("Cash");
  const [instructions, setInstructions] = useState("");
  const [totalConfirmedEarningsCents, setTotalConfirmedEarningsCents] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/profile").then(response => response.ok ? response.json() : null).then((data: WalletProfile | null) => {
      if (!data) return;
      if (data.preferredPaymentMethod && METHODS.includes(data.preferredPaymentMethod)) setMethod(data.preferredPaymentMethod);
      setInstructions(data.paymentInstructions ?? "");
      setTotalConfirmedEarningsCents(Number.isSafeInteger(data.totalConfirmedEarningsCents) ? data.totalConfirmedEarningsCents! : 0);
    }).catch(() => {});
  }, []);

  async function savePreference() {
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/payment-preference", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, instructions }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not save your payment preference.");
      setNotice("Payment preference saved. It will be locked into the next quest acceptance agreement.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your payment preference."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
    <section className="mx-auto max-w-4xl">
      <div className="rounded-2xl bg-[#102A3A] p-7 text-white shadow-sm sm:p-9">
        <div className="mt-5 border-t border-white/20 pt-4"><p className="text-sm font-semibold text-white/75">Total reward earned</p><p className="mt-1 text-4xl font-extrabold">${(totalConfirmedEarningsCents / 100).toFixed(2)}</p></div>
      </div>
      <div className="mt-6 max-w-2xl rounded-xl border border-[#BED8D4] bg-white p-5">
        <label className="block text-sm font-semibold">Preferred external payment method
          <select value={method} onChange={event => setMethod(event.target.value)} className="mt-2 w-full rounded-lg border border-[#BED8D4] bg-white p-3">
            {METHODS.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-sm font-semibold">Payment instructions for an accepted requester
          <input value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={160} placeholder="Optional handle or cash meetup details" className="mt-2 w-full rounded-lg border border-[#BED8D4] bg-white p-3 font-normal" />
          <span className="mt-1 block text-xs font-normal text-slate-500">Only the requester on an accepted quest can see this. Don’t include passwords or account credentials.</span>
        </label>
        <button disabled={busy} onClick={() => void savePreference()} className="mt-4 rounded-lg bg-[#08679e] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Saving…" : "Save preference"}</button>
        {notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
      <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-600">SideQuest facilitates quest agreements and records each participant’s confirmation. Payment happens directly between students through the selected method or cash. SideQuest does not process, hold, guarantee, verify, insure, recover, or reverse external payments.</p>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">After a requester marks payment sent, the completer must confirm receipt before the quest is recorded as completed. These confirmations are self-reported.</p>
    </section>
  </main>;
}
