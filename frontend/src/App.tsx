import { useEffect, useState } from "react";
import ExploreTasks from "./pages/ExploreTasks";
import ActiveQuest from "./pages/ActiveQuest";
import ProfilePage from "./pages/ProfilePage";
import SignIn from "./pages/SignIn";
import PostRequestDialog from "./components/PostRequestDialog";
import CompleteQuest from "./pages/CompleteQuest";
import Icon from "./components/Icon";
import Logo from "./components/Logo";
import Avatar from "./components/Avatar";
// import { mapRequests } from "./data/requests";
import type { Request } from "./data/requests";
import { useAuth } from "./AuthContext";

type Page = "explore" | "active" | "profile" | "complete";

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("sidequest-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [page, setPage] = useState<Page>("explore");
  const [menuOpen, setMenuOpen] = useState(false);
  const { isLoggedIn, checkingSession } = useAuth();
  const [postingRequest, setPostingRequest] = useState(false);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [requests, setRequests] = useState<Request[]>([]);
  const [requestsError, setRequestsError] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<string | number>("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<1 | 2>(1);
  const selectedRequest =
  requests.find((request) => request.id === selectedRequestId)
  ?? requests[0];
  useEffect(() => {
    localStorage.setItem("sidequest-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
  if (!isLoggedIn) {
    setRequests([]);
    setRequestsError("");
    return;
  }

  let cancelled = false;

  async function loadRequests() {
    setRequestsError("");

    try {
      const response = await fetch("/api/get-all-requests");

      if (!response.ok) {
        throw new Error("Could not load requests");
      }

      const result = await response.json();

      type DatabaseRequest = {
        _id: string;
        description: string;
        pay: number;
        requester: string | null;
        lat?: number;
        lng?: number;
      };

      const loaded: Request[] = result.data.map(
        (request: DatabaseRequest) => ({
          id: request._id,
          title: request.description,
          description: request.description,
          price: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(request.pay),
          poster: request.requester ?? "Unknown user",
          category: "Uncategorized",
          location: request.lat != null && request.lng != null
            ? "Location shown on the map" : "Location not provided",
          distance: "",
          posted: "",
          lat: request.lat ?? null,
          lng: request.lng ?? null,
        })
      );

      if (!cancelled) setRequests(loaded);
    } catch {
      if (!cancelled) {
        setRequestsError("Could not load requests.");
      }
    }
  }

  loadRequests();

  return () => {
    cancelled = true;
  };
}, [isLoggedIn, page, requestsVersion]);

  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
  }
  if (checkingSession) {
    return <main className="sign-in"><div className="sign-in-brand"><Logo /></div><p className="sign-in-loading" role="status">Loading SideQuest…</p></main>;
  }
  if (!isLoggedIn) return <SignIn />;

  return (
    <div className={`theme-${theme} min-h-screen bg-[#F7F9F9] text-[#102A3A]`}>
      <header className="relative z-50 h-16 border-b border-[#BED8D4] bg-[#F7F9F9]">
        <div className="flex h-full items-center gap-4 px-4 sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-md text-[#102A3A] transition hover:bg-[#BED8D4]/35"
            aria-label="Open menu"
          >
            <Icon name="menu" size={21} />
          </button>
          <button onClick={() => navigate("explore")} className="shrink-0">
            <Logo />
          </button>

          <form
            className="mx-auto hidden h-10 w-full max-w-md items-center gap-2 rounded-md border border-[#BED8D4] bg-white px-3 focus-within:border-[#2081C3] sm:flex"
            onSubmit={(event) => event.preventDefault()}
          >
            <Icon name="search" size={18} />
            <label htmlFor="task-search" className="sr-only">
              Search tasks
            </label>
            <input
              id="task-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks near MIT"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </form>

          <button className="relative ml-auto grid h-10 w-10 place-items-center rounded-md text-slate-600 transition hover:bg-[#BED8D4]/30">
            <Icon name="bell" size={19} />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-[#F7F9F9] bg-[#63D2FF]" />
          </button>
          <button
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            className="grid h-10 w-10 place-items-center rounded-md text-slate-600 transition hover:bg-[#BED8D4]/30"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={19} />
          </button>
          {page === "explore" && (
            <button onClick={() => setPostingRequest(true)} aria-label="Post a request"
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#08679e] px-3 py-2 text-sm font-bold text-white hover:bg-[#075785]">
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span className="hidden min-[390px]:inline">Post request</span>
            </button>
          )}
          <button onClick={() => navigate("profile")} aria-label="View profile">
            <Avatar initials="JD" />
          </button>
        </div>
      </header>
      <button
        onClick={() => setMenuOpen(false)}
        className={`fixed inset-0 z-[70] bg-[#102A3A]/25 transition-opacity ${
          menuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="Close menu"
        tabIndex={menuOpen ? 0 : -1}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[80] w-[300px] max-w-[86vw] border-r border-[#BED8D4] bg-[#F7F9F9] transition-transform duration-200 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="flex h-16 items-center border-b border-[#BED8D4] px-5">
          <Logo />
        </div>
        <div className="p-4">
          <p className="px-3 pb-2 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Navigate
          </p>
          {[
            { label: "Explore tasks", icon: "location" as const, target: "explore" as const },
            { label: "Active quest", icon: "bolt" as const, target: "active" as const },
            { label: "Profile", icon: "user" as const, target: "profile" as const },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.target)}
              className={`mt-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition ${
                page === item.target
                  ? "bg-[#BED8D4]/45 text-[#2081C3]"
                  : "text-slate-600 hover:bg-[#BED8D4]/25"
              }`}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
              <span className="ml-auto">
                <Icon name="chevron" size={16} />
              </span>
            </button>
          ))}
        </div>
      </aside>
      {page === "explore" && postingRequest && (
        <PostRequestDialog onClose={() => setPostingRequest(false)} onPosted={() => {
          setPostingRequest(false);
          setQuery("");
          setRequestsVersion((version) => version + 1);
        }} />
      )}
      {page === "explore" && (
  <>
    {requestsError && <p role="alert">{requestsError}</p>}

    <ExploreTasks
      requests={requests}
      query={query}
      selectedRequestId={selectedRequestId}
      setSelectedRequestId={setSelectedRequestId}
      onAccept={() => {
        setStage(1);
        navigate("active");
      }}
    />
  </>
)}

{page === "active" && selectedRequest && (
  <ActiveQuest
    selectedRequest={selectedRequest}
    stage={stage}
    setStage={setStage}
    onBack={() => navigate("explore")}
    onComplete={() => navigate("complete")}
  />
)}

{page === "complete" && selectedRequest && (
  <CompleteQuest
    selectedRequest={selectedRequest}
    onBack={() => navigate("explore")}
  />
)}
      {page === "profile" && <ProfilePage onSignedOut={() => navigate("explore")} />}
    </div>
  );
}
