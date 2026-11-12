import { useEffect, useState } from "react";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
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


export default function ProfilePage() {
  const {isLoggedIn, setIsLoggedIn} = useAuth();
  const [kerb, setKerb] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [profileTab, setProfileTab] = useState<"Posted" | "Completed">("Completed");
  const [showLogin, setShowLogin] = useState(false);

  const [isSignup, setIsSignup] = useState(false);
  const [name, setName] = useState("");

  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [showRequest, setShowRequest] = useState(false);
  const [description, setDescription] = useState("");
  const [pay, setPay] = useState("");
  const [requestMessage, setRequestMessage] = useState("");

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

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

  async function handlePostRequest() {
    setRequestMessage("");

    const amount = Number(pay);

    if (!description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setRequestMessage("Enter a description and a payment above zero.");
      return;
    }

    try {
      if (!start || !end || new Date(end) <= new Date(start)) {
        setRequestMessage("Choose a deadline after the start time.");
        return;
      } 


      const response = await fetch("/api/post-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        description: description.trim(),
        pay: amount,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
      });

      if (!response.ok) {
        setRequestMessage("Could not post request.");
        return;
      }

      setRequestMessage("Request posted!");
      setRequestsVersion((version) => version + 1);
      setProfileTab("Posted");
      setDescription("");
      setPay("");
    } catch {
      setRequestMessage("Could not reach the server.");
    }
  }


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


  async function handleLogin() {
  setLoginError("");

  try {
    const response = await fetch(
      isSignup ? "/api/signup" : "/api/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup
            ? { kerb, name, password }
            : { kerb, password } 
        ),
      }
    );

    if (!response.ok) {
      setLoginError(
        isSignup
          ? "Could not create account. Try a different username."
          : "Login failed. Check your username and password."
      );
      return;
    }

    if (isSignup) {
      // Your backend creates the account without logging in.
      setIsSignup(false);
      setPassword("");
      setLoginError("Account created! Log in with your new account.");
      return;
    }

    const statusResponse = await fetch("/api/auth-status");
    const status = await statusResponse.json();

    if (!status.isLoggedIn) {
      setLoginError("Login succeeded, but the session was not retained.");
      return;
    }

    setIsLoggedIn(true);
    setShowLogin(false);
    setPassword("");
  } catch {
    setLoginError("Could not reach the server.");
  }
}

async function handleLogout() {
  try {
    const response = await fetch("/api/logout", {
      method: "DELETE",
    });

    if (!response.ok) {
      alert("Could not log out. Try again.");
      return;
    }

    setIsLoggedIn(false);
  } catch {
    alert("Could not reach the server.");
  }
}



  // if user is not logged in
  if (!isLoggedIn) {
  return (
    <div>
      <button onClick={() => setShowLogin(true)}>
        Log in
      </button>

      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            className="w-full max-w-sm rounded-xl bg-white p-6"
          >
            <h2 id="login-title" className="mb-4 text-xl font-bold">
              {isSignup ? "Create account" : "Log in"}
            </h2>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleLogin();
              }}
              className="flex flex-col gap-3"
            >

              {isSignup && (
                <input
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="rounded border p-2"
                  required
                />
              )}

              <input
                placeholder="Kerb / username"
                aria-label="Username"
                autoComplete="username"
                value={kerb}
                onChange={(event) => setKerb(event.target.value)}
                className="rounded border p-2"
                required
              />

              <input
                type="password"
                placeholder="Password"
                aria-label="Password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded border p-2"
                required
              />

              {loginError && <p role="alert">{loginError}</p>}

              <button type="submit" className="rounded bg-blue-600 p-2 text-white">
                {isSignup ? "Create account" : "Log in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSignup(!isSignup);
                  setLoginError("");
                }}
              >
                {isSignup
                  ? "Already have an account? Log in"
                  : "Create an account"}
              </button>
            </form>

            <button onClick={() => setShowLogin(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
              <button
  onClick={() => {
    setRequestMessage("");
    setShowRequest(true);
  }}
  className="rounded bg-blue-600 px-4 py-2 text-white"
>
  Post a request
</button>

  {showRequest && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-title"
        className="w-full max-w-sm rounded-xl bg-white p-6"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handlePostRequest();
          }}
          className="flex flex-col gap-3"
        >
          <h2 id="request-title" className="text-xl font-bold">
            Post a request
          </h2>

          <input
            placeholder="What do you need help with?"
            aria-label="Request description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border p-2"
            required
          />

          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Payment in dollars"
            aria-label="Payment in dollars"
            value={pay}
            onChange={(event) => setPay(event.target.value)}
            className="rounded border p-2"
            required
          />

          {requestMessage && <p role="status">{requestMessage}</p>}
          
          <label>
            Starts at
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="block w-full rounded border p-2"
              required
            />
          </label>

          <label>
            Deadline
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="block w-full rounded border p-2"
              required
            />
          </label>

          <button
            type="submit"
            className="rounded bg-blue-600 p-2 text-white"
          >
            Post request
          </button>

          <button
            type="button"
            onClick={() => setShowRequest(false)}
          >
            Close
          </button>
        </form>
      </div>
    </div>
  )}
            </section>
          </div>
        </main>
  );
}
