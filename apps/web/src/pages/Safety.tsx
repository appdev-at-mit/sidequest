import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  useAuth,
  Page,
  QueryState,
  useAction,
  ActionStatus,
  TermsGate,
} from "../components";
export function Terms() {
  const auth = useAuth();
  return (
    <Page
      title="Terms & safety"
      subtitle={`Draft policy · ${auth?.termsVersion || "2026-10-08-draft-1"}`}
    >
      <div className="panel prose">
        <h2>Small quests, thoughtful choices</h2>
        <p>
          SideQuest connects students. It does not perform tasks, guarantee task
          completion, or guarantee payment. You are responsible for deciding
          whether a task is reasonable and safe.
        </p>
        <h3>Pay your partner externally</h3>
        <p>
          Agree on payment with your partner and pay through Venmo outside
          SideQuest. We do not collect payment details, hold funds, process
          transfers, or verify payment.
        </p>
        <h3>Keep campus safe</h3>
        <p>
          No illegal activities, harassment, threats, dangerous tasks, academic
          dishonesty, impersonation, password sharing, unauthorized building or
          account access, or prohibited goods and services. Comply with MIT
          policies and applicable law. Ambiguous reports require human review.
        </p>
        <h3>If plans change</h3>
        <p>
          Requesters can cancel open quests. Accepted cancellations require
          confirmation and notify the other participant. Overdue accepted quests
          stay visible until participants complete them or ask a moderator to
          resolve a dispute. Chat remains readable after closure.
        </p>
        <h3>Reports and moderation</h3>
        <p>
          Reports are private to the reporter and moderators. Moderators can
          issue documented strikes after reviewing evidence. Three active
          strikes suspend posting and acceptance; strikes can be revoked.
          Ratings alone never generate strikes. Contact support through the
          report form to ask for a review.
        </p>
        <h3>Location and privacy</h3>
        <p>
          Your current browser location is used for nearby searches and is not
          saved to your profile. Quest pickup locations are visible to visitors.
          Avoid publishing sensitive locations or personal information. Public
          profiles show your display name and reviews; your Venmo username is
          shared only with your quest partner.
        </p>
        <p className="notice">
          These draft terms have not been legally reviewed. Legal and MIT
          institutional review, approved authentication, and a staffed
          moderation process are required before production launch.
        </p>
      </div>
      {auth?.user && <TermsGate />}
    </Page>
  );
}
export function Support() {
  const auth = useAuth();
  const action = useAction();
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(1);
  const reports = useQuery<any[]>({
    queryKey: ["my-reports", page],
    queryFn: () => api(`/users/me/reports?page=${page}`),
  });
  return (
    <Page
      title="Support & reports"
      subtitle="Something doesn’t feel right? Tell us what happened."
    >
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          action.mutate({
            path: "/reports",
            data: {
              reason: f.get("reason"),
              description: f.get("description"),
              ...Object.fromEntries(
                ["questId", "messageId", "reportedUserId"]
                  .map((k) => [k, f.get(k)])
                  .filter(([, v]) => Boolean(v)),
              ),
            },
          });
        }}
      >
        <label>
          Reason
          <select name="reason">
            {[
              "Inappropriate behavior",
              "Unsafe request",
              "Noncompletion",
              "Suspected scam",
              "Payment dispute",
              "Other / request moderation review",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          What happened?
          <textarea
            name="description"
            minLength={5}
            maxLength={2000}
            required
          />
        </label>
        <details>
          <summary>Related identifiers (optional)</summary>
          {["questId", "messageId", "reportedUserId"].map((k) => (
            <label key={k}>
              {k}
              <input name={k} defaultValue={params.get(k) || ""} />
            </label>
          ))}
        </details>
        <p className="muted">
          Visible to you and authorized moderators. SideQuest cannot verify
          external payments.
        </p>
        <button className="button" disabled={action.isPending}>
          Submit report
        </button>
        <ActionStatus action={action} />
      </form>
      <h2>Your reports</h2>
      <QueryState query={reports} />
      {reports.data?.map((r) => (
        <div key={r._id} className="panel">
          <strong>
            {r.reason} · {r.status}
          </strong>
          <p>{r.description}</p>
          {r.resolution && <p>Moderator response: {r.resolution}</p>}
        </div>
      ))}
      {reports.data?.length === 0 && <p>No reports submitted.</p>}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(reports.data?.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      {auth.user?.role === "MODERATOR" && <Moderation />}
    </Page>
  );
}
export function Moderation() {
  const [page, setPage] = useState(1);
  const reports = useQuery<any[]>({
    queryKey: ["admin-reports", page],
    queryFn: () => api(`/admin/reports?page=${page}`),
  });
  return (
    <section>
      <h2>Moderation</h2>
      <QueryState query={reports} />
      {reports.data?.map((r) => (
        <ModerationReport key={r._id} report={r} />
      ))}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(reports.data?.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
export function ModerationReport({ report: r }: { report: any }) {
  const action = useAction();
  const [userId, setUserId] = useState(r.reportedUserId?._id || "");
  const strikes = useQuery<any[]>({
    queryKey: ["strikes", userId],
    queryFn: () => api(`/admin/users/${userId}/strikes`),
    enabled: /^[a-f\d]{24}$/i.test(userId),
  });
  return (
    <div className="panel">
      <h3>
        {r.reason} · {r.status}
      </h3>
      <p>{r.description}</p>
      <p>
        Reporter: {r.reporterId.displayName}{" "}
        {r.questId && <Link to={`/quests/${r.questId}`}>View quest</Link>}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          action.mutate({
            path: `/admin/reports/${r._id}/resolve`,
            data: {
              status: f.get("status"),
              resolution: f.get("resolution"),
              ...(f.get("questResolution")
                ? { questResolution: f.get("questResolution") }
                : {}),
            },
          });
        }}
      >
        <label>
          Status
          <select name="status">
            <option>UNDER_REVIEW</option>
            <option>RESOLVED</option>
            <option>DISMISSED</option>
          </select>
        </label>
        <label>
          Decision and evidence
          <textarea name="resolution" required minLength={5} maxLength={1000} />
        </label>
        {r.questId && (
          <label>
            Resolve disputed quest
            <select name="questResolution">
              <option value="">No lifecycle change</option>
              <option>COMPLETED</option>
              <option>CANCELED</option>
            </select>
          </label>
        )}
        <button className="button secondary" disabled={action.isPending}>
          Record decision
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate({
            path: `/admin/users/${userId}/strikes`,
            data: {
              relatedReportId: r._id,
              reason: new FormData(e.currentTarget).get("reason"),
            },
          });
        }}
      >
        <label>
          User ID to moderate
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            pattern="[a-fA-F0-9]{24}"
          />
        </label>
        <label>
          Strike evidence
          <textarea name="reason" required minLength={5} maxLength={1000} />
        </label>
        <button className="button secondary" disabled={action.isPending}>
          Issue reviewed strike
        </button>
      </form>
      {strikes.isError && <p className="error">{strikes.error.message}</p>}
      {strikes.data?.map((s) => (
        <div className="strike-row" key={s._id}>
          <span>
            {s.reason} · {s.revokedAt ? "Revoked" : "Active"}
          </span>
          {!s.revokedAt && (
            <button
              disabled={action.isPending}
              onClick={() =>
                action.mutate({ path: `/admin/strikes/${s._id}/revoke` })
              }
            >
              Revoke strike
            </button>
          )}
        </div>
      ))}
      <ActionStatus action={action} />
    </div>
  );
}
