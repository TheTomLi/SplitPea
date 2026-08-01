# Launching SplitPea on `getsplitpea.com`

The launch stack is:

- **Cloudflare Registrar + DNS** — `getsplitpea.com`
- **Cloudflare Pages** — Expo web build at `https://getsplitpea.com`
- **Railway** — Express API at `https://api.getsplitpea.com`
- **Neon** — managed PostgreSQL in North America

The repository is already configured for this stack. The production Prisma
schema is PostgreSQL, Railway settings live in `railway.toml`, the web client
uses `/api/v1`, and production CORS defaults to the two SplitPea web origins.
Local development still uses SQLite and needs no database service.

## 1. Register the domain

1. Open [Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register).
2. Search for and purchase `getsplitpea.com`.
3. Keep WHOIS privacy and DNSSEC enabled.

Domain purchase is the only irreversible/paid action in this checklist. Do not
buy a similarly spelled alternative by accident.

## 2. Create the Neon database

1. In [Neon](https://console.neon.tech/), create a project named `SplitPea` in
   the North America region nearest Railway (for example AWS US East/N. Virginia).
2. Copy both connection strings:
   - **Pooled connection** → Railway `DATABASE_URL`
   - **Direct connection** → Railway `DIRECT_URL`
3. Include `sslmode=require` in both URLs.

Do not paste either URL into Git or a committed file. Railway runs
`npm run db:push:prod --workspace @splitpea/server` before each deployment, so
the tables are created from `apps/server/prisma/schema.prisma`.

## 3. Deploy the API on Railway

1. In [Railway](https://railway.com/), create a project from the GitHub repo
   `TheTomLi/SplitPea`.
2. Create one service from the repository root. Railway reads `railway.toml`,
   which supplies the build, pre-deploy migration, start, and health-check commands.
3. Add these service variables:

   ```text
   DATABASE_URL=<Neon pooled connection string>
   DIRECT_URL=<Neon direct connection string>
   NODE_ENV=production
   TRUST_PROXY=1
   GEMINI_API_KEY=<your Gemini key>
   GEMINI_MODEL=gemini-flash-latest
   CORS_ALLOWED_ORIGINS=https://getsplitpea.com,https://www.getsplitpea.com
   CORS_ALLOWED_ORIGIN_SUFFIXES=.splitpea.pages.dev
   ```

4. Deploy and confirm the temporary Railway URL returns `{"ok":true}` at
   `/api/v1/health`.
5. In Railway **Settings → Networking → Custom Domain**, add
   `api.getsplitpea.com`. Add the exact DNS record Railway shows to Cloudflare
   DNS. Start with **DNS only** while Railway validates the hostname.
6. Turn off Railway Serverless/App Sleeping for a responsive user experience,
   and choose a US East region close to Neon.

The API limits writes per IP while leaving polling reads alone. Defaults are 180
mutations per 15 minutes, 40 messages per 5 minutes, and 20 new groups per hour.
They can be overridden with the variables documented in
`apps/server/.env.production.example`.

## 4. Deploy the web app on Cloudflare Pages

1. In Cloudflare **Workers & Pages**, create a Pages project named `splitpea`
   connected to `TheTomLi/SplitPea`. If Cloudflare requires a different project
   name, change Railway's `CORS_ALLOWED_ORIGIN_SUFFIXES` to that project's exact
   `.pages.dev` suffix.
2. Use these build settings:

   ```text
   Production branch: main
   Root directory: repository root (leave this field blank)
   Build command: npm run export:web --workspace @splitpea/app
   Build output directory: apps/app/dist
   Node.js version: 22
   ```

   Cloudflare detects the root `package-lock.json` and installs the npm
   workspace before the build.

3. Add these **build-time** environment variables for both Production and Preview:

   ```text
   EXPO_PUBLIC_API_BASE_URL=https://api.getsplitpea.com
   EXPO_PUBLIC_KOFI_URL=https://ko-fi.com/splitpea
   NODE_VERSION=22
   ```

4. Deploy the Pages URL, then add only `getsplitpea.com` under **Custom domains**.
5. For `www`, follow [Cloudflare's Bulk Redirects pattern](https://developers.cloudflare.com/pages/how-to/www-redirect/):
   - Source URL: `www.getsplitpea.com`
   - Target URL: `https://getsplitpea.com`
   - Status: `301`
   - Enable **Preserve query string**, **Subpath matching**, and
     **Preserve path suffix**.
   - Create the bulk redirect rule, then add a proxied `A` record named `www`
     pointing to Cloudflare's documentation address `192.0.2.1`.

Pushes to `main` now rebuild Railway and Cloudflare automatically.

## 5. Pre-launch smoke test

Run this against production before sharing the URL:

1. Open `https://api.getsplitpea.com/api/v1/health` and confirm `{"ok":true}`.
2. Open `https://getsplitpea.com` in a private browser window.
3. Create a split-bills group with two people.
4. Enter: `$40 on dinner, paid by Emma, for Tom and Emma, split evenly`.
5. Confirm the expense and verify balances.
6. Open the invite link in a second browser/device and verify the same chat.
7. Try the Kelvin/Kevin typo case and verify the correction notice appears.
8. Check that the Ko-fi link opens `https://ko-fi.com/splitpea`.
9. Confirm `https://www.getsplitpea.com` redirects to the apex domain.
10. Watch the first Railway and Neon logs for errors, without copying secrets
    into screenshots or support messages.

## Deliberately omitted: account tokens

SplitPea remains a no-login, invite-link-trust product for this launch. Anyone
with a group link can view and change that group, so users must share links only
with people they trust. CORS and rate limits reduce browser abuse and cost; they
do **not** authenticate a group member. Capability/member tokens can be added
later without changing the public `/api/v1` contract.

## Local development

Copy `apps/server/.env.example` to `apps/server/.env` if needed, then run:

```bash
npm install
npm run db:push
npm run server
```

In a second terminal:

```bash
npm run app
```

The API is at `http://localhost:4000/api/v1/health`; the web app is at
`http://localhost:8081`.
