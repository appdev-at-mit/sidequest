# Architecture

The inspected repository had no frontend, backend, package manager configuration, MapIt integration, or reusable components.

## Layout

- `apps/server/src/config.ts`: validated environment and current terms version.
- `models.ts`, `db.ts`: Mongoose schemas/indexes and replica-set connectivity.
- `auth.ts`: identity interface and production-disabled development adapter.
- `validation.ts`: strict request contracts; no raw client objects become database filters.
- `app.ts`: Express API, sessions, CSRF, authorization, transactions and error boundary. The app factory accepts a session store and event emitter for isolated tests.
- `realtime.ts`: authenticated Socket.IO rooms. Chat writes remain in the validated/rate-limited REST API.
- `index.ts`: startup, expiration worker, server wiring and shutdown.
- `seed.ts`: fictional seed/reset tooling.
- `apps/web/src/api.ts`: typed client entities and CSRF-aware requests.
- `MapView.tsx`: provider boundary for Leaflet; optional browser location and click selection.
- `Discovery.tsx`: server filters and shared list/map selection.
- `App.tsx`: application shell and router; `components.tsx`: shared authentication, loading and action components; `pages/`: quest, messaging, profile, authentication and safety workflows.

npm workspaces keep client and server independent while sharing development commands. No external queue, payment service, or microservice is needed. MongoDB's replica-set transactions are deliberate: quota updates cannot commit without their quests, and review averages cannot drift when duplicate/concurrent reviews arrive.

## State transitions

| State                    | Action                   | Actor                                              | Result                      |
| ------------------------ | ------------------------ | -------------------------------------------------- | --------------------------- |
| OPEN, future deadline    | accept                   | active student other than requester, current terms | ACCEPTED                    |
| OPEN, future deadline    | cancel                   | requester                                          | CANCELED, BEFORE_ACCEPTANCE |
| OPEN, passed deadline    | read/worker              | system                                             | EXPIRED                     |
| ACCEPTED                 | submit work once         | performer                                          | ACCEPTED + workSubmittedAt  |
| ACCEPTED, work submitted | confirm completion       | requester                                          | COMPLETED                   |
| ACCEPTED                 | confirmed cancellation   | requester                                          | CANCELED, AFTER_ACCEPTANCE  |
| ACCEPTED                 | dispute                  | either participant                                 | DISPUTED + private report   |
| DISPUTED                 | resolution with evidence | moderator                                          | COMPLETED or CANCELED       |

All other transitions are rejected. Acceptance checks the deadline in the actual conditional database update, independent of expiration cleanup. Cleanup runs at startup and every minute and never deletes quests. List reads exclude passed deadlines. Accepted and disputed overdue work remains in history; participants can coordinate or seek human resolution. Cancellation preserves performer assignment and timestamps and creates a durable notification for the other participant.

## Concurrency

Creation locks the requester document with a revision increment inside a retried transaction, filters its private ledger to the preceding 24 hours, checks three entries, and appends the new creation timestamp together with the quest insert. The requester, status and cents are server-controlled/validated. The ledger is private and not user-editable; seed writes also populate it.

Acceptance uses `_id + OPEN + deadline > now + requester != current user`, plus a transactional user lock to serialize with moderation. A race returns conflict to the loser. Submission/completion/cancellation similarly lock the quest via a conditional update and do not allow repeated submission/completion. Message creation writes the quest inside the same transaction so a concurrent closure and message cannot bypass closure rules.

Review insertion has a unique `(questId, reviewerId)` index. A review transaction locks the reviewee and updates count/average only if insertion commits. Moderator strikes and revocations serialize on the user; suspension is derived from the count of nonrevoked Strike documents. Ban state is preserved on revocation.

## Security and privacy

HTTP-only, SameSite=Lax sessions persist in MongoDB; production requires HTTPS/secure cookies. Session IDs rotate on login. Synchronizer CSRF tokens protect all state-changing API requests, including development login; Origin is checked when present. Helmet, exact CORS, bounded JSON bodies, endpoint validation, ID validation, and rate limits apply. Session cookies/tokens and raw database errors are not logged. Production trusts exactly one reverse proxy; deployment must enforce that topology.

Socket.IO checks the allowed browser origin, session, CSRF handshake token, and active account. Joining a room reloads participant authorization, with bounded attempts and one room per socket. Sessions are reloaded every 30 seconds to close logged-out/expired connections. Event payloads contain only quest IDs; clients fetch messages through the authorized API. No unauthenticated socket writes exist.

Public profiles expose ID, display name, fictional flag, average and count. Email, Kerberos identity, role, strike details and private ledger are excluded. Venmo usernames appear only in the participant quest response. Rendering uses React text nodes; map marker HTML contains only a server-validated formatted number. Reports and message-report references enforce private conversation access. Suspended accounts can read history and file reports; privileged marketplace writes are disabled.

Current location is transient client state, included in nearby query coordinates but never written to a user record. Infrastructure must avoid logging query strings if location privacy is required. Published quest locations are intentionally public, which the draft terms explain.
