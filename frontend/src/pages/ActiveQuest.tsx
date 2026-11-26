import { apiFetch } from "../api";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";


import L from "leaflet";


import Icon from "../components/Icon";
import useDismissible from "../hooks/useDismissible";
import Avatar from "../components/Avatar";




import { CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";


import type { Request } from "../data/requests";
import { uploadImage } from "../data/imageUpload";


type TransportMode = "foot" | "driving" | "cycling";


const transportModes: { id: TransportMode; label: string; icon: "walk" | "car" | "bike" }[] = [


  { id: "foot", label: "Walking", icon: "walk" },


  { id: "cycling", label: "Cycling", icon: "bike" },


  { id: "driving", label: "Driving", icon: "car" },


];

let lastRouteRequestAt = 0;


type Props = { selectedRequest: Request; stage: 1 | 2 | 3; setStage: (stage: 1 | 2 | 3) => void; currentKerb: string; onBack: () => void; onComplete: () => void; onCancelled: (status?: string, cancellation?: Request["lastCancellation"]) => void; onAccept?: () => void; onEdit?: () => void; onDelete?: () => void; onViewUser?: (kerb: string) => void; onMessage?: () => void };


export default function ActiveQuest({selectedRequest, stage, setStage, currentKerb, onBack, onComplete, onCancelled, onAccept, onEdit, onDelete, onViewUser, onMessage}: Props) {


  const [mode, setMode] = useState<TransportMode>("foot");


  const [routeDetails, setRouteDetails] = useState<{ minutes: number; miles: number } | null>(null);
  const [helperLocation, setHelperLocation] = useState<L.LatLngTuple | null>(selectedRequest.helperLocation ? [selectedRequest.helperLocation.lat, selectedRequest.helperLocation.lng] : null);
  const [helperLocationResolved, setHelperLocationResolved] = useState(false);

  const [directionsCollapsed, setDirectionsCollapsed] = useState(false);
  const [mapHeight, setMapHeight] = useState(() => Math.round(window.innerHeight * 0.48));
  const mapResizeStart = useRef<{ y: number; height: number } | null>(null);
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
  const [completionImageId, setCompletionImageId] = useState("");
  const [completionImageUploading, setCompletionImageUploading] = useState(false);
  const [completionImageName, setCompletionImageName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewEligible, setReviewEligible] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const reviewStarRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const defaultMapHeight = Math.round(window.innerHeight * 0.48);
  const maxMapHeight = Math.round(window.innerHeight * 0.85);
  const mapExpanded = mapHeight > defaultMapHeight + 20;

  function resizeMapTo(height: number) {
    setMapHeight(Math.max(240, Math.min(maxMapHeight, Math.round(height))));
  }

  function onMapResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    mapResizeStart.current = { y: event.clientY, height: mapHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onMapResizePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!mapResizeStart.current) return;
    resizeMapTo(mapResizeStart.current.height + event.clientY - mapResizeStart.current.y);
  }

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
    let firstFixReceived = false;
    let preciseWatchId: number | null = null;
    const firstFixTimer = window.setTimeout(() => {
      if (!active || firstFixReceived) return;
      setHelperLocationResolved(true);
      setLocationError("Location is taking too long; showing an approximate campus route while we keep trying.");
    }, 12_000);
    const onPosition = (position: GeolocationPosition) => {
        if (!active) return;
        firstFixReceived = true;
        window.clearTimeout(firstFixTimer);
        const { latitude: lat, longitude: lng } = position.coords;
        setLocationError("");
        setHelperLocation(current => !current || Math.abs(current[0] - lat) > 0.00003 || Math.abs(current[1] - lng) > 0.00003 ? [lat, lng] : current);
        setHelperLocationResolved(true);
        if (position.coords.accuracy > 100 && preciseWatchId == null) {
          preciseWatchId = navigator.geolocation.watchPosition(onPosition, onLocationError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
        }
        if (Date.now() - lastSentAt >= 25_000) {
          lastSentAt = Date.now();
          void apiFetch(`/api/requests/${encodeURIComponent(String(selectedRequest.id))}/location`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }),
          }).catch(() => {});
        }
    };
    const onLocationError = (error: GeolocationPositionError) => {
        if (!active) return;
        setHelperLocationResolved(true);
        window.clearTimeout(firstFixTimer);
        setLocationError(error.code === error.PERMISSION_DENIED
          ? "Location access is blocked. Allow it in browser settings to route from your current location; showing an approximate campus route."
          : error.code === error.TIMEOUT
            ? "Location is taking too long; showing an approximate campus route while we keep trying."
            : "Current location is unavailable; showing an approximate campus route.");
    };
    const watchId = navigator.geolocation.watchPosition(onPosition, onLocationError, { enableHighAccuracy: false, maximumAge: 20_000, timeout: 12_000 });
    return () => { active = false; window.clearTimeout(resetTimer); window.clearTimeout(firstFixTimer); navigator.geolocation.clearWatch(watchId); if (preciseWatchId != null) navigator.geolocation.clearWatch(preciseWatchId); };
  }, [isHelper, questStatus, selectedRequest.id]);

  useEffect(() => {
    if (!isRequester || questStatus !== "in_progress") return;
    let active = true;
    let requestInFlight = false;
    const controller = new AbortController();
    const refreshAcceptorLocation = () => {
      if (requestInFlight) return;
      requestInFlight = true;
      void apiFetch(`/api/quests/${encodeURIComponent(String(selectedRequest.id))}`, { signal: controller.signal, cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          const location = result?.data?.helperLocation;
          if (active && location && Date.now() - new Date(location.updatedAt).getTime() < 2 * 60 * 1000) setHelperLocation(current => !current || Math.abs(current[0] - location.lat) > 0.00018 || Math.abs(current[1] - location.lng) > 0.00018 ? [location.lat, location.lng] : current);
          else if (active) setHelperLocation(null);
        }).catch(() => {}).finally(() => { requestInFlight = false; });
    };
    refreshAcceptorLocation();
    const timer = window.setInterval(refreshAcceptorLocation, 5_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [isRequester, questStatus, selectedRequest.id]);

  useEffect(() => {
    if (!otherKerb) { setOtherUser(null); return; }
    const controller = new AbortController();
    apiFetch(`/api/user-profiles/${encodeURIComponent(otherKerb)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(data => { if (!controller.signal.aborted) setOtherUser(data); })
      .catch(() => { if (!controller.signal.aborted) setOtherUser(null); });
    return () => controller.abort();
  }, [otherKerb]);

  useEffect(() => {
    if (questStatus !== "completed" || (!isRequester && !isHelper)) return;
    let live = true;
    apiFetch(`/api/quests/${selectedRequest.id}/review-status`).then(response => response.ok ? response.json() : null)
      .then(result => { if (live) { const submitted = Boolean(result?.reviewed); setReviewed(submitted); setReviewEligible(Boolean(result?.eligible)); if (!submitted && result?.eligible) setReviewOpen(true); } }).catch(() => {});
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
    let routeRequestTimer = 0;
    let routeTimeoutTimer = 0;
    let routeTimedOut = false;
    let fallbackLine: L.Polyline | null = null;

    function cleanup() {


      controller.abort();
      window.clearTimeout(routeRequestTimer);
      window.clearTimeout(routeTimeoutTimer);


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
    const setDirectEstimate = () => {
      const miles = L.latLng(origin).distanceTo(L.latLng(destination)) / 1609.344;
      const milesPerHour = mode === "foot" ? 3 : mode === "cycling" ? 10 : 18;
      setRouteDetails({ minutes: Math.max(1, Math.round(miles / milesPerHour * 60)), miles: Math.round(miles * 10) / 10 });
    };

    fallbackLine = L.polyline([origin, destination], {
      color: "#2081C3", weight: 5, opacity: 0.65, dashArray: "7 8",
    }).addTo(map);

    const requestRoute = () => {
      if (controller.signal.aborted) return;
      lastRouteRequestAt = Date.now();
      routeTimeoutTimer = window.setTimeout(() => { routeTimedOut = true; controller.abort(); }, 10_000);
      void apiFetch(


      `https://routing.openstreetmap.de/${router}/route/v1/driving/${coordinates}?overview=simplified&geometries=geojson&steps=false`,


      { signal: controller.signal },


    )


      .then((response) => {


        if (!response.ok) throw new Error("Route unavailable");


        return response.json();


      })


      .then((data) => {


        const route = data.routes?.[0];


        if (controller.signal.aborted) return;
        if (!route?.geometry?.coordinates?.length) throw new Error("Route unavailable");


        const points = route.geometry.coordinates.map(


          ([lng, lat]: [number, number]) => [lat, lng] as L.LatLngTuple,


        );


        if (fallbackLine) map.removeLayer(fallbackLine);
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


        if (routeTimedOut) {
          setRouteError("Route is taking too long; showing a direct estimate.");
          setDirectEstimate();
        } else if (error.name !== "AbortError" && !controller.signal.aborted) {


          setRouteError("Route unavailable for this mode; showing a direct estimate.");
          setDirectEstimate();


        }


      }).finally(() => window.clearTimeout(routeTimeoutTimer));
    };
    routeRequestTimer = window.setTimeout(requestRoute, Math.max(0, 1_000 - (Date.now() - lastRouteRequestAt)));





    return cleanup;


  }, [selectedRequest, mode, helperLocation, helperLocationResolved, isHelper, questStatus]);

  async function advanceQuest() {
    if (actionBusy || !isHelper) return;
    setStageError("");
    if (stage < 3) {
      setActionBusy("progress");
      const nextStage = stage === 1 ? "started" : "picked_up";
      try {
        const response = await apiFetch(`/api/requests/${selectedRequest.id}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: nextStage }) });
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
      const response = await apiFetch(`/api/requests/${selectedRequest.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not cancel this quest.");
      setCancelDialogOpen(false);
      onCancelled(result.status, result.cancellation);
    } catch (reason) { setStageError(reason instanceof Error ? reason.message : "Could not cancel this quest."); }
    finally { setActionBusy(null); }
  }

  async function workflowAction(path: string, body?: unknown, onSuccess?: () => void) {
    setWorkflowBusy(true); setWorkflowError("");
    try {
      const response = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not update this quest.");
      onSuccess?.();
      onComplete();
    } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not update this quest."); }
    finally { setWorkflowBusy(false); }
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const evidence = String(values.get("evidence") ?? "").trim();
    if (completionImageUploading) {
      setWorkflowError("Wait for the receipt image to finish uploading.");
      return;
    }
    if (!evidence || evidence.length > 150) {
      setWorkflowError("Describe the completed work in 150 characters or fewer.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const response = await apiFetch(`/api/requests/${selectedRequest.id}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence, ...(completionImageId ? { imageId: completionImageId } : {}) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not submit completion for review.");
      setCompletionOpen(false);
      setCompletionImageId("");
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
    if (reviewRating < 1 || reviewRating > 5) { setWorkflowError("Choose a star rating before submitting."); return; }
    const form = new FormData(event.currentTarget);
    setWorkflowBusy(true); setWorkflowError("");
    try {
      const response = await apiFetch(`/api/quests/${selectedRequest.id}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: reviewRating, tags: reviewTags, text: form.get("text") }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not save the review.");
      setReviewed(true); setReviewOpen(false); setReviewMessage(result?.data?.published ? "Review published. Thanks for sharing your experience." : "Review saved privately. It will be published when both participants submit or after 14 days.");
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
      const response = await apiFetch(`/api/requests/${selectedRequest.id}/extend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ end: end.toISOString() }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not extend this quest.");
      setExtendDeadlineOpen(false); onComplete();
    } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not extend this quest."); }
    finally { setWorkflowBusy(false); }
  }
  return (


        <main className="isolate min-h-[calc(100vh-64px)] bg-[#F7F9F9]">


          <section style={{ height: mapHeight, maxHeight: "85vh" }} className="relative min-h-[240px] border-b border-[#BED8D4]">


            <div


              ref={routeMapElement}


              className="absolute inset-0"


              aria-label={`Walking route to ${selectedRequest.title}`}


            />


            <button type="button" onClick={() => resizeMapTo(mapExpanded ? defaultMapHeight : Math.round(window.innerHeight * 0.72))} aria-label={mapExpanded ? "Shrink map" : "Expand map"} className="absolute right-4 top-4 z-[500] rounded-md border border-[#BED8D4] bg-white px-3 py-2 text-xs font-bold text-[#08679e] shadow-sm">{mapExpanded ? "Smaller map" : "Larger map"}</button>
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

            <button
              type="button"
              aria-label={`Resize route map, currently ${mapHeight} pixels tall`}
              title="Drag to resize map; use arrow keys to adjust"
              onPointerDown={onMapResizePointerDown}
              onPointerMove={onMapResizePointerMove}
              onPointerUp={() => { mapResizeStart.current = null; }}
              onPointerCancel={() => { mapResizeStart.current = null; }}
              onKeyDown={event => {
                if (event.key === "ArrowUp") { event.preventDefault(); resizeMapTo(mapHeight + 40); }
                if (event.key === "ArrowDown") { event.preventDefault(); resizeMapTo(mapHeight - 40); }
                if (event.key === "Home") { event.preventDefault(); resizeMapTo(240); }
                if (event.key === "End") { event.preventDefault(); resizeMapTo(maxMapHeight); }
              }}
              className="absolute bottom-0 left-1/2 z-[501] flex h-5 w-20 -translate-x-1/2 touch-none items-center justify-center rounded-t-lg border border-b-0 border-[#BED8D4] bg-white/95 shadow-sm cursor-row-resize"
            >
              <span aria-hidden="true" className="h-1 w-9 rounded-full bg-slate-400" />
            </button>


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
                      <label className="grid gap-1 text-sm font-semibold">Receipt photo (optional)<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={async event => {
                        const file = event.currentTarget.files?.[0];
                        setCompletionImageId(""); setCompletionImageName(""); setWorkflowError("");
                        if (!file) return;
                        setCompletionImageUploading(true);
                        try {
                          const uploaded = await uploadImage(file, "completion");
                          setCompletionImageId(uploaded.id); setCompletionImageName(file.name);
                        } catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not upload that image."); event.currentTarget.value = ""; }
                        finally { setCompletionImageUploading(false); }
                      }} className="rounded-md border border-[#BED8D4] bg-white p-3 font-normal" />{completionImageUploading && <span className="text-xs font-normal text-slate-500">Uploading image…</span>}{completionImageName && <span className="text-xs font-normal text-slate-600">Selected: {completionImageName}</span>}</label>
                      <label className="grid gap-1 text-sm font-semibold">Completion notes<textarea name="evidence" required maxLength={150} placeholder="Describe the completed work." className="min-h-20 resize-none rounded-md border border-[#BED8D4] bg-white p-3 font-normal" /><span className="text-xs font-normal text-slate-500">Up to 150 characters</span></label>
                      {workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}
                      <button disabled={workflowBusy || completionImageUploading} className="mt-1 w-full rounded-md bg-[#2081C3] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{completionImageUploading ? "Uploading image…" : workflowBusy ? "Saving…" : "Mark as complete"}</button>
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
                {questStatus === "completed" && reviewEligible && !reviewed && <button type="button" onClick={() => { setWorkflowError(""); setReviewOpen(true); }} className="w-fit rounded-md border border-[#BED8D4] px-4 py-2 text-sm font-bold text-[#08679e]">Leave a review</button>}
                {questStatus !== "disputed" && questStatus !== "cancelled" && questStatus !== "completed" && <div className="grid gap-3">
                  <button type="button" onClick={() => setReportOpen(true)} className="w-fit rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Report problem</button>
                  {reportOpen && createPortal(<div className="fixed inset-0 z-[10001] grid place-items-center bg-[#102A3A]/55 p-4">
                    <section role="dialog" aria-modal="true" aria-labelledby="report-problem-title" className="w-full max-w-lg rounded-2xl border border-red-200 bg-[#F7F9F9] p-6 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between gap-3"><h2 id="report-problem-title" className="text-xl font-extrabold">Report a problem with this quest</h2><button type="button" disabled={workflowBusy} onClick={() => setReportOpen(false)} aria-label="Close report form" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-slate-600 hover:bg-[#E5F1F3] disabled:opacity-50">×</button></div>
                      <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void workflowAction(`/api/requests/${selectedRequest.id}/disputes`, { reason: values.get("reason"), description: values.get("description"), evidence: values.get("evidence") }, () => setReportOpen(false)); }} className="grid gap-3">
                        <select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] bg-white p-3 text-sm"><option value="" disabled>Choose a reason</option>{["Requester failed to pay", "Completer failed to complete the quest", "Quest requirements were misrepresented", "Payment amount was incorrect", "Harassment or inappropriate behavior", "Other"].map(reason => <option key={reason}>{reason}</option>)}</select>
                        <textarea name="description" required maxLength={2000} placeholder="Describe the issue" className="min-h-24 resize-none rounded-md border border-[#BED8D4] bg-white p-3 text-sm" />
                        <textarea name="evidence" maxLength={4000} placeholder="Evidence notes (text only)" className="min-h-16 resize-none rounded-md border border-[#BED8D4] bg-white p-3 text-sm" />
                        {workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}
                        <div className="flex justify-end gap-2"><button type="button" disabled={workflowBusy} onClick={() => setReportOpen(false)} className="rounded-lg border border-[#BED8D4] px-4 py-2 text-sm font-bold disabled:opacity-50">Cancel</button><button disabled={workflowBusy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{workflowBusy ? "Submitting…" : "Open a dispute"}</button></div>
                      </form>
                    </section>
                  </div>, document.body)}
                </div>}
              </section>}

              {reviewOpen && questStatus === "completed" && reviewEligible && !reviewed && createPortal(<div className="fixed inset-0 z-[10003] grid place-items-center bg-[#102A3A]/55 p-4">
                <section role="dialog" aria-modal="true" aria-labelledby="quest-review-title" className="max-h-[min(92dvh,850px)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#BED8D4] bg-[#F7F9F9] p-5 shadow-2xl sm:p-7">
                  <div className="mb-5 flex justify-end"><button type="button" onClick={() => setReviewOpen(false)} aria-label="Close review" className="rounded-full px-2 text-2xl leading-none text-slate-500 hover:bg-[#E5F1F3]">×</button></div>
                  <form onSubmit={submitReview} className="grid gap-5">
                    <div className="text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#E5F1F3] text-3xl text-[#08679e]"><Icon name="user" size={28} /></div><h2 id="quest-review-title" className="mt-3 text-2xl font-extrabold">How was your experience?</h2><p className="mt-1 text-slate-500">{selectedRequest.title ?? selectedRequest.description}</p><p className="text-sm text-slate-500">Reviewing {otherUser?.name ?? otherKerb}</p>
                      <div role="radiogroup" aria-label="Rating from one to five stars" className="mt-4 flex justify-center gap-2">{[1, 2, 3, 4, 5].map(value => <button key={value} ref={element => { reviewStarRefs.current[value - 1] = element; }} type="button" role="radio" aria-checked={reviewRating === value} aria-label={`${value} ${value === 1 ? "star" : "stars"}`} onKeyDown={event => { if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 1 : event.key === "End" ? 5 : Math.max(1, Math.min(5, value + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1))); setReviewRating(next); reviewStarRefs.current[next - 1]?.focus(); } }} onClick={() => setReviewRating(value)} className={`text-4xl transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2081C3] ${value <= reviewRating ? "text-amber-400" : "text-slate-300"}`}>★</button>)}</div>
                      {reviewRating > 0 && <p className="mt-1 font-semibold text-slate-700">{["", "Poor", "Fair", "Good", "Very good", "Excellent"][reviewRating]}</p>}
                    </div>
                    <hr className="border-[#BED8D4]" />
                    <fieldset><legend className="mb-3 text-lg font-bold">What stood out?</legend><div className="flex flex-wrap gap-2">{(isRequester ? ["On time", "Good communication", "Followed instructions", "Reliable", "Quality work"] : ["Clear instructions", "Responsive", "Respectful", "Fair reward", "Prompt payment"]).map(tag => { const active = reviewTags.includes(tag); return <button type="button" key={tag} aria-pressed={active} onClick={() => setReviewTags(current => active ? current.filter(value => value !== tag) : [...current, tag])} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? "border-[#2081C3] bg-[#E5F1F3] text-[#08679e]" : "border-[#BED8D4] bg-white text-slate-600 hover:border-[#2081C3]"}`}>{active && <span aria-hidden="true">✓　</span>}{tag}</button>; })}</div></fieldset>
                    <label className="grid gap-2 text-lg font-bold">Leave a review <span className="text-sm font-normal text-slate-500">Optional</span><textarea name="text" maxLength={500} placeholder="Share your experience…" className="min-h-28 resize-none rounded-xl border border-[#BED8D4] bg-white p-4 text-base font-normal" /><span className="text-right text-sm font-normal text-slate-500">Up to 500 characters</span></label>
                    <p className="rounded-lg bg-white p-3 text-sm text-slate-600"><span className="mr-2" aria-hidden="true">🔒</span>Your review stays private until both of you submit a review or 14 days have passed.</p>
                    {workflowError && <p role="alert" className="text-sm text-red-700">{workflowError}</p>}
                    <button disabled={workflowBusy || reviewRating < 1} className="w-full rounded-full bg-[#102A3A] px-5 py-3 font-bold text-white disabled:opacity-50">{workflowBusy ? "Saving…" : "Submit review"}</button>
                    <button type="button" onClick={() => setReviewOpen(false)} className="mx-auto px-4 py-1 font-semibold text-slate-500 hover:text-slate-800">Maybe later</button>
                  </form>
                </section>
              </div>, document.body)}


            </section>






          </div>
        </main>


  );
}
