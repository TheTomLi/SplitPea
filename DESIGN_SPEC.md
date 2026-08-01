# SplitPea — Design Spec (v0.1)

> A chat-first, no-login bill-splitting app. Rethinks Spliit's form-heavy UX as a
> group chat where you *type or speak* an expense in natural language and a host
> bot turns it into a structured, confirmable entry. Adds a first-class model for
> the **shared-card** scenario (couples/families where one card pays common +
> personal bills).

Status: draft for review. Nothing is built yet.

---

## 1. Goals & non-goals

### Goals
- **Speed of entry.** Adding an expense should take one sentence, not a multi-step form.
- **Chat-first UX.** Each group is a group chat; a **host bot** parses input and replies with confirmation/summary cards.
- **No login.** Join a group via shareable link, identified by name — like Spliit.
- **Voice-friendly.** Native device dictation feeds the same text pipeline (free).
- **Shared-card model.** Handle "one card pays for ours/yours/mine" as a first-class case, not a hack.
- **Cheap to run.** Most messages cost $0 (see the 3-tier parser). LLM is the last resort.
- **Reusable across web + mobile.** Web app first; mobile later from the same codebase.

### Non-goals (for v1)
- Public/marketing site, SEO, discoverability.
- User accounts, passwords, social login.
- Server-side audio transcription (native dictation covers it).
- Real-time multi-user typing indicators / presence (nice-to-have, later).

---

## 2. Key differentiators vs. Spliit

1. **Chat + host bot** instead of forms. Natural-language entry with an editable
   confirmation card (speed of chat + safety of a form).
2. **Group type chosen at creation** (immutable) — this is what removes the
   complexity:
   - **Split-bills group**: everyone pays with their own money. Each expense has
     a payer (a person) and a split; balances are who-owes-whom. No card concept.
   - **Shared-card group**: one card is built into the group. *Every* spend is
     charged to it — you never pick a payer. You just say what you spent and who
     it was for; the app tallies **how much each person owes the card**. A spend
     defaults to just the person who typed it ("I spent 90"), unless others are
     named ("me and Bob spent 100") or "everyone" is said.

   This cleanly handles the couple/family scenario that Spliit forces you to hack
   with a fake "credit card person," without the per-expense friction of a
   generic payer/beneficiary model.

---

## 3. Architecture — layered for web ↔ mobile reuse

Monorepo. Everything except the screen layouts is framework-agnostic and reused
verbatim on mobile.

```
splitpea/
├─ packages/
│  ├─ core/          # pure TypeScript — no UI, no framework
│  │  ├─ types       # Group, Member, Account, Expense, Split, ...
│  │  ├─ balance     # settle-up / who-owes-whom engine (ref: Spliit)
│  │  ├─ parser      # 3-tier parser (gate → rules → LLM)
│  │  └─ sharedcard  # payer/beneficiary logic
│  └─ api-client/    # typed client that calls the server
├─ apps/
│  ├─ server/        # backend API + Postgres (Prisma), LLM calls
│  └─ app/           # Expo Universal UI (web now; iOS/Android later)
```

Reuse guarantee:
- `packages/*` + `apps/server` → **100% shared** web ↔ mobile.
- `apps/app` → Expo Universal means even most UI is shared (`react-native-web`).

---

## 4. Data model (draft)

Extends Spliit's schema. Key change: **`Account` as a payer**, and an explicit
**beneficiary split** separate from the payer.

```
Group
  id, name, createdAt
  inviteCode           # for the no-login shareable join link

Member                 # a person in the group (no account/login)
  id, groupId, name

Account                # a payer that may not be a person: a card, cash, etc.
  id, groupId, name    # e.g. "Joint Visa", "Alice's cash"
  paidByMemberId?      # optional: who actually settles this account's real
                       # statement. If set, settle-up is computed automatically
                       # (e.g. "partner owes you $X for their card share this
                       # month"). If blank, the app just shows the split.

Expense
  id, groupId
  amount               # plain number, shown with a "$" sign
  description, category, date
  paidBy               # -> Member OR Account   (who fronted the money)
  createdVia           # 'rules' | 'llm' | 'manual'  (for analytics/trust)

Split                  # beneficiary allocation — who should bear the cost
  id, expenseId
  memberId
  mode                 # 'even' | 'shares' | 'percent' | 'exact'
  value                # share count / percent / exact amount (per mode)

Message                # chat log (user + host messages)
  id, groupId, memberId?, role ('user'|'host')
  text, cardType?, cardPayload?   # host cards render from structured payload
  createdAt
```

