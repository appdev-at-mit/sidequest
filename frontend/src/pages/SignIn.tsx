import { useState, type FormEvent } from "react";
import Logo from "../components/Logo";
import { useAuth } from "../AuthContext";
import "./SignIn.css";

export default function SignIn() {
  const { setIsLoggedIn } = useAuth();
  const [creating, setCreating] = useState(false);
  const [kerb, setKerb] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const credentials = { kerb: kerb.trim(), password };
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(creating ? "/api/signup" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating
          ? { ...credentials, name: fields.get("name") }
          : { ...credentials, remember: fields.has("remember") }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.result !== "success") {
        setError(response.status >= 500
          ? "SideQuest couldn’t connect. Please try again in a moment."
          : data?.msg || "Something went wrong. Please try again.");
        return;
      }
      setPassword("");
      setVisible(false);
      if (creating) {
        setCreating(false);
        setNotice("Your account is ready. Sign in to continue.");
      } else {
        setIsLoggedIn(true);
      }
    } catch {
      setError("SideQuest couldn’t connect. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <div className="sign-in-brand"><Logo /></div>
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">{creating ? "Create your account" : "Welcome back"}</h1>
        <p className="sign-in-intro">
          {creating ? "Join SideQuest to find and post tasks near MIT." : "Sign in to find and post tasks near MIT."}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          {creating && (
            <label className="sign-in-field">
              Full name
              <input name="name" autoComplete="name" placeholder="Your name" maxLength={100} required />
            </label>
          )}
          <label className="sign-in-field">
            MIT Kerberos username
            <input name="kerb" pattern={creating ? "[a-zA-Z0-9_\\-]+" : undefined} value={kerb} onChange={(event) => setKerb(event.target.value)}
              placeholder="Your Kerberos username" autoComplete="username" autoCapitalize="none"
              spellCheck={false} maxLength={64} required />
          </label>
          <div className="sign-in-field">
            <label htmlFor="sidequest-password">SideQuest password</label>
            <div className="sign-in-password">
              <input id="sidequest-password" name="password" type={visible ? "text" : "password"}
                value={password} onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password" autoComplete={creating ? "new-password" : "current-password"}
                minLength={creating ? 12 : undefined} maxLength={256}
                aria-describedby={creating ? "password-hint" : undefined} required />
              <button type="button" onClick={() => setVisible(!visible)} aria-controls="sidequest-password">
                {visible ? "Hide" : "Show"}
              </button>
            </div>
            {creating && <small id="password-hint">Use at least 12 characters.</small>}
          </div>
          {!creating && (
            <label className="sign-in-remember">
              <input type="checkbox" name="remember" /> Keep me signed in for 30 days
            </label>
          )}
          {error && <p className="sign-in-feedback sign-in-error" role="alert">{error}</p>}
          {notice && <p className="sign-in-feedback" role="status">{notice}</p>}
          <button className="sign-in-submit" type="submit" disabled={busy}>
            {busy ? (creating ? "Creating account…" : "Signing in…") : (creating ? "Create account" : "Sign in")}
          </button>
        </form>
        <p className="sign-in-switch">
          {creating ? "Already have an account?" : "New to SideQuest?"}{" "}
          <button type="button" disabled={busy} onClick={() => {
            setCreating(!creating);
            setPassword("");
            setVisible(false);
            setError("");
            setNotice("");
          }}>
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </main>
  );
}
