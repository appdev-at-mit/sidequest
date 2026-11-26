import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Icon from "../components/Icon";
import QuestCountdown from "../components/QuestCountdown";
import useDismissible from "../hooks/useDismissible";
import { CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";
import type { Request } from "../data/requests";
import "./ExploreTasks.css";

type Props = {
  requests: Request[];
  query: string;
  selectedRequestId: string | number;
  currentKerb: string;
  setSelectedRequestId: (id: string | number) => void;
  onAccept: () => void;
};

export default function ExploreTasks({
  requests,
  query,
  selectedRequestId,
  currentKerb,
  setSelectedRequestId,
  onAccept,
}: Props) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [mapViewVersion, setMapViewVersion] = useState(0);
  const [clusterRequests, setClusterRequests] = useState<Request[] | null>(null);
  const requestPanelOpen = requestOpen && Boolean(clusterRequests || requests.some(request => request.id === selectedRequestId));
  const requestPanelRef = useDismissible<HTMLElement>(requestPanelOpen, () => {
    setRequestOpen(false);
    setClusterRequests(null);
    setSelectedRequestId("");
  }, "global-popover");

  const mapElement = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const selectedRequest =
    requests.find((request) => request.id === selectedRequestId)
    ?? null;

  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return requests.filter(
      (request) => (request.status ?? "open") === "open" && !request.expired &&
      (
        (!normalized ||
          request.title.toLowerCase().includes(normalized) ||
          request.category.toLowerCase().includes(normalized) || request.description.toLowerCase().includes(normalized))
      )
    );
  }, [requests, query]);

  // Create the map once.
  useEffect(() => {
    if (!mapElement.current) return;

    const map = L.map(mapElement.current, {
      minZoom: 14,
      zoomControl: false,
    }).setView(CAMBRIDGE_CENTER, 16);

    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map);
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ debounceMoveend: true }));
    resizeObserver.observe(mapElement.current);
    map.on("click", () => {
      setRequestOpen(false);
      setClusterRequests(null);
      setSelectedRequestId("");
    });
    map.on("zoomend moveend", () => setMapViewVersion(version => version + 1));

    leafletMap.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      leafletMap.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedRequest || clusterRequests) return;
    setRequestOpen(true);
    if (typeof selectedRequest.lat === "number" && typeof selectedRequest.lng === "number") {
      leafletMap.current?.setView([selectedRequest.lat, selectedRequest.lng], Math.max(leafletMap.current.getZoom(), 17), { animate: true });
    }
  }, [selectedRequestId, clusterRequests]);

  // Refresh markers when the requests or selection change.
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const markers: L.Marker[] = [];

    const positioned = visibleRequests.flatMap(request => {
      if (typeof request.lat !== "number" || typeof request.lng !== "number" || !Number.isFinite(request.lat) || !Number.isFinite(request.lng)) return [];
      return [{ request, point: map.project([request.lat, request.lng], map.getZoom()) }];
    });
    const groups: typeof positioned[] = [];
    positioned.forEach(item => {
      const group = groups.find(current => current.some(member => member.point.distanceTo(item.point) < 52));
      if (group) group.push(item);
      else groups.push([item]);
    });

    groups.forEach(group => {
      const request = group[0].request;
      if (group.length > 1) {
        const center = L.latLng(group.reduce((sum, item) => sum + item.request.lat!, 0) / group.length, group.reduce((sum, item) => sum + item.request.lng!, 0) / group.length);
        const clusterButton = document.createElement("button");
        clusterButton.type = "button";
        clusterButton.className = "sidequest-cluster-marker";
        clusterButton.textContent = String(group.length);
        clusterButton.setAttribute("aria-label", `${group.length} requests in this area`);
        const marker = L.marker(center, { icon: L.divIcon({ className: "sidequest-cluster-icon", html: clusterButton, iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 1200, bubblingMouseEvents: false })
          .addTo(map)
          .on("click", () => {
            setClusterRequests(group.map(item => item.request));
            setSelectedRequestId(group[0].request.id);
            setRequestOpen(true);
          });
        markers.push(marker);
        return;
      }

      const countLabel = document.createElement("span");
      countLabel.className =
        "sidequest-marker__count" +
        (request.id === selectedRequestId ? " is-selected" : "");
      countLabel.textContent = "1";

      const stem = document.createElement("span");
      stem.className = "sidequest-marker__stem";

      const markerContent = document.createElement("div");
      markerContent.append(countLabel, stem);

      const marker = L.marker([request.lat, request.lng], {
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: "sidequest-marker",
          html: markerContent,
          iconSize: [70, 48],
          iconAnchor: [35, 44],
        }),
        title: request.title,
        alt: "1 quest near this location",
      })
        .addTo(map)
        .on("click", () => {
          setClusterRequests([request]);
          setSelectedRequestId(request.id);
          setRequestOpen(true);
        });

      markers.push(marker);
    });

    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [visibleRequests, selectedRequestId, setSelectedRequestId, mapViewVersion]);

  return (
    <main className="explore-layout relative isolate overflow-hidden">
      <div className="explore-map relative min-w-0">
        <div
          ref={mapElement}
          className="absolute inset-0 z-0"
          aria-label="Map of tasks near MIT"
        />

        <div className="absolute bottom-6 left-5 z-20 overflow-hidden rounded-md border border-[#BED8D4] bg-[#F7F9F9]">
          <button
            onClick={() => leafletMap.current?.zoomIn()}
            className="grid h-10 w-10 place-items-center border-b text-xl"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => leafletMap.current?.zoomOut()}
            className="grid h-10 w-10 place-items-center border-b text-xl"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() =>
              leafletMap.current?.setView(CAMBRIDGE_CENTER, 16)
            }
            className="grid h-10 w-10 place-items-center text-[#2081C3]"
            aria-label="Recenter map"
          >
            <Icon name="location" size={18} />
          </button>
        </div>
      </div>

      {requestOpen && clusterRequests && (
        <aside ref={requestPanelRef} role="dialog" aria-label="Requests in this area" className="absolute inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col bg-transparent">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="flex flex-col gap-3">
              {clusterRequests.map(request => <button key={request.id} onClick={() => { setSelectedRequestId(request.id); setClusterRequests(null); if (typeof request.lat === "number" && typeof request.lng === "number") leafletMap.current?.setView([request.lat, request.lng], Math.max(leafletMap.current.getZoom(), 17), { animate: true }); }} className="w-full overflow-hidden rounded-xl border border-[#BED8D4] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#2081C3] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2081C3]">
                {request.imageUrl ? <img src={request.imageUrl} alt="" className="-mx-4 -mt-4 mb-3 h-32 w-[calc(100%+2rem)] rounded-t-xl border-[6px] border-white object-cover" /> : <div aria-hidden="true" className="quest-preview-art -mx-4 -mt-4 mb-3 h-32 rounded-none border-[6px] border-white"><span className="text-3xl">↗</span></div>}
                <div className="flex items-start justify-between gap-3"><h3 className="font-extrabold">{request.title}</h3><span className="shrink-0 font-extrabold text-[#2081C3]">${request.reward}</span></div>
                <p className="mt-1 text-xs text-slate-500">Posted by {request.poster} <span className="ml-1 font-semibold text-slate-600"><span className="text-[#2081C3]">★</span> {request.requesterRating?.toFixed(1) ?? "—"} ({request.requesterReviewCount ?? 0} {request.requesterReviewCount === 1 ? "rating" : "ratings"})</span></p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{request.description.slice(0, 150)}</p>
              </button>)}
            </div>
          </div>
        </aside>
      )}
      {requestOpen && selectedRequest && !clusterRequests && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 flex items-center justify-center bg-[#102A3A]/35 p-3 sm:p-4">
        <section
          ref={requestPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Quest details"
          className="relative flex max-h-[min(680px,calc(100dvh-5rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] text-[#102A3A] shadow-2xl"
        >
          <div className="relative min-h-0 flex-1 overflow-y-auto p-5 pt-4 sm:p-7">
            <button
              onClick={() => setRequestOpen(false)}
              aria-label="Close quest"
              className="absolute right-3 top-2 p-2"
            >
              <Icon name="x" size={18} />
            </button>

            <h1 className="mt-0 pr-10 text-2xl font-extrabold">
              {selectedRequest.title}
            </h1>
            <p className="mt-1 text-[8px] font-semibold text-slate-500">Posted by {selectedRequest.poster}</p>

            {selectedRequest.imageUrl ? (
              <img src={selectedRequest.imageUrl} alt={selectedRequest.title}
                className="mt-4 h-44 w-full rounded-xl object-cover" />
            ) : (
              <div className="quest-preview-art mt-4" role="img" aria-label="Illustration of a bicycle and laundry basket">
                <svg viewBox="0 0 320 150" aria-hidden="true">
                  <circle cx="69" cy="99" r="34" fill="none" stroke="#f8f5e9" strokeWidth="7" />
                  <circle cx="156" cy="99" r="34" fill="none" stroke="#f8f5e9" strokeWidth="7" />
                  <path d="m69 99 43-59 44 59H69l25-36h38m-31-27h-19m80 0h19" fill="none" stroke="#2081c3" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="m211 61 16-12 19 8 17-9 23 16-8 14-18-6-18 10-19-6-12 7-10-11Z" fill="#fff8e8" stroke="#102a3a" strokeWidth="3" strokeLinejoin="round" />
                  <path d="M218 78h64l-7 49h-49Z" fill="#2081c3" stroke="#102a3a" strokeWidth="3" />
                  <path d="M230 92c8-8 15-8 23 0s15 8 23 0" fill="none" stroke="#78d5d7" strokeWidth="4" strokeLinecap="round" />
                  <path d="m38 48 4-9m187 1 6-7" stroke="#fff8e8" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </div>
            )}
            <p className="mt-4 leading-6 text-slate-600">
              {selectedRequest.description.length > 150 ? `${selectedRequest.description.slice(0, 147).trimEnd()}…` : selectedRequest.description}
            </p>

            <div className="my-5 h-px bg-[#BED8D4]" />
            <p className="text-xs font-bold uppercase text-slate-400">
              Reward
            </p>
            <p className="mt-1 text-4xl font-extrabold text-[#2081C3]">
              ${selectedRequest.reward}
            </p>
            <div className="mt-5 space-y-3 border-t border-[#BED8D4] pt-4 text-sm">
              <p><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">Pickup</span><span className="mt-1 block font-semibold text-slate-700">{selectedRequest.pickup || selectedRequest.location || "Location not provided"}</span></p>
              <p><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">Drop-off</span><span className="mt-1 block font-semibold text-slate-700">{selectedRequest.dropoff || "Not specified"}</span></p>
              <QuestCountdown expiresAt={selectedRequest.expiresAt ?? (selectedRequest.createdAt ? new Date(new Date(selectedRequest.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null)} />
            </div>
          </div>

          <div className="border-t border-[#BED8D4] p-5">
            {selectedRequest.status === "open" && selectedRequest.requester !== null && selectedRequest.requester !== currentKerb && <button
              onClick={() => {
                setSelectedRequestId(selectedRequest.id);
                onAccept();
              }}
              className="w-full rounded-md bg-[#2081C3] py-3.5 text-sm font-bold text-white"
            >
              Accept quest
            </button>}
          </div>
        </section>
        </div>
      )}
    </main>
  );
}
