import { useEffect, useState } from "react";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import PostRequestDialog from "../components/PostRequestDialog";
import { useAuth } from "../AuthContext";

type UserProfile = {
  kerb: string;
  name: string;
  createdAt: string | null;
};

type PostedRequest = {
  _id: string;
  description: string;
  pay: number;
  start: string | null;
  end: string | null;
};


export default function ProfilePage({ onSignedOut }: { onSignedOut: () => void }) {
  const {isLoggedIn, setIsLoggedIn} = useAuth();
  const [profileTab, setProfileTab] = useState<"Posted" | "Completed">("Completed");


  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [showRequest, setShowRequest] = useState(false);


  const [postedRequests, setPostedRequests] = useState<PostedRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState("");
  const [requestsVersion, setRequestsVersion] = useState(0);

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
  }, [isLoggedIn, requestsVersion]);

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
}, [isLoggedIn]);


async function handleLogout() {
  try {
    const response = await fetch("/api/logout", {
      method: "DELETE",
    });

    if (!response.ok) {
      alert("Could not log out. Try again.");
      return;
    }

    onSignedOut();
    setIsLoggedIn(false);
  } catch {
    alert("Could not reach the server.");
  }
}



  return (
        <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9] px-5 py-10 sm:px-8">
          <div className="mx-auto max-w-4xl">
            <section className="flex flex-col gap-5 border-b border-[#BED8D4] pb-8 sm:flex-row sm:items-center">
              <Avatar initials="JD" large />
              <div>
                <h1 className="text-2xl font-extrabold tracking-[-0.5px]"> {profile?.name ?? "Loading..."}</h1>
                <p className="mt-1 text-sm text-slate-500">{profile?.kerb ?? "Loading..."}@mit.edu</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                  <span className="text-[#2081C3]">
                    <Icon name="star" size={15} />
                  </span>
                  4.9 <span className="font-normal text-slate-400">(42 reviews)</span>
                </p>
              </div>
              <button className="rounded-md border border-[#BED8D4] px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-[#78D5D7] sm:ml-auto">
                Edit Profile
              </button>
              <button
                onClick={handleLogout}
                className="rounded bg-blue-600 px-4 py-2 text-white"
              >
                Log out
            </button>

            </section>



            <section className="grid grid-cols-3 border-b border-[#BED8D4] py-8">
              {[
                ["18", "Quests Completed"],
                ["$1,240", "Total Earned"],
                ["Sep 2024", "Member Since"],
              ].map(([value, label], index) => (
                <div
                  key={label}
                  className={`px-3 text-center ${index > 0 ? "border-l border-[#BED8D4]" : ""}`}
                >
                  <p className="text-xl font-extrabold sm:text-2xl">{value}</p>
                  <p className="mt-1 text-xs text-slate-500 sm:text-sm">{label}</p>
                </div>
              ))}
            </section>

            <section className="pt-8">
              <div className="flex gap-7 border-b border-[#BED8D4]">
                {(["Posted", "Completed"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setProfileTab(tab)}
                    className={`relative pb-3 text-sm font-bold ${
                      profileTab === tab
                        ? "text-[#2081C3] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[#2081C3]"
                        : "text-slate-500"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
                <div className="divide-y divide-[#BED8D4]">
                {profileTab === "Completed" ? (
                  <p className="py-5 text-sm text-slate-500">
                    Completed requests aren’t connected yet.
                  </p>
                ) : requestsLoading ? (
                  <p className="py-5">Loading requests...</p>
                ) : requestsError ? (
                  <p role="alert" className="py-5">{requestsError}</p>
                ) : postedRequests.length === 0 ? (
                  <p className="py-5 text-sm text-slate-500">
                    You haven’t posted any requests yet.
                  </p>
                ) : (
                  postedRequests.map((request) => (
                    <article
                      key={request._id}
                      className="flex items-center gap-4 py-5"
                    >
                      <div className="min-w-0 flex-1">
                        <h2 className="font-bold">{request.description}</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          {request.end
                            ? `Deadline: ${new Date(request.end).toLocaleString()}`
                            : "No deadline"}
                        </p>
                      </div>

                      {/* <span className="rounded-full border border-[#BED8D4] px-3 py-1.5 text-xs font-bold text-slate-500">
                        Posted
                      </span> */}

                      <button
                        onClick={() => handleDeleteRequest(request._id)}
                        className="text-sm font-bold text-red-600"
                      >
                        Delete
                      </button>

                      <span className="text-right font-extrabold text-[#2081C3]">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                        }).format(request.pay)}
                      </span>
                    </article>
                  ))
                )}
              </div>
              <button onClick={() => setShowRequest(true)}
                className="mt-4 rounded-lg bg-[#08679e] px-4 py-2 text-sm font-bold text-white">
                Post a request
              </button>
              {showRequest && (
                <PostRequestDialog onClose={() => setShowRequest(false)} onPosted={() => {
                  setShowRequest(false);
                  setProfileTab("Posted");
                  setRequestsVersion((version) => version + 1);
                }} />
              )}
            </section>
          </div>
        </main>
  );
}
