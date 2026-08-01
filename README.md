# SpliitAI

A chat-first, no-login bill-splitting app. Type or speak an expense in natural
language and a host bot turns it into a structured entry. See
[`DESIGN_SPEC.md`](./DESIGN_SPEC.md) for the full design.

Built as a monorepo so the web app (now) and mobile app (later) share everything
except screen layouts.

## Structure

```
packages/core         shared TypeScript types (no framework deps)
packages/api-client   typed fetch client for the server
apps/server           Express + Prisma + SQLite API
apps/app              Expo Universal app (web now; iOS/Android later)
```

## Prerequisites

- Node.js 18+ and npm
- No database install needed for dev — SQLite is just a file.

## Setup (first time)

```bash
npm install
npm run db:push        # creates apps/server/prisma/dev.db from the schema
```

## Run (two terminals)

```bash
npm run server         # API on http://localhost:4000
npm run app            # web app on http://localhost:8081
```

Open http://localhost:8081. Create a group, then open the same URL in another
tab and join with the invite code to see the group chat with two people.

## Milestones

- **M0 (done)** — monorepo, create/join a group, group chat with a host bot,
  messages persist.
- **M1 (done)** — manual expense entry, balance engine with minimal settle-up,
  balances panel, expense cards in chat.
- **Group types (done)** — pick at creation, immutable:
  - *Split bills*: everyone pays their own way; who-owes-whom + settle-up.
  - *Shared card*: one built-in card; every spend charged to it; each person owes
    the card their share ("I spent 90" → you owe 90; "me and Bob spent 100" → $50
    each). No payer picking.
- **Settle up (done)** — record payments in natural language. Split: "I paid
  Bob 20" (person-to-person). Shared card: "I paid the card 50" / "I settled 50".
  Confirm card → balances update. Leaving is blocked until your balance is $0.
- **M2 (done)** — relevance gate + deterministic parser (free, no LLM). Type
  "paid 40 for dinner, split with Bob" → host proposes an expense card you
  Confirm / Edit / Cancel. Also "balance"/"settle"/"help" commands. Irrelevant
  chatter gets a free canned reply.
- **M3 (done)** — LLM fallback (Gemini Flash) for messy input the rules can't
  parse. Off by default; set `GEMINI_API_KEY` in `apps/server/.env` to enable.
  Only "unparsed" messages reach the model; output still goes through a confirm
  card. Fails safe to a canned reply on any error.
- **M4** — shared-card model (accounts as payers, ours/yours/mine splits).
- **M5** — voice input + balance/settle-up/undo commands.
- **M6** — mobile build (iOS/Android) + store submission.

## Notes

- Dev DB is SQLite (`apps/server/.env` → `DATABASE_URL`). Switch to Postgres at
  deployment time by changing the datasource provider + URL.
- For testing on a physical device later, set `apps/app/src/config.ts`
  `API_BASE_URL` to your machine's LAN IP instead of `localhost`.
```
