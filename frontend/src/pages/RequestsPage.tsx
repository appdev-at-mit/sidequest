import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import QuestCountdown from "../components/QuestCountdown";
import { categories as availableCategories } from "../data/requests";
import type { Request } from "../data/requests";

type Props = { requests: Request[]; query: string; currentLocation: { lat: number; lng: number } | null; onViewOnMap: (id: string | number) => void };
type SortBy = "newest" | "highest-reward" | "highest-rating" | "closest";

function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceMiles(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  return distanceKm(from, to) * 0.621371;
}

export default function RequestsPage({ requests, query, currentLocation, onViewOnMap }: Props) {
  const [category, setCategory] = useState("All");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return requests.filter(request => (request.status ?? "open") === "open" && !request.expired && (category === "All" || request.category === category)
      && (!normalized || `${request.title} ${request.description} ${request.location} ${request.category}`.toLowerCase().includes(normalized)))
      .sort((a, b) => {
        if (sortBy === "highest-reward") return Number.parseFloat(b.reward) - Number.parseFloat(a.reward);
        if (sortBy === "highest-rating") return (b.rating ?? -1) - (a.rating ?? -1);
        if (sortBy === "closest" && currentLocation) {
          const distanceA = a.lat == null || a.lng == null ? Infinity : distanceKm(currentLocation, { lat: a.lat, lng: a.lng });
          const distanceB = b.lat == null || b.lng == null ? Infinity : distanceKm(currentLocation, { lat: b.lat, lng: b.lng });
          return distanceA - distanceB;
        }
        return (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0);
      });
  }, [requests, query, category, sortBy, currentLocation]);

  const sortOptions: { id: SortBy; label: string }[] = [
    { id: "newest", label: "Newest" },
    { id: "highest-reward", label: "Highest reward" },
    { id: "highest-rating", label: "Highest rating" },
    { id: "closest", label: "Closest to me" },
  ];

  const categoryIcons: Record<string, "grid" | "truck" | "bolt" | "home" | "wrench" | "book" | "arrow"> = {
    All: "grid", Delivery: "truck", Moving: "arrow", "Home Help": "home", Tech: "wrench", Academic: "book",
  };

  return <main className="min-h-[calc(100dvh-64px)] overflow-y-auto bg-[#F7F9F9] px-5 pb-7 pt-1 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <div className="border-b border-[#BED8D4] pb-5">
        <div><div className="flex flex-wrap gap-3">
          {availableCategories.map(value => <button key={value} type="button" onClick={() => setCategory(value)} aria-pressed={category === value} className={`flex min-w-[82px] flex-col items-center gap-2 px-4 py-3 text-xs font-semibold transition ${category === value ? "text-[#08679e]" : "text-slate-600 hover:text-[#2081C3]"}`}><Icon name={categoryIcons[value]} size={22} /><span>{value === "All" ? "All quests" : value}</span></button>)}
        </div></div>
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {sortOptions.map(option => <button key={option.id} type="button" onClick={() => setSortBy(option.id)} aria-pressed={sortBy === option.id} className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${sortBy === option.id ? "border-[#2081C3] bg-[#E5F1F3] text-[#08679e]" : "border-[#BED8D4] bg-white text-slate-600 hover:bg-[#E5F1F3]"}`}>{option.label}</button>)}
          </div>
          {!currentLocation && <p className="mt-2 text-xs text-slate-500">Set a drop-off location in the top bar to sort by distance.</p>}
        </div>
      </div>
      {!items.length ? <p className="py-14 text-center text-sm text-slate-500">No requests match your search.</p> : <div className="grid grid-cols-1 gap-5 py-6 sm:grid-cols-2 lg:grid-cols-3">{items.map(request => <button key={request.id} onClick={() => onViewOnMap(request.id)} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#BED8D4] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        {request.imageUrl ? <img src={request.imageUrl} alt="" className="aspect-[16/9] w-full border-[6px] border-white object-cover" /> : <div className="quest-preview-art aspect-[16/9] w-full rounded-none border-[6px] border-white" aria-hidden="true"><span className="text-4xl">↗</span></div>}
        <div className="flex flex-1 flex-col p-4"><div className="flex items-center justify-between gap-3"><h2 className="min-w-0 truncate font-extrabold">{request.title}</h2><span className="shrink-0 text-xs font-semibold text-slate-500">{currentLocation && request.lat != null && request.lng != null ? `${distanceMiles(currentLocation, { lat: request.lat, lng: request.lng }).toFixed(1)} mi away` : "Distance unavailable"}</span></div><span className="mt-1 text-xs text-slate-500">Posted by {request.poster}{request.requesterReviewCount ? <span className="ml-1 font-semibold text-slate-600"><span className="text-[#2081C3]">★</span> {request.requesterRating?.toFixed(1)} ({request.requesterReviewCount})</span> : <span className="ml-1">· No reviews yet</span>}</span><QuestCountdown expiresAt={request.expiresAt ?? (request.end ? new Date(request.end).toISOString() : request.createdAt ? new Date(new Date(request.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null)} /><div className="mt-auto flex items-end justify-between border-t border-[#BED8D4] pt-3"><span className="text-lg font-extrabold text-[#2081C3]">${request.reward}</span><span className="text-xs font-semibold text-slate-500">View map →</span></div></div>
      </button>)}</div>}
    </div>
  </main>;
}
