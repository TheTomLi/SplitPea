// Tier-3 of the parser: the LLM fallback.
//
// This is called ONLY for messages the relevance gate let through but the
// deterministic rules couldn't parse (ParseResult "unparsed"). It asks a cheap
// model to return the same structured shape the rules produce, so the rest of
// the pipeline (confirm card, commit) is unchanged.
//
// It fails safe: any missing key, network error, or unparseable response
// returns null, and the caller falls back to the canned reply. Everything the
// rules already handle never reaches here, so cost stays minimal.
//
// The engine lives behind `llmParse`, so swapping Gemini for Groq / a local
// model later is a change to this file only.

import type {
  GroupType,
  ParseResult,
  ParsedSplit,
  SplitMode,
} from "@splitpea/core";

interface LlmContextMember {
  id: string;
  name: string;
}
interface LlmContextAccount {
  id: string;
  name: string;
}
export interface LlmContext {
  members: LlmContextMember[];
  accounts: LlmContextAccount[];
  senderMemberId: string;
  mode: GroupType;
  cardAccountId: string | null;
}

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export function isLLMEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Shape we ask the model to return (names, not ids — mapped server-side). */
interface LlmOutput {
  kind: "expense" | "settlement" | "settleAll" | "balance" | "none";
  amount?: number;
  description?: string;
  payer?: string; // member name, the card name, or "me"
  splitMembers?: string[]; // member names, or ["everyone"] (even split)
  /** For uneven splits: each person's mode + value. */
  splits?: { name: string; mode: "even" | "exact" | "percent"; value: number }[];
  from?: string; // settlement payer name or "me"
  to?: string; // settlement recipient name or "card"
  /** Person names referenced in the message that are NOT in the member list. */
  unknownNames?: string[];
}

function buildPrompt(text: string, ctx: LlmContext): string {
  const names = ctx.members.map((m) => m.name).join(", ");
  const sender = ctx.members.find((m) => m.id === ctx.senderMemberId)?.name ?? "the sender";
  const cardName = ctx.accounts[0]?.name ?? "the card";

  const modeRules =
    ctx.mode === "joint"
      ? `This is a SHARED-CARD group. Every expense is charged to the card ("${cardName}") — set "payer" to "${cardName}". If no people are named, "splitMembers" is just ["${sender}"] (the sender). A settlement here is paying the card: set "to" to "card".`
      : `This is a SPLIT-BILLS group. "payer" is the person who paid (default "${sender}"). If no split is specified, "splitMembers" is ["everyone"].`;

  return [
    `You convert a chat message into a structured expense or settlement for a bill-splitting app.`,
    `Group members: ${names}.`,
    `The person writing the message is "${sender}"; interpret "I"/"me" as "${sender}".`,
    modeRules,
    ``,
    `Return ONLY JSON with this shape:`,
    `{"kind":"expense"|"settlement"|"settleAll"|"balance"|"none","amount":number,"description":string,"payer":string,"splitMembers":string[],"splits":[{"name":string,"mode":"even"|"exact"|"percent","value":number}],"from":string,"to":string,"unknownNames":string[]}`,
    `- Use "expense" for a spend, with amount, description, payer.`,
    `- For an EVEN split, list names in "splitMembers".`,
    `- For an UNEVEN split, use "splits": exact dollar amounts (mode "exact") or`,
    `  percentages (mode "percent").`,
    `  Example: "me 60% Bob 40%" → splits:[{"name":"me","mode":"percent","value":60},{"name":"Bob","mode":"percent","value":40}].`,
    `- If one person treats/covers another (that person doesn't pay), use "exact"`,
    `  amounts: give the covered person $0 (or omit them) and add their share to`,
    `  the payer. Example: 4 people, $100 split evenly, but the payer treats Emma`,
    `  → each even share is $25, so splits (exact): payer $50, the two others $25`,
    `  each, Emma $0. The exact amounts must sum to the total.`,
    `- Use "settlement" for a repayment ("I paid Bob 20"), with amount, from, to.`,
    `- Use "settleAll" if the message states everyone is settled up / all square /`,
    `  all paid up / even, or that nobody owes anybody anymore (this clears all`,
    `  balances to zero). Examples: "we're all even now", "everything's paid up",`,
    `  "nobody owes anybody".`,
    `- Use "balance" if the user asks to see balances / who owes what / the totals.`,
    `- Use "none" if the message is unclear, nonsensical, a greeting, a question,`,
    `  or not clearly a shared expense, payment, or one of the intents above. Do`,
    `  NOT guess an expense from confusing input — when in doubt, return "none".`,
    `- Use only the member names listed above (or "everyone"/"card").`,
    `- "unknownNames": list any specific PERSON names referenced in the message`,
    `  that are NOT in the member list above (e.g. someone being treated or paid`,
    `  who isn't a member). Do not include members, "everyone", "me", or "card".`,
    `  Use [] if all referenced people are members.`,
    ``,
    `Message: "${text.replace(/"/g, "'")}"`,
  ].join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt: string): Promise<LlmOutput | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  // Retry transient 429/503 (free tier gets occasional overload/rate blips).
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) break;
    if (res.status !== 429 && res.status !== 503) break;
    if (attempt < 2) await sleep(600 * (attempt + 1));
  }
  if (!res || !res.ok) {
    console.error(`[llm] Gemini ${res?.status}: ${(await res?.text().catch(() => "")) ?? ""}`.slice(0, 300));
    return null;
  }
  const data: any = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as LlmOutput;
  } catch {
    console.error("[llm] non-JSON response:", raw.slice(0, 200));
    return null;
  }
}

