import { useEffect, useRef, useState } from "react";
import DropoffPicker from "./components/DropoffPicker";
import ExploreTasks from "./pages/ExploreTasks";
import ActiveQuest from "./pages/ActiveQuest";
import ProfilePage from "./pages/ProfilePage";
import SignIn from "./pages/SignIn";
import PostRequestDialog from "./components/PostRequestDialog";
import CompleteQuest from "./pages/CompleteQuest";
import UserLookupPage from "./pages/UserLookupPage";
import RequestsPage from "./pages/RequestsPage";
import WalletPage from "./pages/WalletPage";
import Icon from "./components/Icon";
import Logo from "./components/Logo";
import Avatar from "./components/Avatar";
import ChatPopup from "./components/ChatPopup";
import FeedbackDialog from "./components/FeedbackDialog";
// import { mapRequests } from "./data/requests";
import type { Request } from "./data/requests";
import { useAuth } from "./AuthContext";

type Page = "map" | "requests" | "active" | "profile" | "complete" | "users" | "wallet";

export default function App() {
  const [page, setPage] = useState<Page>("map");
  const [menuOpen, setMenuOpen] = useState(false);
  const { isLoggedIn, checkingSession, setIsLoggedIn, setUserName, userName, userKerb, setUserKerb } = useAuth();
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [dropoffAddress, setDropoffAddress] = useState(() => localStorage.getItem("sidequest-default-dropoff") || "Current location");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [postingRequest, setPostingRequest] = useState(false);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [requests, setRequests] = useState<Request[]>([]);
  const [requestsError, setRequestsError] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<string | number>("");
  const [query, setQuery] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchVersion, setUserSearchVersion] = useState(0);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ _id: string; type?: string; title: string; message: string; createdAt: string; readAt?: string | null }[]>([]);
  const menuRef = useRef<HTMLElement>(null);
  const selectedRequest =
  requests.find((request) => request.id === selectedRequestId)
  ?? requests[0];

  useEffect(() => {
    if (page !== "active" || !selectedRequest) return;
    const persistedStage = selectedRequest.questStage ?? 0;
    setStage(persistedStage >= 2 ? 3 : persistedStage >= 1 ? 2 : 1);
  }, [page, selectedRequest?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpen]);


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
        title?: string;
        description: string;
        category?: string;
        pay: number;
        requester: string | null;
        requesterName?: string | null;
        lat?: number;
        lng?: number;
        start?: string;
        end?: string;
        pickup?: string;
        dropoff?: string;
        createdAt?: string;
        expiresAt?: string;
        expired?: boolean;
        rating?: number;
        imageUrl?: string;
        status?: number;
        questStage?: number;
        helper?: string | null;
      };

      const loaded: Request[] = result.data.map(
        (request: DatabaseRequest) => ({
          id: request._id,
          title: request.title ?? request.description,
          description: request.description,
          reward: Number(request.pay).toFixed(2),
          poster: request.requesterName ?? request.requester ?? "Unknown user",
          category: request.category ?? "Uncategorized",
          location: request.pickup || (request.lat != null && request.lng != null
            ? "Location shown on the map" : "Location not provided"),
          posted: request.createdAt ? new Date(request.createdAt).toLocaleString() : "Posting time unavailable",
          distance: "",
          lat: request.lat ?? null,
          lng: request.lng ?? null,
          start: request.start ?? null,
          end: request.end ?? null,
          pickup: request.pickup ?? null,
          dropoff: request.dropoff ?? null,
          createdAt: request.createdAt ?? null,
          expiresAt: request.expiresAt ?? (request.createdAt ? new Date(new Date(request.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null),
          expired: request.expired ?? false,
          rating: request.rating ?? null,
          imageUrl: request.imageUrl ?? null,
          status: request.status,
          questStage: request.questStage,
          helper: request.helper ?? null,
          requester: request.requester ?? null,
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

  useEffect(() => {
    if (!isLoggedIn) { setNotifications([]); return; }
    const controller = new AbortController();
    const load = () => fetch("/api/notifications", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => {
      if (result?.data) { setNotifications(result.data); if (result.data.some((item: { type?: string; readAt?: string | null }) => item.type === "message" && !item.readAt)) setChatUnread(true); }
    }).catch(() => {});
    void load();
    const timer = window.setInterval(() => { void load(); }, 12000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [isLoggedIn]);

  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
  }
  if (checkingSession) {
    return <main className="sign-in"><div className="sign-in-brand"><Logo /></div><p className="sign-in-loading" role="status">Loading SideQuest…</p></main>;
  }
  if (!isLoggedIn) return <SignIn />;

  return (
    <div className="min-h-screen bg-[#F7F9F9] text-[#102A3A]">
      <header className="relative z-50 h-16 border-b border-[#BED8D4] bg-[#F7F9F9]">
        <div className="flex h-full items-center gap-4 px-4 sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-md text-[#102A3A] transition hover:bg-[#BED8D4]/35"
            aria-label="Open menu"
          >
            <Icon name="menu" size={21} />
          </button>
          <button type="button" onClick={() => navigate("map")} aria-label="SideQuest home" className="shrink-0 rounded text-[18px] font-black tracking-[-0.8px] text-[#102A3A] hover:text-[#08679e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2081C3]">sidequest</button>
          <button onClick={() => setDropoffOpen(true)}
            className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-2 text-sm font-semibold text-[#102A3A] hover:bg-[#BED8D4]/30 sm:flex"
            aria-label="Choose drop-off address">
            <Icon name="location" size={19} />
            <span className="max-w-[180px] truncate">{dropoffAddress}</span>
            <Icon name="chevron" size={15} />
          </button>

          <form
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#BED8D4] bg-white px-4 focus-within:border-[#2081C3]"
            onSubmit={(event) => { event.preventDefault(); if (userSearchQuery.trim().length >= 2) { setUserSearchVersion(version => version + 1); navigate("users"); } }}
          >
            <Icon name="search" size={18} />
            <label htmlFor="task-search" className="sr-only">
              Search users
            </label>
            <input
              id="user-search"
              value={userSearchQuery}
              onChange={(event) => setUserSearchQuery(event.target.value)}
              placeholder="Search users by name or username"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </form>

          <button onClick={() => setNotificationOpen(open => !open)} className="relative grid h-10 w-10 shrink-0 place-items-center rounded-md text-slate-600 transition hover:bg-[#BED8D4]/30" aria-label="Notifications" aria-expanded={notificationOpen}>
            <Icon name="bell" size={19} />
            {notifications.some(item => !item.readAt) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-[#F7F9F9] bg-[#63D2FF]" />}
          </button>
          {(
            <button onClick={() => setPostingRequest(true)} aria-label="Post a quest"
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#08679e] px-3 py-2 text-sm font-bold text-white hover:bg-[#075785]">
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span className="hidden min-[390px]:inline">Post a quest</span>
            </button>
          )}
        </div>
      </header>
      {notificationOpen && <section aria-label="Notifications" className="fixed right-4 top-[72px] z-[90] max-h-[min(70vh,520px)] w-[min(380px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[#BED8D4] bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-extrabold">Notifications</h2><button type="button" onClick={() => setNotificationOpen(false)} aria-label="Close notifications" className="rounded-md p-1 hover:bg-[#E5F1F3]"><Icon name="x" size={18} /></button></div>
        {!notifications.length ? <p className="py-5 text-center text-sm text-slate-500">No updates yet.</p> : <div className="divide-y divide-[#BED8D4]">{notifications.map(item => <button key={item._id} type="button" onClick={() => {
          if (!item.readAt) {
            setNotifications(current => current.map(entry => entry._id === item._id ? { ...entry, readAt: new Date().toISOString() } : entry));
            void fetch(`/api/notifications/${item._id}/read`, { method: "PATCH" });
          }
          setNotificationOpen(false);
        }} className={`block w-full px-1 py-3 text-left ${item.readAt ? "opacity-70" : ""}`}><span className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-[#2081C3]"}`} /><span><strong className="block text-sm">{item.title}</strong><span className="mt-0.5 block text-sm text-slate-600">{item.message}</span><time className="mt-1 block text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</time></span></span></button>)}</div>}
      </section>}
      {dropoffOpen && <DropoffPicker onClose={() => { setDropoffOpen(false); setDropoffAddress(localStorage.getItem("sidequest-default-dropoff") || "Current location"); }} onSelectAddress={setDropoffAddress} />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      <button
        onClick={() => setMenuOpen(false)}
        className={`fixed inset-0 z-[70] bg-[#102A3A]/25 transition-opacity ${
          menuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="Close menu"
        tabIndex={menuOpen ? 0 : -1}
      />
      <aside
        ref={menuRef}
        className={`fixed inset-y-0 left-0 z-[80] w-[300px] max-w-[86vw] border-r border-[#BED8D4] bg-[#F7F9F9] transition-transform duration-200 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="flex min-h-16 items-center px-5 pt-4">
          <button onClick={() => navigate("profile")} className="flex items-center gap-3 text-left">
            <Avatar initials={(userName || "U").slice(0, 1).toUpperCase()} />
            <span className="ml-2"><span className="block font-bold">{userName || "Your profile"}</span><span className="text-xs font-medium text-[#2081C3]">Manage account</span></span>
          </button>
        </div>
        <div className="flex h-[calc(100%-80px)] flex-col overflow-y-auto px-4 pb-0 pt-5">
          {[
            { label: "Quests", icon: "location" as const, target: "requests" as const },
            { label: "Map", icon: "location" as const, target: "map" as const },
            { label: "Active quest", icon: "bolt" as const, target: "active" as const },
            { label: "Wallet", icon: "wallet" as const, target: "wallet" as const },
            { label: "FAQ", icon: "book" as const, target: null },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.target) navigate(item.target);
                else {
                  setMenuOpen(false);
                  window.alert("FAQ and support are coming soon.");
                }
              }}
              className={`mt-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition ${
                page === item.target
                  ? "bg-[#BED8D4]/45 text-[#2081C3]"
                  : "text-slate-600 hover:bg-[#BED8D4]/25"
              }`}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
              {item.label !== "FAQ" && <span className="ml-auto"><Icon name="chevron" size={16} /></span>}
            </button>
          ))}
          <div className="mt-auto translate-y-6">
            <button onClick={() => {
              void fetch("/api/logout", { method: "DELETE" }).finally(() => {
                setIsLoggedIn(false);
                setUserName("");
                setUserKerb("");
                navigate("map");
              });
            }} className="mt-1 w-full rounded-md px-3 py-3 text-left text-sm font-semibold text-slate-500 hover:bg-[#BED8D4]/25">
              Sign out
            </button>
            <div className="flex items-center gap-2 border-t border-[#BED8D4] pt-2">
              <button onClick={() => { setMenuOpen(false); window.alert("Help and support is coming soon."); }} className="rounded-md px-3 py-3 text-sm font-semibold text-slate-500 hover:bg-[#BED8D4]/25">Help</button>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <button onClick={() => { setMenuOpen(false); setFeedbackOpen(true); }} className="rounded-md px-3 py-3 text-sm font-semibold text-slate-500 hover:bg-[#BED8D4]/25">Feedback</button>
            </div>
          </div>
        </div>
      </aside>
      {postingRequest && (
        <PostRequestDialog onClose={() => setPostingRequest(false)} onPosted={() => {
          setPostingRequest(false);
          setQuery("");
          setRequestsVersion((version) => version + 1);
        }} />
      )}
      {page === "map" && (
  <>
    {requestsError && <p role="alert">{requestsError}</p>}

    <ExploreTasks
      requests={requests}
      query={query}
      selectedRequestId={selectedRequestId}
      setSelectedRequestId={setSelectedRequestId}
      onAccept={async () => {
        const response = await fetch("/api/connect-request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _id: String(selectedRequestId || selectedRequest?.id || "") }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          window.alert(result?.msg ?? "Could not accept this quest.");
          return;
        }
        setStage(1);
        navigate("active");
      }}
    />
  </>
)}

{page === "requests" && <RequestsPage requests={requests} query={query} onViewOnMap={id => { setSelectedRequestId(id); navigate("map"); }} />}

{page === "wallet" && <WalletPage />}

{page === "active" && selectedRequest && (
  <ActiveQuest
    selectedRequest={selectedRequest}
    stage={stage}
    setStage={setStage}
    currentKerb={userKerb}
    onBack={() => navigate("map")}
    onComplete={() => navigate("complete")}
    onCancelled={() => { setRequestsVersion(version => version + 1); navigate("map"); }}
  />
)}

{page === "complete" && selectedRequest && (
  <CompleteQuest
    selectedRequest={selectedRequest}
    onBack={() => navigate("map")}
  />
)}
      {page === "profile" && <ProfilePage refreshKey={requestsVersion} />}
      {page === "users" && <UserLookupPage initialQuery={userSearchQuery} searchVersion={userSearchVersion} />}
      <ChatPopup request={selectedRequest} open={chatOpen} onClose={() => setChatOpen(false)} onUnreadChange={setChatUnread} />
      <button type="button" aria-label={chatOpen ? "Close chat" : "Open chat"} title="Messages" onClick={() => {
        setChatOpen(open => !open);
        setChatUnread(false);
        const unreadMessages = notifications.filter(item => item.type === "message" && !item.readAt);
        unreadMessages.forEach(item => { void fetch(`/api/notifications/${item._id}/read`, { method: "PATCH" }); });
        if (unreadMessages.length) setNotifications(current => current.map(item => item.type === "message" ? { ...item, readAt: new Date().toISOString() } : item));
      }} className="fixed bottom-6 right-6 z-[750] grid h-14 w-14 place-items-center rounded-full border-2 border-white bg-[#2081C3] text-white shadow-lg transition hover:bg-[#176FA9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102A3A]">
        <Icon name={chatOpen ? "x" : "chat"} size={24} />
        {chatUnread && <span aria-label="Unread messages" className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-red-500" />}
      </button>
    </div>
  );
}
