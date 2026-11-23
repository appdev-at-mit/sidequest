import { useEffect, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import Icon from "./Icon";
import { CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";

type Props = { onClose: () => void; onPosted: () => void };

const inputClass = "mt-1 block w-full rounded-lg border border-[#BED8D4] bg-white p-2.5";

export default function PostRequestDialog({ onClose, onPosted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [location, setLocation] = useState<L.LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (!mapElement.current) return () => element?.close();

    const picker = L.map(mapElement.current).setView(CAMBRIDGE_CENTER, 16);
    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(picker);
    picker.on("click", (event: L.LeafletMouseEvent) => setLocation(event.latlng));
    map.current = picker;
    return () => {
      picker.remove();
      map.current = null;
      element?.close();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !location) return;
    const marker = L.circleMarker(location, {
      radius: 8, color: "white", weight: 3, fillColor: "#08679e", fillOpacity: 1,
      interactive: false,
    }).addTo(map.current);
    return () => { marker.remove(); };
  }, [location]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const fields = new FormData(event.currentTarget);
    const start = new Date(String(fields.get("start")));
    const end = new Date(String(fields.get("end")));
    if (!(end > start)) {
      setError("Choose a deadline after the start time.");
      return;
    }
    if (!location) {
      setError("Choose a spot on the map for your request.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/post-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: String(fields.get("description")).trim(),
          pay: Number(fields.get("pay")),
          start: start.toISOString(),
          end: end.toISOString(),
          lat: location.lat,
          lng: location.lng,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.msg ?? "Could not post the request. Try again.");
        return;
      }
      onPosted();
    } catch {
      setError("Could not reach SideQuest. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="post-request-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-5 text-[#102A3A] shadow-xl backdrop:bg-[#102A3A]/50 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 id="post-request-title" className="text-2xl font-extrabold">Post a request</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close post request" className="rounded-md p-2 hover:bg-[#BED8D4]/40">
          <Icon name="x" size={20} />
        </button>
      </div>
      <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
        <label className="text-sm font-semibold">
          What do you need help with?
          <textarea name="description" className={inputClass} rows={2} maxLength={1000} required />
        </label>
        <label className="text-sm font-semibold">
          Payout ($)
          <input name="pay" className={inputClass} type="number" min="0.01" step="0.01" required />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold">
            Starts at
            <input name="start" className={inputClass} type="datetime-local" required />
          </label>
          <label className="min-w-0 text-sm font-semibold">
            Deadline
            <input name="end" className={inputClass} type="datetime-local" required />
          </label>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold" id="request-location-label">Task location</p>
          <div ref={mapElement} role="region" aria-labelledby="request-location-label"
            className="isolate h-44 overflow-hidden rounded-lg border border-[#BED8D4]" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <p role="status">{location ? "Location selected" : "Click the map to place a pin."}</p>
            <button type="button" className="font-bold text-[#08679e] underline"
              onClick={() => { if (map.current) setLocation(map.current.getCenter()); }}>
              Pin map center
            </button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-[#08679e] p-3 text-sm font-bold text-white disabled:opacity-60">
          {busy ? "Posting…" : "Post request"}
        </button>
      </form>
    </dialog>
  );
}
