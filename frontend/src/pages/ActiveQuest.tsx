import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import L from "leaflet";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { CAMBRIDGE_CENTER } from "../data/requests";
import type { Request } from "../data/requests";
type Props = { selectedRequest: Request; stage: 1 | 2; setStage: (stage: 1 | 2) => void; onBack: () => void; onComplete: () => void };
export default function ActiveQuest({selectedRequest, stage, setStage, onBack, onComplete}: Props) {
  const [routeDetails, setRouteDetails] = useState({ minutes: 12, miles: 0.6 });
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([
    { from: "Maya", text: "Hi Jordan! Thanks for accepting. The sofa is in the lobby.", time: "10:42 AM" },
    { from: "me", text: "Great, I can be there around 11:15.", time: "10:44 AM" },
    { from: "Maya", text: "Perfect. I’ll meet you by the front desk.", time: "10:45 AM" },
  ]);
  const routeMapElement = useRef<HTMLDivElement>(null);
  const routeMap = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!routeMapElement.current || routeMap.current) return;

    const map = L.map(routeMapElement.current, {
      attributionControl: true,
      minZoom: 14,
      zoomControl: false,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, OpenStreetMap contributors",
        maxZoom: 19,
      },
    ).addTo(map);

    const userIcon = L.divIcon({
      className: "route-user-marker",
      html: '<span class="route-user-marker__dot"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const destinationIcon = L.divIcon({
      className: "route-destination-marker",
      html: '<span class="route-destination-marker__pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v11H5zM8 8V5h8v3M9 12h6M9 15h4"/></svg></span>',
      iconSize: [48, 58],
      iconAnchor: [24, 54],
    });

    L.marker(CAMBRIDGE_CENTER, {
      icon: userIcon,
      title: "Your location",
      zIndexOffset: 1000,
    }).addTo(map);
    L.marker([selectedRequest.lat, selectedRequest.lng], {
      icon: destinationIcon,
      title: selectedRequest.title,
      zIndexOffset: 900,
    })
      .addTo(map)
      .bindTooltip(selectedRequest.title, { direction: "top", offset: [0, -44] });

    const bounds = L.latLngBounds(CAMBRIDGE_CENTER, [
      selectedRequest.lat,
      selectedRequest.lng,
    ]);
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17 });
    routeMap.current = map;

    const controller = new AbortController();
    const coordinates = `${CAMBRIDGE_CENTER[1]},${CAMBRIDGE_CENTER[0]};${selectedRequest.lng},${selectedRequest.lat}`;
    fetch(
      `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Route unavailable");
        return response.json();
      })
      .then((data) => {
        const route = data.routes?.[0];
        if (!route || !routeMap.current) return;
        const points = route.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng] as L.LatLngTuple,
        );
        L.polyline(points, {
          color: "#F7F9F9",
          weight: 9,
          opacity: 0.92,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(routeMap.current);
        const routeLine = L.polyline(points, {
          color: "#2081C3",
          weight: 6,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(routeMap.current);
        L.polyline(points, {
          color: "#78D5D7",
          weight: 2,
          opacity: 0.9,
          dashArray: "2 12",
          lineCap: "round",
        }).addTo(routeMap.current);
        routeMap.current.fitBounds(routeLine.getBounds(), {
          paddingTopLeft: [60, 60],
          paddingBottomRight: [60, 110],
          maxZoom: 17,
        });
        setRouteDetails({
          minutes: Math.max(1, Math.round(route.duration / 60)),
          miles: Math.round((route.distance / 1609.344) * 10) / 10,
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          L.polyline(
            [
              CAMBRIDGE_CENTER as L.LatLngTuple,
              [selectedRequest.lat, selectedRequest.lng],
            ],
            { color: "#2081C3", weight: 5, opacity: 0.85, dashArray: "7 8" },
          ).addTo(map);
        }
      });

    return () => {
      controller.abort();
      map.remove();
      routeMap.current = null;
    };
  }, [selectedRequest]);
  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages((current) => [
      ...current,
      { from: "me", text: draft.trim(), time: "Just now" },
    ]);
    setDraft("");
  }
  return (
        <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9]">
          <div className="border-b border-[#BED8D4] bg-white">
            <div className="mx-auto max-w-5xl px-6 py-6">
              <div className="grid grid-cols-3">
                {[
                  { label: "Accepted", number: 1 },
                  { label: "In Progress", number: 2 },
                  { label: "Completed", number: 3 },
                ].map((step, index) => {
                  const complete = step.number < stage + 1;
                  const current = step.number === stage;
                  return (
                    <div key={step.label} className="relative text-center">
                      <div
                        className={`absolute left-0 right-0 top-[7px] h-0.5 ${
                          index === 0 ? "left-1/2" : index === 2 ? "right-1/2" : ""
                        } ${complete ? "bg-[#78D5D7]" : "bg-[#BED8D4]"}`}
                      />
                      <span
                        className={`relative mx-auto block h-4 w-4 rounded-full border-[3px] border-white ${
                          current
                            ? "bg-[#2081C3] ring-1 ring-[#2081C3]"
                            : complete
                              ? "bg-[#78D5D7] ring-1 ring-[#78D5D7]"
                              : "bg-[#BED8D4] ring-1 ring-[#BED8D4]"
                        }`}
                      />
                      <span
                        className={`mt-2 block text-xs font-bold ${
                          current ? "text-[#2081C3]" : "text-slate-500"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <section className="relative h-[52vh] min-h-[420px] border-b border-[#BED8D4]">
            <div
              ref={routeMapElement}
              className="absolute inset-0"
              aria-label={`Walking route to ${selectedRequest.title}`}
            />
            <div className="absolute bottom-5 left-1/2 z-[500] flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 items-center rounded-lg border border-[#BED8D4] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#BED8D4]/40 text-[#2081C3]">
                <Icon name="walk" size={21} />
              </span>
              <div className="ml-3">
                <p className="font-extrabold">~{routeDetails.minutes} min</p>
                <p className="mt-0.5 text-xs text-slate-500">{routeDetails.miles} mi</p>
              </div>
              <button className="ml-auto text-sm font-bold text-[#2081C3] hover:underline">
                Directions
              </button>
            </div>
            <div className="absolute right-4 top-4 z-[500] overflow-hidden rounded-md border border-[#BED8D4] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <button
                onClick={() => routeMap.current?.zoomIn()}
                className="grid h-9 w-9 place-items-center border-b border-[#BED8D4] text-lg hover:bg-[#BED8D4]/25"
                aria-label="Zoom route in"
              >
                +
              </button>
              <button
                onClick={() => routeMap.current?.zoomOut()}
                className="grid h-9 w-9 place-items-center text-lg hover:bg-[#BED8D4]/25"
                aria-label="Zoom route out"
              >
                −
              </button>
            </div>
          </section>

          <div className="mx-auto max-w-4xl px-5 py-8">
            <button
              onClick={onBack}
              className="mb-5 flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-[#2081C3]"
            >
              <Icon name="arrow" size={17} /> Back to map
            </button>
            <section className="rounded-lg border border-[#BED8D4] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] sm:p-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Avatar initials={selectedRequest.poster.slice(0, 1)} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#2081C3]">
                      {stage === 1 ? "Accepted" : "In progress"}
                    </p>
                    <h1 className="mt-1 text-xl font-extrabold">{selectedRequest.title}</h1>
                    <p className="mt-1 text-sm text-slate-500">Posted by {selectedRequest.poster}</p>
                  </div>
                </div>
                <p className="text-2xl font-extrabold text-[#2081C3]">{selectedRequest.price}</p>
                <button
                  onClick={() => {
                    if (stage === 1) setStage(2);
                    else onComplete();
                  }}
                  className="rounded-md bg-[#2081C3] px-5 py-3 text-sm font-bold text-white hover:bg-[#176FA9]"
                >
                  {stage === 1 ? "Mark as In Progress" : "Mark as Complete"}
                </button>
              </div>
            </section>

            <section className="mt-8 border-t border-[#BED8D4] pt-8">
              <h2 className="text-lg font-extrabold">Message {selectedRequest.poster}</h2>
              <p className="mt-1 text-sm text-slate-500">Coordinate the details of your quest.</p>
              <div className="mt-6 min-h-[280px] space-y-5">
                {messages.map((message, index) => (
                  <div
                    key={`${message.time}-${index}`}
                    className={`flex flex-col ${message.from === "me" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-lg px-4 py-3 text-sm leading-5 ${
                        message.from === "me"
                          ? "bg-[#63D2FF] text-[#102A3A]"
                          : "bg-[#BED8D4]/55 text-[#102A3A]"
                      }`}
                    >
                      {message.text}
                    </div>
                    <span className="mt-1.5 text-[11px] text-slate-400">{message.time}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="mt-6 flex gap-2">
                <label htmlFor="message" className="sr-only">
                  Send a message
                </label>
                <input
                  id="message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Send a message..."
                  className="h-12 min-w-0 flex-1 rounded-md border border-[#BED8D4] bg-white px-4 text-sm outline-none focus:border-[#2081C3]"
                />
                <button
                  className="grid h-12 w-12 place-items-center rounded-md bg-[#2081C3] text-white hover:bg-[#176FA9]"
                  aria-label="Send message"
                >
                  <Icon name="send" size={19} />
                </button>
              </form>
            </section>
          </div>
        </main>
  );
}
