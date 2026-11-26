import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Icon from "./Icon";
import AddressLookup, { type GeocodedAddress } from "./AddressLookup";
import { addressPolicyError } from "../data/addressPolicy";
import { inputSchemas, MAX_REWARD_CENTS } from "../data/validation";
import "./PostRequestDialog.css";

type Props = { onClose: () => void; onPosted: () => void };
const inputClass = "mt-1 block w-full rounded-lg border border-[#BED8D4] bg-white p-2.5";
const paymentMethods = ["Cash", "PayPal", "Venmo", "Cash App", "Zelle", "Other"];
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const displayHour = hour % 12 || 12;
  const period = hour < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${minute} ${period}` };
});

function readDefaultDropoff() {
  const fallback = localStorage.getItem("sidequest-default-dropoff") ?? "";
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("sidequest-saved-dropoffs") ?? "[]");
    const selectedId = localStorage.getItem("sidequest-selected-dropoff");
    if (Array.isArray(saved) && selectedId) {
      const item = saved.find(value => value?.id === selectedId && typeof value.address === "string");
      if (item) {
        const address: GeocodedAddress | null = Number.isFinite(item.lat) && Number.isFinite(item.lng)
          ? { address: item.address, lat: item.lat, lng: item.lng, provider: item.provider ?? "photon", providerPlaceId: item.providerPlaceId ?? "", buildingName: item.buildingName, roomNumber: item.roomNumber }
          : null;
        return { text: item.address as string, address, roomNumber: typeof item.roomNumber === "string" ? item.roomNumber : "" };
      }
    }
  } catch { /* Legacy plain-text preference is resolved by the server below. */ }
  return { text: fallback, address: null as GeocodedAddress | null, roomNumber: "" };
}

function toGeocodedAddress(value: Record<string, unknown>): GeocodedAddress | null {
  const address = typeof value.formattedAddress === "string" ? value.formattedAddress : typeof value.address === "string" ? value.address : "";
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { address, lat, lng, provider: typeof value.provider === "string" ? value.provider : "photon", providerPlaceId: typeof value.providerPlaceId === "string" ? value.providerPlaceId : "", buildingName: typeof value.buildingName === "string" ? value.buildingName : undefined, roomNumber: typeof value.roomNumber === "string" ? value.roomNumber : undefined };
}

export default function PostRequestDialog({ onClose, onPosted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dropoffPrefill] = useState(readDefaultDropoff);
  const [pickup, setPickup] = useState<GeocodedAddress | null>(null);
  const [dropoff, setDropoff] = useState<GeocodedAddress | null>(dropoffPrefill.address);
  const [pickupRoom, setPickupRoom] = useState("");
  const [dropoffRoom, setDropoffRoom] = useState(dropoffPrefill.roomNumber);
  const [resolvedDropoffPrefill, setResolvedDropoffPrefill] = useState<GeocodedAddress | null>(null);
  const [legacyDropoffSuggestions, setLegacyDropoffSuggestions] = useState<GeocodedAddress[]>([]);
  const submissionKey = useRef(crypto.randomUUID());
  const dropoffEdited = useRef(false);
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
    if (!dropoffPrefill.text || dropoffPrefill.address) return;
    const controller = new AbortController();
    fetch("/api/resolve-address", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ address: dropoffPrefill.text, roomNumber: dropoffPrefill.roomNumber }) })
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted || dropoffEdited.current) return;
        if (response.status === 409 && body?.needsConfirmation && Array.isArray(body.suggestions)) {
          setLegacyDropoffSuggestions(body.suggestions.map(toGeocodedAddress).filter((address: GeocodedAddress | null): address is GeocodedAddress => Boolean(address)));
          return;
        }
        if (!response.ok) throw new Error(body?.msg ?? "Select the saved drop-off location from the suggestions to confirm it.");
        const address = body?.data && toGeocodedAddress(body.data);
        if (address) { address.roomNumber = dropoffPrefill.roomNumber || undefined; setResolvedDropoffPrefill(address); setDropoff(address); }
      })
      .catch(reason => { if (!controller.signal.aborted && !dropoffEdited.current) setError(reason instanceof Error ? reason.message : "Select a saved address suggestion to confirm its location."); });
    return () => controller.abort();
  }, [dropoffPrefill]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const pay = Number(fields.get("pay"));
    if (!Number.isFinite(pay) || pay < 3 || !inputSchemas.rewardCents(Math.round(pay * 100))) { setError(`The reward must be between $3.00 and $${(MAX_REWARD_CENTS / 100).toFixed(2)}.`); return; }
    if (!inputSchemas.boundedText(String(fields.get("description") ?? ""), 150)) { setError("Enter a quest description under 150 characters."); return; }
    const start = new Date();
    const end = new Date(`${fields.get("endDate")}T${fields.get("endTime")}`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
      || !inputSchemas.isoDateTime(start.toISOString()) || !inputSchemas.isoDateTime(end.toISOString())
      || !(end > start)) { setError("Choose a future deadline."); return; }
    if (!pickup || !dropoff) { setError("Search for and select valid pickup and drop-off addresses."); return; }
    const pickupLocation = { ...pickup, roomNumber: pickupRoom.trim() || undefined };
    const dropoffLocation = { ...dropoff, roomNumber: dropoffRoom.trim() || undefined };
    if (!inputSchemas.roomNumber(pickupRoom.trim()) || !inputSchemas.roomNumber(dropoffRoom.trim())) { setError("Enter a valid room number using letters, numbers, spaces, #, /, or hyphens."); return; }
    if (!inputSchemas.coordinates(pickup.lat, pickup.lng) || !inputSchemas.coordinates(dropoff.lat, dropoff.lng)) { setError("Choose valid pickup and drop-off locations from the suggestions."); return; }
    const pickupAddress = [pickup.address, pickupRoom.trim() ? `Room ${pickupRoom.trim()}` : ""].filter(Boolean).join(", ");
    const dropoffAddress = [dropoff.address, dropoffRoom.trim() ? `Room ${dropoffRoom.trim()}` : ""].filter(Boolean).join(", ");
    const policyError = addressPolicyError(pickupAddress) || addressPolicyError(dropoffAddress);
    if (policyError) { setError(policyError); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/post-request", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submissionKey.current },
        body: JSON.stringify({
          description: String(fields.get("description")).trim(), pay,
          category: String(fields.get("category")),
          paymentMethod: String(fields.get("paymentMethod")),
          start: start.toISOString(), end: end.toISOString(), lat: pickup.lat, lng: pickup.lng,
          pickup: pickupAddress, dropoff: dropoffAddress, pickupLocation, dropoffLocation, imageUrl: photoData,
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
    onCancel={event => event.preventDefault()}
    className="post-request-dialog m-auto max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-5 text-[#102A3A] shadow-xl backdrop:bg-[#102A3A]/50 sm:p-7">
    <div className="mb-5 flex items-center justify-between gap-4">
      <h2 id="post-request-title" className="text-2xl font-extrabold">Post a quest</h2>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Close post request" className="rounded-md p-2 hover:bg-[#BED8D4]/40"><Icon name="x" size={20} /></button>
    </div>
    <form onSubmit={submit} onChange={() => { if (!busy) submissionKey.current = crypto.randomUUID(); }} className="grid gap-4" aria-busy={busy}>
      <label className="text-sm font-semibold">What do you need help with?<textarea name="description" className={`${inputClass} resize-none`} rows={2} maxLength={150} required /><span className="mt-1 block text-xs font-normal text-slate-500">Up to 150 characters</span></label>
      <label className="text-sm font-semibold">Category<select name="category" className={inputClass} defaultValue="" required><option value="" disabled>Select a category</option><option>Delivery</option><option>Moving</option><option>Home Help</option><option>Tech</option><option>Academic</option></select></label>
      <label className="text-sm font-semibold">Payment method<select name="paymentMethod" className={inputClass} defaultValue="Cash" required>{paymentMethods.map(method => <option key={method}>{method}</option>)}</select></label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="min-w-0">
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
        <div className="flex items-center gap-2"><label htmlFor="quest-reward" className="text-sm font-semibold">Reward</label><input id="quest-reward" name="pay" className="block w-24 rounded-lg border border-[#BED8D4] bg-white p-2.5" type="number" min="3" max={(MAX_REWARD_CENTS / 100).toFixed(2)} step="0.01" required /></div>
      </div>
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold">Deadline</legend>
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-600">Date<input name="endDate" className={inputClass} type="date" onFocus={event => event.currentTarget.showPicker?.()} required /></label>
          <label className="block text-xs font-medium text-slate-600">Time<select name="endTime" className={inputClass} defaultValue="" required><option value="" disabled>Select a time</option>{timeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </fieldset>
      <div className="grid gap-2">
        <AddressLookup id="request-dropoff" label="Drop-off address" placeholder="Street address or MIT building (e.g. W20 or 7 and 10)" initialValue={dropoffPrefill.text} initialAddress={resolvedDropoffPrefill ?? dropoffPrefill.address} initialSuggestions={legacyDropoffSuggestions} onSelect={address => { if (!address) dropoffEdited.current = true; else { dropoffEdited.current = true; setError(""); } setDropoff(address); }} />
        <label htmlFor="request-dropoff-room" className="text-xs font-medium text-slate-600">Room number (optional)<input id="request-dropoff-room" value={dropoffRoom} onChange={event => setDropoffRoom(event.target.value)} className="mt-1 block w-full rounded-lg border border-[#BED8D4] bg-white p-2.5 text-sm" maxLength={30} placeholder="e.g. 407" /></label>
      </div>
      <div className="grid gap-2">
        <AddressLookup id="request-pickup" label="Pickup address" placeholder="Street address or MIT building (e.g. W20 or 7 and 10)" onSelect={setPickup} />
        <label htmlFor="request-pickup-room" className="text-xs font-medium text-slate-600">Room number (optional)<input id="request-pickup-room" value={pickupRoom} onChange={event => setPickupRoom(event.target.value)} className="mt-1 block w-full rounded-lg border border-[#BED8D4] bg-white p-2.5 text-sm" maxLength={30} placeholder="e.g. 407" /></label>
      </div>
      <p className="-mt-2 text-xs text-slate-500">Choose a publicly accessible address. Residence hall meetups should be at the lobby or front desk.</p>
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      <p className="text-xs leading-5 text-slate-500">SideQuest records quest agreements and payment confirmations but does not process, guarantee, or insure external payments.</p>
      <button type="submit" disabled={busy} className="rounded-lg bg-[#08679e] p-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Posting…" : "Post quest"}</button>
    </form>
  </dialog>;
}
