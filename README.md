# SideQuest

SideQuest is a React and TypeScript app with an Express API and MongoDB persistence. It helps users agree on local tasks and records the participants’ self-reported progress, completion, and external reward confirmations.

## Local development

Install Node.js and Docker, start the local MongoDB replica set with `docker compose up -d --wait`, then configure `MONGODB_URI` and a strong random `SECRET` in `backend/.env`. Start the API with `npm start` from `backend` and the frontend with `npm run dev` from `frontend`.

## Identity and payment boundaries

Accounts use a local username and password. A Kerberos-style username or `@mit.edu`-looking name is not authentication by MIT, and this app currently does not verify school affiliation. Do not describe users as verified students.

Rewards are amounts the two participants agree to pay directly using their chosen external method, such as cash, PayPal, Venmo, Cash App, or Zelle. SideQuest does not process, escrow, hold, guarantee, reverse, verify, or insure payment. The requester reports when they sent a reward and the completer confirms only if they actually received it. Those statements are self-reported. The app stores only a selected method and user-entered payment instructions; users should not enter passwords, account credentials, or sensitive financial data. Browser sessions use HTTP-only, SameSite=Lax cookies; production requires HTTPS.

Production operators should use a MongoDB deployment with TLS and encryption at rest, keep secrets in a secret manager, and back up transaction records with an appropriate retention policy. The current completion/dispute evidence fields accept text only; secure photo or attachment support would require private object storage, strict content and size validation, authorization checks on every download, and a retention/deletion policy before it should be enabled.

No payment encryption API is required because the app does not collect card or bank credentials. If a future product decision introduces payment processing, use a payment provider’s hosted checkout or hosted onboarding so the SideQuest servers never receive card numbers or bank credentials. Do not add client-side encryption as a substitute for a payment provider or TLS.

## Quest workflow

Quest state progresses through `open`, `in_progress`, `pending_review`, `awaiting_payment`, `payment_sent`, and `completed`. Either participant can open a dispute while the transaction is active. Completion reviews are tied to the quest and can be submitted once by each participant after receipt is confirmed. Quest agreements snapshot the description, category, reward in integer cents, locations, timing, and the completer’s payment preference at acceptance. Public quest listings expire after 24 hours; accepted transaction records remain for accountability.

## Moderation configuration

Set `ADMIN_KERBS` to an explicit comma-separated allowlist of administrator usernames. Moderation can issue a warning, add a strike, temporarily suspend, permanently suspend, or reinstate an account. `MODERATION_STRIKES_FOR_SUSPENSION` controls the strike threshold (default `3`; `0` disables automatic strike suspension) and `MODERATION_SUSPENSION_HOURS` controls temporary suspension duration (default `72`). Administrative actions and dispute decisions are recorded in the audit collection. Reports and disputes accept text notes only; avoid uploading or sharing sensitive evidence.

For a deployed app, set `APP_BASE_URL` or `FRONTEND_ORIGIN` to its exact HTTPS origin. The API checks request origins for writes and applies per-process IP request limits. Local Vite ports are allowed only outside production. A multi-instance production deployment should replace the in-memory limiter with a shared store.

## Checks

From `backend`, run `node --test quest-lifecycle.test.js`. From `frontend`, run `npm run build`.
