import { BrowserRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Compass,
  MessageCircle,
  UserRound,
  MapPin,
  Plus,
  LogOut,
  ArrowUpRight,
} from "lucide-react";
import { api, post, type Auth } from "./api";
import { Discovery } from "./Discovery";
import { AuthContext, RequireAuth, Page } from "./components";
import { Login } from "./pages/Login";
import { CreateQuest, QuestDetail, MyQuests } from "./pages/Quests";
import { Conversations, Chat } from "./pages/Messages";
import { Profile, PublicProfile } from "./pages/Profiles";
import { Terms, Support } from "./pages/Safety";
export function App() {
  const query = useQuery<Auth>({
    queryKey: ["auth"],
    queryFn: () => api("/auth/me"),
    retry: 1,
  });
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => post("/auth/logout"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
  });
  return (
    <BrowserRouter>
      <AuthContext.Provider value={query.data}>
        <header className="app-header">
          <Link to="/" className="logo">
            <span className="logo-icon">
              <Compass size={23} />
            </span>
            SideQuest<span className="mit-tag">MIT</span>
          </Link>
          <nav>
            <NavLink to="/" end>
              <MapPin size={17} />
              Explore
            </NavLink>
            <NavLink to="/my-quests">
              <Compass size={17} />
              My quests
            </NavLink>
            <NavLink to="/messages">
              <MessageCircle size={17} />
              Messages
            </NavLink>
          </nav>
          <div className="header-right">
            <Link className="button compact" to="/quests/new">
              <Plus size={17} />
              Post a quest
            </Link>
            {query.data?.user ? (
              <>
                <Link
                  to="/profile"
                  className="profile-link"
                  aria-label="My profile"
                >
                  <span className="avatar">
                    {query.data.user.displayName.charAt(0)}
                  </span>
                  <span>{query.data.user.displayName.split(" ")[0]}</span>
                </Link>
                <button
                  className="icon-button"
                  aria-label="Log out"
                  onClick={() => logout.mutate()}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <Link className="login-link" to="/login">
                Sign in <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </header>
        {query.isError && (
          <div className="service-banner">
            API unavailable. {query.error.message}{" "}
            <button onClick={() => query.refetch()}>Retry</button>
          </div>
        )}
        {query.data?.developmentLogin && (
          <div className="dev-banner">
            Development pilot · seeded sample quests and fictional accounts ·
            payments happen externally
          </div>
        )}
        {logout.isError && (
          <p role="alert" className="error">
            {logout.error.message}
          </p>
        )}
        <Routes>
          <Route path="/" element={<Discovery />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/quests/new"
            element={
              <RequireAuth>
                <CreateQuest />
              </RequireAuth>
            }
          />
          <Route path="/quests/:id" element={<QuestDetail />} />
          <Route
            path="/my-quests"
            element={
              <RequireAuth>
                <MyQuests />
              </RequireAuth>
            }
          />
          <Route
            path="/messages"
            element={
              <RequireAuth>
                <Conversations />
              </RequireAuth>
            }
          />
          <Route
            path="/messages/:questId"
            element={
              <RequireAuth>
                <Chat />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route path="/users/:id" element={<PublicProfile />} />
          <Route path="/terms" element={<Terms />} />
          <Route
            path="/support"
            element={
              <RequireAuth>
                <Support />
              </RequireAuth>
            }
          />
          <Route
            path="*"
            element={
              <Page title="Page not found">
                <Link to="/">Return to campus</Link>
              </Page>
            }
          />
        </Routes>
        <nav className="mobile-nav">
          <NavLink to="/" end>
            <MapPin size={19} />
            Explore
          </NavLink>
          <NavLink to="/my-quests">
            <Compass size={19} />
            My quests
          </NavLink>
          <NavLink to="/messages">
            <MessageCircle size={19} />
            Messages
          </NavLink>
          <NavLink to="/profile">
            <UserRound size={19} />
            Profile
          </NavLink>
        </nav>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}
