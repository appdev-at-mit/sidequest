import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import Icon from "./Icon";
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";
import { addressPolicyError, isWithinMITCampus, resolveMITBuildingQuery } from "../data/addressPolicy";
import "./DropoffPicker.css";

type BuildingType = "House" | "Apartment" | "Office" | "Hotel" | "Other";
type SavedAddress = { id: string; address: string; label: string; instructions: string; buildingType: BuildingType; lat: number; lng: number };
type GeoResult = { display_name: string; lat: string; lon: string };
type Props = { onClose: () => void; onSelectAddress: (address: string) => void };
const STORAGE_KEY = "sidequest-saved-dropoffs";
const BUILDING_TYPES: BuildingType[] = ["House", "Apartment", "Office", "Hotel", "Other"];

function readAddresses(): SavedAddress[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is SavedAddress => typeof item?.id === "string" && typeof item?.address === "string" && typeof item?.lat === "number" && typeof item?.lng === "number").map(item => ({ buildingType: "Other", instructions: "", label: "Home", ...item })) : [];
  } catch { return []; }
}

export default function DropoffPicker({ onClose, onSelectAddress }: Props) {
  const [addresses, setAddresses] = useState(readAddresses);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("sidequest-selected-dropoff") ?? "");
  const [detail, setDetail] = useState<SavedAddress | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SavedAddress[]>([]);
  const [busy, setBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const value = query.trim();
    if (detail || value.length < 3 || addressPolicyError(value)) { setMatches([]); setSuggestionsLoading(false); return; }
    const building = resolveMITBuildingQuery(value);
    if (building.error) { setMatches([]); setError(building.error); setSuggestionsLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(building.query)}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Search unavailable");
        const results: GeoResult[] = await response.json();
        const suggestions = results.map(result => ({
          id: crypto.randomUUID(), address: result.display_name, label: "Home", instructions: "",
          buildingType: "Other" as BuildingType, lat: Number(result.lat), lng: Number(result.lon),
        })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && (!building.isBuilding || isWithinMITCampus(item.lat, item.lng)));
        setMatches(suggestions);
      } catch { if (!controller.signal.aborted) setMatches([]); }
      finally { if (!controller.signal.aborted) setSuggestionsLoading(false); }
    }, 1000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, detail]);

  useEffect(() => {
    if (!detail || !preview.current) return;
    const map = L.map(preview.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([detail.lat, detail.lng], 18);
    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map);
    L.circleMarker([detail.lat, detail.lng], { radius: 8, color: "white", weight: 3, fillColor: "#08679e", fillOpacity: 1 }).addTo(map);
    return () => { map.remove(); };
  }, [detail]);

  function persist(next: SavedAddress[]) {
    setAddresses(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function select(address: SavedAddress) {
    const issue = addressPolicyError(address.address, address.instructions);
    if (issue) { setError(issue); return; }
    setSelectedId(address.id);
    localStorage.setItem("sidequest-selected-dropoff", address.id);
    localStorage.setItem("sidequest-default-dropoff", address.address);
    onSelectAddress(address.address);
    setError("");
  }

  function openEditor(address: SavedAddress) {
    setDetail({ ...address });
    setError("");
  }

  function saveDetail() {
    if (!detail) return;
    const issue = addressPolicyError(detail.address, detail.instructions);
    if (issue) { setError(issue); return; }
    const exists = addresses.some(address => address.id === detail.id);
    persist(exists ? addresses.map(address => address.id === detail.id ? detail : address) : [...addresses, detail]);
    setSelectedId(detail.id);
    localStorage.setItem("sidequest-selected-dropoff", detail.id);
    localStorage.setItem("sidequest-default-dropoff", detail.address);
    onSelectAddress(detail.address);
    setDetail(null);
    setError("");
  }

  function removeDetail() {
    if (!detail) return;
    const next = addresses.filter(address => address.id !== detail.id);
    if (next.length !== addresses.length) persist(next);
    if (selectedId === detail.id) {
      setSelectedId("");
      localStorage.removeItem("sidequest-selected-dropoff");
      localStorage.removeItem("sidequest-default-dropoff");
      onSelectAddress("Current location");
    }
    setDetail(null);
    setError("");
  }

  async function findAddress(text = query) {
    const value = text.trim();
    if (!value || busy) return;
    const building = resolveMITBuildingQuery(value);
    const issue = building.error || addressPolicyError(value);
    if (issue) { setError(issue); return; }
    setBusy(true); setError(""); setMatches([]);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(building.query)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Address search is temporarily unavailable.");
      const results: GeoResult[] = await response.json();
      const mapped = results.map(result => ({ id: crypto.randomUUID(), address: result.display_name, label: "Home", instructions: "", buildingType: "Other" as BuildingType, lat: Number(result.lat), lng: Number(result.lon) })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && (!building.isBuilding || isWithinMITCampus(item.lat, item.lng)));
      if (!mapped.length) throw new Error(building.isBuilding ? "That building number was not found within MIT." : "No matching address found. Try a street address or building name.");
      setMatches(mapped);
      if (mapped.length === 1) openEditor(mapped[0]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not search for that address."); }
    finally { setBusy(false); }
  }

  function useCurrentLocation() {
    if (locationBusy) return;
    if (!navigator.geolocation) { setError("This browser does not support location sharing."); return; }
    setError("");
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const { latitude, longitude } = position.coords;
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Could not find an address for your current location.");
        const result: GeoResult = await response.json();
        const address: SavedAddress = { id: crypto.randomUUID(), address: result.display_name, label: "Current location", instructions: "", buildingType: "Other", lat: latitude, lng: longitude };
        setQuery(result.display_name);
        openEditor(address);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not find your current address."); }
      finally { setLocationBusy(false); }
    }, reason => {
      setLocationBusy(false);
      if (reason.code === reason.TIMEOUT) { setError(""); return; }
      setError(reason.code === reason.PERMISSION_DENIED
        ? "Location permission was denied. Allow location access in your browser settings, or search for an address."
        : "Your device location is unavailable. Turn on Location Services or search for an address.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#102A3A]/35 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="dropoff-title" className="dropoff-drawer flex h-[min(760px,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#BED8D4] bg-[#F7F9F9] text-[#102A3A] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[#BED8D4] px-5 py-4">
        <div className="flex items-center gap-3">{detail && <button type="button" onClick={() => { setDetail(null); setError(""); }} aria-label="Back to saved addresses" className="rounded-[5px] p-2 hover:bg-[#BED8D4]/40"><Icon name="arrow" /></button>}<h2 id="dropoff-title" className="text-xl font-extrabold">{detail ? "Address details" : "Drop-off location"}</h2></div>
        <button onClick={onClose} aria-label="Close locations" className="rounded-[5px] p-2 hover:bg-[#BED8D4]/40"><Icon name="x" /></button>
      </header>

      {detail ? <div className="flex-1 overflow-y-auto p-5">
        <div ref={preview} className="h-40 overflow-hidden rounded-[5px] border border-[#BED8D4] bg-[#E6EEEE]" />
        <p className="mt-4 text-sm font-semibold">{detail.address}</p>
        <label className="mt-5 block text-sm font-semibold">Building type
          <select value={detail.buildingType} onChange={event => setDetail({ ...detail, buildingType: event.target.value as BuildingType })} className="mt-1 w-full rounded-[5px] border border-[#BED8D4] bg-white p-3">
            {BUILDING_TYPES.map(type => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-sm font-semibold">Instructions for delivery person
          <textarea value={detail.instructions} onChange={event => setDetail({ ...detail, instructions: event.target.value })} rows={4} className="mt-1 w-full rounded-[5px] border border-[#BED8D4] bg-white p-3 text-sm" placeholder="Entrance, lobby, or where to leave the item" />
        </label>
        <label className="mt-4 block text-sm font-semibold">Address label
          <input value={detail.label} onChange={event => setDetail({ ...detail, label: event.target.value })} className="mt-1 w-full rounded-[5px] border border-[#BED8D4] bg-white p-3" placeholder="Home, work, dorm…" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div> : <div className="flex flex-1 flex-col overflow-y-auto p-5">
        <form onSubmit={event => { event.preventDefault(); void findAddress(); }} className="rounded-[5px] border border-[#BED8D4] bg-white p-1.5 focus-within:border-[#2081C3]">
          <div className="flex gap-2">
            <input value={query} onChange={event => { setQuery(event.target.value); setMatches([]); setError(""); }} placeholder="Search an address or building" className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none" />
            <button disabled={busy || suggestionsLoading || !query.trim()} className="flex min-w-[92px] items-center justify-center gap-2 rounded-[4px] bg-[#08679e] px-3 text-sm font-bold text-white disabled:opacity-60">{(busy || suggestionsLoading) && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}{busy || suggestionsLoading ? "Finding…" : "Search"}</button>
          </div>
        </form>
        {suggestionsLoading && <p className="mt-2 text-xs text-slate-500">Searching addresses…</p>}
        {matches.length > 0 && <div className="mt-1 max-h-40 overflow-y-auto rounded-[5px] border border-[#BED8D4] bg-white">{matches.map(match => <button key={`${match.lat}-${match.lng}`} onClick={() => openEditor(match)} className="block w-full border-b border-[#BED8D4]/60 p-3 text-left text-sm last:border-0 hover:bg-[#E8F2F1]">{match.address}</button>)}</div>}
        <button type="button" onClick={useCurrentLocation} disabled={locationBusy} className="mt-3 flex w-full items-center gap-2 py-1 text-left text-sm font-bold text-[#08679e] disabled:cursor-wait"><Icon name="location" size={18} />Use my current location{locationBusy && <span role="status" aria-label="Finding your location" className="ml-1 h-4 w-4 animate-spin rounded-full border-2 border-[#08679e] border-t-transparent" />}</button>
        {!suggestionsLoading && query.trim().length >= 3 && !matches.length && !error && <p className="mt-2 text-xs text-slate-500">Search for a verified address to see matches.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {addresses.length ? <div className="space-y-2">{addresses.map(address => <article key={address.id} className={`rounded-[5px] border bg-white p-3 ${selectedId === address.id ? "border-[#2081C3]" : "border-[#BED8D4]"}`}>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => select(address)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Icon name="location" size={19} /><span className="min-w-0"><span className="block font-bold">{address.label || address.buildingType}</span><span className="block truncate text-xs text-slate-500">{address.address}</span></span></button>
            <button type="button" onClick={() => openEditor(address)} aria-label={`Edit ${address.label || "address"}`} className="rounded-[5px] p-2 text-[#08679e] hover:bg-[#BED8D4]/40"><Icon name="edit" size={18} /></button>
          </div>
        </article>)}</div> : <div className="flex flex-1 items-center justify-center"><p className="max-w-xs text-center text-sm text-slate-600">Add an address to save a drop-off location.</p></div>}
      </div>}

      <footer className="border-t border-[#BED8D4] bg-white p-5">
        <div className="flex gap-2">
          {detail && <button onClick={removeDetail} className="flex-1 rounded-[5px] border border-red-200 p-3 font-bold text-red-700 hover:bg-red-50">Remove</button>}
          {detail ? <button onClick={saveDetail} className="flex-1 rounded-[5px] bg-[#08679e] p-3 font-bold text-white">Save</button> : <button onClick={onClose} className="w-full rounded-[5px] bg-[#08679e] p-3 font-bold text-white">Done</button>}
        </div>
      </footer>
    </section>
  </div>;
}
