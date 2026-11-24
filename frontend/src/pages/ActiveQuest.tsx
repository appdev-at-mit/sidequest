import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";


import L from "leaflet";


import Icon from "../components/Icon";




import { CAMBRIDGE_CENTER, MAP_TILE_URL, MAP_TILE_OPTIONS } from "../data/requests";


import type { Request } from "../data/requests";


type TransportMode = "foot" | "driving" | "cycling";


const transportModes: { id: TransportMode; label: string; icon: "walk" | "car" | "bike" }[] = [


  { id: "foot", label: "Walking", icon: "walk" },


  { id: "cycling", label: "Cycling", icon: "bike" },


  { id: "driving", label: "Driving", icon: "car" },


];


type Props = { selectedRequest: Request; stage: 1 | 2 | 3; setStage: (stage: 1 | 2 | 3) => void; currentKerb: string; onBack: () => void; onComplete: () => void; onCancelled: () => void };


export default function ActiveQuest({selectedRequest, stage, setStage, currentKerb, onBack, onComplete, onCancelled}: Props) {


  const [mode, setMode] = useState<TransportMode>("foot");


  const [routeDetails, setRouteDetails] = useState<{ minutes: number; miles: number } | null>(null);

  const [directionsCollapsed, setDirectionsCollapsed] = useState(false);


  const [routeError, setRouteError] = useState("");
  const [stageError, setStageError] = useState("");
  const [actionBusy, setActionBusy] = useState<"cancel" | "progress" | "complete" | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const isRequester = selectedRequest.requester === currentKerb;
  const isHelper = selectedRequest.helper === currentKerb;
  const questStatus = selectedRequest.status ?? "open";

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
    const userArrowAngle = destination
      ? Math.atan2(destination[1] - CAMBRIDGE_CENTER[1], destination[0] - CAMBRIDGE_CENTER[0]) * 180 / Math.PI
      : 0;


    const map = L.map(routeMapElement.current, {


      attributionControl: true,


      minZoom: 14,


      zoomControl: false,


    }).setView(CAMBRIDGE_CENTER, 16);





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





    L.marker(CAMBRIDGE_CENTER, {


      icon: userIcon,


      title: "Your location",


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


    map.fitBounds(L.latLngBounds(CAMBRIDGE_CENTER, destination), { padding: [70, 70], maxZoom: 17 });





    const origin: L.LatLngTuple = [CAMBRIDGE_CENTER[0], CAMBRIDGE_CENTER[1]];


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


              CAMBRIDGE_CENTER as L.LatLngTuple,


              destination,


            ],


            { color: "#2081C3", weight: 5, opacity: 0.85, dashArray: "7 8" },


          ).addTo(map);


        }


      });





    return cleanup;


  }, [selectedRequest, mode]);

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

  async function cancelQuest() {
    if (actionBusy || (!isRequester && !isHelper)) return;
    if (!window.confirm("Cancel this quest and notify the requester?")) return;
    setStageError("");
    setActionBusy("cancel");
    try {
      const response = await fetch(`/api/requests/${selectedRequest.id}/cancel`, { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.msg ?? "Could not cancel this quest.");
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
  return (


        <main className="isolate min-h-[calc(100vh-64px)] bg-[#F7F9F9]">


          <section className="relative h-[48vh] min-h-[340px] border-b border-[#BED8D4]">


            <div


              ref={routeMapElement}


              className="absolute inset-0"


              aria-label={`Walking route to ${selectedRequest.title}`}


            />


            {directionsCollapsed ? <button type="button" onClick={() => setDirectionsCollapsed(false)} className="absolute bottom-4 right-4 z-[500] rounded-lg border border-[#BED8D4] bg-white px-4 py-2.5 text-sm font-bold text-[#08679e] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">Directions</button> : <div className="absolute bottom-4 right-4 z-[500] w-[min(320px,calc(100%-32px))] rounded-lg border border-[#BED8D4] bg-white p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">


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


                ) : <p className="text-xs text-slate-500">{routeError || "Finding the best route…"}</p>}

                <p className="mt-1 truncate text-[10px] text-slate-600" title={selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}><span className="font-semibold text-slate-700">Pickup:</span> {selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}</p>
                <p className="truncate text-[10px] text-slate-600" title={selectedRequest.dropoff || "Not specified"}><span className="font-semibold text-slate-700">Drop-off:</span> {selectedRequest.dropoff || "Not specified"}</p>


              </div>


              <a aria-label="Open directions in Google Maps" className="self-center text-right text-[10px] font-bold text-[#2081C3] hover:underline"


                href={selectedRequest.lat != null && selectedRequest.lng != null


                  ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(selectedRequest.pickup || `${CAMBRIDGE_CENTER[0]},${CAMBRIDGE_CENTER[1]}`)}&destination=${encodeURIComponent(selectedRequest.dropoff || `${selectedRequest.lat},${selectedRequest.lng}`)}&travelmode=${mode === "foot" ? "walking" : mode === "cycling" ? "bicycling" : "driving"}`


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


                âˆ’


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
                    <div className="mt-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
                      <p className="min-w-0 break-words"><span className="font-bold text-slate-600">Pickup:</span> {selectedRequest.pickup || selectedRequest.location || "Location shown on the map"}</p>
                      <p className="min-w-0 break-words"><span className="font-bold text-slate-600">Drop-off:</span> {selectedRequest.dropoff || "Not specified"}</p>
                    </div>
                  </div>


                </div>


                <p className="text-2xl font-extrabold text-[#2081C3]">{selectedRequest.reward}</p>


                {stageError && !actionBusy && <p role="alert" className="mr-2 text-sm text-red-700">{stageError}</p>}
                {(isRequester || isHelper) && <button type="button" disabled={actionBusy !== null} onClick={() => { void cancelQuest(); }} className="inline-flex min-h-12 min-w-32 items-center justify-center gap-2 rounded-md border border-[#BED8D4] px-4 py-3 text-sm font-bold text-slate-600 hover:bg-[#E5F1F3] disabled:opacity-70">
                  {actionBusy === "cancel" ? <span role="status" aria-label="Cancelling" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : "Cancel quest"}
                </button>}

                {isHelper && questStatus === "in_progress" && <button type="button" disabled={actionBusy !== null} onClick={() => { void advanceQuest(); }} className="inline-flex min-h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-[#2081C3] px-5 py-3 text-sm font-bold text-white hover:bg-[#176FA9] disabled:opacity-70">
                  {actionBusy === "progress" ? <span role="status" aria-label="Saving progress" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : stage === 1 ? "Mark as In Progress" : stage === 2 ? "Mark pickup complete" : "Mark pickup complete"}
                </button>}


              </div>


              <dl className="mt-6 grid gap-4 border-t border-[#BED8D4] pt-5 text-sm sm:grid-cols-2">


                <div><dt className="text-xs font-bold uppercase text-slate-500">Posted</dt><dd className="mt-1 font-semibold">{selectedRequest.posted || "Posting time unavailable"}</dd></div>


                <div><dt className="text-xs font-bold uppercase text-slate-500">Deadline</dt><dd className="mt-1 font-semibold">{selectedRequest.end ? new Date(selectedRequest.end).toLocaleString() : "No deadline provided"}</dd></div>


              </dl>

              {(isRequester || isHelper) && <section className="mt-5 grid gap-4 border-t border-[#BED8D4] pt-5">
                <h2 className="text-lg font-extrabold">Quest progress</h2>
                <p className="text-sm font-semibold text-slate-700">Status: {questStatus.replaceAll("_", " ")}</p>
                {questStatus === "in_progress" && isHelper && <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void workflowAction(`/api/requests/${selectedRequest.id}/completion`, { description: values.get("description"), evidence: values.get("evidence") }); }} className="grid gap-3 rounded-lg border border-[#BED8D4] bg-white p-4">
                  <label className="grid gap-1 text-sm font-semibold">Describe the completed work<textarea name="description" required maxLength={2000} className="min-h-20 rounded-md border border-[#BED8D4] p-3 font-normal" /></label>
                  <label className="grid gap-1 text-sm font-semibold">Evidence notes (optional)<textarea name="evidence" maxLength={4000} placeholder="Text only. Do not include sensitive information." className="min-h-16 rounded-md border border-[#BED8D4] p-3 font-normal" /></label>
                  <button disabled={workflowBusy} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{workflowBusy ? "Submitting…" : "Submit completion for review"}</button>
                </form>}
                {questStatus === "pending_review" && <div className="grid gap-2 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                  <h3 className="font-bold">Completion submitted</h3><p>{selectedRequest.completionSubmission?.description}</p>{selectedRequest.completionSubmission?.evidence && <p className="text-slate-600">Evidence notes: {selectedRequest.completionSubmission.evidence}</p>}
                  {isRequester && <button type="button" disabled={workflowBusy} onClick={() => void workflowAction(`/api/requests/${selectedRequest.id}/approve-completion`)} className="w-fit rounded-md bg-[#2081C3] px-4 py-2 font-bold text-white disabled:opacity-60">{workflowBusy ? "Saving…" : "Approve completion"}</button>}
                  {isHelper && <p className="text-slate-600">Waiting for the requester to review the work.</p>}
                </div>}
                {questStatus === "awaiting_payment" && <div className="grid gap-2 rounded-lg border border-[#BED8D4] bg-white p-4 text-sm">
                  <h3 className="font-bold">Arrange the reward directly</h3><p>SideQuest does not collect, hold, or verify payment. Contact the other participant if needed.</p>
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
                {questStatus !== "disputed" && questStatus !== "cancelled" && questStatus !== "completed" && <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void workflowAction(`/api/requests/${selectedRequest.id}/disputes`, { reason: values.get("reason"), description: values.get("description"), evidence: values.get("evidence") }); }} className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                  <h3 className="font-bold">Report a problem with this quest</h3><select name="reason" required defaultValue="" className="rounded-md border border-[#BED8D4] bg-white p-2 text-sm"><option value="" disabled>Choose a reason</option>{["Requester failed to pay", "Completer failed to complete the quest", "Quest requirements were misrepresented", "Payment amount was incorrect", "Harassment or inappropriate behavior", "Other"].map(reason => <option key={reason}>{reason}</option>)}</select><textarea name="description" required maxLength={2000} placeholder="Describe the issue" className="min-h-16 rounded-md border border-[#BED8D4] bg-white p-3 text-sm" /><textarea name="evidence" maxLength={4000} placeholder="Evidence notes (text only)" className="min-h-14 rounded-md border border-[#BED8D4] bg-white p-3 text-sm" /><button disabled={workflowBusy} className="w-fit rounded-md border border-amber-300 px-4 py-2 text-sm font-bold">{workflowBusy ? "Submitting…" : "Open a dispute"}</button>
                </form>}
              </section>}


            </section>






          </div>
        </main>


  );
}
