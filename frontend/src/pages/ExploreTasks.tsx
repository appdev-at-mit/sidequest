import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { categories, CAMBRIDGE_CENTER } from "../data/requests";
import type { Request } from "../data/requests";

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

  const mapElement = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const selectedRequest =
    requests.find((request) => request.id === selectedRequestId)
    ?? requests[0];

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
      maxBounds: L.latLngBounds(
        [42.342, -71.126],
        [42.378, -71.062]
      ),
      maxBoundsViscosity: 1,
      minZoom: 14,
      zoomControl: false,
    }).setView(CAMBRIDGE_CENTER, 16);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }
    ).addTo(map);

    leafletMap.current = map;

    return () => {
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
    <main className="relative h-[calc(100vh-64px)] overflow-hidden">
      <div className="absolute inset-0 lg:right-[390px]">
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

      <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-[#BED8D4] bg-[#F7F9F9] sm:w-[390px]">
        <div className="border-b border-[#BED8D4] px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold">
              Requests
            </h1>
            <span className="rounded-full bg-[#BED8D4]/55 px-2.5 py-1 text-xs font-bold">
              {visibleRequests.length}
            </span>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {[...categories, "Uncategorized"].map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  category === item
                    ? "border-[#2081C3] bg-[#2081C3] text-white"
                    : "border-[#BED8D4] text-slate-600"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
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

          {visibleRequests.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-slate-500">
              No requests to display. Make sure you’re logged in
              and have selected All.
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