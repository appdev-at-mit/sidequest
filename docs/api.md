# API v1

Base: `/api/v1`. JSON responses; errors have `{ "error": "message" }`. Validation errors use 400, missing session 401, denied access/CSRF 403, missing resource 404, lifecycle/duplicate conflict 409, quota/rate limits 429, service failure 503. Some malformed transport/body errors use their Express status.

First GET `/auth/me` with credentials included. Save the returned `csrfToken`, use it as `x-csrf-token` on **all** POST/PATCH requests, and retain the session cookie. Login rotates the session and returns a new token. The browser Origin must match `CLIENT_ORIGIN`. `/auth/me` also returns user, termsVersion and developmentLogin.

## Routes

| Method | Path                         | Access / body                                                                      |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/health`                    | database ping; 503 if unavailable                                                  |
| GET    | `/auth/me`                   | anonymous or authenticated session + CSRF                                          |
| GET    | `/auth/login`                | redirect to client login page                                                      |
| GET    | `/auth/callback`             | unavailable until actual SAML integration                                          |
| POST   | `/auth/dev-login`            | development only; `{kerberosId}` from seeded fictional accounts                    |
| POST   | `/auth/logout`               | destroy session                                                                    |
| GET    | `/quests`                    | public search, described below                                                     |
| GET    | `/quests/:id`                | public details; partner-only Venmo; overdue flag                                   |
| POST   | `/quests`                    | active user + current terms; quest contract below                                  |
| POST   | `/quests/:id/accept`         | active nonrequester + current terms                                                |
| POST   | `/quests/:id/submit`         | performer; accepted work, once                                                     |
| POST   | `/quests/:id/complete`       | requester; work must be submitted                                                  |
| POST   | `/quests/:id/cancel`         | requester; accepted work requires `{confirm:true}`                                 |
| POST   | `/quests/:id/dispute`        | accepted participant; `{reason}` 5–1000 chars                                      |
| GET    | `/users/me/quests`           | own posted/accepted history; paginated                                             |
| GET    | `/quests/:id/messages`       | accepted participants; paginated, chronological within page                        |
| POST   | `/quests/:id/messages`       | active participant; `{content}` 1–2000 chars; accepted/disputed only               |
| POST   | `/quests/:id/reviews`        | completed participants; `{rating:1..5,comment?}`; unique per reviewer/quest        |
| GET    | `/users/:id/reviews`         | public; paginated                                                                  |
| GET    | `/users/me`                  | private own profile                                                                |
| PATCH  | `/users/me`                  | active user; `{displayName?,venmoUsername?}` only                                  |
| GET    | `/users/:id`                 | public profile with privacy projection                                             |
| POST   | `/users/me/terms`            | `{version}` must equal current terms; acceptance audit                             |
| GET    | `/users/me/notifications`    | most recent 50 durable quest updates                                               |
| POST   | `/reports`                   | authenticated; `{reason,description,questId?,reportedUserId?,messageId?}`          |
| GET    | `/users/me/reports`          | own reports only; paginated                                                        |
| GET    | `/admin/reports`             | active moderator; paginated                                                        |
| POST   | `/admin/reports/:id/resolve` | moderator; `{status,resolution,questResolution?}`                                  |
| GET    | `/admin/users/:id/strikes`   | moderator; most recent 50 records                                                  |
| POST   | `/admin/users/:id/strikes`   | moderator; `{relatedReportId,reason}`; report must be reviewed and identify target |
| POST   | `/admin/strikes/:id/revoke`  | moderator; revocation audit                                                        |

General pagination: `page` defaults 1, `limit` defaults 20, maximum 50. Collections return arrays, except discovery returns `{items,total,page,limit}`. Messages page 1 contains the most recent messages, ordered ascending; larger page numbers retrieve older history. Read timestamps are recorded when a participant retrieves messages.

Report reasons are descriptive strings (3–100 chars); descriptions are 5–2000 chars. Report IDs refer to existing resources. A message report must reference a conversation accessible to the reporter. Moderator status is UNDER_REVIEW, RESOLVED or DISMISSED; resolution requires 5–1000 chars. Optional questResolution is COMPLETED/CANCELED, requires a RESOLVED report referencing a DISPUTED quest, and notifies both participants.

## Discovery

`latitude` [-90,90], `longitude` [-180,180] default MIT; `radiusMeters` 100–10000 (default 2000); `minPayCents`/`maxPayCents` integer 0–100000; `category` FOOD/DELIVERY/MOVING/BORROWING/ERRAND; `sort` distance/payment/newest/deadline; `search` literal title substring (up to 100 chars); `page`/`limit`. Filters compose server-side; only open, unexpired work is returned. Payment sorts descending; others sort ascending distance/deadline or descending creation time. Stable ID tie-breaks are used.

## Creation example

```json
{
  "title": "Bring a charger to Lobby 7",
  "description": "Meet me at the public entrance.",
  "category": "DELIVERY",
  "payCents": 700,
  "startLocation": {
    "type": "Point",
    "coordinates": [-71.0932, 42.3592],
    "label": "Lobby 7"
  },
  "deadline": "<ISO timestamp in the next 24 hours>"
}
```

Optional `endLocation` uses the same Point contract; `instructions` is up to 1000 chars. Title: 1–100 chars; description: 1–2000 chars; payment: positive integer cents up to $1000. GeoJSON order is always **longitude, latitude**, unlike Leaflet's **latitude, longitude**. Requester, performer, status, rating, strikes, and account role cannot be supplied by the client.

## Real time

Connect Socket.IO using `transports: ["websocket"]` on the API origin (proxied at `/socket.io` in development) with the session cookie, allowed Origin, and `auth: {csrfToken}`. Emit `join` with quest ID and optional acknowledgment callback. Only the accepted requester and performer can join, including closed history. Invalid attempts are bounded. Receive `message: {questId}` after persisted message creation and refetch REST. Clients can join one conversation at a time; all writes go through POST message validation, CSRF and rate limiting.
