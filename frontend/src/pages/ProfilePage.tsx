import { useEffect, useState } from "react";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { useAuth } from "../AuthContext";

type UserProfile = {
  kerb: string;
  name: string;
  rank: number;
  rating: number | null;
  reviewCount: number;
  postedQuests: number;
  completedQuests: number;
  confirmedPayments: number;
  paymentConfirmationRate: number | null;
  totalConfirmedEarningsCents: number;
  identityVerificationStatus: string;
  moderationStatus?: string;
  strikes?: number;
  reviews: { id?: string; role: string; ratings: Record<string, number>; text: string; createdAt: string }[];
  preferredPaymentMethod?: string;
  paymentInstructions?: string;
  createdAt: string | null;
};

type PostedRequest = {
  _id: string;
  status?: string;
  title?: string;
  description: string;
  pay: number;
  start: string | null;
  end: string | null;
  expired?: boolean;
};


export default function ProfilePage({ refreshKey, onPostQuest, onRequestDeleted }: { refreshKey: number; onPostQuest: () => void; onRequestDeleted: () => void }) {
  const {isLoggedIn} = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [postedRequests, setPostedRequests] = useState<PostedRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState("");

  async function handleDeleteRequest(id: string) {
    if (!window.confirm("Delete this request?")) return;

    try {
      const response = await fetch(`/api/requests/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        alert("Could not delete request.");
        return;
      }

      setPostedRequests((requests) =>
        requests.filter((request) => request._id !== id)
      );
      onRequestDeleted();
    } catch {
      alert("Could not reach the server.");
    }
}


  useEffect(() => {
    if (!isLoggedIn) {
      setPostedRequests([]);
      return;
    }

    let cancelled = false;

    async function loadRequests() {
      setRequestsLoading(true);
      setRequestsError("");

      try {
        const response = await fetch("/api/my-requests");

        if (!response.ok) {
          throw new Error("Could not load requests.");
        }

        const data: PostedRequest[] = await response.json();

        if (!cancelled) setPostedRequests(data);
      } catch {
        if (!cancelled) setRequestsError("Could not load requests.");
      } finally {
        if (!cancelled) setRequestsLoading(false);
      }
    }

    loadRequests();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, refreshKey]);

useEffect(() => {
  if (!isLoggedIn) {
    setProfile(null);
    return;
  }

  async function loadProfile() {
    try {
      const response = await fetch("/api/profile");

      if (!response.ok) {
        throw new Error("Could not load profile");
      }

      const data: UserProfile = await response.json();
      setProfile(data);
    } catch (error) {
      console.error(error);
    }
  }

  loadProfile();
}, [isLoggedIn, refreshKey]);


  return (
        <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <section className="pb-8 text-center">
              <div className="relative h-36 overflow-visible rounded-t-2xl bg-[#78D5D7]">
                <span aria-hidden="true" className="absolute left-[12%] top-8 h-16 w-16 rounded-full border-[10px] border-white/25" />
                <span aria-hidden="true" className="absolute right-[15%] top-6 h-20 w-20 rotate-12 rounded-3xl border-4 border-[#2081C3]/30" />
                <div className="absolute bottom-[-42px] left-1/2 z-10 -translate-x-1/2 rounded-full border-4 border-[#F7F9F9] bg-[#F7F9F9]"><Avatar initials={(profile?.name ?? "U").slice(0, 1).toUpperCase()} large /></div>
              </div>
              <div className="mt-12">
                <h1 className="text-2xl font-extrabold tracking-[-0.5px]">{profile?.name ?? "Loading..."}</h1>
                <p className="mt-1 text-sm text-slate-500">Username: {profile?.kerb ?? "Loading..."}</p>
                <p className="mt-1 text-xs text-amber-700">University affiliation is not verified by SideQuest.</p>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-sm font-semibold"><span className="text-[#2081C3]"><Icon name="star" size={15} /></span>{profile?.rating == null ? "No ratings yet" : `${profile.rating.toFixed(1)} · ${profile.reviewCount} ${profile.reviewCount === 1 ? "review" : "reviews"}`}
                </p>
                {profile?.rank ? <p className="mt-2 text-sm font-semibold">Leaderboard rank #{profile.rank}</p> : null}
              </div>
            </section>

            <section className="grid grid-cols-2 border-y border-[#BED8D4] py-6">
              <div className="border-r border-[#BED8D4] px-3 text-center"><p className="text-xl font-extrabold sm:text-2xl">{profile?.completedQuests ?? 0}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Completed quests with receipt confirmed</p></div>
              <div className="px-3 text-center"><p className="text-xl font-extrabold sm:text-2xl">{((profile?.totalConfirmedEarningsCents ?? 0) / 100).toFixed(2)}</p><p className="mt-1 text-xs text-slate-500 sm:text-sm">Self-reported confirmed rewards</p></div>
            </section>
            <p className="py-3 text-center text-xs text-slate-500">{profile?.createdAt && `Member since ${new Date(profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`}</p>

            <section className="mt-5 grid gap-6 lg:grid-cols-2">
              <div className="min-w-0 border-t-2 border-[#2081C3] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold">My quests</h2><p className="mt-1 text-sm text-slate-500">View your current quests, post a new one, or delete an open quest.</p></div><button type="button" onClick={onPostQuest} className="rounded-lg bg-[#08679e] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#075785]">+ Post a quest</button></div>
                <div className="divide-y divide-[#BED8D4]">
                {requestsLoading ? <p className="py-5 text-sm text-slate-500">Loading quests...</p> : requestsError ? <p role="alert" className="py-5 text-sm">{requestsError}</p> : postedRequests.length === 0 ? <p className="py-5 text-sm text-slate-500">You haven’t posted any quests yet.</p> : postedRequests.map(request => <article key={request._id} className="flex items-center gap-4 py-5">
                    <div className="min-w-0 flex-1"><h3 className="font-bold">{request.title ?? request.description}</h3><p className="mt-1 text-xs capitalize text-slate-500">{request.status?.replaceAll("_", " ") ?? "open"} · {request.end ? `Deadline: ${new Date(request.end).toLocaleString()}` : "No deadline"}</p></div>
                    {(request.status ?? "open") === "open" && <button onClick={() => handleDeleteRequest(request._id)} className="text-sm font-bold text-red-600">Delete</button>}
                    <span className="font-extrabold text-[#2081C3]">{Number(request.pay).toFixed(2)} reward</span>
                  </article>)}
                </div>
              </div>
              <div className="border-t-2 border-[#BED8D4] pt-4">
                <h2 className="text-lg font-extrabold">Completed quests</h2>
                {profile?.paymentConfirmationRate != null && <p className="text-sm text-slate-600">{profile.confirmedPayments} requester payment claims later confirmed by the completer ({profile.paymentConfirmationRate}%).</p>}
                <p className="py-3 text-sm text-slate-500">Quest reviews are tied to completed quest transactions. External payment confirmations are self-reported, not verified by SideQuest.</p>
                {profile?.reviews?.length ? <div className="divide-y divide-[#BED8D4]">{profile.reviews.map((review, index) => <article key={review.id ?? index} className="py-3"><p className="text-xs font-semibold uppercase text-slate-500">{review.role === "requester" ? "Requester review" : "Completer review"} · {new Date(review.createdAt).toLocaleDateString()}</p><p className="mt-1 text-sm">{Object.entries(review.ratings).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}/5`).join(" · ")}</p>{review.text && <p className="mt-1 text-sm text-slate-600">{review.text}</p>}</article>)}</div> : <p className="py-2 text-sm text-slate-500">No reviews yet.</p>}
              </div>
            </section>
          </div>
        </main>
  );
}
