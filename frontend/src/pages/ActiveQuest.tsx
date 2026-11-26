import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";


import L from "leaflet";


import Icon from "../components/Icon";
import useDismissible from "../hooks/useDismissible";
import Avatar from "../components/Avatar";




import { CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";


import type { Request } from "../data/requests";


type TransportMode = "foot" | "driving" | "cycling";


const transportModes: { id: TransportMode; label: string; icon: "walk" | "car" | "bike" }[] = [


  { id: "foot", label: "Walking", icon: "walk" },


  { id: "cycling", label: "Cycling", icon: "bike" },


  { id: "driving", label: "Driving", icon: "car" },


];


type Props = { selectedRequest: Request; stage: 1 | 2 | 3; setStage: (stage: 1 | 2 | 3) => void; currentKerb: string; onBack: () => void; onComplete: () => void; onCancelled: () => void; onAccept?: () => void; onEdit?: () => void; onDelete?: () => void; onViewUser?: (kerb: string) => void; onMessage?: () => void };


export default function ActiveQuest({selectedRequest, stage, setStage, currentKerb, onBack, onComplete, onCancelled, onAccept, onEdit, onDelete, onViewUser, onMessage}: Props) {


  const [mode, setMode] = useState<TransportMode>("foot");


  const [routeDetails, setRouteDetails] = useState<{ minutes: number; miles: number } | null>(null);
  const [helperLocation, setHelperLocation] = useState<L.LatLngTuple | null>(selectedRequest.helperLocation ? [selectedRequest.helperLocation.lat, selectedRequest.helperLocation.lng] : null);
  const [helperLocationResolved, setHelperLocationResolved] = useState(false);

  const [directionsCollapsed, setDirectionsCollapsed] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const manageMenuRef = useDismissible<HTMLDivElement>(manageMenuOpen, () => setManageMenuOpen(false), "global-popover");
  const directionsRef = useDismissible<HTMLDivElement>(!directionsCollapsed, () => setDirectionsCollapsed(true), "global-popover");


  const [routeError, setRouteError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [stageError, setStageError] = useState("");
  const [actionBusy, setActionBusy] = useState<"cancel" | "progress" | "complete" | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [completionOpen, setCompletionOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [completionImage, setCompletionImage] = useState("");
  const [completionImageName, setCompletionImageName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [extendDeadlineOpen, setExtendDeadlineOpen] = useState(false);
  const [countdownNow, setCountdownNow] = useState(0);
  const isRequester = selectedRequest.requester === currentKerb;
  const isHelper = selectedRequest.helper === currentKerb;
  const questStatus = selectedRequest.status ?? "open";
  const otherKerb = isRequester ? selectedRequest.helper : selectedRequest.requester;
  const [otherUser, setOtherUser] = useState<{ kerb: string; name: string; rating: number | null; reviewCount: number; completedQuests: number; identityVerificationStatus: string } | null>(null);
  const isExpiredQuest = questStatus === "expired" || (questStatus === "open" && Boolean(selectedRequest.expired));
  const graceEndMs = selectedRequest.expirationGraceUntil ? new Date(selectedRequest.expirationGraceUntil).getTime() : selectedRequest.end ? new Date(selectedRequest.end).getTime() + 24 * 60 * 60 * 1000 : 0;
  const graceRemainingMs = Math.max(0, graceEndMs - countdownNow);

  useEffect(() => {
    const initialTick = window.setTimeout(() => setCountdownNow(Date.now()), 0);
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 30_000);
    return () => { window.clearTimeout(initialTick); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const supportsGeolocation = Boolean(navigator.geolocation);
    const resetTimer = window.setTimeout(() => {
      setHelperLocation(null);
      setLocationError(isHelper && !supportsGeolocation ? "Location access is unavailable; showing an approximate campus route." : "");
      setHelperLocationResolved(!isHelper || !supportsGeolocation);
    }, 0);
    if (!isHelper || questStatus !== "in_progress" || !supportsGeolocation) return () => window.clearTimeout(resetTimer);
    let active = true;
    let lastSentAt = 0;
    const onPosition = (position: GeolocationPosition) => {
        if (!active) return;
        const { latitude: lat, longitude: lng } = position.coords;
        setHelperLocation(current => !current || Math.abs(current[0] - lat) > 0.00018 || Math.abs(current[1] - lng) > 0.00018 ? [lat, lng] : current);
        setHelperLocationResolved(true);
        if (Date.now() - lastSentAt >= 25_000) {
          lastSentAt = Date.now();
          void fetch(`/api/requests/${encodeURIComponent(String(selectedRequest.id))}/location`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }),
          }).catch(() => {});
        }
    };
    const onLocationError = () => {
        if (!active) return;
        setHelperLocationResolved(true);
        setLocationError("Allow location access to route from your current location; showing an approximate campus route.");
    };
    const watchId = navigator.geolocation.watchPosition(onPosition, onLocationError, { enableHighAccuracy: true, maximumAge: 20_000 });
    return () => { active = false; window.clearTimeout(resetTimer); navigator.geolocation.clearWatch(watchId); };
  }, [isHelper, questStatus, selectedRequest.id]);

  useEffect(() => {
    if (!isRequester || questStatus !== "in_progress") return;
    let active = true;
    const refreshAcceptorLocation = () => {
      void fetch(`/api/quests/${encodeURIComponent(String(selectedRequest.id))}`)
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          const location = result?.data?.helperLocation;
          if (active && location && Date.now() - new Date(location.updatedAt).getTime() < 2 * 60 * 1000) setHelperLocation(current => !current || Math.abs(current[0] - location.lat) > 0.00018 || Math.abs(current[1] - location.lng) > 0.00018 ? [location.lat, location.lng] : current);
          else if (active) setHelperLocation(null);
        }).catch(() => {});
    };
    refreshAcceptorLocation();
    const timer = window.setInterval(refreshAcceptorLocation, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isRequester, questStatus, selectedRequest.id]);

  useEffect(() => {
    if (!otherKerb) { setOtherUser(null); return; }
    const controller = new AbortController();
    fetch(`/api/user-profiles/${encodeURIComponent(otherKerb)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(data => { if (!controller.signal.aborted) setOtherUser(data); })
      .catch(() => { if (!controller.signal.aborted) setOtherUser(null); });
    return () => controller.abort();
  }, [otherKerb]);

  useEffect(() => {
    if (questStatus !== "completed" || (!isRequester && !isHelper)) return;
    let live = true;
    fetch(`/api/quests/${selectedRequest.id}/review-status`).then(response => response.ok ? response.json() : null)
      .then(result => { if (live) setReviewed(Boolean(result?.reviewed)); }).catch(() => {});
    return () => { live = false; };
  }, [selectedRequest.id, questStatus, isRequester, isHelper]);





  const routeMapElement = useRef<HTMLDivElement>(null);


  const routeMap = useRef<L.Map | null>(null);


  useEffect(() => {


    if (!routeMapElement.current || routeMap.current) return;





    setRouteDetails(null);


    setRouteError("");


    const { lat, lng } = selectedRequest;


    const destination: L.LatLngTuple | null = lat != null && lng != null ? [lat, lng] : null;
    const currentHelperLocation = questStatus === "in_progress" ? helperLocation : null;
    const origin: L.LatLngTuple = currentHelperLocation ?? [CAMBRIDGE_CENTER[0], CAMBRIDGE_CENTER[1]];
    const userArrowAngle = destination
      ? Math.atan2(destination[1] - origin[1], destination[0] - origin[0]) * 180 / Math.PI
      : 0;


    const map = L.map(routeMapElement.current, {


      attributionControl: true,


      minZoom: 14,


      zoomControl: false,


    }).setView(origin, 16);





    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map);





    const userIcon = L.divIcon({


      className: "route-user-marker",


      html: `<span class="route-user-marker__arrow" style="transform:rotate(${userArrowAngle}deg)" aria-hidden="true"></span>`,


      iconSize: [24, 24],


      iconAnchor: [12, 12],


    });


    const destinationIcon = L.divIcon({


      className: "route-destination-marker",


      html: '<span class="route-destination-marker__dot"></span>',


      iconSize: [24, 24],


      iconAnchor: [12, 12],


    });





    if (currentHelperLocation) L.marker(origin, {


      icon: userIcon,


      title: "Current location shared by the quest acceptor",


      zIndexOffset: 1000,


    }).addTo(map);


    routeMap.current = map;


    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ debounceMoveend: true }));


    resizeObserver.observe(routeMapElement.current);


    const controller = new AbortController();





    function cleanup() {


      controller.abort();


      resizeObserver.disconnect();


      map.remove();


      routeMap.current = null;


    }





    if (!destination) return cleanup;





    L.marker(destination, {


      icon: destinationIcon,


      title: selectedRequest.title,


      zIndexOffset: 900,


    }).addTo(map);


    if (isHelper && !helperLocationResolved) {
      map.setView(destination, 16);
      return cleanup;
    }
    map.fitBounds(L.latLngBounds(origin, destination), { padding: [70, 70], maxZoom: 17 });





    const coordinates = `${origin[1]},${origin[0]};${destination[1]},${destination[0]}`;


    const router = mode === "foot" ? "routed-foot" : mode === "cycling" ? "routed-bike" : "routed-car";


    fetch(


      `https://routing.openstreetmap.de/${router}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,


      { signal: controller.signal },


    )


      .then((response) => {


        if (!response.ok) throw new Error("Route unavailable");


        return response.json();


      })


      .then((data) => {


        const route = data.routes?.[0];


        if (!route || controller.signal.aborted) return;


        const points = route.geometry.coordinates.map(


          ([lng, lat]: [number, number]) => [lat, lng] as L.LatLngTuple,


        );


        const routeLine = L.polyline(points, {


          color: "#2081C3",


          weight: 7,


          opacity: 0.95,


          lineCap: "round",


          lineJoin: "round",


        }).addTo(map);


        map.fitBounds(routeLine.getBounds(), {


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


        if (error.name !== "AbortError" && !controller.signal.aborted) {


          setRouteError("Route unavailable for this mode.");


          L.polyline(


            [


              origin,


              destination,


            ],


            { color: "#2081C3", weight: 5, opacity: 0.85, dashArray: "7 8" },


          ).addTo(map);


        }


      });





    return cleanup;


  }, [selectedRequest, mode, helperLocation, helperLocationResolved, isHelper, questStatus]);

  async function advanceQuest() {
    if (actionBusy || !isHelper) return;
    setStageError("");
    if (stage < 3) {
      setActionBusy("progress");
      const nextStage = stage === 1 ? "started" : "picked_up";
      try {
        const response = await fetch(`/api/requests/${selectedRequest.id}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: nextStage }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.msg ?? "Could not update quest progress.");
        setStage(stage === 1 ? 2 : 3);
      } catch (reason) { setStageError(reason instanceof Error ? reason.message : "Could not update quest progress."); }
      finally { setActionBusy(null); }
      return;
    }
  }

  async function cancelQuest(reason: string) {
    if (actionBusy || (!isRequester && !isHelper)) return;
    setStageError("");
    setActionBusy("cancel");
    try {
      const response = await fetch(`/api/requests/${selectedRequest.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not cancel this quest.");
      setCancelDialogOpen(false);
      onCancelled();
    } catch (reason) { setStageError(reason instanceof Error ? reason.message : "Could not cancel this quest."); }
    finally { setActionBusy(null); }
  }

  async function workflowAction(path: string, body?: unknown) {
    setWorkflowBusy(true); setWorkflowError("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not update this quest.");
      onComplete();
    } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not update this quest."); }
    finally { setWorkflowBusy(false); }
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const evidence = String(values.get("evidence") ?? "").trim();
    if (!evidence && !completionImage) {
      setWorkflowError("Upload a receipt image or add notes before marking this quest complete.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const response = await fetch(`/api/requests/${selectedRequest.id}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence, imageUrl: completionImage }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not submit completion for review.");
      setCompletionOpen(false);
      setCompletionImage("");
      setCompletionImageName("");
      onComplete();
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : "Could not submit completion for review.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requesterRatings = { completionQuality: Number(form.get("completionQuality")), communication: Number(form.get("communication")), reliability: Number(form.get("reliability")) };
    const completerRatings = { paymentReliability: Number(form.get("paymentReliability")), descriptionAccuracy: Number(form.get("descriptionAccuracy")), communication: Number(form.get("communication")) };
    const ratings = isRequester ? requesterRatings : completerRatings;
    setWorkflowBusy(true); setWorkflowError("");
    try {
      const response = await fetch(`/api/quests/${selectedRequest.id}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratings, text: form.get("text") }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not save the review.");
      setReviewed(true); setReviewMessage("Review saved.");
    } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not save the review."); }
    finally { setWorkflowBusy(false); }
  }

  async function extendExpiredQuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRequester || !isExpiredQuest || workflowBusy) return;
    const values = new FormData(event.currentTarget);
    const end = new Date(String(values.get("end") ?? ""));
    if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.now()) { setWorkflowError("Choose a future deadline."); return; }
    setWorkflowBusy(true); setWorkflowError("");
    try {
      const response = await fetch(`/api/requests/${selectedRequest.id}/extend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ end: end.toISOString() }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not extend this quest.");
      setExtendDeadlineOpen(false); onComplete();
    } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not extend this quest."); }
    finally { setWorkflowBusy(false); }
  }
  return (


        <main className="isolate min-h-[calc(100vh-64px)] bg-[#F7F9F9]">


          <section className={`relative ${mapExpanded ? "h-[72vh] min-h-[520px]" : "h-[48vh] min-h-[340px]"} border-b border-[#BED8D4] transition-[height] duration-300`}>


            <div


              ref={routeMapElement}


              className="absolute inset-0"


              aria-label={`Walking route to ${selectedRequest.title}`}


            />


            <button type="button" onClick={() => setMapExpanded(value => !value)} aria-label={mapExpanded ? "Shrink map" : "Expand map"} className="absolute right-4 top-4 z-[500] rounded-md border border-[#BED8D4] bg-white px-3 py-2 text-xs font-bold text-[#08679e] shadow-sm">{mapExpanded ? "Smaller map" : "Larger map"}</button>
            {directionsCollapsed ? <button type="button" onClick={() => setDirectionsCollapsed(false)} className="absolute bottom-4 right-4 z-[500] rounded-lg border border-[#BED8D4] bg-white px-4 py-2.5 text-sm font-bold text-[#08679e] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">Directions</button> : <div ref={directionsRef} className="absolute bottom-4 right-4 z-[500] w-[min(320px,calc(100%-32px))] rounded-lg border border-[#BED8D4] bg-white p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">


              <div className="mb-0.5 flex justify-end">
                <button type="button" onClick={() => setDirectionsCollapsed(true)} aria-label="Minimize directions" title="Minimize directions" className="grid h-4 w-4 place-items-center rounded text-slate-600 hover:bg-[#BED8D4]/40"><Icon name="minus" size={12} /></button>
              </div>

              <div className="flex gap-0.5 border-b border-[#BED8D4] pb-1">


                {transportModes.map((item) => (
                  <button key={item.id} type="button" onClick={() => setMode(item.id)} aria-label={item.label} title={item.label} aria-pressed={mode === item.id}
                    className={`flex flex-1 items-center justify-center rounded-md px-1.5 py-1 ${mode === item.id ? "bg-[#2081C3] text-white" : "text-slate-600 hover:bg-[#BED8D4]/40"}`}>
                    <Icon name={item.icon} size={18} />
                  </button>
                ))}


              </div>


              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5 px-0.5">
              <div className="min-w-0">


                {routeDetails ? (


                  <>


                    <p className="font-extrabold">~{routeDetails.minutes} min</p>


                    <p className="mt-0.5 text-xs text-slate-500">{routeDetails.miles} mi</p>


                  </>


                ) : <p className="text-xs text-slate-500">{routeError || (isHelper && !helperLocationResolved ? "Finding your current location…" : "Finding the best route…")}</p>}
                {locationError && <p className="mt-1 text-[10px] text-slate-500">{locationError}</p>}
                {isHelper && questStatus === "in_progress" && <p className="mt-1 text-[10px] text-slate-500">If you allow location access, your current location is shared with the requester while this quest is in progress.</p>}
                {isRequester && questStatus === "in_progress" && !helperLocation && <p className="mt-1 text-[10px] text-slate-500">Waiting for the acceptor to share a current location.</p>}

                <p className="mt-1 truncate text-[10px] text-slate-600" title={selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}><span className="font-semibold text-slate-700">Pickup:</span> {selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}</p>
                <p className="truncate text-[10px] text-slate-600" title={selectedRequest.dropoff || "Not specified"}><span className="font-semibold text-slate-700">Drop-off:</span> {selectedRequest.dropoff || "Not specified"}</p>


              </div>


              <a aria-label="Open directions in Google Maps" className="self-center text-right text-[10px] font-bold text-[#2081C3] hover:underline"


                href={selectedRequest.lat != null && selectedRequest.lng != null


                  ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(helperLocation ? `${helperLocation[0]},${helperLocation[1]}` : selectedRequest.pickup || `${CAMBRIDGE_CENTER[0]},${CAMBRIDGE_CENTER[1]}`)}&destination=${encodeURIComponent(selectedRequest.dropoff || `${selectedRequest.lat},${selectedRequest.lng}`)}&travelmode=${mode === "foot" ? "walking" : mode === "cycling" ? "bicycling" : "driving"}`


                  : undefined} target="_blank" rel="noreferrer">Open in Google Maps</a>


              </div>


            </div>}


            <div className="absolute bottom-4 left-4 z-[500] overflow-hidden rounded-md border border-[#BED8D4] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">


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





          <div className="mx-auto max-h-[50vh] max-w-4xl overflow-y-auto overscroll-contain px-5 py-2" aria-label="Request details">


            <button


              onClick={onBack}


              className="mb-1 flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-[#2081C3]"


            >


              <Icon name="arrow" size={17} /> Back


            </button>


            <section className="py-0">


              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">


                <div className="flex min-w-0 flex-1 items-center gap-4">


                  <div className="min-w-0">
                    <h1 className="text-xl font-extrabold">{selectedRequest.title}</h1>
                    <p className="mt-1 text-sm text-slate-500">Posted by {selectedRequest.poster}</p>
                    <p className="mt-1 text-xs font-semibold capitalize text-slate-500">Quest #{String(selectedRequest.id)} · {selectedRequest.expired && questStatus === "open" ? "expired" : questStatus.replaceAll("_", " ")}</p>
                    <div className="mt-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
                      <p className="min-w-0 break-words"><span className="font-bold text-slate-600">Pickup:</span> {selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}</p>
                      <p className="min-w-0 break-words"><span className="font-bold text-slate-600">Drop-off:</span> {selectedRequest.dropoff || "Not specified"}</p>
                    </div>
                  </div>


                </div>


                <p className="text-2xl font-extrabold text-[#2081C3]">${selectedRequest.reward}</p>


                {stageError && !actionBusy && <p role="alert" className="mr-2 text-sm text-red-700">{stageError}</p>}
                {isRequester && (questStatus === "open" || (isExpiredQuest && graceRemainingMs > 0)) && <div ref={manageMenuRef} className="relative"><button type="button" aria-label="Quest management" aria-expanded={manageMenuOpen} onClick={() => setManageMenuOpen(open => !open)} className="grid h-10 w-10 place-items-center rounded-md border border-[#BED8D4] text-xl font-bold hover:bg-[#E5F1F3]">⋯</button>{manageMenuOpen && <div className="absolute right-0 top-11 z-20 min-w-40 rounded-lg border border-[#BED8D4] bg-white p-1 shadow-lg">{isExpiredQuest ? <><button type="button" onClick={() => { setManageMenuOpen(false); setWorkflowError(""); setExtendDeadlineOpen(true); }} className="block w-full rounded px-3 py-2 text-left text-sm font-semibold hover:bg-[#EAF3F2]">Extend deadline</button><button type="button" onClick={() => { setManageMenuOpen(false); onEdit?.(); }} className="block w-full rounded px-3 py-2 text-left text-sm font-semibold hover:bg-[#EAF3F2]">Repost quest</button></> : <button type="button" onClick={() => { setManageMenuOpen(false); onEdit?.(); }} className="block w-full rounded px-3 py-2 text-left text-sm font-semibold hover:bg-[#EAF3F2]">Edit quest</button>}<button type="button" onClick={() => { setManageMenuOpen(false); onDelete?.(); }} className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50">Delete quest</button></div>}</div>}
                {!isRequester && !isHelper && questStatus === "open" && !selectedRequest.expired && <button type="button" onClick={() => onAccept?.()} className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#2081C3] px-5 py-3 text-sm font-bold text-white hover:bg-[#176FA9]">Accept quest</button>}
                {(isRequester || isHelper) && ["in_progress", "pending_review", "awaiting_payment"].includes(questStatus) && <div className="flex min-w-44 flex-col gap-2">
                  {isRequester && questStatus === "in_progress" && <button type="button" onClick={() => { setWorkflowError(""); setCompletionOpen(true); }} className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-[#2081C3] px-5 py-3 text-sm font-bold text-white hover:bg-[#176FA9]">Mark as complete</button>}
                  {(isRequester || isHelper) && ["in_progress", "pending_review", "awaiting_payment"].includes(questStatus) && <button type="button" disabled={actionBusy !== null} onClick={() => setCancelDialogOpen(true)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-[#BED8D4] px-4 py-3 text-sm font-bold text-slate-600 hover:bg-[#E5F1F3] disabled:opacity-70">
                    {actionBusy === "cancel" ? <span role="status" aria-label="Cancelling" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : "Cancel quest"}
                  </button>}
                </div>}

                {isHelper && questStatus === "in_progress" && stage < 3 && <button type="button" disabled={actionBusy !== null || workflowBusy} onClick={() => { void advanceQuest(); }} className="inline-flex min-h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-[#2081C3] px-5 py-3 text-sm font-bold text-white hover:bg-[#176FA9] disabled:opacity-70">
                  {actionBusy === "progress" ? <span role="status" aria-label="Saving progress" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : stage === 1 ? "Mark as In Progress" : "Mark pickup complete"}
                </button>}


              </div>

              {isExpiredQuest && isRequester && <section className="mt-4 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                <p className="font-semibold text-slate-700">{selectedRequest.lastCancellation?.role === "acceptor" ? "The acceptor cancelled. Your quest has expired." : "Your quest has expired."}</p>
                <p className="mt-1 text-slate-600">Extend your deadline to make this quest available again. {graceRemainingMs > 0 ? `This quest will be automatically removed in ${Math.floor(graceRemainingMs / 3_600_000)}h ${Math.floor((graceRemainingMs % 3_600_000) / 60_000)}m.` : "This quest is being archived."}</p>
                {graceRemainingMs > 0 && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setWorkflowError(""); setExtendDeadlineOpen(true); }} className="rounded-md bg-[#2081C3] px-4 py-2 font-bold text-white">Extend deadline</button><button type="button" onClick={() => onEdit?.()} className="rounded-md border border-[#BED8D4] px-4 py-2 font-bold">Repost quest</button><button type="button" onClick={() => onDelete?.()} className="rounded-md border border-red-200 px-4 py-2 font-bold text-red-700">Delete quest</button></div>}
              </section>}

              {isRequester && questStatus === "open" && selectedRequest.lastCancellation?.role === "acceptor" && <p className="mt-3 rounded-lg bg-[#EAF3F2] p-3 text-sm text-[#08679e]">The acceptor cancelled. Your quest has been reopened.</p>}


              <dl className="mt-6 grid gap-4 border-t border-[#BED8D4] pt-5 text-sm sm:grid-cols-2">


                <div><dt className="text-xs font-bold uppercase text-slate-500">Posted</dt><dd className="mt-1 font-semibold">{selectedRequest.posted || "Posting time unavailable"}</dd></div>


                <div><dt className="text-xs font-bold uppercase text-slate-500">Deadline</dt><dd className="mt-1 font-semibold">{selectedRequest.end ? new Date(selectedRequest.end).toLocaleString() : "No deadline provided"}</dd></div>


              </dl>

              <section className="mt-5 grid gap-3">
                <div><h2 className="text-sm font-bold uppercase text-slate-500">Quest details</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selectedRequest.description}</p></div>
                <p className="text-sm"><span className="font-semibold">Category:</span> {selectedRequest.category}</p>
                {selectedRequest.imageUrl && <figure><img src={selectedRequest.imageUrl} alt={`Photo attached to ${selectedRequest.title}`} className="max-h-72 rounded-lg object-contain" /><figcaption className="mt-1 text-xs text-slate-500">Quest attachment</figcaption></figure>}
              </section>

              {otherKerb && <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#BED8D4] bg-white p-4">
                <div className="flex min-w-0 items-center gap-3"><Avatar initials={(otherUser?.name ?? otherKerb).slice(0, 1).toUpperCase()} /><div className="min-w-0"><p className="text-xs font-bold uppercase text-slate-500">{isRequester ? "Completer" : "Requester"}</p><p className="truncate font-bold">{otherUser?.name ?? otherKerb}</p><p className="text-xs text-slate-500">{otherUser?.rating == null ? "No ratings yet" : `★ ${otherUser.rating.toFixed(1)} · ${otherUser.reviewCount} reviews`} · ${otherUser?.completedQuests ?? 0} completed quests{otherUser?.identityVerificationStatus === "verified" ? " · University verified" : ""}</p></div></div>
                <div className="flex gap-2">{onViewUser && <button type="button" onClick={() => onViewUser(otherKerb)} className="rounded-lg border border-[#BED8D4] px-3 py-2 text-sm font-semibold">View profile</button>}{(isRequester || isHelper) && onMessage && <button type="button" onClick={onMessage} className="rounded-lg border border-[#BED8D4] px-3 py-2 text-sm font-semibold">Message</button>}</div>
              </section>}

              {(isRequester || isHelper) && <section className="mt-5 grid gap-4 border-t border-[#BED8D4] pt-5">
                {cancelDialogOpen && <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#102A3A]/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="cancel-quest-title" className="w-full max-w-lg rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 id="cancel-quest-title" className="text-xl font-extrabold">Cancel quest</h2><button type="button" disabled={actionBusy === "cancel"} onClick={() => setCancelDialogOpen(false)} aria-label="Close cancellation form" className="rounded-md p-2 hover:bg-[#BED8D4]/40 disabled:opacity-50"><Icon name="x" size={20} /></button></div><p className="text-sm text-slate-600">{isHelper ? "Your assignment will be cancelled. If no work has started and the deadline is still open, the quest will return to the marketplace." : "This will cancel the quest for its current acceptor."}</p><form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void cancelQuest(String(values.get("reason") ?? "").trim()); }}><label className="grid gap-1 text-sm font-semibold">Reason for cancellation<textarea name="reason" required minLength={3} maxLength={500} className="min-h-24 resize-none rounded-md border border-[#BED8D4] bg-white p-3 font-normal" placeholder="Briefly explain why you’re cancelling." /></label>{stageError && <p role="alert" className="text-sm text-red-700">{stageError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={actionBusy === "cancel"} onClick={() => setCancelDialogOpen(false)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold">Keep quest</button><button type="submit" disabled={actionBusy === "cancel"} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{actionBusy === "cancel" ? "Cancelling…" : "Confirm cancellation"}</button></div></form></section></div>}
                {questStatus === "pending_review" && <p className="rounded-lg bg-[#EAF3F2] p-3 text-sm">{isRequester ? "Review the submitted completion." : "Waiting for the requester to review your submission."}</p>}
                {questStatus === "awaiting_payment" && <p className="rounded-lg bg-[#EAF3F2] p-3 text-sm">{isRequester ? `Send the agreed $${selectedRequest.reward} reward.` : `Waiting for your $${selectedRequest.reward} reward.`}</p>}
                {questStatus === "payment_sent" && <p className="rounded-lg bg-[#EAF3F2] p-3 text-sm">{isRequester ? "Waiting for the completer to confirm receipt." : "Confirm that you received your reward."}</p>}
                {completionOpen && questStatus === "in_progress" && isRequester && createPortal(<div className="fixed inset-0 z-[9999] grid place-items-center bg-[#102A3A]/55 p-4">
                  <section role="dialog" aria-modal="true" aria-labelledby="completion-dialog-title" className="relative max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-6 shadow-2xl">
                    <button type="button" onClick={() => { setCompletionOpen(false); setWorkflowError(""); }} disabled={workflowBusy} aria-label="Close completion form" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-xl text-slate-600 hover:bg-[#E5F1F3] disabled:opacity-50">×</button>
                    <h2 id="completion-dialog-title" className="pr-10 text-xl font-extrabold">Mark quest complete</h2>
                    <p className="mt-1 text-sm text-slate-600">Add a receipt photo or notes about the completed work. You can still arrange the external reward separately.</p>
                    <form onSubmit={submitCompletion} className="mt-5 grid gap-3">
                      <label className="grid gap-1 text-sm font-semibold">Receipt photo (optional)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        setCompletionImage(""); setCompletionImageName(""); setWorkflowError("");
                        if (!file) return;
                        if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type) || file.size > 5 * 1024 * 1024) { setWorkflowError("Choose a PNG, JPEG, WebP, or GIF image under 5 MB."); event.currentTarget.value = ""; return; }
                        const reader = new FileReader();
                        reader.onload = () => { if (typeof reader.result === "string") { setCompletionImage(reader.result); setCompletionImageName(file.name); } };
                        reader.onerror = () => setWorkflowError("Could not read that image. Try another file.");
                        reader.readAsDataURL(file);
                      }} className="rounded-md border border-[#BED8D4] bg-white p-3 font-normal" />{completionImageName && <span className="text-xs font-normal text-slate-600">Selected: {completionImageName}</span>}</label>
                      <label className="grid gap-1 text-sm font-semibold">Completion notes (optional)<textarea name="evidence" maxLength={4000} placeholder="Add notes about the completed quest." className="min-h-20 resize-none rounded-md border border-[#BED8D4] bg-white p-3 font-normal" /></label>
                      {workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}
                      <button disabled={workflowBusy} className="mt-1 w-full rounded-md bg-[#2081C3] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Mark as complete"}</button>
                    </form>
                  </section>
                </div>, document.body)}
                {extendDeadlineOpen && isRequester && isExpiredQuest && createPortal(<div className="fixed inset-0 z-[10000] grid place-items-center bg-[#102A3A]/55 p-4">
                  <section role="dialog" aria-modal="true" aria-labelledby="extend-deadline-title" className="w-full max-w-lg rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-6 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between"><h2 id="extend-deadline-title" className="text-xl font-extrabold">Extend quest deadline</h2><button type="button" disabled={workflowBusy} onClick={() => setExtendDeadlineOpen(false)} aria-label="Close deadline extension" className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-600 hover:bg-[#E5F1F3] disabled:opacity-50">×</button></div>
                    <p className="text-sm text-slate-600">Set a new future deadline to reopen this quest on the marketplace.</p>
                    <form onSubmit={extendExpiredQuest} className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold">New deadline<input name="end" type="datetime-local" required min={new Date(countdownNow + 60_000 - new Date(countdownNow).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} className="rounded-md border border-[#BED8D4] bg-white p-3 font-normal" /></label>{workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={workflowBusy} onClick={() => setExtendDeadlineOpen(false)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold">Cancel</button><button type="submit" disabled={workflowBusy} className="rounded-lg bg-[#2081C3] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Extend deadline"}</button></div></form>
                  </section>
                </div>, document.body)}
                {questStatus === "pending_review" && <div className="grid gap-2 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                  <h3 className="font-bold">Completion submitted</h3><p>{selectedRequest.completionSubmission?.description}</p>{selectedRequest.completionSubmission?.evidence && <p className="text-slate-600">Evidence notes: {selectedRequest.completionSubmission.evidence}</p>}
                  {isRequester && <button type="button" disabled={workflowBusy} onClick={() => void workflowAction(`/api/requests/${selectedRequest.id}/approve-completion`)} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Approve completion"}</button>}
                  {isHelper && <p className="text-slate-600">Waiting for the requester to review the work.</p>}
                </div>}
                {questStatus === "awaiting_payment" && <div className="grid gap-2 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                  <h3 className="font-bold">Arrange the reward directly</h3><p>SideQuest does not collect, hold, or verify payment. Contact the other participant if needed.</p>
                  {selectedRequest.completionReceipt?.imageUrl && <figure><img src={selectedRequest.completionReceipt.imageUrl} alt="Receipt submitted by the requester" className="max-h-64 rounded-lg object-contain" /><figcaption className="mt-1 text-xs text-slate-500">Receipt image provided by the requester</figcaption></figure>}
                  {selectedRequest.completionReceipt?.evidence && <p className="text-slate-600">Completion notes: {selectedRequest.completionReceipt.evidence}</p>}
                  {selectedRequest.agreementSnapshot?.paymentMethod && <p>Preferred method: <strong>{selectedRequest.agreementSnapshot.paymentMethod}</strong></p>}
                  {selectedRequest.agreementSnapshot?.paymentInstructions && <p>Payment details: {selectedRequest.agreementSnapshot.paymentInstructions}</p>}
                  {isRequester && <button type="button" disabled={workflowBusy} onClick={() => void workflowAction(`/api/requests/${selectedRequest.id}/payment-sent`)} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "I sent the reward"}</button>}
                </div>}
                {questStatus === "payment_sent" && <div className="grid gap-2 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                  <p>The requester says they sent the reward. This is self-reported and has not been verified by SideQuest.</p>
                  {isHelper && <button type="button" disabled={workflowBusy} onClick={() => void workflowAction(`/api/requests/${selectedRequest.id}/confirm-payment`)} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Confirm I received it"}</button>}
                </div>}
                {questStatus === "completed" && <p className="rounded-lg bg-[#E5F1F3] p-3 text-sm">Both participants have self-reported that the external reward was received. SideQuest does not verify the transaction.</p>}
                {workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}
                {reviewMessage && <p role="status" className="text-sm text-green-700">{reviewMessage}</p>}
                {questStatus === "completed" && !reviewed && <form onSubmit={submitReview} className="grid gap-3 rounded-lg border border-[#BED8D4] bg-white p-4">
                  <h3 className="font-bold">Review this quest</h3>
                  {(isRequester ? [["completionQuality", "Completion quality"], ["communication", "Communication"], ["reliability", "Reliability"]] : [["paymentReliability", "Payment reliability"], ["descriptionAccuracy", "Description accuracy"], ["communication", "Communication"]]).map(([name, label]) => <label key={name} className="flex items-center justify-between gap-3 text-sm">{label}<select name={name} required defaultValue="" className="rounded border border-[#BED8D4] p-2"><option value="" disabled>Rate</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>)}
                  <textarea name="text" maxLength={1000} placeholder="Optional written review" className="min-h-16 rounded-md border border-[#BED8D4] p-3 text-sm" />
                  <button disabled={workflowBusy} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Submit review"}</button>
                </form>}
                {questStatus !== "disputed" && questStatus !== "cancelled" && questStatus !== "completed" && <div className="grid gap-3">
                  {!reportOpen ? <button type="button" onClick={() => setReportOpen(true)} className="w-fit rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Report problem</button> : <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void workflowAction(`/api/requests/${selectedRequest.id}/disputes`, { reason: values.get("reason"), description: values.get("description"), evidence: values.get("evidence") }); }} className="grid gap-3 rounded-lg border border-red-200 bg-red-50/50 p-4">
                    <h3 className="font-bold">Report a problem with this quest</h3><select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] bg-white p-2 text-sm"><option value="" disabled>Choose a reason</option>{["Requester failed to pay", "Completer failed to complete the quest", "Quest requirements were misrepresented", "Payment amount was incorrect", "Harassment or inappropriate behavior", "Other"].map(reason => <option key={reason}>{reason}</option>)}</select><textarea name="description" required maxLength={2000} placeholder="Describe the issue" className="min-h-16 rounded-md border border-[#BED8D4] bg-white p-3 text-sm" /><textarea name="evidence" maxLength={4000} placeholder="Evidence notes (text only)" className="min-h-14 rounded-md border border-[#BED8D4] bg-white p-3 text-sm" /><button disabled={workflowBusy} className="w-fit rounded-md border border-red-300 px-4 py-2 text-sm font-bold">{workflowBusy ? "Submitting…" : "Open a dispute"}</button>
                  </form>}
                </div>}
              </section>}


            </section>






          </div>
        </main>


  );
}
