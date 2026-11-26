import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Icon from "./Icon";
import useDismissible from "../hooks/useDismissible";
import { addressPolicyError, isMatchingMITBuilding, isWithinMITCampus, resolveMITBuildingQuery } from "../data/addressPolicy";
import { inputSchemas } from "../data/validation";
import "./AddressLookup.css";

export type GeocodedAddress = { address: string; lat: number; lng: number; provider?: string; providerPlaceId?: string; buildingName?: string; roomNumber?: string; title?: string; subtitle?: string };

type Props = {
  id: string;
  label: string;
  placeholder: string;
  initialValue?: string;
  initialAddress?: GeocodedAddress | null;
  initialSuggestions?: GeocodedAddress[];
  onSelect: (address: GeocodedAddress | null) => void;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    osm_id?: number;
    osm_type?: string;
  };
};
type PhotonResponse = { features?: PhotonFeature[] };

const MIT_CENTER = { lat: 42.3585, lng: -71.0935 };

function formatFeature(feature: PhotonFeature, buildingQuery: boolean): GeocodedAddress | null {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || !inputSchemas.coordinates(coordinates[1], coordinates[0])) return null;
  const [lng, lat] = coordinates;
  const properties = feature.properties ?? {};
  const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const locality = [properties.district, properties.locality, properties.city, properties.county, properties.state, properties.postcode]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(", ");
  const title = buildingQuery ? properties.name || "" : properties.name || streetAddress || properties.city || properties.state || "Address";
  const subtitle = [streetAddress, locality, properties.country].filter(Boolean).join(", ") || properties.name || "";
  const addressParts = [properties.name, streetAddress, locality, properties.country]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const address = buildingQuery ? [properties.name, subtitle].filter(Boolean).join(", ") : addressParts.join(", ") || subtitle || title;
  const providerPlaceId = properties.osm_type && properties.osm_id != null ? `${properties.osm_type}/${properties.osm_id}` : "";
  return { address, lat, lng, title, subtitle, provider: "photon", providerPlaceId, ...(properties.name ? { buildingName: properties.name } : {}) };
}

function campusDistance(address: GeocodedAddress) {
  return (address.lat - MIT_CENTER.lat) ** 2 + (address.lng - MIT_CENTER.lng) ** 2;
}

