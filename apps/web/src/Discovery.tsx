import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  MapPin,
  Clock,
  ArrowUpRight,
  Navigation,
  Plus,
  List,
  Map as MapIcon,
  X,
} from "lucide-react";
import { api, categoryLabel, money, type Quest } from "./api";
import { MapView, CAMPUS } from "./MapView";
export function Discovery() {
  const [center, setCenter] = useState<[number, number]>(CAMPUS);
  const [located, setLocated] = useState(false);
  const [locationNotice, setLocationNotice] = useState(
    "Finding your location…",
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [radius, setRadius] = useState("2000");
  const [sort, setSort] = useState("distance");
  const [filters, setFilters] = useState(false);
  const [showList, setShowList] = useState(false);
  const [manual, setManual] = useState(false);
  const [page, setPage] = useState(1);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function locate() {
    if (!navigator.geolocation) {
      setLocationNotice("Location unavailable. Showing quests near MIT.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter([p.coords.latitude, p.coords.longitude]);
        setLocated(true);
        setLocationNotice("Nearby quests · your location stays on this device");
      },
      () => {
        setLocationNotice(
          "Using MIT campus. You can choose a location on the map.",
        );
      },
      { timeout: 8000, maximumAge: 60000 },
    );
  }
  useEffect(() => {
    locate();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPage(1);
    setSelectedId(undefined);
  }, [center, category, debounced, min, max, radius, sort]);
  const params = new URLSearchParams({
    latitude: String(center[0]),
    longitude: String(center[1]),
    radiusMeters: radius,
    sort,
    page: String(page),
    ...(category ? { category } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(min ? { minPayCents: String(Math.round(Number(min) * 100)) } : {}),
    ...(max ? { maxPayCents: String(Math.round(Number(max) * 100)) } : {}),
  });
  const query = useQuery<{ items: Quest[]; total: number; limit: number }>({
    queryKey: ["quests", params.toString()],
    queryFn: () => api(`/quests?${params}`),
  });
  const quests = query.data?.items || [];
  const selected = quests.find((q) => q._id === selectedId);
  function select(id: string) {
    setSelectedId(id);
    refs.current[id]?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
  }
  return (
    <div className={`discovery ${showList ? "show-list" : ""}`}>
      <aside className="quest-sidebar">
        <div className="sidebar-intro">
          <span className="eyebrow">A LITTLE HELP GOES A LONG WAY</span>
          <h1>
            Your campus.
            <br />
            Your next quest.
          </h1>
          <p>Make someone’s day. Earn a little along the way.</p>
        </div>
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search quests"
            placeholder="Find your next quest…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            aria-label="Toggle filters"
            onClick={() => setFilters(!filters)}
            className={filters ? "active" : ""}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
        <div className="category-tabs">
          <button
            onClick={() => setCategory("")}
            className={!category ? "active" : ""}
          >
            All quests
          </button>
          {Object.entries(categoryLabel).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={category === id ? "active" : ""}
            >
              {label}
            </button>
          ))}
        </div>
        {filters && (
          <div className="filter-panel">
            <label>
              Within
              <select
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
              >
                <option value="500">500 m</option>
                <option value="1000">1 km</option>
                <option value="2000">2 km</option>
                <option value="5000">5 km</option>
                <option value="10000">10 km</option>
              </select>
            </label>
            <label>
              Min $
              <input
                type="number"
                min="0"
                max="1000"
                step="0.01"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </label>
            <label>
              Max $
              <input
                type="number"
                min="0"
                max="1000"
                step="0.01"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="list-heading">
          <strong>{query.data?.total ?? "…"} quests nearby</strong>
          <select
            aria-label="Sort quests"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="distance">Nearest first</option>
            <option value="payment">Highest pay</option>
            <option value="newest">Newest</option>
            <option value="deadline">Soonest deadline</option>
          </select>
        </div>
        <div className="quest-list">
          {query.isPending && (
            <div className="state">Loading campus quests…</div>
          )}
          {query.isError && (
            <div className="state error">
              {query.error.message}
              <button onClick={() => query.refetch()}>Try again</button>
            </div>
          )}
          {!query.isPending && !query.isError && !quests.length && (
            <div className="state">
              <MapPin />
              <h3>No quests here yet</h3>
              <p>Try a wider radius or post the first one.</p>
            </div>
          )}
          {quests.map((q) => (
            <button
              ref={(el) => {
                refs.current[q._id] = el;
              }}
              key={q._id}
              className={`quest-card ${selectedId === q._id ? "selected" : ""}`}
              aria-pressed={selectedId === q._id}
              onClick={() => select(q._id)}
            >
              <div className="card-top">
                <span className={`category-badge ${q.category.toLowerCase()}`}>
                  {categoryLabel[q.category]}
                </span>
                <span className="pay">{money(q.payCents)}</span>
              </div>
              <h3>{q.title}</h3>
              <p className="card-location">
                <MapPin size={14} />
                {q.startLocation.label}
              </p>
              <div className="card-footer">
                <span className="avatar">
                  {q.requesterId.displayName.charAt(0)}
                </span>
                <span>
                  {q.requesterId.displayName.split(" ")[0]}
                  {q.fictional && <small> · sample</small>}
                </span>
                <span className="card-time">
                  <Clock size={13} />
                  {Math.max(
                    1,
                    Math.ceil((Date.parse(q.deadline) - Date.now()) / 3600000),
                  )}
                  h left
                </span>
              </div>
              <div className="distance">
                {Math.round(q.distanceMeters || 0)} m away{" "}
                <ArrowUpRight size={14} />
              </div>
            </button>
          ))}
        </div>
        {query.data && query.data.total > query.data.limit && (
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * query.data.limit >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
        <Link className="button sidebar-create" to="/quests/new">
          <Plus size={18} />
          Post a quest
        </Link>
        <p className="sidebar-note">Small tasks. Real campus connections.</p>
      </aside>
      <section className="map-stage">
        <MapView
          quests={quests}
          selected={selected}
          onSelect={select}
          center={center}
          located={located}
          onPick={
            manual
              ? (v) => {
                  setCenter(v);
                  setLocated(false);
                  setManual(false);
                  setLocationNotice("Searching around your selected location.");
                }
              : undefined
          }
        />
        <div className="map-label">
          <span className="live-dot" /> MIT CAMPUS <span>Cambridge, MA</span>
        </div>
        <div className="map-controls">
          <button
            title="Find my location"
            aria-label="Find my location"
            onClick={locate}
          >
            <Navigation size={20} />
          </button>
          <button
            title="Choose search location"
            aria-label="Choose search location"
            onClick={() => setManual(!manual)}
            className={manual ? "active" : ""}
          >
            <MapPin size={20} />
          </button>
        </div>
        <div className="location-notice">
          {manual
            ? "Click the map to choose a search location."
            : locationNotice}
        </div>
        {selected && (
          <div className="map-preview">
            <button
              className="close-preview"
              aria-label="Close preview"
              onClick={() => setSelectedId(undefined)}
            >
              <X size={16} />
            </button>
            <span className="category-badge">
              {categoryLabel[selected.category]}
            </span>
            <strong>{money(selected.payCents)}</strong>
            <h3>{selected.title}</h3>
            <p>{selected.startLocation.label}</p>
            <Link to={`/quests/${selected._id}`}>
              See quest details <ArrowUpRight size={16} />
            </Link>
          </div>
        )}
        <button
          className="mobile-list-toggle"
          onClick={() => setShowList(!showList)}
        >
          {showList ? <MapIcon size={18} /> : <List size={18} />}{" "}
          {showList ? "Show map" : `Show quests (${query.data?.total || 0})`}
        </button>
        <Link
          to="/quests/new"
          className="floating-create"
          aria-label="Post a quest"
        >
          <Plus />
        </Link>
      </section>
    </div>
  );
}
