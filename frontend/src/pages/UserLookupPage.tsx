import { useEffect, useState, type FormEvent } from "react";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import "./UserLookupPage.css";

type User = { kerb: string; name: string; rating: number | null; canRate: boolean; yourRating: number | null };
type RankedUser = User & { quests: number };

type UserLookupPageProps = { initialQuery: string; searchVersion: number };

export default function UserLookupPage({ initialQuery, searchVersion }: UserLookupPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [leaderboard, setLeaderboard] = useState<RankedUser[]>([]);
  const [ratingUser, setRatingUser] = useState<User | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [ratingError, setRatingError] = useState("");
  const [leaderboardStart, setLeaderboardStart] = useState(0);
  const [leaderboardTransition, setLeaderboardTransition] = useState(true);

  const topLeaderboard = leaderboard.slice(0, 5);
  const rotatingLeaderboard = topLeaderboard.length > 3
    ? [...topLeaderboard, ...topLeaderboard.slice(0, 3)]
    : topLeaderboard;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/leaderboard", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => {
      if (result?.data) setLeaderboard(result.data);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!searchVersion || initialQuery.trim().length < 2) return;
    setQuery(initialQuery);
    setBusy(true);
    setError("");
    setSearched(true);
    const controller = new AbortController();
    fetch(`/api/users/search?q=${encodeURIComponent(initialQuery.trim())}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result?.msg ?? "Could not search users.");
        setUsers(result.data ?? []);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not search users.");
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [initialQuery, searchVersion]);

  useEffect(() => {
    if (topLeaderboard.length <= 3) return;
    const timer = window.setInterval(() => setLeaderboardStart(start => start + 1), 4200);
    return () => window.clearInterval(timer);
  }, [topLeaderboard.length]);

  function finishLeaderboardSlide() {
    if (leaderboardStart < topLeaderboard.length) return;
    setLeaderboardTransition(false);
    setLeaderboardStart(0);
    requestAnimationFrame(() => requestAnimationFrame(() => setLeaderboardTransition(true)));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setSearched(true);
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.msg ?? "Could not search users.");
      setUsers(result.data ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not search users."); }
    finally { setBusy(false); }
  }

  function openRating(user: User) {
    setRatingUser(user);
    setRatingError("");
    setRatingFeedback("");
  }

  async function saveRating(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault();
    setRatingBusy(true);
    setRatingError("");
    const rating = Number(new FormData(event.currentTarget).get("rating"));
    try {
      const response = await fetch("/api/rate-user", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kerb: user.kerb, rating }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.msg ?? "Could not save your rating.");
      setUsers(current => current.map(person => person.kerb === user.kerb
        ? { ...person, rating: result.rating, yourRating: result.yourRating } : person));
      setRatingUser(null);
      setRatingFeedback(`Rating saved for ${user.name}.`);
      const ranking = await fetch("/api/leaderboard").catch(() => null);
      if (ranking?.ok) {
        const updated = await ranking.json().catch(() => null);
        if (updated?.data) setLeaderboard(updated.data);
      }
    } catch (reason) {
      setRatingError(reason instanceof Error ? reason.message : "Could not save your rating.");
    } finally {
      setRatingBusy(false);
    }
  }

  return <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9] px-5 py-10 sm:px-8">
    <section className="mx-auto max-w-3xl">
      <form onSubmit={search} className="flex gap-2 rounded-xl border border-[#BED8D4] bg-white p-3 shadow-sm">
        <Icon name="search" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Enter a name or username" className="min-w-0 flex-1 bg-transparent outline-none" />
        <button disabled={busy || query.trim().length < 2} className="rounded-lg bg-[#08679e] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Searching…" : "Search"}</button>
      </form>
      {!!leaderboard.length && <section aria-label="Top questers" className="mt-8">
        <h1 className="mb-3 text-xl font-extrabold">Leaderboard</h1>
        <div className="leaderboard-viewport">
          <div onTransitionEnd={finishLeaderboardSlide} className={`leaderboard-track ${leaderboardTransition ? "leaderboard-track--sliding" : ""}`} style={{ transform: `translateX(calc(-${leaderboardStart * (100 / 3)}% - ${leaderboardStart * 8}px))` }}>
          {rotatingLeaderboard.map((person, index) => {
          return <article key={`${person.kerb}-${index}`} className="leaderboard-card flex items-center gap-3 rounded-lg border border-[#BED8D4] bg-white p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E5F1F3] text-sm font-extrabold text-[#08679e]">#{(index % Math.max(topLeaderboard.length, 1)) + 1}</span>
            <Avatar initials={person.name.slice(0, 1).toUpperCase()} />
            <div className="min-w-0"><h2 className="truncate text-sm font-bold">{person.name}</h2><p className="text-xs text-slate-500">{person.quests} quests · {person.rating == null ? "No rating" : `★ ${person.rating.toFixed(1)}`}</p></div>
            {person.canRate && <button type="button" onClick={() => openRating(person)} className="ml-auto text-sm font-bold text-[#08679e]" aria-label={`Rate ${person.name}`}>Rate</button>}
          </article>;
        })}
          </div>
        </div>
      </section>}
      {ratingFeedback && <p role="status" className="mt-4 text-sm">{ratingFeedback}</p>}
      {ratingUser && <form key={ratingUser.kerb} onSubmit={event => saveRating(event, ratingUser)} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-[#BED8D4] bg-white p-4">
        <label className="text-sm font-semibold">Rate {ratingUser.name}
          <select name="rating" defaultValue={ratingUser.yourRating ?? ""} required className="mt-1 block rounded border border-[#BED8D4] p-2">
            <option value="" disabled>Choose stars</option>
            {[1, 2, 3, 4, 5].map(stars => <option key={stars} value={stars}>{stars} {stars === 1 ? "star" : "stars"}</option>)}
          </select>
        </label>
        <button disabled={ratingBusy} className="rounded bg-[#08679e] px-4 py-2 text-sm font-bold text-white">Save rating</button>
        <button type="button" disabled={ratingBusy} onClick={() => setRatingUser(null)} className="px-2 py-2 text-sm">Cancel</button>
        {ratingError && <p role="alert" className="w-full text-sm text-red-700">{ratingError}</p>}
      </form>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="mt-5 divide-y divide-[#BED8D4]">
        {users.map(user => <article key={user.kerb} className="flex items-center gap-4 py-4">
          <Avatar initials={user.name.slice(0, 1).toUpperCase()} />
          <div><h2 className="font-bold">{user.name}</h2><p className="text-sm text-slate-500">{user.kerb}</p></div>
          {user.rating != null && <span className="ml-auto text-sm font-semibold text-slate-600">★ {user.rating.toFixed(1)}</span>}
          {user.canRate && <button type="button" onClick={() => openRating(user)} className="text-sm font-bold text-[#08679e]" aria-label={`Rate ${user.name}`}>Rate</button>}
        </article>)}
        {searched && !busy && !error && users.length === 0 && <p className="py-6 text-sm text-slate-500">No matching users found.</p>}
      </div>
    </section>
  </main>;
}
