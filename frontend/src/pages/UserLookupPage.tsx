import { useEffect, useState, type FormEvent } from "react";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";

type User = { kerb: string; name: string; rating: number | null; reviewCount: number; completedQuests?: number; identityVerificationStatus?: string };
type Recommendation = User & { quests?: number; postedQuests?: number };
type PastAcceptor = User & { lastAcceptedAt: string | null; lastQuestTitle: string };
type Review = { role: string; ratings: Record<string, number>; text: string; createdAt: string };
type PublicProfile = User & {
  rank: number; postedQuests: number; completedQuests: number; confirmedPayments: number;
  paymentConfirmationRate: number | null; totalConfirmedEarningsCents: number; createdAt: string | null; reviews: Review[];
};
type Props = { initialQuery: string; searchVersion: number; initialProfileKerb?: string };

export default function UserLookupPage({ initialQuery, searchVersion, initialProfileKerb = "" }: Props) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [pastAcceptors, setPastAcceptors] = useState<PastAcceptor[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [reportUser, setReportUser] = useState<User | null>(null);
  const [reportNotice, setReportNotice] = useState("");
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/recommendations", { signal: controller.signal })
      .then(async response => { const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.msg ?? "Could not load recommendations."); return result?.data; })
      .then(data => { if (!controller.signal.aborted) { setRecommendations(data?.recommendations ?? []); setPastAcceptors(data?.pastAcceptors ?? []); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load recommendations."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function openProfile(kerb: string) {
    setProfile(null); setProfileLoading(true); setProfileError("");
    try {
      const response = await fetch(`/api/user-profiles/${encodeURIComponent(kerb)}`);
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? `Profile lookup failed (HTTP ${response.status}).`);
      setProfile(result);
    } catch (reason) { setProfileError(reason instanceof Error ? reason.message : "Could not open this profile."); }
    finally { setProfileLoading(false); }
  }

  useEffect(() => {
    if (initialProfileKerb) void openProfile(initialProfileKerb);
  }, [initialProfileKerb, searchVersion]);

  useEffect(() => {
    if (!searchVersion || initialQuery.trim().length < 2) return;
    const controller = new AbortController();
    fetch(`/api/users/search?q=${encodeURIComponent(initialQuery.trim())}`, { signal: controller.signal })
      .then(async response => { const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.msg ?? "Could not search users."); return result?.data ?? []; })
      .then(data => { if (!controller.signal.aborted) { setSearchResults(data); setSearched(true); setSearching(false); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) { setSearched(true); setSearching(false); setError(reason instanceof Error ? reason.message : "Could not search users."); } })
      .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    return () => controller.abort();
  }, [initialQuery, searchVersion]);

  async function toggleBlock(user: User) {
    try {
      const response = await fetch("/api/toggle-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dest: user.kerb }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not change block setting.");
      setReportNotice(result.msg ?? "Block setting updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change block setting."); }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!reportUser) return;
    const form = new FormData(event.currentTarget); setReportError("");
    try {
      const response = await fetch("/api/user-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: reportUser.kerb, reason: form.get("reason"), description: form.get("description"), evidence: form.get("evidence") }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not submit report.");
      setReportNotice("Report sent for review."); setReportUser(null);
    } catch (reason) { setReportError(reason instanceof Error ? reason.message : "Could not submit report."); }
  }

  const verificationText = (status?: string) => status === "verified" ? "University affiliation verified" : "University affiliation not verified by SideQuest";
  const personCard = (user: Recommendation | PastAcceptor, supportingText: string, key: string) => <article key={key} className="flex flex-wrap items-center gap-4 rounded-xl border border-[#BED8D4] bg-white p-4 shadow-sm">
    <Avatar initials={user.name.slice(0, 1).toUpperCase()} />
    <div className="min-w-0 flex-1"><h3 className="font-bold">{user.name}</h3><p className="text-sm text-slate-500">{user.kerb} · {user.completedQuests ?? 0} completed quests · {user.rating == null ? "No ratings" : `★ ${user.rating.toFixed(1)} (${user.reviewCount})`}</p><p className="mt-1 text-xs text-slate-500">{supportingText} · {verificationText(user.identityVerificationStatus)}</p></div>
    <button type="button" onClick={() => void openProfile(user.kerb)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold text-[#08679e] hover:bg-[#EAF3F2]">Profile</button>
    <button type="button" onClick={() => void toggleBlock(user)} className="text-sm font-semibold text-slate-600">Block</button>
    <button type="button" onClick={() => { setReportUser(user); setReportError(""); }} className="text-sm font-semibold text-amber-700">Report</button>
  </article>;

  if (profileLoading && !profile) return <main role="status" className="min-h-[calc(100dvh-64px)] px-5 py-16 text-center text-slate-600">Loading profile…</main>;
  if (profileError && !profile) return <main className="min-h-[calc(100dvh-64px)] px-5 py-12"><div className="mx-auto max-w-3xl"><button type="button" onClick={() => setProfileError("")} className="mb-5 text-sm font-semibold text-[#08679e]">← Back to recommendations</button><p role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">{profileError}</p></div></main>;

  if (profile) return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
    <section className="mx-auto max-w-5xl">
      <button type="button" onClick={() => setProfile(null)} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-[#08679e]"><Icon name="arrow" size={17} /> Back to recommendations</button>
      {reportNotice && <p role="status" className="mb-4 text-sm text-slate-600">{reportNotice}</p>}
      <section className="overflow-hidden rounded-2xl border border-[#BED8D4] bg-white shadow-sm">
        <div className="relative h-36 bg-[#78D5D7] sm:h-48"><span aria-hidden="true" className="absolute left-[12%] top-8 h-16 w-16 rounded-full border-[10px] border-white/25" /><span aria-hidden="true" className="absolute right-[15%] top-6 h-20 w-20 rotate-12 rounded-3xl border-4 border-[#2081C3]/30" /><div className="absolute bottom-[-42px] left-8 rounded-full border-4 border-white bg-white sm:left-12"><Avatar initials={profile.name.slice(0, 1).toUpperCase()} large /></div></div>
        <div className="grid gap-6 px-6 pb-6 pt-14 sm:grid-cols-[1fr_auto] sm:px-12 sm:pt-16"><div><h1 className="text-3xl font-extrabold tracking-tight">{profile.name}</h1><p className="mt-1 text-slate-600">Username: {profile.kerb}</p><p className={`mt-2 text-sm ${profile.identityVerificationStatus === "verified" ? "text-emerald-700" : "text-amber-700"}`}>{verificationText(profile.identityVerificationStatus)}</p><p className="mt-2 flex items-center gap-1.5 text-sm font-semibold"><span className="text-[#2081C3]"><Icon name="star" size={15} /></span>{profile.rating == null ? "No ratings yet" : `${profile.rating.toFixed(1)} · ${profile.reviewCount} ${profile.reviewCount === 1 ? "review" : "reviews"}`}</p>{profile.rank > 0 && <p className="mt-2 text-sm font-semibold">Community rank #{profile.rank}</p>}<p className="mt-2 text-xs text-slate-500">{profile.createdAt ? `SideQuest member since ${new Date(profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "SideQuest member"}</p></div><div className="flex flex-wrap items-start gap-2 sm:justify-end"><button type="button" onClick={() => void toggleBlock(profile)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold">Block</button><button type="button" onClick={() => { setReportUser(profile); setReportError(""); }} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-bold text-amber-700">Report</button></div></div>
        <div className="grid grid-cols-2 border-y border-[#BED8D4] py-6 sm:grid-cols-4"><div className="border-r border-[#BED8D4] px-3 text-center"><p className="text-2xl font-extrabold">{profile.postedQuests}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Quests posted</p></div><div className="px-3 text-center sm:border-r sm:border-[#BED8D4]"><p className="text-2xl font-extrabold">{profile.completedQuests}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Quests completed</p></div><div className="border-r border-[#BED8D4] px-3 text-center"><p className="text-2xl font-extrabold">{profile.confirmedPayments}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Payments confirmed</p></div><div className="px-3 text-center"><p className="text-2xl font-extrabold">{(profile.totalConfirmedEarningsCents / 100).toFixed(2)}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Self-reported rewards</p></div></div>
        <section className="p-6 sm:px-12"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-extrabold">Quest reviews</h2><p className="text-xs text-slate-500">Ratings and payments are self-reported by SideQuest participants.</p></div>{profile.reviews.length ? <div className="mt-3 divide-y divide-[#BED8D4]">{profile.reviews.map((review, index) => <article key={`${review.createdAt}-${index}`} className="py-4"><p className="text-xs font-semibold uppercase text-slate-500">{review.role === "requester" ? "Requester review" : "Completer review"} · {new Date(review.createdAt).toLocaleDateString()}</p><p className="mt-1 text-sm">{Object.entries(review.ratings).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}/5`).join(" · ")}</p>{review.text && <p className="mt-1 text-sm text-slate-600">{review.text}</p>}</article>)}</div> : <p className="mt-3 text-sm text-slate-500">No reviews yet.</p>}</section>
      </section>
    </section>
    {reportUser && <div className="fixed inset-0 z-[900] grid place-items-center bg-[#102A3A]/50 p-4"><form onSubmit={submitReport} className="grid w-full max-w-lg gap-3 rounded-xl bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">Report {reportUser.name}</h2><button type="button" aria-label="Close report" onClick={() => setReportUser(null)}>×</button></div><select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] p-2"><option value="" disabled>Choose a reason</option>{["Harassment or inappropriate behavior", "Fraud or misleading conduct", "Spam", "Other"].map(item => <option key={item}>{item}</option>)}</select><textarea name="description" required maxLength={2000} placeholder="Describe the concern" className="min-h-20 rounded-md border border-[#BED8D4] p-3" /><textarea name="evidence" maxLength={4000} placeholder="Text evidence only. Do not include private information." className="min-h-16 rounded-md border border-[#BED8D4] p-3" />{reportError && <p role="alert" className="text-sm text-red-700">{reportError}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setReportUser(null)} className="px-3 py-2 text-sm">Cancel</button><button className="rounded-md bg-[#08679e] px-4 py-2 text-sm font-bold text-white">Submit report</button></div></form></div>}
  </main>;

  return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8"><section className="mx-auto max-w-4xl">
    {reportNotice && <p role="status" className="mb-4 text-sm text-slate-600">{reportNotice}</p>}{error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
    <section><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recommended</p>{loading ? <p role="status" className="py-5 text-sm text-slate-500">Finding recommendations…</p> : recommendations.length ? <div className="grid gap-3">{recommendations.map((user, index) => personCard(user, user.rating == null ? "Building a quest history" : `★ ${user.rating.toFixed(1)} average rating`, `${user.kerb}-${index}`))}</div> : !error && <p className="rounded-xl border border-[#BED8D4] bg-white p-5 text-sm text-slate-500">No recommendations yet. Check back as more people complete quests.</p>}</section>
        {searched && <section className="mb-8"><h2 className="mb-3 text-xl font-extrabold">Search results</h2>{searching ? <p role="status" className="py-4 text-sm text-slate-500">Searching profiles…</p> : searchResults.length ? <div className="grid gap-3">{searchResults.map(user => personCard(user, "Profile match", user.kerb))}</div> : <p className="rounded-xl border border-[#BED8D4] bg-white p-4 text-sm text-slate-500">No matching profiles found.</p>}</section>}
    <section className="mt-9"><h2 className="mb-1 text-xl font-extrabold">Past quest acceptors</h2><p className="mb-4 text-sm text-slate-500">People who accepted quests you posted and completed or cancelled them.</p>{loading ? <p role="status" className="py-5 text-sm text-slate-500">Loading past acceptors…</p> : pastAcceptors.length ? <div className="grid gap-3">{pastAcceptors.map((user, index) => personCard(user, `Accepted “${user.lastQuestTitle}”${user.lastAcceptedAt ? ` · ${new Date(user.lastAcceptedAt).toLocaleDateString()}` : ""}`, `${user.kerb}-${index}`))}</div> : <p className="rounded-xl border border-[#BED8D4] bg-white p-5 text-sm text-slate-500">Past quest acceptors will appear here after a quest they accepted is completed or cancelled.</p>}</section>
  </section>
  {reportUser && <div className="fixed inset-0 z-[900] grid place-items-center bg-[#102A3A]/50 p-4"><form onSubmit={submitReport} className="grid w-full max-w-lg gap-3 rounded-xl bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">Report {reportUser.name}</h2><button type="button" aria-label="Close report" onClick={() => setReportUser(null)}>×</button></div><select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] p-2"><option value="" disabled>Choose a reason</option>{["Harassment or inappropriate behavior", "Fraud or misleading conduct", "Spam", "Other"].map(item => <option key={item}>{item}</option>)}</select><textarea name="description" required maxLength={2000} placeholder="Describe the concern" className="min-h-20 rounded-md border border-[#BED8D4] p-3" /><textarea name="evidence" maxLength={4000} placeholder="Text evidence only. Do not include private information." className="min-h-16 rounded-md border border-[#BED8D4] p-3" />{reportError && <p role="alert" className="text-sm text-red-700">{reportError}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setReportUser(null)} className="px-3 py-2 text-sm">Cancel</button><button className="rounded-md bg-[#08679e] px-4 py-2 text-sm font-bold text-white">Submit report</button></div></form></div>}
  </main>;
}
