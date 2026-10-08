import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { api, type Person } from "../api";
import { useAuth, Page, QueryState, TermsGate } from "../components";
export function Profile() {
  const auth = useAuth();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (data: any) =>
      api("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <Page title="Your profile">
      <div className="panel">
        <span className="avatar large">{auth.user!.displayName.charAt(0)}</span>
        <h2>{auth.user!.displayName}</h2>
        <p>
          {auth.user!.kerberosId} · {auth.user!.accountStatus}
        </p>
        <p>
          <Star size={17} /> {auth.user!.averageRating.toFixed(1)} ·{" "}
          {auth.user!.ratingCount} reviews
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate({
              displayName: f.get("displayName"),
              venmoUsername: f.get("venmoUsername"),
            });
          }}
        >
          <label>
            Display name
            <input
              name="displayName"
              defaultValue={auth.user!.displayName}
              required
              maxLength={80}
            />
          </label>
          <label>
            Venmo username (optional)
            <input
              name="venmoUsername"
              defaultValue={auth.user!.venmoUsername || ""}
              maxLength={30}
            />
          </label>
          <p className="muted">
            Shared with your quest partner only. Payments are external and
            unverified.
          </p>
          <button className="button" disabled={save.isPending}>
            Save profile
          </button>
          {save.isError && (
            <p className="error" role="alert">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && (
            <p className="success" role="status">
              Profile saved.
            </p>
          )}
        </form>
      </div>
      <TermsGate />
      <Link to={`/users/${auth.user!._id}`}>View your public profile</Link>
    </Page>
  );
}
export function PublicProfile() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const query = useQuery<Person>({
    queryKey: ["user", id],
    queryFn: () => api(`/users/${id}`),
  });
  const reviews = useQuery<any[]>({
    queryKey: ["reviews", id, page],
    queryFn: () => api(`/users/${id}/reviews?page=${page}`),
  });
  return (
    <Page title={query.data?.displayName || "Campus profile"}>
      <QueryState query={query} />
      {query.data && (
        <div className="panel">
          <span className="avatar large">
            {query.data.displayName.charAt(0)}
          </span>
          <p>
            <Star size={18} /> {query.data.averageRating.toFixed(1)} ·{" "}
            {query.data.ratingCount} reviews
          </p>
          {query.data.fictional && (
            <p className="sample-note">Fictional development profile</p>
          )}
          <Link to={`/support?reportedUserId=${id}`}>Report this user</Link>
        </div>
      )}
      <h2>Campus feedback</h2>
      <QueryState query={reviews} />
      {reviews.data?.map((r) => (
        <div className="panel" key={r._id}>
          <strong>
            {r.rating} / 5 · {r.reviewerId.displayName}
          </strong>
          <p>{r.comment || "No comment added."}</p>
        </div>
      ))}
      {reviews.data?.length === 0 && <p className="state">No reviews yet.</p>}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(reviews.data?.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </Page>
  );
}
