# SideQuest

SideQuest is a React and TypeScript app with an Express API and MongoDB persistence.

## Local development

Install Node.js and Docker, start the local MongoDB replica set with `docker compose up -d --wait`, then configure `MONGODB_URI` and a strong random `SECRET` in `backend/.env`. Start the API with `npm start` from `backend` and the frontend with `npm run dev` from `frontend`.

## Stripe Connect setup

The wallet uses Stripe hosted onboarding for connected account setup. SideQuest does not collect or store bank or card details. Add `STRIPE_SECRET_KEY` and `APP_BASE_URL` to the backend environment to enable onboarding. Use a Stripe test secret while developing and the HTTPS production site URL for `APP_BASE_URL` in production. Never expose the secret key in frontend code or commit it.

The current integration creates Express connected accounts with the transfers capability and opens Stripe's account onboarding. Live quest payment collection, release, refunds, disputes, and transfers are not wired yet. PayPal, Venmo, Cash App, and card selections are currently saved as preferences only.
