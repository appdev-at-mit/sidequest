import { apiFetch } from "../api";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import L from "leaflet";
import Icon from "./Icon";
import useDismissible from "../hooks/useDismissible";
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";
import { addressPolicyError, isMatchingMITBuilding, isWithinMITCampus, resolveMITBuildingQuery } from "../data/addressPolicy";
import "./DropoffPicker.css";

type BuildingType = "House" | "Apartment" | "Office" | "Hotel" | "Other";
export type SavedAddress = { id: string; address: string; label: string; instructions: string; buildingType: BuildingType; lat?: number; lng?: number; provider?: string; providerPlaceId?: string; buildingName?: string; roomNumber?: string; suggestionTitle?: string; suggestionSubtitle?: string };
type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; ref?: string; osm_value?: string; housenumber?: string; street?: string; district?: string; city?: string; county?: string; state?: string; postcode?: string; country?: string; osm_id?: number; osm_type?: string } };
type ReverseGeoResult = { display_name?: string; lat?: string; lon?: string };
type Props = { onClose: () => void; onSelectAddress: (address: SavedAddress | null) => void };
const STORAGE_KEY = "sidequest-saved-dropoffs";
const BUILDING_TYPES: BuildingType[] = ["House", "Apartment", "Office", "Hotel", "Other"];

function readAddresses(): SavedAddress[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is SavedAddress => typeof item?.id === "string" && typeof item?.address === "string").map(item => ({ buildingType: "Other", instructions: "", label: "Home", ...item })) : [];
  } catch { return []; }
}

