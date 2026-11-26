import { useState } from "react";
import { addressPolicyError, isWithinMITCampus, resolveMITBuildingQuery } from "../data/addressPolicy";

export type GeocodedAddress = { address: string; lat: number; lng: number };

type Props = {
  id: string;
  label: string;
  placeholder: string;
  initialValue?: string;
  onSelect: (address: GeocodedAddress | null) => void;
};

type Result = { display_name: string; lat: string; lon: string };

export default function AddressLookup({ id, label, placeholder, initialValue = "", onSelect }: Props) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<GeocodedAddress[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (!query.trim() || busy) return;
    const building = resolveMITBuildingQuery(query);
    const issue = building.error || addressPolicyError(query);
    if (issue) { setError(issue); onSelect(null); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(building.query)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Address search is temporarily unavailable.");
      const found: Result[] = await response.json();
      const matches = found.map(item => ({ address: building.isBuilding ? query.trim() : item.display_name, lat: Number(item.lat), lng: Number(item.lon) }))
        .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && (!building.isBuilding || isWithinMITCampus(item.lat, item.lng)));
      if (!matches.length) throw new Error(building.isBuilding ? "That building number was not found within MIT. Try a nearby street address." : "No matching address was found. Try a street address or building name.");
      setResults(matches);
      if (matches.length === 1) choose(matches[0]);
    } catch (reason) {
      setResults([]); onSelect(null);
      setError(reason instanceof Error ? reason.message : "Could not find that address.");
    } finally { setBusy(false); }
  }

  function choose(address: GeocodedAddress) {
    const issue = addressPolicyError(address.address);
    setQuery(address.address);
    setResults([]);
    setError(issue ?? "");
    onSelect(issue ? null : address);
  }

  return <div>
    <label htmlFor={id} className="text-sm font-semibold">{label}</label>
    <div role="search" className="mt-1 flex gap-2 rounded-lg border border-[#BED8D4] bg-white p-1 focus-within:border-[#2081C3]">
      <input id={id} value={query} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} onChange={event => { setQuery(event.target.value); setResults([]); onSelect(null); setError(""); }} className="min-w-0 flex-1 bg-transparent px-2.5 py-2 outline-none" placeholder={placeholder} maxLength={200} />
      <button type="button" onClick={() => void search()} disabled={busy || !query.trim()} className="shrink-0 rounded-md bg-[#08679e] px-3 text-sm font-bold text-white hover:bg-[#075785] disabled:opacity-50">{busy ? "Searching…" : "Search"}</button>
    </div>
    {results.length > 1 && <ul className="mt-2 max-h-36 overflow-auto rounded-lg border border-[#BED8D4] bg-white" aria-label={`${label} matches`}>
      {results.map(result => <li key={`${result.lat},${result.lng}`}><button type="button" onClick={() => choose(result)} className="w-full border-b border-[#BED8D4]/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-[#E8F2F1]">{result.address}</button></li>)}
    </ul>}
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}
