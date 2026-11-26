# SideQuest

SideQuest is a React and TypeScript app with an Express API and MongoDB persistence. It helps users agree on local tasks and records the participants’ self-reported progress, completion, and external reward confirmations.

## Local development

Use Node.js 22.12+ and Docker, start the local MongoDB replica set with `docker compose up -d --wait`, then copy `backend/.env.example` to `backend/.env` and set a random `SESSION_SECRET` of at least 32 characters. `MAX_QUEST_REWARD_CENTS` optionally configures the maximum reward in cents (default `100000`, or $1,000.00; quests currently require at least $3.00). Start the API with `npm start` from `backend` and the frontend with `npm run dev` from `frontend`.

## Identity and payment boundaries

Accounts use a local username and password. A Kerberos-style username or `@mit.edu`-looking name is not authentication by MIT, and this app currently does not verify school affiliation. Do not describe users as verified students. Backend controllers use a provider-neutral `req.auth` principal with the MongoDB user ID, alias, and application roles. Passport sessions store that stable ID; existing sessions that contain a Kerberos alias remain readable. User records reserve provider and verified identity identifiers for a future approved provider, but local signup always creates an unverified identity. New quest, message, notification, review, report, and moderation relationships include stable user IDs while legacy Kerberos references remain available during migration.

Rewards are amounts the two participants agree to pay directly using their chosen external method, such as cash, PayPal, Venmo, Cash App, or Zelle. SideQuest does not process, escrow, hold, guarantee, reverse, verify, or insure payment. The requester reports when they sent a reward and the completer confirms only if they actually received it. Those statements are self-reported. The app stores only a selected method and user-entered payment instructions; users should not enter passwords, account credentials, or sensitive financial data. Browser sessions use HTTP-only, SameSite=Lax cookies; production requires HTTPS.

Production operators should use a MongoDB deployment with TLS and encryption at rest, keep secrets in a secret manager, and back up transaction records with an appropriate retention policy. Quest photos and completion receipt images use a private MongoDB-backed image store. The API accepts only bounded JPEG, PNG, and WebP uploads, validates their signatures and decoded image content, re-encodes them to WebP without source metadata, and checks authorization on every image download. Unattached uploads are removed after 24 hours; per-user and global storage quotas can be configured with `MAX_USER_IMAGE_STORAGE_BYTES` and `MAX_GLOBAL_IMAGE_STORAGE_BYTES`. Upload decoding limits can be configured with `MAX_IMAGE_BYTES`, `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT`, `MAX_IMAGE_PIXELS`, and `MAX_CONCURRENT_IMAGE_UPLOADS`.

No payment encryption API is required because the app does not collect card or bank credentials. If a future product decision introduces payment processing, use a payment provider’s hosted checkout or hosted onboarding so the SideQuest servers never receive card numbers or bank credentials. Do not add client-side encryption as a substitute for a payment provider or TLS.

## Quest workflow

Quest state progresses through `open`, `in_progress`, `pending_review`, `awaiting_payment`, `payment_sent`, and `completed`. Either participant can open a dispute while the transaction is active. Completion reviews are tied to the quest and can be submitted once by each participant after receipt is confirmed. Quest agreements snapshot the description, category, reward in integer cents, locations, timing, and the completer’s payment preference at acceptance. Open listings stop appearing after their deadline; unattended quests are soft-deleted 24 hours after that deadline, while accepted transaction records remain for accountability.

## Moderation configuration

Set `ADMIN_KERBS` to an explicit comma-separated allowlist of administrator usernames. Moderation can issue a warning, add a strike, temporarily suspend, permanently suspend, or reinstate an account. `MODERATION_STRIKES_FOR_SUSPENSION` controls the strike threshold (default `3`; `0` disables automatic strike suspension) and `MODERATION_SUSPENSION_HOURS` controls temporary suspension duration (default `72`). Administrative actions and dispute decisions are recorded in the audit collection. Reports and disputes accept text notes only; avoid uploading or sharing sensitive evidence.

Quest publication also uses a versioned, low-cost moderation policy in `backend/moderation-policy.js`. Clear high-confidence prohibited requests are blocked; uncertain text and every quest with an image are held from public browsing until a moderator reviews them. Give trusted moderator accounts the `moderator` role or set `MODERATOR_KERBS` to a comma-separated allowlist; `ADMIN_KERBS` remains supported. Moderators can review text and sanitized quest images in the Admin review page. Policy version and reason codes are retained with each moderation case and decisions are written to the audit collection.

For a deployed app, set `APP_BASE_URL` or `FRONTEND_ORIGIN` to its exact HTTPS origin. The API checks request origins for writes and applies per-process IP request limits. Local Vite ports are allowed only outside production. A multi-instance production deployment should replace the in-memory limiter with a shared store.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Cloudflare Pages, Render, MongoDB, GitHub, health-check, and scheduled-job setup. Hosted credentials belong in provider secret settings, never in a Vite variable or committed `.env` file.

## Checks

From `backend`, run `node --test quest-lifecycle.test.js`. From `frontend`, run `npm run build`.
