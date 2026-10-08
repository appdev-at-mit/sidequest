# SideQuest

A mobile-friendly, MIT-area peer-to-peer task marketplace. React/TypeScript + Leaflet on the client, Express/TypeScript + MongoDB on the server. Quests, messages, reviews, reports, strikes, notifications, and terms acceptances persist in MongoDB. Payments happen entirely outside SideQuest.

## Run locally

Requires Node **20.19+** (or 22.12+) and Docker with Compose.

```bash
npm install
cp .env.example .env
docker compose up -d --wait
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. API: **http://localhost:4000/api/v1**. Database health: `/api/v1/health`.

The seed creates six clearly fictional quests near the Student Center, Stata, Hayden, Simmons, Baker, and Lobby 7. Five are open; one is accepted. Sign in with fictional Alex, Maya, or Jordan on `/login`. Read and accept the draft terms before posting or accepting. Seeded quests consume each fictional requester's rolling quota, leaving one additional post per account initially. No real student identity or Venmo account is implied.

The seed is idempotent while an unexpired sample quest exists. To regenerate development data:

```bash
npm run db:reset
```

**Reset deletes all application records**, and is limited to development mode and a database named `sidequest` or ending in `_dev`. It does not remove the session collection; users should log out before reset. Never point it at a database containing real user data.

To try moderation, set `MODERATOR_KERBEROS_IDS=demo-jordan` **before the first seed**, then sign in as Jordan and open Support. On an existing disposable database, reset/reseed after changing this setting. Clients cannot set their roles. Moderation writes require the database moderator role on every request.

## Checks

```bash
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:e2e -w apps/web
npm audit
```

Integration tests require the local replica set. They create a randomly named `sidequest_test_*` database and drop only that database afterward. Override `TEST_DATABASE_URL` with a disposable replica-set/Atlas connection; the test runner replaces its database name with a unique test name. Tests never use the application database. Browser tests start separate API/web servers on ports 4001/5174 and create a unique `sidequest_e2e_*_dev` database. These fictional browser fixtures remain for inspection; remove old test databases with your database tooling when no longer needed. Desktop and mobile tests cover two authenticated participants, posting, acceptance, chat, completion, review, and support.

## Configuration

See [.env.example](.env.example). Configuration loads from the repository root even when npm runs workspace scripts. No secrets are committed. Generate a session secret with `openssl rand -hex 32`.

- `DATABASE_URL`: local replica set or Atlas URI. Multi-document transactions require a replica set or sharded cluster. Docker binds MongoDB only to loopback and persists data in `mongo_data`.
- `CLIENT_ORIGIN`: exact allowed web origin, including port. CSRF and Socket.IO enforce it.
- `SESSION_SECRET`: at least 32 characters. Development has an explicitly local default; production refuses it.
- `AUTH_MODE`: `development` or `disabled`. Development authentication **cannot run in production**.
- `MODERATOR_KERBEROS_IDS`: comma-separated fictional seed identities to provision as moderators; no default moderators.
- `STRIKE_THRESHOLD`: positive integer, default 3.
- `API_PROXY_TARGET`: optional Vite development proxy override; defaults to `http://localhost:4000`.

## Authentication status

**Real Touchstone authentication is not configured or implemented as a production service.** MIT documents Touchstone as Shibboleth/SAML, rather than generic OAuth. The isolated `AuthenticationAdapter` interface allows a future verified identity implementation. The current adapter accepts only fictional seeded development accounts and never accepts a password, identity header, or fabricated SAML assertion. Production must use `AUTH_MODE=disabled`; it permits browsing but has no login until a reviewed production adapter is added.

Production integration needs MIT-approved service provider registration, entity ID and HTTPS assertion consumer URL, current trusted IdP metadata/signing certificates, SP key/certificate, approved identity and current student affiliation attributes, and the deployment's Shibboleth/SAML trust boundary. If an authenticated reverse proxy supplies attributes, the app must be inaccessible except through that proxy, which must strip client identity headers. If SAML is validated in Node, verify issuer, signature, audience, recipient, time window, InResponseTo, and replay protection; use a maintained implementation and approved metadata. MIT identity by itself is not proof of current student status. No such trust boundary is assumed here.

Official references: [MIT Touchstone](https://ist.mit.edu/touchstone), [MIT Touchstone FAQ](https://wikis.mit.edu/confluence/display/TOUCHSTONE/MIT%2BTouchstone%2BFAQ).

## Architecture and behavior

See [architecture](docs/architecture.md), [API reference](docs/api.md), and [production checklist](docs/production.md).

- One client selection ID drives the card highlight, map centering/pin highlight, and detail preview. Leaflet sits behind `MapView`; no MapIt source was present in the empty repository.
- Nearby discovery combines server-side geospatial, amount, category, literal title search, sorting, and pagination. Search radius is 100 m–10 km; page size is at most 50.
- Browser location is optional and is not persisted. Denial defaults to MIT; manual search and pickup location selection remain available. OpenStreetMap tile requests require network access.
- Quotas use a per-user timestamp ledger locked in the same MongoDB transaction as quest insertion. Cancellation and expiration never remove quota entries.
- Acceptance is a conditional atomic update inside a transaction. Only one student can accept; requesters cannot accept their own quests.
- Performer submission precedes requester completion confirmation. Completion is independent of payment. Overdue accepted work remains visible with a warning; participants may escalate to a moderator-resolved dispute.
- Chat uses authorized quest rooms for real-time invalidation and persists through REST. Polling every 10 seconds provides a fallback. Closed chat remains readable; sending is limited to accepted/disputed work. Durable quest notifications appear in My Quests.
- Terms are explicitly accepted and audited by version. Draft terms require legal/institutional review.
- Reports are private. Reviewed strikes are issued by moderators; active strike records are the source of truth. Three active strikes suspend the account; revocation restores it below threshold unless banned. Ratings never create strikes.
- Venmo usernames are shown only to quest participants. No payment verification, payment API, wallet, transfer, or undocumented deep link exists.

## Current limitations

Production Touchstone/verified student eligibility, institutional/legal review, staffed moderation, and production infrastructure remain launch blockers. This implementation is a functional **development pilot**, not a production-authenticated MIT service. Blocking is reserved in the schema and has no UI. No external push/email notifications or payment verification are provided. Listings and conversations are paginated; map pins reflect the currently loaded results page. Messages are ordered within each newest-first page. Profile avatars use initials; an avatar URL field is reserved. Moderation audit data is stored with reports and strikes; a tamper-resistant external audit archive is not provided. Single-process rate limits require a shared store if the API is scaled horizontally. OSM tiles have no offline fallback.
