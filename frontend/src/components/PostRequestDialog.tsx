import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Icon from "./Icon";
import AddressLookup, { type GeocodedAddress } from "./AddressLookup";
import { addressPolicyError } from "../data/addressPolicy";

type Props = { onClose: () => void; onPosted: () => void };
type PostingLimits = { availableCents: number };
const inputClass = "mt-1 block w-full rounded-lg border border-[#BED8D4] bg-white p-2.5";
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const displayHour = hour % 12 || 12;
  const period = hour < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${minute} ${period}` };
});

export default function PostRequestDialog({ onClose, onPosted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pickup, setPickup] = useState<GeocodedAddress | null>(null);
  const [dropoff, setDropoff] = useState<GeocodedAddress | null>(null);
  const [limits, setLimits] = useState<PostingLimits | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoData, setPhotoData] = useState("");
  const [photoName, setPhotoName] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/posting-limits", { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(setLimits)
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load your reward balance. Reopen this form to retry.");
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !limits) return;
    const fields = new FormData(event.currentTarget);
    const pay = Number(fields.get("pay"));
    if (pay > limits.availableCents / 100) {
      setError("This reward exceeds your available balance.");
      return;
    }
    const start = new Date(`${fields.get("startDate")}T${fields.get("startTime")}`);
    const end = new Date(`${fields.get("endDate")}T${fields.get("endTime")}`);
    if (!(end > start)) { setError("Choose a deadline after the start time."); return; }
    if (!pickup || !dropoff) { setError("Search for and select valid pickup and drop-off addresses."); return; }
    const policyError = addressPolicyError(pickup.address) || addressPolicyError(dropoff.address);
    if (policyError) { setError(policyError); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/post-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: String(fields.get("description")).trim(), pay,
          category: String(fields.get("category")),
          start: start.toISOString(), end: end.toISOString(), lat: pickup.lat, lng: pickup.lng,
          pickup: pickup.address, dropoff: dropoff.address, imageUrl: photoData,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.msg ?? "Could not post the request. Try again."); return;
      }
      onPosted();
    } catch { setError("Could not reach SideQuest. Try again."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-labelledby="post-request-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-5 text-[#102A3A] shadow-xl backdrop:bg-[#102A3A]/50 sm:p-7">
    <div className="mb-5 flex items-center justify-between gap-4">
      <h2 id="post-request-title" className="text-2xl font-extrabold">Post a quest</h2>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Close post request" className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={20} /></button>
    </div>
    <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
      <label className="text-sm font-semibold">What do you need help with?<textarea name="description" className={inputClass} rows={2} maxLength={150} required /><span className="mt-1 block text-xs font-normal text-slate-500">Up to 150 characters</span></label>
      <label className="text-sm font-semibold">Category<select name="category" className={inputClass} defaultValue="" required><option value="" disabled>Select a category</option><option>Delivery</option><option>Moving</option><option>Home Help</option><option>Tech</option><option>Academic</option></select></label>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Photo (optional)</span>
          <button type="button" onClick={() => photoInput.current?.click()} className="rounded-lg border border-[#BED8D4] bg-white px-4 py-2.5 text-sm font-bold text-[#08679e]">Upload photo</button>
          {photoName && <><span className="max-w-56 truncate text-sm text-slate-600">{photoName}</span><button type="button" onClick={() => { setPhotoData(""); setPhotoName(""); if (photoInput.current) photoInput.current.value = ""; }} className="text-sm font-semibold text-slate-600 underline">Remove</button></>}
        </div>
        <input ref={photoInput} type="file" accept="image/*" className="sr-only" aria-label="Choose a photo from your device" onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          if (!file.type.startsWith("image/")) { setError("Choose an image file."); event.currentTarget.value = ""; return; }
          if (file.size > 5 * 1024 * 1024) { setError("Choose an image under 5 MB."); event.currentTarget.value = ""; return; }
          const reader = new FileReader();
          reader.onload = () => { setPhotoData(typeof reader.result === "string" ? reader.result : ""); setPhotoName(file.name); setError(""); };
          reader.onerror = () => setError("Could not read that image. Try another file.");
          reader.readAsDataURL(file);
        }} />
        {photoData && <img src={photoData} alt="Selected quest photo preview" className="mt-2 max-h-32 rounded-lg object-cover" />}
      </div>
      <label className="text-sm font-semibold">Reward<input name="pay" className={inputClass} type="number" min="0.01" step="0.01" required /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        {([{ label: "Starts at", dateName: "startDate", timeName: "startTime" }, { label: "Deadline", dateName: "endDate", timeName: "endTime" }] as const).map(field => <fieldset key={field.dateName} className="min-w-0">
          <legend className="text-sm font-semibold">{field.label}</legend>
          <label className="mt-1 block text-xs font-medium text-slate-600">Date<input name={field.dateName} className={inputClass} type="date" onFocus={event => event.currentTarget.showPicker?.()} required /></label>
          <label className="mt-2 block text-xs font-medium text-slate-600">Time<select name={field.timeName} className={inputClass} defaultValue="" required><option value="" disabled>Select a time</option>{timeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </fieldset>)}
      </div>
      <AddressLookup id="request-dropoff" label="Drop-off address" placeholder="Search a street address or building" initialValue={localStorage.getItem("sidequest-default-dropoff") ?? ""} onSelect={setDropoff} />
      <AddressLookup id="request-pickup" label="Pickup address" placeholder="Search where the task begins" onSelect={setPickup} />
      <p className="-mt-2 text-xs text-slate-500">Choose a publicly accessible address. Residence hall meetups should be at the lobby or front desk.</p>
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={busy || !limits} className="rounded-lg bg-[#08679e] p-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Posting…" : "Post quest"}</button>
    </form>
  </dialog>;
}
