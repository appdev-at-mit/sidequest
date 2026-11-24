import { useEffect, useState } from "react";

export default function QuestCountdown({ expiresAt }: { expiresAt?: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return <p className={`text-xs font-semibold ${remaining < 3_600_000 ? "text-amber-700" : "text-slate-500"}`} aria-live="off">
    {remaining === 0 ? "Quest expired" : `Expires in ${hours}h ${minutes}m ${seconds}s`}
  </p>;
}