export default function DropoffPicker({ onClose, onSelectAddress }: Props) {
  const [addresses, setAddresses] = useState(readAddresses);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("sidequest-selected-dropoff") ?? "");
  const [detail, setDetail] = useState<SavedAddress | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SavedAddress[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [locationBusy, setLocationBusy] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const searchArea = useDismissible<HTMLDivElement>(suggestionsOpen, () => { setSuggestionsOpen(false); setActiveSuggestion(-1); }, "address-suggestions");
  const searchInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const value = query.trim();
    const requestId = ++requestVersion.current;
    if (detail || !suggestionsOpen || value.length < 2) { setMatches([]); setSuggestionsLoading(false); setError(""); return; }
    const building = resolveMITBuildingQuery(value);
    const issue = building.error || addressPolicyError(value);
    if (issue) { setMatches([]); setError(issue); setSuggestionsLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q: building.query, limit: "5", lang: "en", lat: "42.3585", lon: "-71.0935", zoom: "17", location_bias_scale: "0.1" });
        const response = await apiFetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/geo+json, application/json" } });
        if (!response.ok) throw new Error("Search unavailable");
        const payload: { features?: PhotonFeature[] } = await response.json();
        const buildingFeatures = building.isBuilding
          ? (payload.features ?? []).filter(feature => [feature.properties?.name, feature.properties?.ref, feature.properties?.osm_value].some(name => isMatchingMITBuilding(name, value)))
          : payload.features ?? [];
        const suggestions = buildingFeatures.map(feature => {
          const properties = feature.properties ?? {};
          const [lng, lat] = feature.geometry?.coordinates ?? [NaN, NaN];
          const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
          const details = [street, properties.district, properties.city, properties.county, properties.state, properties.postcode, properties.country].filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index).join(", ");
          const suggestionTitle = properties.name || street || details;
          const suggestionSubtitle = details || properties.country || "";
          const address = [suggestionTitle, suggestionSubtitle].filter(Boolean).join(", ");
          const providerPlaceId = properties.osm_type && properties.osm_id != null ? `${properties.osm_type}/${properties.osm_id}` : "";
          return { id: crypto.randomUUID(), address, label: "Home", instructions: "", buildingType: "Other" as BuildingType, lat, lng, provider: "photon", providerPlaceId, ...(properties.name ? { buildingName: properties.name } : {}), suggestionTitle, suggestionSubtitle };
        }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && (!building.isBuilding || isWithinMITCampus(item.lat, item.lng)))
          .sort((a, b) => (a.lat - 42.3585) ** 2 + (a.lng + 71.0935) ** 2 - ((b.lat - 42.3585) ** 2 + (b.lng + 71.0935) ** 2));
        if (controller.signal.aborted || requestId !== requestVersion.current) return;
        setMatches(suggestions);
        setActiveSuggestion(-1);
        if (!suggestions.length) setError(building.isBuilding ? "That MIT building was not found. Check the building number or code." : "No matching address found. Try a street address or MIT building.");
      } catch (reason) { if (!controller.signal.aborted && requestId === requestVersion.current) { setMatches([]); setError(reason instanceof Error ? reason.message : "Could not find that address."); } }
      finally { if (!controller.signal.aborted && requestId === requestVersion.current) setSuggestionsLoading(false); }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, detail, suggestionsOpen]);

  useEffect(() => {
    if (!detail || !preview.current || typeof detail.lat !== "number" || typeof detail.lng !== "number") return;
    const map = L.map(preview.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([detail.lat, detail.lng], 18);
    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map);
    L.circleMarker([detail.lat, detail.lng], { radius: 8, color: "white", weight: 3, fillColor: "#08679e", fillOpacity: 1 }).addTo(map);
    return () => { map.remove(); };
  }, [detail]);

  function persist(next: SavedAddress[]) {
    setAddresses(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function select(address: SavedAddress) {
    if (!Number.isFinite(address.lat) || !Number.isFinite(address.lng)) {
      try {
        setSuggestionsLoading(true);
        const response = await apiFetch("/api/resolve-address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.address, roomNumber: address.roomNumber ?? "" }) });
        const body = await response.json().catch(() => null);
        if (response.status === 409 && body?.needsConfirmation) {
          const suggestions: SavedAddress[] = (body.suggestions ?? []).map((item: SavedAddress & { formattedAddress?: string }) => ({ ...address, ...item, address: item.formattedAddress ?? item.address, id: crypto.randomUUID(), suggestionTitle: item.buildingName || item.formattedAddress || item.address, suggestionSubtitle: item.formattedAddress ?? item.address }));
          setQuery(address.address);
          setMatches(suggestions);
          setSuggestionsOpen(true);
          setError("Choose the matching address to confirm its map location.");
          return;
        }
        if (!response.ok || !body?.data) throw new Error(body?.msg ?? "Could not resolve this saved address.");
        address = { ...address, address: body.data.formattedAddress, lat: body.data.lat, lng: body.data.lng, provider: body.data.provider, providerPlaceId: body.data.providerPlaceId, buildingName: body.data.buildingName };
        persist(addresses.map(item => item.id === address.id ? address : item));
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not resolve this saved address."); return; }
      finally { setSuggestionsLoading(false); }
    }
    const issue = addressPolicyError(address.address, address.instructions);
    if (issue) { setError(issue); return; }
    setSelectedId(address.id);
    localStorage.setItem("sidequest-selected-dropoff", address.id);
    localStorage.setItem("sidequest-default-dropoff", address.address);
    onSelectAddress(address);
    setError("");
  }

  function openEditor(address: SavedAddress) {
    setDetail({ ...address });
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setError("");
  }

  function saveDetail() {
    if (!detail) return;
    if (typeof detail.lat !== "number" || typeof detail.lng !== "number") { setError("Choose a suggested address to confirm its map location before saving."); return; }
    const issue = addressPolicyError(detail.address, detail.instructions);
    if (issue) { setError(issue); return; }
    const exists = addresses.some(address => address.id === detail.id);
    persist(exists ? addresses.map(address => address.id === detail.id ? detail : address) : [...addresses, detail]);
    setSelectedId(detail.id);
    localStorage.setItem("sidequest-selected-dropoff", detail.id);
    localStorage.setItem("sidequest-default-dropoff", detail.address);
    onSelectAddress(detail);
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
      onSelectAddress(null);
    }
    setDetail(null);
    setError("");
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveSuggestion(index => index < 0 ? 0 : Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setActiveSuggestion(index => index <= 0 ? matches.length - 1 : index - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length) openEditor(matches[activeSuggestion >= 0 ? activeSuggestion : 0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
    }
  }

  function clearQuery() {
    setQuery("");
    setMatches([]);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setError("");
    searchInput.current?.focus();
  }

  function useCurrentLocation() {
    if (locationBusy) return;
    if (!navigator.geolocation) { setError("This browser does not support location sharing."); return; }
    setError("");
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const { latitude, longitude } = position.coords;
        const response = await apiFetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Could not find an address for your current location.");
        const result: ReverseGeoResult = await response.json();
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

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#102A3A]/35 p-4" onMouseDown={event => { if (!detail && event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="dropoff-title" className="dropoff-drawer flex h-[min(760px,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#BED8D4] bg-[#F7F9F9] text-[#102A3A] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[#BED8D4] px-5 py-4">
        <div className="flex items-center gap-3">{detail && <button type="button" onClick={() => { setDetail(null); setError(""); }} aria-label="Back to saved addresses" className="rounded-[5px] p-2 hover:bg-[#BED8D4]/40"><Icon name="arrow" /></button>}<h2 id="dropoff-title" className="text-xl font-extrabold">{detail ? "Address details" : "Drop-off location"}</h2></div>
        <button onClick={onClose} aria-label="Close locations" className="rounded-[5px] p-2 hover:bg-[#BED8D4]/40"><Icon name="x" /></button>
      </header>

      {detail ? <div className="flex-1 overflow-y-auto p-5">
        <div ref={preview} className="h-40 overflow-hidden rounded-[5px] border border-[#BED8D4] bg-[#E6EEEE]" />
        <p className="mt-4 text-sm font-semibold">{detail.address}</p>
        <label className="mt-4 block text-sm font-semibold">Room number (optional)
          <input value={detail.roomNumber ?? ""} maxLength={30} onChange={event => setDetail({ ...detail, roomNumber: event.target.value })} className="mt-1 w-full rounded-[5px] border border-[#BED8D4] bg-white p-3" placeholder="e.g. 407" />
        </label>
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
        <div ref={searchArea} className="relative">
          <div role="search" className={`flex items-center gap-2 rounded-[5px] border border-[#BED8D4] bg-white p-1.5 focus-within:border-[#2081C3] ${suggestionsOpen && matches.length ? "rounded-b-none" : ""}`}>
            <Icon name="location" size={18} />
            <input ref={searchInput} value={query} onFocus={() => setSuggestionsOpen(query.trim().length >= 2)} onKeyDown={handleSearchKeyDown} onChange={event => { setQuery(event.target.value); setMatches([]); setActiveSuggestion(-1); setError(""); setSuggestionsOpen(true); }} placeholder="Search an address or building" className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap bg-transparent px-1.5 py-2 text-sm outline-none" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && matches.length > 0} aria-controls="dropoff-address-suggestions" aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? `dropoff-address-option-${activeSuggestion}` : undefined} />
            {suggestionsLoading && <span role="status" aria-label="Loading address suggestions" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#2081C3] border-t-transparent" />}
            {query && <button type="button" onClick={clearQuery} aria-label="Clear address search" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-[#EAF3F2]"><Icon name="x" size={17} /></button>}
          </div>
          {suggestionsOpen && matches.length > 0 && <ul id="dropoff-address-suggestions" role="listbox" aria-label="Address suggestions" className="absolute left-0 right-0 top-full z-40 -mt-px max-h-40 overflow-y-auto rounded-b-[5px] border border-[#BED8D4] bg-white shadow-lg">{matches.map((match, index) => <li key={`${match.lat}-${match.lng}`} role="presentation" className="border-b border-[#BED8D4]/60 last:border-b-0"><button id={`dropoff-address-option-${index}`} type="button" role="option" aria-selected={activeSuggestion === index} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => openEditor(match)} className={`block w-full p-3 text-left text-sm ${activeSuggestion === index ? "bg-[#EAF3F2]" : "hover:bg-[#EAF3F2]"}`}><span className="block font-semibold">{match.suggestionTitle ?? match.address}</span>{match.suggestionSubtitle && <span className="mt-1 block text-xs text-slate-500">{match.suggestionSubtitle}</span>}</button></li>)}</ul>}
        </div>
        <button type="button" onClick={useCurrentLocation} disabled={locationBusy} className="mt-3 flex w-full items-center gap-2 py-1 text-left text-sm font-bold text-[#08679e] disabled:cursor-wait"><Icon name="location" size={18} />Use my current location{locationBusy && <span role="status" aria-label="Finding your location" className="ml-1 h-4 w-4 animate-spin rounded-full border-2 border-[#08679e] border-t-transparent" />}</button>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {addresses.length ? <div className="space-y-2">{addresses.map(address => <article key={address.id} className={`rounded-[5px] border bg-white p-3 ${selectedId === address.id ? "border-[#2081C3]" : "border-[#BED8D4]"}`}>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => select(address)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Icon name="location" size={19} /><span className="min-w-0"><span className="block font-bold">{address.label || address.buildingType}</span><span className="block truncate text-xs text-slate-500">{address.address}</span></span></button>
            <button type="button" onClick={() => openEditor(address)} disabled={typeof address.lat !== "number" || typeof address.lng !== "number"} aria-label={`Edit ${address.label || "address"}`} className="rounded-[5px] p-2 text-[#08679e] hover:bg-[#BED8D4]/40 disabled:opacity-40"><Icon name="edit" size={18} /></button>
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
