import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { mapRequests, categories, CAMBRIDGE_CENTER } from "../data/requests";

type Props = { query: string; selectedRequestId: number; setSelectedRequestId: (id: number) => void; onAccept: () => void };
export default function ExploreTasks({query, selectedRequestId, setSelectedRequestId, onAccept}: Props) {
  const [category, setCategory] = useState("All");
  const [requestOpen, setRequestOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const mapElement = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const requestMarkers = useRef(new Map<number, L.Marker>());
  const selectedRequest = mapRequests.find(request => request.id === selectedRequestId) ?? mapRequests[0];
  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return mapRequests.filter(
      (request) =>
        (category === "All" || request.category === category) &&
        (!normalized ||
          request.title.toLowerCase().includes(normalized) ||
          request.category.toLowerCase().includes(normalized)),
    );
  }, [category, query]);

  const markerIcon = (price: string, selected: boolean) =>
    L.divIcon({
      className: "sidequest-marker",
      html: `<span class="sidequest-marker__price${selected ? " is-selected" : ""}">${price}</span><span class="sidequest-marker__stem"></span>`,
      iconSize: [70, 48],
      iconAnchor: [35, 44],
    });
  useEffect(() => {
    if (!mapElement.current || leafletMap.current) return;

    const map = L.map(mapElement.current, {
      attributionControl: true,
      maxBounds: L.latLngBounds([42.342, -71.126], [42.378, -71.062]),
      maxBoundsViscosity: 1,
      minZoom: 14,
      zoomControl: false,
    }).setView(CAMBRIDGE_CENTER, 16);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China, OpenStreetMap contributors",
        maxZoom: 19,
      },
    ).addTo(map);

    L.marker(CAMBRIDGE_CENTER, {
      icon: L.divIcon({
        className: "user-location-marker",
        html: '<span class="user-location-marker__ring"><span class="user-location-marker__dot"></span></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
      title: "Your location",
      zIndexOffset: 1000,
    })
      .addTo(map)
      .bindTooltip("You are here", {
        direction: "top",
        offset: [0, -10],
      });

    mapRequests.forEach((request) => {
      const marker = L.marker([request.lat, request.lng], {
        icon: markerIcon(request.price, request.id === selectedRequestId),
        title: `${request.title} for ${request.price}`,
      })
        .addTo(map)
        .on("click", () => {
          setSelectedRequestId(request.id);
          setRequestOpen(true);
        });
      requestMarkers.current.set(request.id, marker);
    });

    leafletMap.current = map;
    return () => {
      map.remove();
      leafletMap.current = null;
      requestMarkers.current.clear();
    };
  }, []);

  useEffect(() => {
    mapRequests.forEach((request) => {
      requestMarkers.current
        .get(request.id)
        ?.setIcon(markerIcon(request.price, request.id === selectedRequestId));
    });
  }, [selectedRequestId]);
  return (
        <main className="relative h-[calc(100vh-64px)] overflow-hidden">
          <div className="absolute inset-0 right-0 lg:right-[390px]">
            <div
              ref={mapElement}
              className="absolute inset-0 z-0"
              aria-label="Interactive map of tasks near MIT"
            />
            <div className="absolute bottom-6 left-5 z-20 overflow-hidden rounded-md border border-[#BED8D4] bg-[#F7F9F9] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <button
                onClick={() => leafletMap.current?.zoomIn()}
                className="grid h-10 w-10 place-items-center border-b border-[#BED8D4] text-xl hover:bg-[#BED8D4]/25"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                onClick={() => leafletMap.current?.zoomOut()}
                className="grid h-10 w-10 place-items-center border-b border-[#BED8D4] text-xl hover:bg-[#BED8D4]/25"
                aria-label="Zoom out"
              >
                −
              </button>
              <button
                onClick={() => leafletMap.current?.setView(CAMBRIDGE_CENTER, 16)}
                className="grid h-10 w-10 place-items-center text-[#2081C3] hover:bg-[#BED8D4]/25"
                aria-label="Recenter map"
              >
                <Icon name="location" size={18} />
              </button>
            </div>
          </div>

          <aside className="absolute inset-y-0 right-0 z-20 hidden w-[390px] border-l border-[#BED8D4] bg-[#F7F9F9] lg:flex lg:flex-col">
            <div className="border-b border-[#BED8D4] px-5 pb-4 pt-5">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-[-0.4px]">Nearby requests</h1>
                <span className="rounded-full bg-[#BED8D4]/55 px-2.5 py-1 text-xs font-bold text-slate-600">
                  {visibleRequests.length}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">Available around MIT and Cambridge</p>
              <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
                {categories.map((item) => (
                  <button
                    key={item}
                    onClick={() => setCategory(item)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      category === item
                        ? "border-[#2081C3] bg-[#2081C3] text-white"
                        : "border-[#BED8D4] bg-[#F7F9F9] text-slate-600 hover:border-[#78D5D7]"
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
                  onClick={() => {
                    setSelectedRequestId(request.id);
                    setRequestOpen(true);
                    leafletMap.current?.panTo([request.lat, request.lng]);
                  }}
                  className={`w-full rounded-lg border bg-white p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition ${
                    selectedRequestId === request.id && requestOpen
                      ? "border-[#78D5D7]"
                      : "border-[#BED8D4] hover:border-[#78D5D7]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[#2081C3]">
                        {request.category}
                      </span>
                      <h2 className="mt-1 font-bold leading-5">{request.title}</h2>
                      <p className="mt-2 text-xs text-slate-500">
                        {request.distance} · {request.posted}
                      </p>
                    </div>
                    <span className="text-lg font-extrabold text-[#2081C3]">{request.price}</span>
                  </div>
                </button>
              ))}
              {!visibleRequests.length && (
                <div className="px-4 py-12 text-center text-sm text-slate-500">
                  No nearby tasks match that search.
                </div>
              )}
            </div>
          </aside>

          <div className="absolute bottom-4 left-4 right-4 z-20 lg:hidden">
            <button
              onClick={() => setRequestOpen(true)}
              className="flex w-full items-center justify-between rounded-lg border border-[#BED8D4] bg-[#F7F9F9] p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
            >
              <span>
                <span className="block text-xs font-bold uppercase text-[#2081C3]">
                  {selectedRequest.category}
                </span>
                <span className="mt-1 block font-bold">{selectedRequest.title}</span>
              </span>
              <span className="font-extrabold text-[#2081C3]">{selectedRequest.price}</span>
            </button>
          </div>

          <aside
            className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-[#BED8D4] bg-[#F7F9F9] shadow-[-1px_0_3px_rgba(0,0,0,0.08)] transition-transform duration-200 ${
              requestOpen ? "translate-x-0" : "translate-x-full"
            }`}
            aria-hidden={!requestOpen}
          >
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-full bg-[#BED8D4]/45 px-3 py-1.5 text-xs font-bold text-[#174F72]">
                  {selectedRequest.category}
                </span>
                <button
                  onClick={() => setRequestOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-[#BED8D4]/30"
                  aria-label="Close request"
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
              <h1 className="mt-5 text-[27px] font-extrabold leading-tight tracking-[-0.7px]">
                {selectedRequest.title}
              </h1>
              <div className="my-6 h-px bg-[#BED8D4]" />
              <div className="flex items-center">
                <Avatar initials={selectedRequest.poster.slice(0, 1)} />
                <div className="ml-3">
                  <p className="text-sm font-bold">{selectedRequest.poster}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <span className="text-[#2081C3]">
                      <Icon name="star" size={13} />
                    </span>
                    4.9 <span>(28 reviews)</span>
                  </p>
                </div>
                <button className="ml-auto text-xs font-bold text-[#2081C3] hover:underline">
                  View Profile
                </button>
              </div>
              <p className="mt-7 text-[15px] leading-6 text-slate-600">
                {selectedRequest.description}
              </p>
              <p className="mt-6 flex items-center gap-2 text-sm text-slate-600">
                <span className="text-[#2081C3]">
                  <Icon name="location" size={18} />
                </span>
                {selectedRequest.location}
              </p>
              <div className="mt-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Payout
                </p>
                <p className="mt-1 text-4xl font-extrabold tracking-[-1px] text-[#2081C3]">
                  {selectedRequest.price}
                </p>
              </div>
            </div>
            <div className="border-t border-[#BED8D4] p-5">
              <button
                onClick={onAccept}
                className="w-full rounded-md bg-[#2081C3] py-3.5 text-sm font-bold text-white transition hover:bg-[#176FA9]"
              >
                Accept Task
              </button>
              <button
                onClick={() => setSaved((current) => !current)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[#2081C3] py-3.5 text-sm font-bold text-[#2081C3] transition hover:bg-[#63D2FF]/10"
              >
                <Icon name="bookmark" size={17} />
                {saved ? "Saved for Later" : "Save for Later"}
              </button>
            </div>
          </aside>
        </main>
  );
}
