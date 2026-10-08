import { useState, type FormEvent } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  MessageCircle,
  MapPin,
  Shield,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { api, post, type Quest, money, categoryLabel } from "../api";
import { MapView, CAMPUS } from "../MapView";
import {
  useAuth,
  Page,
  QueryState,
  useAction,
  ActionStatus,
  TermsGate,
} from "../components";
export function CreateQuest() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [point, setPoint] = useState<[number, number]>(CAMPUS);
  const [drop, setDrop] = useState(false);
  const create = useMutation({
    mutationFn: (data: any) => post("/quests", data),
    onSuccess: (q) => navigate(`/quests/${q._id}`),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dollars = String(f.get("payment"));
    if (!/^\d+(\.\d{1,2})?$/.test(dollars)) {
      window.alert("Enter an amount with at most two decimal places.");
      return;
    }
    create.mutate({
      title: f.get("title"),
      description: f.get("description"),
      instructions: f.get("instructions"),
      category: f.get("category"),
      payCents: Math.round(Number(dollars) * 100),
      startLocation: {
        type: "Point",
        coordinates: [point[1], point[0]],
        label: f.get("location"),
      },
      ...(drop
        ? {
            endLocation: {
              type: "Point",
              coordinates: [Number(f.get("dropLng")), Number(f.get("dropLat"))],
              label: f.get("dropLabel"),
            },
          }
        : {}),
      deadline: new Date(String(f.get("deadline"))).toISOString(),
    });
  }
  return (
    <Page
      title="Post a little quest"
      subtitle="Tell campus what you need. You can post 3 quests per rolling 24 hours."
    >
      <TermsGate />
      <form className="panel form-grid" onSubmit={submit}>
        <label className="full">
          Quest title
          <input
            name="title"
            placeholder="A quick food run to W20"
            required
            maxLength={100}
          />
        </label>
        <label className="full">
          What do you need?
          <textarea
            name="description"
            placeholder="Include the details someone needs to help."
            required
            maxLength={2000}
          />
        </label>
        <label>
          Category
          <select name="category">
            {Object.entries(categoryLabel).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payment (USD)
          <input
            name="payment"
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            placeholder="7.00"
            required
          />
        </label>
        <label>
          Pickup location name
          <input
            name="location"
            placeholder="Student Center entrance"
            required
            maxLength={120}
          />
        </label>
        <label>
          Deadline (within 24 hours)
          <input name="deadline" type="datetime-local" required />
        </label>
        <div className="full location-picker">
          <p>
            Click the map to set pickup. Coordinates: {point[0].toFixed(5)},{" "}
            {point[1].toFixed(5)}
          </p>
          <MapView center={CAMPUS} onPick={setPoint} picked={point} />
        </div>
        <label className="full check-label">
          <input
            type="checkbox"
            checked={drop}
            onChange={(e) => setDrop(e.target.checked)}
          />
          Add a drop-off location
        </label>
        {drop && (
          <>
            <label>
              Drop-off label
              <input name="dropLabel" required maxLength={120} />
            </label>
            <label>
              Latitude
              <input
                name="dropLat"
                type="number"
                step="any"
                min="-90"
                max="90"
                required
              />
            </label>
            <label>
              Longitude
              <input
                name="dropLng"
                type="number"
                step="any"
                min="-180"
                max="180"
                required
              />
            </label>
          </>
        )}
        <label className="full">
          Additional instructions (optional)
          <textarea name="instructions" maxLength={1000} />
        </label>
        <p className="full muted">
          Keep requests safe and reasonable. No academic dishonesty,
          credentials, unauthorized access, harassment, prohibited goods, or
          dangerous tasks. SideQuest does not process or guarantee payment.
        </p>
        {create.isError && (
          <p role="alert" className="error full">
            {create.error.message}
          </p>
        )}
        <button
          className="button full"
          disabled={
            create.isPending || auth.user?.termsVersion !== auth.termsVersion
          }
        >
          {create.isPending ? "Posting…" : "Post quest"}
        </button>
      </form>
    </Page>
  );
}
export function QuestDetail() {
  const { id } = useParams();
  const auth = useAuth();
  const action = useAction();
  const navigate = useNavigate();
  const [dispute, setDispute] = useState(false);
  const query = useQuery<Quest>({
    queryKey: ["quest", id],
    queryFn: () => api(`/quests/${id}`),
  });
  const q = query.data;
  const requester = Boolean(auth?.user && q?.requesterId._id === auth.user._id);
  const performer = Boolean(
    auth?.user && q?.performerId?._id === auth.user._id,
  );
  return (
    <Page title={q?.title || "Quest details"}>
      <QueryState query={query} />
      {q && (
        <div className="detail-grid">
          <div>
            <div className="panel">
              <div className="detail-top">
                <span className="category-badge">
                  {categoryLabel[q.category]}
                </span>
                <span className="status-badge">{q.status}</span>
                <strong className="big-pay">{money(q.payCents)}</strong>
              </div>
              {q.fictional && (
                <p className="sample-note">Fictional development quest</p>
              )}
              <p className="description">{q.description}</p>
              <p>
                <MapPin size={17} /> {q.startLocation.label}
              </p>
              {q.endLocation && <p>Drop-off: {q.endLocation.label}</p>}
              <p>
                <Clock size={17} /> Due {new Date(q.deadline).toLocaleString()}
              </p>
              {q.instructions && <p>{q.instructions}</p>}
              {q.overdue && (
                <p className="notice">
                  This accepted quest is overdue. Coordinate with your partner
                  or open a dispute. It remains in your history.
                </p>
              )}
              <div className="people-row">
                <span className="avatar">
                  {q.requesterId.displayName.charAt(0)}
                </span>
                <div>
                  <small>Posted by</small>
                  <Link to={`/users/${q.requesterId._id}`}>
                    {q.requesterId.displayName}
                  </Link>
                </div>
              </div>
              {q.performerId && (
                <p>
                  Helping out:{" "}
                  <Link to={`/users/${q.performerId._id}`}>
                    {q.performerId.displayName}
                  </Link>
                </p>
              )}
              <TermsGate />
              <div className="quest-actions">
                {q.status === "OPEN" && !requester && (
                  <button
                    className="button"
                    disabled={action.isPending}
                    onClick={() =>
                      auth?.user
                        ? action.mutate({ path: `/quests/${id}/accept` })
                        : navigate("/login")
                    }
                  >
                    Accept this quest
                  </button>
                )}
                {performer && q.status === "ACCEPTED" && !q.workSubmittedAt && (
                  <button
                    className="button"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ path: `/quests/${id}/submit` })
                    }
                  >
                    Mark work as done
                  </button>
                )}
                {q.workSubmittedAt && q.status === "ACCEPTED" && (
                  <p className="notice">
                    Work submitted. Waiting for requester confirmation.
                  </p>
                )}
                {requester && q.status === "ACCEPTED" && q.workSubmittedAt && (
                  <button
                    className="button"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ path: `/quests/${id}/complete` })
                    }
                  >
                    Confirm task completion
                  </button>
                )}
                {requester && ["OPEN", "ACCEPTED"].includes(q.status) && (
                  <button
                    className="button secondary"
                    disabled={action.isPending}
                    onClick={() => {
                      if (
                        q.status === "OPEN" ||
                        window.confirm(
                          "Cancel this accepted quest? Your partner will be notified and history preserved.",
                        )
                      )
                        action.mutate({
                          path: `/quests/${id}/cancel`,
                          data: { confirm: true },
                        });
                    }}
                  >
                    Cancel quest
                  </button>
                )}
                {(requester || performer) && q.performerId && (
                  <Link className="button secondary" to={`/messages/${id}`}>
                    <MessageCircle size={17} />
                    Open conversation
                  </Link>
                )}
                {(requester || performer) && q.status === "ACCEPTED" && (
                  <button
                    className="text-button"
                    onClick={() => setDispute(!dispute)}
                  >
                    Escalate a disagreement
                  </button>
                )}
              </div>
              {dispute && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action.mutate({
                      path: `/quests/${id}/dispute`,
                      data: {
                        reason: new FormData(e.currentTarget).get("reason"),
                      },
                    });
                  }}
                >
                  <label>
                    Describe the disagreement
                    <textarea
                      name="reason"
                      required
                      minLength={5}
                      maxLength={1000}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={action.isPending}
                  >
                    Open dispute
                  </button>
                </form>
              )}
              <ActionStatus action={action} />
              <Link className="report-link" to={`/support?questId=${id}`}>
                <Shield size={15} />
                Report this quest
              </Link>
            </div>
            {(requester || performer) && (
              <div className="panel payment-panel">
                <h3>Payment stays between you</h3>
                <p>
                  Agreed amount: <strong>{money(q.payCents)}</strong>
                </p>
                {q.requesterVenmoUsername ? (
                  <p>Requester’s Venmo: @{q.requesterVenmoUsername}</p>
                ) : (
                  <p>Ask your partner for their Venmo username in chat.</p>
                )}
                <p className="muted">
                  Pay externally using Venmo. SideQuest never handles funds and
                  cannot verify or guarantee payment. Confirming the task does
                  not confirm payment.
                </p>
              </div>
            )}
            {(requester || performer) && q.status === "COMPLETED" && (
              <ReviewForm id={q._id} />
            )}
          </div>
          <div className="detail-map">
            <MapView quests={[q]} selected={q} center={CAMPUS} />
          </div>
        </div>
      )}
    </Page>
  );
}
export function ReviewForm({ id }: { id: string }) {
  const action = useAction();
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        action.mutate({
          path: `/quests/${id}/reviews`,
          data: { rating: Number(f.get("rating")), comment: f.get("comment") },
        });
      }}
    >
      <h3>How did it go?</h3>
      <label>
        Rating
        <select name="rating">
          {[5, 4, 3, 2, 1].map((n) => (
            <option value={n} key={n}>
              {n} stars
            </option>
          ))}
        </select>
      </label>
      <label>
        Comment (optional)
        <textarea name="comment" maxLength={500} />
      </label>
      <button
        className="button"
        disabled={action.isPending || action.isSuccess}
      >
        Submit review
      </button>
      <ActionStatus action={action} />
    </form>
  );
}
export function QuestRows({ quests }: { quests: Quest[] }) {
  return (
    <div className="quest-rows">
      {quests.map((q) => (
        <Link className="panel quest-row" key={q._id} to={`/quests/${q._id}`}>
          <div>
            <span className="category-badge">{categoryLabel[q.category]}</span>
            <h3>{q.title}</h3>
            <p>
              {q.startLocation.label} · {q.status}
            </p>
          </div>
          <strong className="pay">{money(q.payCents)}</strong>
          <ArrowUpRight size={19} />
        </Link>
      ))}
    </div>
  );
}
export function MyQuests() {
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("all");
  const query = useQuery<Quest[]>({
    queryKey: ["my-quests", page],
    queryFn: () => api(`/users/me/quests?page=${page}`),
  });
  const notifications = useQuery<any[]>({
    queryKey: ["notifications"],
    queryFn: () => api("/users/me/notifications"),
    refetchInterval: 15000,
  });
  const quests =
    query.data?.filter(
      (q) =>
        tab === "all" ||
        (tab === "posted"
          ? q.requesterId._id === auth.user!._id
          : q.performerId?._id === auth.user!._id),
    ) || [];
  return (
    <Page title="Your campus quests">
      <div className="category-tabs">
        {["all", "posted", "accepted"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab === t ? "active" : ""}
          >
            {t}
          </button>
        ))}
      </div>
      <QueryState query={query} />
      {!query.isPending && !query.isError && !quests.length && (
        <p className="state">
          No quests here yet. <Link to="/">Explore campus</Link> or{" "}
          <Link to="/quests/new">post a quest</Link>.
        </p>
      )}
      <QuestRows quests={quests} />
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(query.data?.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      <h2>Recent updates</h2>
      <QueryState query={notifications} />
      {notifications.data?.map((n) => (
        <Link key={n._id} className="notification" to={`/quests/${n.questId}`}>
          {n.text}
          <small>{new Date(n.createdAt).toLocaleString()}</small>
        </Link>
      ))}
    </Page>
  );
}
