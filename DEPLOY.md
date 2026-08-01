# Deploying SpliitAI — Phase A (backend) + Phase B (web)

Goal: a public API and a public web app, both free to start.
Stack: **Neon** (Postgres) · **Render** (backend) · **Vercel** (web).

---

## 0. Prerequisites

- Accounts (all free): **GitHub**, **Neon**, **Render**, **Vercel**.
- Push this repo to GitHub (Render & Vercel deploy from it):

```bash
cd C:\SpliitAI
git init
git add .
git commit -m "SpliitAI"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/spliitai.git
git branch -M main
git push -u origin main
```

`.env` and `node_modules` are gitignored, so your secrets are not pushed.

---

## Phase A — Backend + Database

### A1. Create the database (Neon)
1. Sign up at https://neon.tech → **New Project**.
2. Copy the **connection string** (starts with `postgresql://…`, includes `?sslmode=require`).
3. (Optional) Create a second **branch** in Neon for local dev, so local testing
   doesn't touch production data.

### A2. Switch the schema to Postgres
In `apps/server/prisma/schema.prisma`, change the datasource provider:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

Update `apps/server/.env` locally to the Neon (dev branch) URL:

```
DATABASE_URL="postgresql://…neon.tech/…?sslmode=require"
```

Then create the tables and verify locally:

```bash
npm run db:push
npm run server      # should start; test at http://localhost:4000/api/health
```

### A3. Deploy the backend (Render)
1. https://render.com → **New → Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory:** *(leave blank — repo root)*
   - **Build Command:** `npm install`
   - **Start Command:** `npm run start:prod -w @spliitai/server`
   - **Instance type:** Free
3. **Environment variables** (Render dashboard → Environment):
   - `DATABASE_URL` = your Neon **production** connection string
   - `GEMINI_API_KEY` = your key
   - `GEMINI_MODEL` = `gemini-flash-latest`
   - *(Render provides `PORT` automatically — the server already reads it.)*
4. Deploy. When it's live you'll get a URL like `https://spliitai.onrender.com`.
   Test: open `https://…onrender.com/api/health` → should show `{"ok":true}`.

> Note: Render's free tier sleeps after inactivity, so the first request after a
> while takes ~30s to wake. Fine for testing; upgrade later if needed.

`start:prod` runs `prisma db push` on boot, so the production tables are created
automatically on first deploy.

---

## Phase B — Web app (Vercel)

1. https://vercel.com → **Add New → Project** → import the same GitHub repo.
2. Settings:
   - **Root Directory:** *(leave as repo root)*
   - **Build Command:** `npm install && npm run export:web -w @spliitai/app`
   - **Output Directory:** `apps/app/dist`
3. **Environment variable:**
   - `EXPO_PUBLIC_API_BASE_URL` = your Render URL (e.g. `https://spliitai.onrender.com`)
     — no trailing slash.
4. Deploy → you get `https://your-project.vercel.app`.

That URL is your live app. Invite links it generates (`?g=CODE`) now work for
anyone, on any device.

> Re-deploy whenever you push to GitHub (both Render and Vercel auto-deploy on
> push). If you change the backend URL, update `EXPO_PUBLIC_API_BASE_URL` in
> Vercel and redeploy (Expo inlines it at build time).

---

## After it's live (recommended before promoting widely)

- **Rate limiting / abuse protection** on the API, especially the messages
  endpoint (protects your Gemini quota). Not required for a soft launch.
- **Custom domain** (optional) — both Render and Vercel let you add one.
- Keep an eye on Neon/Render/Gemini free-tier limits.

## Local dev after the switch

Local now uses Postgres too (via the Neon dev URL in `apps/server/.env`).
`npm run server` + `npm run app` work exactly as before.