Notes:
- **paidBy = Account** is what makes the shared-card case clean. The joint card
  is the payer; the split says how much was "ours" vs "yours" vs "mine."
- Split modes mirror Spliit (even/shares/percent/exact) so the balance math is
  familiar and reusable.

---

## 5. The 3-tier parser (cost control lives here)

Most messages must cost **$0**. Only genuinely ambiguous expense-like text hits
the LLM.

**Tier 1 — Relevance gate (free, no LLM).**
Cheap check: does the message contain a number/currency or a known keyword
(`paid`, `split`, `owe`, `balance`, `settle`, `undo`, a member name)? Also
enforce a max length (~200 chars). If it fails → host replies with a canned
"I didn't catch an expense or command" + an example. **No API call.**

**Tier 2 — Deterministic parser (free, no LLM).**
Regex/grammar for the common shapes:
- `paid <amount> for <thing>[, split <who>]`
- `balance` / `who owes what`
- `settle up`
- `undo` / `delete last`
Confident match → build the card directly. **No API call.**

**Tier 3 — LLM fallback (paid, rare).**
Expense-looking text that Tier 2 couldn't parse → LLM with a **strict JSON
schema** (tool/structured output): `{ amount, paidBy, category, split[] }`.
Output stays tiny.

Engine: **Gemini Flash free tier** to start (swappable behind an interface;
Groq or self-hosted small model are drop-in alternatives later).

Abuse protection: max message length, per-group/IP rate limiting, ignore
oversized input before it reaches any LLM.

---

## 6. Host bot behavior

The host is a **command parser with a friendly personality**, NOT an open-ended
chatbot. It:
- Confirms parsed expenses via an **editable card** (tap to fix amount/who/split
  before committing).
- Answers a fixed set of queries: balances, settle-up, recent expenses, undo.
- Politely declines anything else ("I handle expenses and balances for this
  group — try 'paid 20 for coffee, split with Sam'."). Declines are **free**
  (handled by Tier 1, no LLM).

This keeps it cheap, fast, and trustworthy with money — the model never silently
guesses at a dollar amount without a confirm step.

---

## 7. Chat UX / screens

- **Chat list** — all groups you've joined (stored locally on device +
  reconstructable from invite links).
- **Group chat** — message bubbles; host messages can be **structured cards**
  (expense confirmation, balance summary, settle-up plan).
- **Composer** — text input with the OS mic button for voice dictation.
- **Group settings** — members, accounts (cards), currency, invite link.

Voice = native dictation → text → same parser pipeline. No extra cost.

---

## 8. No-login & joining

- Create a group → get an **invite link** with an `inviteCode`.
- Open the link → pick/enter your name → you're in the chat.
- Identity is name-based per group (like Spliit). Device remembers which groups
  and which name you used (local storage).

---

## 9. Tech stack

- **UI:** Expo (React Native + `react-native-web`) — one codebase → web now,
  iOS/Android later.
- **Language:** TypeScript everywhere.
- **Backend:** Express API in `apps/server`, hosted on Railway. Prisma with
  SQLite locally and Neon PostgreSQL in production.
- **Web hosting:** Cloudflare Pages at `getsplitpea.com`; API at
  `api.getsplitpea.com` with a stable `/api/v1` prefix.
- **LLM:** Gemini Flash free tier (swappable).
- **Balance math + parser:** `packages/core`, pure TS, reused everywhere.

---

## 10. Roadmap (thin slices)

- **M0 — Skeleton.** Monorepo, Expo app runs on web, server + DB up, create/join
  a group, post plain chat messages.
- **M1 — Manual expense via card.** Add an expense through a card UI (no parsing
  yet); balances compute correctly. Proves the data model + balance engine.
- **M2 — Tiers 1 & 2 parser.** Relevance gate + deterministic parser. Type
  "paid 40 for dinner, split with Bob" → confirmation card. Zero LLM cost.
- **M3 — Tier 3 LLM fallback.** Gemini Flash for messy input, strict JSON schema.
- **M4 — Shared-card polish.** Accounts as payers, ours/yours/mine splits,
  statement reconciliation view.
- **M5 — Voice + queries.** Dictation, balance/settle-up/undo commands.
- **M6 — Mobile.** `expo build` → iOS/Android, store submission.

---

## 11. Open questions

- Exact free-tier limits of Gemini Flash and whether they suffice at your scale.
- ~~Multi-currency~~ **Decided:** no multi-currency, no conversion. Display a
  plain `$` sign; users convert on their own if needed.
- ~~Do accounts need per-member "ownership"~~ **Decided:** yes. Accounts have an
  optional `paidByMemberId`; when set, settle-up is computed automatically.
```
