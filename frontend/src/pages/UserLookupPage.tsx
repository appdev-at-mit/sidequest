import { useEffect, useState, type FormEvent } from "react";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import "./UserLookupPage.css";

type User = { kerb: string; name: string; rating: number | null; reviewCount: number; completedQuests?: number; identityVerificationStatus?: string };
type RankedUser = User & { quests: number };
type UserLookupPageProps = { initialQuery: string; searchVersion: number };

export default function UserLookupPage({ initialQuery, searchVersion }: UserLookupPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [leaderboard, setLeaderboard] = useState<RankedUser[]>([]);
  const [leaderboardStart, setLeaderboardStart] = useState(0);
  const [leaderboardTransition, setLeaderboardTransition] = useState(true);
  const [reportUser, setReportUser] = useState<User | null>(null);
  const [reportNotice, setReportNotice] = useState("");
  const [reportError, setReportError] = useState("");
  const [profile, setProfile] = useState<(User & { postedQuests: number; completedQuests: number; confirmedPayments: number; paymentConfirmationRate: number | null; totalConfirmedEarningsCents: number; identityVerificationStatus: string; reviews: { role: string; ratings: Record<string, number>; text: string; createdAt: string }[] }) | null>(null);

  const topLeaderboard = leaderboard.slice(0, 5);
  const rotatingLeaderboard = topLeaderboard.length > 3 ? [...topLeaderboard, ...topLeaderboard.slice(0, 3)] : topLeaderboard;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/leaderboard", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => { if (result?.data) setLeaderboard(result.data.slice(0, 5)); }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (topLeaderboard.length <= 3) return;
    const timer = window.setInterval(() => setLeaderboardStart(start => start + 1), 4200);
    return () => window.clearInterval(timer);
  }, [topLeaderboard.length]);

  function finishLeaderboardSlide() {
    if (leaderboardStart < topLeaderboard.length) return;
    setLeaderboardTransition(false); setLeaderboardStart(0);
    requestAnimationFrame(() => requestAnimationFrame(() => setLeaderboardTransition(true)));
  }

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSearched(true);
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.msg ?? "Could not search users.");
      setUsers(result.data ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not search users."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!searchVersion || initialQuery.trim().length < 2) return;
    setQuery(initialQuery); setBusy(true); setError(""); setSearched(true);
    const controller = new AbortController();
    fetch(`/api/users/search?q=${encodeURIComponent(initialQuery.trim())}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result?.msg ?? "Could not search users."); setUsers(result.data ?? []); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not search users."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [initialQuery, searchVersion]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!reportUser) return;
    const form = new FormData(event.currentTarget); setReportError("");
    try {
      const response = await fetch("/api/user-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: reportUser.kerb, reason: form.get("reason"), description: form.get("description"), evidence: form.get("evidence") }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not submit report.");
      setReportNotice(`Report sent for review.`); setReportUser(null);
    } catch (reason) { setReportError(reason instanceof Error ? reason.message : "Could not submit report."); }
  }

  async function toggleBlock(user: User) {
    try {
      const response = await fetch("/api/toggle-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dest: user.kerb }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not change block setting.");
      setReportNotice(result.msg);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change block setting."); }
  }

  async function openProfile(user: User) {
    setProfile(null); setError("");
    try { const response = await fetch(`/api/user-profiles/${encodeURIComponent(user.kerb)}`); const result = await response.json(); if (!response.ok) throw new Error(result.msg ?? "Could not open this profile."); setProfile(result); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open this profile."); }
  }

  return <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9] px-5 py-10 sm:px-8"><section className="mx-auto max-w-3xl">
    <form onSubmit={search} className="flex gap-2 rounded-xl border border-[#BED8D4] bg-white p-3 shadow-sm"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Enter a name or username" className="min-w-0 flex-1 bg-transparent outline-none" /><button disabled={busy || query.trim().length < 2} className="rounded-lg bg-[#08679e] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Searching…" : "Search"}</button></form>
    {!!leaderboard.length && <section aria-label="Top questers" className="mt-8"><h1 className="mb-3 text-xl font-extrabold">Leaderboard</h1><div className="leaderboard-viewport"><div onTransitionEnd={finishLeaderboardSlide} className={`leaderboard-track ${leaderboardTransition ? "leaderboard-track--sliding" : ""}`} style={{ transform: `translateX(calc(-${leaderboardStart * (100 / 3)}% - ${leaderboardStart * 8}px))` }}>{rotatingLeaderboard.map((person, index) => <article key={`${person.kerb}-${index}`} className="leaderboard-card flex items-center gap-3 rounded-lg border border-[#BED8D4] bg-white p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E5F1F3] text-sm font-extrabold text-[#08679e]">#{(index % Math.max(topLeaderboard.length, 1)) + 1}</span><Avatar initials={person.name.slice(0, 1).toUpperCase()} /><div className="min-w-0"><h2 className="truncate text-sm font-bold">{person.name}</h2><p className="text-xs text-slate-500">{person.quests} quests · {person.rating == null ? "No rating" : `★ ${person.rating.toFixed(1)}`}</p></div></article>)}</div></div></section>}
    {reportNotice && <p role="status" className="mt-4 text-sm text-slate-600">{reportNotice}</p>}{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <div className="mt-5 divide-y divide-[#BED8D4]">{users.map(user => <article key={user.kerb} className="flex flex-wrap items-center gap-4 py-4"><Avatar initials={user.name.slice(0, 1).toUpperCase()} /><div className="min-w-0 flex-1"><h2 className="font-bold">{user.name}</h2><p className="text-sm text-slate-500">{user.kerb} · {user.completedQuests ?? 0} completed quests{user.rating != null ? ` · ★ ${user.rating.toFixed(1)} (${user.reviewCount})` : " · No ratings"}</p><p className="text-xs text-slate-500">University affiliation: unverified</p></div><button type="button" onClick={() => void openProfile(user)} className="text-sm font-semibold text-[#08679e]">Profile</button><button type="button" onClick={() => void toggleBlock(user)} className="text-sm font-semibold text-slate-600">Block / unblock</button><button type="button" onClick={() => { setReportUser(user); setReportError(""); }} className="text-sm font-semibold text-amber-700">Report</button></article>)}{searched && !busy && !error && users.length === 0 && <p className="py-6 text-sm text-slate-500">No matching users found.</p>}</div>
    {profile && <div className="fixed inset-0 z-[850] grid place-items-center bg-[#102A3A]/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setProfile(null); }}><section role="dialog" aria-modal="true" aria-label={`${profile.name} profile`} className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><Avatar initials={profile.name.slice(0, 1).toUpperCase()} /><div><h2 className="text-xl font-extrabold">{profile.name}</h2><p className="text-sm text-slate-500">{profile.kerb} · university affiliation unverified</p></div></div><button type="button" onClick={() => setProfile(null)} aria-label="Close profile">×</button></div><div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-[#EAF3F2] p-3 text-center text-sm sm:grid-cols-3"><p>{profile.postedQuests} posted</p><p>{profile.completedQuests} completed</p><p>{profile.rating == null ? "No rating" : `★ ${profile.rating.toFixed(1)} (${profile.reviewCount})`}</p><p>{profile.confirmedPayments} confirmed payments</p><p>{profile.paymentConfirmationRate == null ? "No payment history" : `${profile.paymentConfirmationRate}% confirmation rate`}</p><p>{(profile.totalConfirmedEarningsCents / 100).toFixed(2)} self-reported rewards</p></div><h3 className="mt-5 font-bold">Quest reviews</h3>{profile.reviews.length ? profile.reviews.map((review, index) => <article key={index} className="border-b border-[#BED8D4] py-3"><p className="text-xs text-slate-500">{review.role} · {new Date(review.createdAt).toLocaleDateString()}</p><p className="mt-1 text-sm">{Object.entries(review.ratings).map(([key, value]) => `${key}: ${value}/5`).join(" · ")}</p>{review.text && <p className="mt-1 text-sm">{review.text}</p>}</article>) : <p className="mt-2 text-sm text-slate-500">No reviews yet.</p>}</section></div>}
    {reportUser && <div className="fixed inset-0 z-[900] grid place-items-center bg-[#102A3A]/50 p-4"><form onSubmit={submitReport} className="grid w-full max-w-lg gap-3 rounded-xl bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">Report {reportUser.name}</h2><button type="button" aria-label="Close report" onClick={() => setReportUser(null)}>×</button></div><select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] p-2"><option value="" disabled>Choose a reason</option>{["Harassment or inappropriate behavior", "Fraud or misleading conduct", "Spam", "Other"].map(item => <option key={item}>{item}</option>)}</select><textarea name="description" required maxLength={2000} placeholder="Describe the concern" className="min-h-20 rounded-md border border-[#BED8D4] p-3" /><textarea name="evidence" maxLength={4000} placeholder="Text evidence only. Do not include private information." className="min-h-16 rounded-md border border-[#BED8D4] p-3" />{reportError && <p role="alert" className="text-sm text-red-700">{reportError}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setReportUser(null)} className="px-3 py-2 text-sm">Cancel</button><button className="rounded-md bg-[#08679e] px-4 py-2 text-sm font-bold text-white">Submit report</button></div></form></div>}
  </section></main>;
}