// --- name → id mapping -----------------------------------------------------

function resolveMemberName(name: string | undefined, ctx: LlmContext): string | null {
  if (!name) return null;
  const t = name.trim().toLowerCase();
  if (!t) return null;
  if (t === "me" || t === "i" || t === "myself") return ctx.senderMemberId;
  const m = ctx.members.find((x) => x.name.toLowerCase() === t);
  return m ? m.id : null;
}

function mapToParseResult(out: LlmOutput, ctx: LlmContext): ParseResult | null {
  const allIds = ctx.members.map((m) => m.id);

  if (out.kind === "settleAll") return { kind: "command", command: "settleAll" };
  if (out.kind === "balance") return { kind: "command", command: "balance" };

  if (out.kind === "expense") {
    let amount = Number(out.amount);

    let paidByMemberId: string | null = null;
    let paidByAccountId: string | null = null;
    if (ctx.mode === "joint") {
      paidByAccountId = ctx.cardAccountId;
    } else {
      const acct = ctx.accounts.find(
        (a) => a.name.toLowerCase() === (out.payer ?? "").trim().toLowerCase()
      );
      if (acct) paidByAccountId = acct.id;
      else paidByMemberId = resolveMemberName(out.payer, ctx) ?? ctx.senderMemberId;
    }

    // Uneven split, if the model provided per-person modes/values.
    let splits: ParsedSplit[] | null = null;
    if (Array.isArray(out.splits) && out.splits.length > 0) {
      const ps: ParsedSplit[] = [];
      for (const s of out.splits) {
        const id = resolveMemberName(s.name, ctx);
        const value = Number(s.value);
        const mode = s.mode;
        if (
          id &&
          (mode === "even" || mode === "exact" || mode === "percent") &&
          Number.isFinite(value) &&
          value > 0
        ) {
          ps.push({ memberId: id, mode, value });
        }
      }
      if (ps.length > 0) {
        splits = ps;
        if (ps.every((p) => p.mode === "exact")) {
          amount = ps.reduce((a, p) => a + p.value, 0);
        }
      }
    }

    // Otherwise, an even split across the named members (or everyone).
    if (!splits) {
      let memberIds: string[] = [];
      const list = out.splitMembers ?? [];
      if (list.some((s) => /^(everyone|all)$/i.test(s.trim()))) {
        memberIds = allIds;
      } else {
        const set = new Set<string>();
        for (const n of list) {
          const id = resolveMemberName(n, ctx);
          if (id) set.add(id);
        }
        memberIds = [...set];
      }
      if (memberIds.length === 0) {
        memberIds = ctx.mode === "joint" ? [ctx.senderMemberId] : allIds;
      }
      splits = memberIds.map((memberId) => ({
        memberId,
        mode: "even" as SplitMode,
        value: 1,
      }));
    }

    if (!Number.isFinite(amount) || amount <= 0) return null;

    return {
      kind: "expense",
      expense: {
        amount,
        description: (out.description ?? "expense").trim() || "expense",
        category: null,
        paidByMemberId,
        paidByAccountId,
        splits,
      },
    };
  }

  if (out.kind === "settlement") {
    const amount = Number(out.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const from = resolveMemberName(out.from, ctx) ?? ctx.senderMemberId;
    let to: string | null;
    if ((out.to ?? "").trim().toLowerCase() === "card") to = null;
    else to = resolveMemberName(out.to, ctx);

    // A member-to-member settlement needs a real, distinct recipient.
    if (ctx.mode !== "joint" && !to) return null;
    if (to != null && to === from) return null;

    return { kind: "settlement", settlement: { fromMemberId: from, toMemberId: to, amount } };
  }

  return null;
}

export interface LlmParse {
  result: ParseResult;
  /** Referenced people who aren't members (validated against the message). */
  unknownNames: string[];
}

/** Reserved tokens the model may return in unknownNames that we should ignore. */
const RESERVED_NAMES = new Set([
  "everyone",
  "everybody",
  "all",
  "me",
  "i",
  "myself",
  "us",
  "them",
  "card",
]);

/** Keep only names that (a) aren't members, (b) aren't reserved words, and
 *  (c) actually appear in the original message (guards against hallucinations). */
function validateUnknownNames(
  names: string[] | undefined,
  text: string,
  ctx: LlmContext
): string[] {
  if (!Array.isArray(names)) return [];
  const memberNames = new Set(ctx.members.map((m) => m.name.toLowerCase()));
  const lowerText = text.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    if (RESERVED_NAMES.has(key) || memberNames.has(key)) continue;
    // Must be a whole-word mention in the original message.
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(lowerText)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Parse a message with the LLM. Returns null on any failure (fail safe). */
export async function llmParse(text: string, ctx: LlmContext): Promise<LlmParse | null> {
  try {
    const out = await callGemini(buildPrompt(text, ctx));
    if (!out || out.kind === "none") return null;
    const result = mapToParseResult(out, ctx);
    if (!result) return null;
    return { result, unknownNames: validateUnknownNames(out.unknownNames, text, ctx) };
  } catch (e) {
    console.error("[llm] error:", e instanceof Error ? e.message : e);
    return null;
  }
}
