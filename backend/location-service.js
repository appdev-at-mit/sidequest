const { createHash } = require("node:crypto");
const { schemas } = require("./validation.js");
require("dotenv").config();

const PHOTON_API = process.env.PHOTON_API_URL || "https://photon.komoot.io/api/";
const MIT_CENTER = { lat: 42.3585, lng: -71.0935 };
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function clean(value, max = 200) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function toLocation(feature, roomNumber = "") {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties ?? {};
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const [lng, lat] = coordinates;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
    const locality = [properties.district, properties.locality, properties.city, properties.county, properties.state, properties.postcode]
        .filter((part, index, all) => part && all.indexOf(part) === index).join(", ");
    const formattedAddress = [properties.name, street, locality, properties.country]
        .filter((part, index, all) => part && all.indexOf(part) === index).join(", ") || clean(properties.name);
    if (!formattedAddress || !schemas.roomNumber(roomNumber)) return null;
    const buildingName = clean(properties.name, 120);
    const providerPlaceId = properties.osm_type && properties.osm_id != null ? `${properties.osm_type}/${properties.osm_id}` : "";
    return {
        formattedAddress,
        lat,
        lng,
        provider: "photon",
        providerPlaceId,
        ...(buildingName ? { buildingName } : {}),
        ...(clean(roomNumber, 30) ? { roomNumber: clean(roomNumber, 30) } : {}),
    };
}

function distanceFromMIT(location) {
    return (location.lat - MIT_CENTER.lat) ** 2 + (location.lng - MIT_CENTER.lng) ** 2;
}

function normalizeStructuredLocation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const formattedAddress = clean(value.formattedAddress ?? value.address);
    const { lat, lng } = value;
    if (!formattedAddress || !schemas.latitude(lat) || !schemas.longitude(lng) || !schemas.roomNumber(value.roomNumber)) return null;
    return {
        formattedAddress,
        lat,
        lng,
        provider: clean(value.provider, 32) || "photon",
        providerPlaceId: clean(value.providerPlaceId, 120),
        ...(clean(value.buildingName, 120) ? { buildingName: clean(value.buildingName, 120) } : {}),
        ...(clean(value.roomNumber, 30) ? { roomNumber: clean(value.roomNumber, 30) } : {}),
    };
}

async function geocodeLegacyAddress(address, roomNumber = "") {
    const query = clean(address);
    if (!query) return { error: "Enter an address." };
    const key = createHash("sha256").update(query.toLocaleLowerCase()).digest("hex");
    const cached = cache.get(key);
    let features;
    if (cached && cached.expiresAt > Date.now()) {
        features = cached.features;
    } else {
        const params = new URLSearchParams({ q: query, limit: "2", lang: "en", lat: String(MIT_CENTER.lat), lon: String(MIT_CENTER.lng), zoom: "17", location_bias_scale: "0.1" });
        const response = await fetch(`${PHOTON_API}?${params.toString()}`, { headers: { Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("The location service is temporarily unavailable.");
        const payload = await response.json();
        features = Array.isArray(payload.features) ? payload.features : [];
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, features });
        if (cache.size > 1000) for (const [entry, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(entry);
    }
    const matches = features.map(feature => toLocation(feature, roomNumber)).filter(Boolean).sort((a, b) => distanceFromMIT(a) - distanceFromMIT(b));
    if (!matches.length) return { error: "We couldn’t resolve that address. Select a suggested address to confirm its location." };
    if (matches.length > 1) return { needsConfirmation: true, suggestions: matches };
    return { location: matches[0] };
}

async function resolveLocation(value) {
    if (typeof value === "string") return geocodeLegacyAddress(value);
    const location = normalizeStructuredLocation(value);
    return location ? { location } : { error: "Choose a valid address with a confirmed map location." };
}

module.exports = { geocodeLegacyAddress, resolveLocation, normalizeStructuredLocation };
