# CourtSync

Mobile-first PWA for sports groups: daily RSVP, auto court scaling (7 players per court, Court 2 at the 8th player), membership and drop-in dues, and an expense ledger (court fees, shuttles, equipment) deducted from the pool. Angular + Supabase, deployed on Netlify.

## Setup

1. Create a free Supabase project. Enable **Authentication > Providers > Anonymous Sign-Ins**.
2. In the SQL editor run `supabase/migrations/001_courtsync.sql`, then edit and run `supabase/seed.sql` (group name, slug, admin PIN, players).
3. Put your project URL, anon key and group slug in `src/environment.ts`.
4. `npm install`, then `npm start` (http://localhost:4200). Use `npm test` for unit tests.

## Deploy (Netlify)

Connect the repo; `netlify.toml` sets the build and SPA redirect. Add env vars `SUPABASE_URL` and `SUPABASE_ANON_KEY` so the edge function (`netlify/edge-functions/og.ts`) can serve live "N Playing Today" link previews to WhatsApp.

## Routes

- `/g/:slug/today` player RSVP
- `/g/:slug/me` personal ledger
- `/g/:slug/admin` PIN-protected admin
