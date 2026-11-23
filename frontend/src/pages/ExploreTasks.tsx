import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { categories, CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";
import type { Request } from "../data/requests";
import "./ExploreTasks.css";

type Props = {
  requests: Request[];
  query: string;
  selectedRequestId: string | number;
  setSelectedRequestId: (id: string | number) => void;
  onAccept: () => void;
};

export default function ExploreTasks({
  requests,
  query,
  selectedRequestId,
  setSelectedRequestId,
  onAccept,
}: Props) {
  const [category, setCategory] = useState("All");
  const [requestOpen, setRequestOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(390);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  function resizePanel(width: number) {
    setPanelWidth(Math.min(580, Math.max(300, width)));
  }

  const mapElement = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const selectedRequest =
    requests.find((request) => request.id === selectedRequestId)
    ?? null;

  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return requests.filter(
      (request) =>
        (category === "All" || request.category === category) &&
        (!normalized ||
          request.title.toLowerCase().includes(normalized) ||
          request.category.toLowerCase().includes(normalized))
    );
  }, [requests, category, query]);

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

    leafletMap.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      leafletMap.current = null;
    };
  }, []);

  // Refresh markers when the requests or selection change.
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const markers: L.Marker[] = [];

    visibleRequests.forEach((request) => {
      if (
        typeof request.lat !== "number" ||
        typeof request.lng !== "number" ||
        !Number.isFinite(request.lat) ||
        !Number.isFinite(request.lng)
      ) {
        return;
      }

      const priceLabel = document.createElement("span");
      priceLabel.className =
        "sidequest-marker__price" +
        (request.id === selectedRequestId ? " is-selected" : "");
      priceLabel.textContent = request.price;

      const stem = document.createElement("span");
      stem.className = "sidequest-marker__stem";

      const markerContent = document.createElement("div");
      markerContent.append(priceLabel, stem);

      const marker = L.marker([request.lat, request.lng], {
        icon: L.divIcon({
          className: "sidequest-marker",
          html: markerContent,
          iconSize: [70, 48],
          iconAnchor: [35, 44],
        }),
        title: request.title,
        alt: `${request.title} · ${request.price}`,
      })
        .addTo(map)
        .on("click", () => {
          setSelectedRequestId(request.id);
          setRequestOpen(true);
        });

      markers.push(marker);
    });

    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [visibleRequests, selectedRequestId, setSelectedRequestId]);

  function openRequest(request: Request) {
    setSelectedRequestId(request.id);
    setRequestOpen(true);

    if (
      typeof request.lat === "number" &&
      typeof request.lng === "number" &&
      Number.isFinite(request.lat) &&
      Number.isFinite(request.lng)
    ) {
      leafletMap.current?.panTo([request.lat, request.lng]);
    }
  }

  return (
    <main className="explore-layout relative overflow-hidden"
      style={{ "--request-panel-width": `${panelWidth}px` } as CSSProperties}>
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

      <div className="request-panel-divider" role="separator" tabIndex={0}
        title="Drag to resize" aria-label="Resize request panel" aria-controls="request-panel" aria-orientation="vertical"
        aria-valuemin={300} aria-valuemax={580} aria-valuenow={panelWidth}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const panel = event.currentTarget.nextElementSibling;
          if (!panel) return;
          dragStart.current = { x: event.clientX, width: panel.getBoundingClientRect().width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = dragStart.current;
          if (start) resizePanel(start.width + start.x - event.clientX);
        }}
        onLostPointerCapture={() => { dragStart.current = null; }}
        onKeyDown={(event) => {
          const widths: Record<string, number> = {
            ArrowLeft: panelWidth + 20, ArrowRight: panelWidth - 20, Home: 300, End: 580,
          };
          if (!Object.hasOwn(widths, event.key)) return;
          event.preventDefault();
          resizePanel(widths[event.key]);
        }}
      />
      <aside id="request-panel" className="request-panel z-20 flex min-h-0 flex-col border-[#BED8D4] bg-[#F7F9F9]">
        <div className="border-b border-[#BED8D4] px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold">
              Requests
            </h1>
            <span className="rounded-full bg-[#BED8D4]/55 px-2.5 py-1 text-xs font-bold">
              {visibleRequests.length}
            </span>
          </div>

          <label className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold">
            Category
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setRequestOpen(false);
              }}
              className="min-w-0 flex-1 rounded-md border border-[#BED8D4] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#08679e]"
            >
              {[...categories, "Uncategorized"].map((item) => (
                <option key={item} value={item}>{item === "All" ? "All categories" : item}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {visibleRequests.map((request) => (
            <button
              key={request.id}
              onClick={() => openRequest(request)}
              className={`w-full rounded-lg border bg-white p-4 text-left shadow-sm ${
                selectedRequestId === request.id && requestOpen
                  ? "border-[#78D5D7]"
                  : "border-[#BED8D4]"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-bold uppercase text-[#2081C3]">
                    {request.category}
                  </span>
                  <h2 className="mt-1 font-bold leading-5">
                    {request.title}
                  </h2>
                  <p className="mt-2 text-xs text-slate-500">
                    Posted by {request.poster}
                  </p>
                </div>

                <span className="text-lg font-extrabold text-[#2081C3]">
                  {request.price}
                </span>
              </div>
            </button>
          ))}

          {requests.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-slate-500">No requests yet. Post one to add a pin to the map.</p>
          )}
          {requests.length > 0 && visibleRequests.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-slate-500">
              No requests match these filters.
            </p>
          )}
        </div>
      </aside>

      {requestOpen && selectedRequest && (
        <aside
          role="dialog"
          aria-label="Request details"
          className="absolute inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-[#BED8D4] bg-[#F7F9F9] shadow-lg"
        >
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-[#BED8D4]/45 px-3 py-1.5 text-xs font-bold">
                {selectedRequest.category}
              </span>
              <button
                onClick={() => setRequestOpen(false)}
                aria-label="Close request"
                className="p-2"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <h1 className="mt-5 text-2xl font-extrabold">
              {selectedRequest.title}
            </h1>

            <div className="my-6 h-px bg-[#BED8D4]" />

            <div className="flex items-center gap-3">
              <Avatar
                initials={selectedRequest.poster.slice(0, 1)}
              />
              <p className="font-bold">
                {selectedRequest.poster}
              </p>
            </div>

            <p className="mt-7 leading-6 text-slate-600">
              {selectedRequest.description}
            </p>

            <p className="mt-6 text-sm text-slate-500">
              {selectedRequest.location}
            </p>

            <p className="mt-8 text-xs font-bold uppercase text-slate-400">
              Payout
            </p>
            <p className="mt-1 text-4xl font-extrabold text-[#2081C3]">
              {selectedRequest.price}
            </p>
          </div>

          <div className="border-t border-[#BED8D4] p-5">
            <button
              onClick={() => {
                setSelectedRequestId(selectedRequest.id);
                onAccept();
              }}
              className="w-full rounded-md bg-[#2081C3] py-3.5 text-sm font-bold text-white"
            >
              Accept Task
            </button>
          </div>
        </aside>
      )}
    </main>
  );
}