import { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
  CircleMarker,
} from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
import { type Quest, money } from "./api";
export const CAMPUS: [number, number] = [42.3592, -71.0932];
function MapBehavior({
  selected,
  center,
  onPick,
  quests,
}: {
  quests: Quest[];
  selected?: Quest;
  center: [number, number];
  onPick?: (v: [number, number]) => void;
}) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && !selected && quests.length > 1) {
      const points: [number, number][] = quests.map((q) => [
        q.startLocation.coordinates[1],
        q.startLocation.coordinates[0],
      ]);
      const bounds = L.latLngBounds([center, ...points]);
      if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 3000) {
        map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
        fitted.current = true;
      }
    }
  }, [map, quests, center, selected]);
  useEffect(() => {
    map.flyTo(
      selected
        ? [
            selected.startLocation.coordinates[1],
            selected.startLocation.coordinates[0],
          ]
        : center,
      selected ? 17 : 16,
      { duration: 0.6 },
    );
  }, [map, selected, center]);
  useMapEvents({ click: (e) => onPick?.([e.latlng.lat, e.latlng.lng]) });
  return null;
}
export function MapView({
  quests = [],
  selected,
  onSelect,
  center,
  located,
  onPick,
  picked,
}: {
  quests?: Quest[];
  selected?: Quest;
  onSelect?: (id: string) => void;
  center: [number, number];
  located?: boolean;
  onPick?: (v: [number, number]) => void;
  picked?: [number, number];
}) {
  return (
    <MapContainer
      center={center}
      zoom={16}
      zoomControl={false}
      className="campus-map"
      aria-label="Campus quest map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapBehavior
        quests={quests}
        selected={selected}
        center={center}
        onPick={onPick}
      />
      {located && (
        <CircleMarker
          center={center}
          radius={9}
          pathOptions={{
            color: "white",
            weight: 3,
            fillColor: "#2563eb",
            fillOpacity: 1,
          }}
        >
          <Popup>Your location (not stored)</Popup>
        </CircleMarker>
      )}
      {picked && (
        <CircleMarker
          center={picked}
          radius={10}
          pathOptions={{ color: "#2563eb", fillOpacity: 0.7 }}
        />
      )}
      {quests.map((q) => (
        <Marker
          key={q._id}
          position={[
            q.startLocation.coordinates[1],
            q.startLocation.coordinates[0],
          ]}
          icon={L.divIcon({
            className: "quest-pin-container",
            html: `<div class="quest-pin ${selected?._id === q._id ? "selected" : ""}">${money(q.payCents)}</div>`,
            iconSize: [64, 40],
            iconAnchor: [32, 40],
          })}
          eventHandlers={{ click: () => onSelect?.(q._id) }}
        >
          <Popup>
            <strong>{q.title}</strong>
            <p>{q.startLocation.label}</p>
            <Link to={`/quests/${q._id}`}>View quest →</Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
