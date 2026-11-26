import { useState, type FormEvent } from "react";
import { useAuth } from "../AuthContext";
import "./SignIn.css";

function BicycleIllustration() {
  return (
    <svg className="landing-object landing-bike" viewBox="0 0 440 300" aria-hidden="true">
      <ellipse cx="220" cy="255" rx="166" ry="17" fill="#17495a" opacity=".13" />
      <g fill="#f8f5e9" stroke="#102a3a" strokeWidth="9">
        <circle cx="109" cy="203" r="66" /><circle cx="329" cy="203" r="66" />
      </g>
      <g fill="none" stroke="#2081c3" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round">
        <path d="m109 203 82-111 67 111H109l47-68h73m-46-43h-38m135 0h32" />
        <path d="M329 203h-71" />
      </g>
      <path d="m183 89 19 2m109 0 17 4" stroke="#102a3a" strokeWidth="10" strokeLinecap="round" />
      <circle cx="191" cy="203" r="8" fill="#f2bd55" />
      <path d="M214 57c14-18 33-22 51-12m-6-13 9 15-18 2" fill="none" stroke="#fff8e8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M91 87c-13-13-25-10-35 1m281 20c15-16 29-15 41-4" fill="none" stroke="#174f72" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function LaundryIllustration() {
  return (
    <svg className="landing-object landing-laundry" viewBox="0 0 360 320" aria-hidden="true">
      <ellipse cx="180" cy="278" rx="123" ry="14" fill="#17495a" opacity=".13" />
      <path d="m91 117 35-24 45 11 41-21 58 36-15 28-37-14-47 24-44-12-28 18-27-26Z" fill="#fff8e8" stroke="#102a3a" strokeWidth="5" strokeLinejoin="round" />
      <path d="M101 139h167l-17 119H117Z" fill="#2081c3" stroke="#102a3a" strokeWidth="6" strokeLinejoin="round" />
      <path d="m111 155 13 89m120-89-12 89M125 169h115" stroke="#fff8e8" strokeWidth="5" opacity=".75" />
      <path d="M128 110c-8-21 15-38 31-16 8-26 43-17 38 7 23-18 44 3 32 23" fill="#f2bd55" stroke="#102a3a" strokeWidth="5" strokeLinejoin="round" />
      <path d="M137 196c12-13 25-13 38 0s26 13 39 0 24-13 36 0" fill="none" stroke="#78d5d7" strokeWidth="7" strokeLinecap="round" />
      <circle cx="126" cy="265" r="8" fill="#102a3a" /><circle cx="244" cy="265" r="8" fill="#102a3a" />
    </svg>
  );
}

export default function SignIn() {
  const { setIsLoggedIn, setUserName, setUserKerb } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = new FormData(event.currentTarget);
      const response = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kerb: fields.get("kerb"), password: fields.get("password"), remember: fields.get("remember") === "on" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.msg ?? "Could not log in.");
      setIsLoggedIn(true);
      setUserName(data.name ?? "");
      setUserKerb(data.kerb ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reach SideQuest. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="SideQuest home">
          <span className="landing-brand-mark" aria-hidden="true">→</span><span>sidequest</span>
        </a>
        <button type="button" className="landing-header-login" onClick={() => setShowLogin(true)}>Log in</button>
      </header>
      <BicycleIllustration />
      <LaundryIllustration />
      <div className="landing-spark landing-spark-one" aria-hidden="true">✳</div>
      <div className="landing-spark landing-spark-two" aria-hidden="true">✦</div>

      <section className="landing-content" aria-labelledby="landing-title">
        <h1 id="landing-title">Get paid to<br className="landing-mobile-break" /> side quest.</h1>
        <button className="landing-login" type="button" onClick={() => setShowLogin(true)}>
          SideQuest account
        </button>
      </section>
      {showLogin && <div className="landing-login-backdrop">
        <section role="dialog" aria-modal="true" aria-labelledby="login-title" className="landing-login-dialog">
          <button type="button" className="landing-dialog-close" aria-label="Close login" onClick={() => setShowLogin(false)}>×</button>
          <p className="landing-dialog-eyebrow">SIDEQUEST ACCOUNT</p>
          <h2 id="login-title">Welcome back</h2>
          <p className="landing-dialog-copy">Log in with your SideQuest username and password.</p>
          <p className="text-xs leading-5 text-amber-800">Accounts are local to SideQuest. Entering a Kerberos username does not verify MIT or university affiliation.</p>
          <form onSubmit={passwordLogin} className="landing-login-form">
            <label>Username<input name="kerb" autoComplete="username" required maxLength={64} /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
            <label className="landing-remember"><input type="checkbox" name="remember" /> Keep me signed in for 30 days</label>
            {error && <p role="alert" className="landing-error">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
          </form>
        </section>
      </div>}
      <div className="landing-ground" aria-hidden="true" />
      <footer className="landing-footer">
        <nav aria-label="Footer" className="landing-footer-links">
          <a href="#terms">Terms of condition</a><span aria-hidden="true">·</span>
          <a href="#help">Help</a><span aria-hidden="true">·</span>
          <a href="#faq">FAQ</a>
        </nav>
      </footer>
    </main>
  );
}