export default function AddressLookup({ id, label, placeholder, initialValue = "", initialAddress = null, initialSuggestions = [], onSelect }: Props) {
  const [query, setQuery] = useState(initialAddress?.address ?? initialValue);
  const [results, setResults] = useState<GeocodedAddress[]>(initialSuggestions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(initialSuggestions.length > 0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useDismissible<HTMLDivElement>(open, () => { setOpen(false); setActiveIndex(-1); }, "address-suggestions");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const initialSuggestionQuery = useRef(initialValue.trim());

  useEffect(() => {
    if (!initialAddress) return;
    setQuery(initialAddress.address);
    setOpen(false);
    setResults([]);
    onSelect(initialAddress);
  }, [initialAddress?.address, initialAddress?.lat, initialAddress?.lng, initialAddress?.providerPlaceId]);

  useEffect(() => {
    if (!initialSuggestions.length) return;
    setResults(initialSuggestions);
    setOpen(true);
    setActiveIndex(-1);
  }, [initialSuggestions]);

  useEffect(() => {
    const value = query.trim();
    const requestId = ++requestVersion.current;
    if (initialSuggestions.length && open && value === initialSuggestionQuery.current) return;
    if (!open) {
      setResults([]);
      setBusy(false);
      return;
    }
    if (value.length < 2) {
      setResults([]);
      setBusy(false);
      setError("");
      return;
    }

    const building = resolveMITBuildingQuery(value);
    const policyError = building.error || addressPolicyError(value);
    if (policyError) {
      setResults([]);
      setBusy(false);
      setError(policyError);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError("");
      const params = new URLSearchParams({
        q: building.query,
        limit: "5",
        lang: "en",
        lat: String(MIT_CENTER.lat),
        lon: String(MIT_CENTER.lng),
        zoom: "17",
        location_bias_scale: "0.1",
      });
      try {
        const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/geo+json, application/json" } });
        if (!response.ok) throw new Error("Address suggestions are temporarily unavailable.");
        const payload: PhotonResponse = await response.json();
        const buildingFeatures = building.isBuilding
          ? (payload.features ?? []).filter(feature => isMatchingMITBuilding(feature.properties?.name, value))
          : payload.features ?? [];
        const suggestions = buildingFeatures
          .map(feature => formatFeature(feature, building.isBuilding))
          .filter((address): address is GeocodedAddress => Boolean(address)
            && (!building.isBuilding || isWithinMITCampus(address.lat, address.lng)))
          .sort((a, b) => campusDistance(a) - campusDistance(b));
        if (controller.signal.aborted || requestId !== requestVersion.current) return;
        setResults(suggestions);
        setActiveIndex(-1);
        if (!suggestions.length) setError(building.isBuilding
          ? "That MIT building was not found. Check the building number or code."
          : "No matching address found. Try a street address or MIT building.");
      } catch (reason) {
        if (controller.signal.aborted || requestId !== requestVersion.current) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : "Could not find that address.");
      } finally {
        if (!controller.signal.aborted && requestId === requestVersion.current) setBusy(false);
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  function choose(address: GeocodedAddress) {
    const issue = addressPolicyError(address.address);
    setQuery(address.address);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setError(issue ?? "");
    onSelect(issue ? null : address);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => index < 0 ? 0 : Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex(index => index <= 0 ? results.length - 1 : index - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results.length) choose(results[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function clearAddress() {
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
    setError("");
    onSelect(null);
    inputRef.current?.focus();
  }

  const showingResults = open && results.length > 0;
  return <div ref={rootRef} className="relative">
    <label htmlFor={id} className="text-sm font-semibold">{label}</label>
    <div role="search" className={`mt-1 flex items-center gap-2 rounded-lg border border-[#BED8D4] bg-white px-3 py-1 focus-within:border-[#2081C3] ${showingResults ? "rounded-b-none" : ""}`}>
      <Icon name="location" size={19} />
      <input
        ref={inputRef}
        id={id}
        value={query}
        onFocus={() => setOpen(query.trim().length >= 2)}
        onKeyDown={handleKeyDown}
        onChange={event => { setQuery(event.target.value); setResults([]); setActiveIndex(-1); setError(""); setBusy(false); setOpen(true); onSelect(null); }}
        className="address-lookup-input min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap bg-white px-1 py-2.5 outline-none"
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showingResults}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={showingResults && activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
      />
      {busy && <span role="status" aria-label="Loading address suggestions" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#2081C3] border-t-transparent" />}
      {query && <button type="button" onClick={clearAddress} aria-label={`Clear ${label.toLowerCase()}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-[#EAF3F2]"><Icon name="x" size={17} /></button>}
    </div>
    {showingResults && <ul id={`${id}-suggestions`} role="listbox" aria-label={`${label} suggestions`} className="absolute left-0 right-0 top-full z-40 -mt-px max-h-64 overflow-y-auto rounded-b-lg border border-[#BED8D4] bg-white shadow-lg">
      {results.map((result, index) => <li key={`${result.lat},${result.lng}`} role="presentation" className="border-b border-[#BED8D4]/70 last:border-b-0">
        <button id={`${id}-suggestion-${index}`} type="button" role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)} className={`flex w-full items-center gap-3 px-3 py-3 text-left ${activeIndex === index ? "bg-[#EAF3F2]" : "hover:bg-[#EAF3F2]"}`}>
          <Icon name="location" size={19} />
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{result.title ?? result.address}</span>{result.subtitle && <span className="mt-1 block truncate text-sm text-slate-500">{result.subtitle}</span>}</span>
          <span aria-hidden="true" className="text-slate-500">↖</span>
        </button>
      </li>)}
    </ul>}
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}
