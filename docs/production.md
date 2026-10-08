# Production launch checklist

This project is ready for local development evaluation, **not an authenticated production MIT launch**.

- Register the application with MIT Touchstone support and establish the actual approved SAML/Shibboleth integration. Implement and review the production adapter, secure callback/replay handling, and approved current-student eligibility checks. Keep development login inaccessible in every production deployment.
- Obtain legal and institutional review of terms, acceptable use, privacy, liability, external payments, dispute policy and moderation. Change terms version when policies change. Add the operational contact/escalation process and staff the report queue before inviting real students.
- Provision an Atlas replica set or authenticated MongoDB deployment; protect credentials in a secrets manager; restrict network access; configure backups and test restore. Never expose the unauthenticated local Compose database to the internet.
- Run `npm ci`, build, lint, unit/integration/browser tests, and dependency audit in CI. Recheck concurrency against the production MongoDB version. The Docker development database uses MongoDB 7.0.
- Serve `apps/web/dist` with SPA history fallback. Reverse proxy `/api` and `/socket.io` to the Node server with WebSocket support and HTTPS. Configure exactly one trusted proxy hop, secure headers and request limits. Do not expose the API directly behind a trusted-header authentication setup.
- Set NODE_ENV=production, AUTH_MODE=disabled until a production adapter is reviewed, an HTTPS CLIENT_ORIGIN, and a unique long SESSION_SECRET. Rotate secrets through an explicit session invalidation policy.
- Provision moderators through trusted administrative tooling after authentication, never through a profile update. Review source reports before issuing strikes. Reports/strikes preserve moderator and timestamp audit data; consider an append-only external audit archive.
- Define data retention and removal policies for sessions, messages, published locations and moderation history. Disable logging of session tokens, secrets and sensitive location query strings. Explain tile-provider requests in the reviewed privacy policy.
- Check OpenStreetMap tile attribution, caching, usage policy and capacity; switch to an approved tile provider for production traffic as needed.
- Add production monitoring for health, database failures, expiration jobs, report backlog, availability and anomalous usage. Define on-call/recovery procedures.
- Use shared rate-limit storage if deploying multiple API instances; configure Socket.IO shared-room infrastructure if realtime runs on multiple processes. The MVP uses one process.
- Confirm that no UI promises payment processing, escrow, verification, or guarantees. No actual payment integration exists, and funds must remain external.
- Validate mobile devices, keyboard navigation, screen reader labels, denied geolocation, slow networks and external tile failure before the pilot.
