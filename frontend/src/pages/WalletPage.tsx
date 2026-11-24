import { useEffect, useState } from "react";

type WalletProfile = { earned?: number; quests?: number };
type StripeStatus = { configured: boolean; connected: boolean; detailsSubmitted?: boolean };
const METHODS = ["Stripe Connect", "PayPal", "Venmo", "Cash App", "Debit or credit card", "Bank transfer"];

export default function WalletPage() {
  const [profile, setProfile] = useState<WalletProfile>({});
  const [method, setMethod] = useState(() => {
    const savedMethod = localStorage.getItem("sidequest-payout-preference");
    return savedMethod && METHODS.includes(savedMethod) ? savedMethod : METHODS[0];
  });
  const [saved, setSaved] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/profile").then(response => response.ok ? response.json() : null).then(data => { if (data) setProfile(data); }).catch(() => {});
    fetch("/api/stripe/connect/status").then(async response => {
      const result = await response.json();
      if (response.ok) setStripeStatus(result);
    }).catch(() => {});
  }, []);

  async function connectStripe() {
    localStorage.setItem("sidequest-payout-preference", "Stripe Connect");
    setMethod("Stripe Connect");
    setStripeBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stripe/connect/onboarding-link", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.msg ?? "Could not start Stripe setup.");
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start Stripe setup.");
      setStripeBusy(false);
    }
  }

  return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
    <section className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-extrabold">Wallet</h1>
      <div className="mt-5 rounded-2xl bg-[#102A3A] px-6 py-5 text-white shadow-sm">
        <p className="text-sm font-semibold text-white/70">Total rewards earned</p>
        <p className="mt-1 text-4xl font-extrabold">{(profile.earned ?? 0).toFixed(2)}</p>
        <p className="mt-1 text-sm text-white/70">{profile.quests ?? 0} completed quests</p>
      </div>

      <section className="mt-6">
        <label className="block text-sm font-semibold">Preferred payment method
          <select value={method} onChange={event => { setMethod(event.target.value); setSaved(false); setNotice(""); }} className="mt-2 w-full rounded-lg border border-[#BED8D4] bg-white p-3">
            {METHODS.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={() => { localStorage.setItem("sidequest-payout-preference", method); setSaved(true); setNotice("Preference saved."); }} className="rounded-lg bg-[#08679e] px-5 py-3 text-sm font-bold text-white hover:bg-[#075785]">
            {saved ? "Preference saved" : "Save preference"}
          </button>
          {method === "Stripe Connect" && <button disabled={stripeBusy} onClick={connectStripe} className="rounded-lg border border-[#BED8D4] bg-white px-5 py-3 text-sm font-bold text-[#08679e] disabled:opacity-60">
            {stripeBusy ? "Opening Stripe…" : stripeStatus?.connected ? "Manage Stripe account" : "Set up Stripe payouts"}
          </button>}
        </div>
        {notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {stripeStatus?.connected && <p className="mt-3 text-sm text-emerald-800">Stripe account connected. Stripe manages your sensitive payout details.</p>}
        {!stripeStatus?.configured && method === "Stripe Connect" && <p className="mt-3 text-sm text-slate-600">Stripe setup is not configured on this server yet.</p>}
        <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-500">Payment method choices are saved as preferences. Stripe Connect opens Stripe’s hosted setup so SideQuest does not collect or store card or bank details. PayPal, Venmo, Cash App, and direct card integrations are not active yet; live quest payments and transfers also require a configured Stripe platform and payment flow.</p>
      </section>
    </section>
  </main>;
}
