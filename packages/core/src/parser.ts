// The parser — Tiers 1 & 2 of the message pipeline (no LLM).
//
// Tier 1 (relevance gate): decide whether a message is even worth parsing.
//   Irrelevant chatter returns { kind: "irrelevant" } and never costs anything.
// Tier 2 (deterministic rules): extract an expense or recognise a command from
//   the common phrasings, for free.
//
// A message that looks like an expense but can't be parsed returns
// { kind: "unparsed" } — that is the hook where the Tier-3 LLM fallback plugs in
// later (M3). Pure TypeScript, so it runs identically on server, web, and mobile.

import type { GroupType, SplitMode } from "./types";

export interface ParseContextMember {
  id: string;
  name: string;
}
export interface ParseContextAccount {
  id: string;
  name: string;
}
export interface ParseContext {
  members: ParseContextMember[];
  accounts: ParseContextAccount[];
  senderMemberId: string;
  /** Group mode. "split" (default) or "joint" (single shared card). */
  mode?: GroupType;
  /** In joint mode, the id of the group's card that every spend is charged to. */
  cardAccountId?: string | null;
}

export interface ParsedSplit {
  memberId: string;
  mode: SplitMode;
  value: number;
}
export interface ParsedExpense {
  amount: number;
  description: string;
  category?: string | null;
  paidByMemberId?: string | null;
  paidByAccountId?: string | null;
  splits: ParsedSplit[];
}

export type ParseCommand = "balance" | "help" | "settleAll";

/** A settlement/repayment. toMemberId null = paid to the card (joint mode). */
export interface ParsedSettlement {
  fromMemberId: string;
  toMemberId: string | null;
  amount: number;
}

export type ParseResult =
  | { kind: "expense"; expense: ParsedExpense }
  | { kind: "settlement"; settlement: ParsedSettlement }
  | { kind: "command"; command: ParseCommand }
  | { kind: "unparsed" }
  | { kind: "irrelevant" };

const MAX_LEN = 200;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve a spoken name token to a member id ("me"/"i"/"myself" = sender). */
function resolveMember(
  token: string,
  ctx: ParseContext
): string | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === "me" || t === "i" || t === "myself") return ctx.senderMemberId;
  const m = ctx.members.find((x) => x.name.toLowerCase() === t);
  return m ? m.id : null;
}

/** Collect all member ids named in a phrase (split on spaces, commas, "and"). */
function collectNames(phrase: string, ctx: ParseContext): string[] {
  const ids = new Set<string>();
  for (const tok of phrase.split(/[\s,]+|\band\b/i)) {
    const id = resolveMember(tok, ctx);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** An explicitly-stated grand total ("I paid 150", "total is 50", "cost 40").
 *  Distinct from the per-person split values, so we can reconcile the two. */
function detectExplicitTotal(raw: string): number | null {
  const m = raw.match(
    /(?:paid|spent|spend|costs?|total|bill|altogether|comes?\s*to|sum)\D{0,8}\$?(\d+(?:[.,]\d{1,2})?)/i
  );
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** Find the expense total: an explicit "total/bill … N", else the first number
 *  that isn't a percentage or a share count. */
function detectTotal(raw: string): number | null {
  const explicit = raw.match(
    /(?:total|bill|altogether|comes?\s*to|sum)\D{0,8}\$?(\d+(?:[.,]\d{1,2})?)/i
  );
  if (explicit) return parseFloat(explicit[1].replace(",", "."));

  const re =
    /\$?(\d+(?:[.,]\d{1,2})?)(\s*%|\s*(?:slices?|shares?|parts?|portions?|pieces?))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (!m[2]) return parseFloat(m[1].replace(",", "."));
  }
  return null;
}

interface CustomSplit {
  splits: ParsedSplit[];
  /** For "by amount" splits, the expense total = sum of the parts. */
  amountOverride?: number;
}

/**
 * Detect a non-even split: by percentage ("me 60% emma 40%"), by shares
 * ("I had 6 slices, emma 4"), or by exact amount ("20 to tom, 30 to emma").
 * Returns null for a normal/even split.
 */
function detectCustomSplits(
  raw: string,
  lower: string,
  ctx: ParseContext
): CustomSplit | null {
  // Percentage — triggered by a "%" sign OR an explicit "percent" intent, so
  // "split by percent, Emma is 20, Tom is 30" is read as percentages (which then
  // get sum-checked against 100), not as dollar amounts.
  const percentIntent =
    lower.includes("%") || /\b(percent|percentage|percentages|pct)\b/.test(lower);
  if (percentIntent) {
    const seen = new Set<string>();
    const splits: ParsedSplit[] = [];
    const push = (name: string, val: string) => {
      const id = resolveMember(name, ctx);
      if (id && !seen.has(id)) {
        seen.add(id);
        splits.push({ memberId: id, mode: "percent", value: parseFloat(val) });
      }
    };
    let m: RegExpExecArray | null;
    const nameFirst =
      /([A-Za-z]+)\s*(?:takes?|pays?|gets?|has|have|=|:)?\s*(\d+(?:\.\d+)?)\s*%/gi;
    while ((m = nameFirst.exec(raw))) push(m[1], m[2]);
    const pctFirst = /(\d+(?:\.\d+)?)\s*%\s*(?:to|for|goes to)?\s+([A-Za-z]+)/gi;
    while ((m = pctFirst.exec(raw))) push(m[2], m[1]);
    // No "%" signs but the user said "percent": read "<name> is 20" as a percent.
    if (splits.length === 0) {
      const nameNum =
        /([A-Za-z]+)\s*(?:takes?|gets?|has|have|is|are|=|:)\s*(\d+(?:\.\d+)?)/gi;
      while ((m = nameNum.exec(raw))) push(m[1], m[2]);
    }
    if (splits.length >= 1) return { splits };
  }

  // Exact amounts to people ("20 to tom", "tom pays 20"). Need ≥2 to be sure.
  {
    const seen = new Set<string>();
    const splits: ParsedSplit[] = [];
    const push = (name: string, val: string) => {
      const id = resolveMember(name, ctx);
      if (id && !seen.has(id)) {
        seen.add(id);
        splits.push({ memberId: id, mode: "exact", value: parseFloat(val) });
      }
    };
    let m: RegExpExecArray | null;
    const amtTo = /(\d+(?:\.\d+)?)\s*(?:to|for)\s+([A-Za-z]+)/gi;
    while ((m = amtTo.exec(raw))) push(m[2], m[1]);
    const nameAmt =
      /([A-Za-z]+)\s*(?:pays?|owes?|takes?|gets?|is|are|was|were|:|=)\s*\$?(\d+(?:\.\d+)?)/gi;
    while ((m = nameAmt.exec(raw))) push(m[1], m[2]);
    if (splits.length >= 2) {
      const sum = splits.reduce((a, s) => a + s.value, 0);
      return { splits, amountOverride: sum };
    }
  }

  return null;
}

/** Best-effort description for a custom-split message (strips names/numbers/filler). */
function describeCustom(raw: string, ctx: ParseContext): string {
  let d = raw;
  for (const m of ctx.members) {
    d = d.replace(new RegExp(`\\b${escapeRegExp(m.name)}\\b`, "gi"), " ");
  }
  d = d
    .replace(/\d+(?:[.,]\d{1,2})?\s*%/g, " ")
    .replace(/\$?\s*\d+(?:[.,]\d{1,2})?/g, " ")
    .replace(/\b(slices?|shares?|parts?|portions?|pieces?)\b/gi, " ")
    .replace(
      /\b(me|i|myself|we|us|our|and|a|an|the|is|are|was|were|had|have|has|got|gets?|for|on|at|to|with|by|of|each|takes?|pays?|paid|owes?|buy|bought|spend|spent|costs?|split|percent|percentage|percentages|pct|person|persons|people|everyone|everybody|all|evenly|even|total|bill|altogether|dollars?|bucks?|goes|ate|took)\b/gi,
      " "
    )
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return d || "expense";
}

/**
 * Try to read the message as a settlement/repayment ("I paid Bob 20", "Bob paid
 * me 20", "I paid the card 50", "I settled 50"). Returns null if it isn't one.
 */
function parseSettlement(
  raw: string,
  lower: string,
  amount: number,
  ctx: ParseContext
): ParsedSettlement | null {
  const isJoint = (ctx.mode ?? "split") === "joint";

  // Payer (from): a leading "<Name> paid/…", else the sender.
  let from = ctx.senderMemberId;
  const lead = raw.match(/^\s*([A-Za-z]+)\s+(paid|repaid|gave|settled)\b/i);
  if (lead) {
    const who = resolveMember(lead[1], ctx);
    if (who) from = who;
  }

  // Recipient (to): a member, or the card (null).
  let to: string | null | undefined = undefined;

  if (isJoint && /\bcard\b/i.test(lower)) to = null;

  if (to === undefined) {
    const toName = raw.match(/\bto\s+([A-Za-z]+)\b/i);
    if (toName) {
      const id = resolveMember(toName[1], ctx);
      if (id) to = id;
    }
  }
  if (to === undefined) {
    const obj = raw.match(
      /\b(?:paid back|paid|repaid|gave|reimbursed?)\s+([A-Za-z]+)\b/i
    );
    if (obj && obj[1].toLowerCase() !== "back" && obj[1].toLowerCase() !== "for") {
      const id = resolveMember(obj[1], ctx);
      if (id) to = id;
    }
  }
  // In a shared-card group, a bare "settle/settled" means paying the card.
  if (to === undefined && isJoint && /\b(settle|settled)\b/i.test(lower)) to = null;

  if (to === undefined) return null; // no recipient → not a settlement
  if (to !== null && to === from) return null; // can't pay yourself

  return { fromMemberId: from, toMemberId: to, amount };
}

export function parseMessage(text: string, ctx: ParseContext): ParseResult {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // --- Tier 1: relevance gate ---------------------------------------------
  if (!raw || raw.length > MAX_LEN) return { kind: "irrelevant" };

  if (/^(help|what can you do|how do (i|you)|commands)\b/.test(lower)) {
    return { kind: "command", command: "help" };
  }

  // "settle everyone up" / "settled for everyone" / "all square" / "reset
  // balances" → zero everyone out (distinct from "settle up" = view balances).
  const looksAllSettled =
    /\ball\s+settled\b/.test(lower) ||
    /\bsettled?\b[^.!?]*\b(all|everyone|everybody)\b/.test(lower) ||
    /\b(everyone|everybody|all)\b[^.!?]*\bsettled?\b/.test(lower) ||
    /\ball\s+square\b/.test(lower) ||
    /\b(reset|clear)\b[^.!?]*\bbalanc/.test(lower);

  // Softer natural phrasings for "everyone's settled" ("we're all even",
  // "everything's paid up", "nobody owes anybody"). Only when there's no amount,
  // so they don't clash with an expense like "we split 40 even".
  const noAmount = !/\d/.test(lower);
  const looksAllEven =
    noAmount &&
    (/\bno(?:body|\s*one)\s+owes\b/.test(lower) ||
      /\b(everything|everyone|everybody|all|we|we're|we are|were)\b[^.!?]*\bpaid\s+up\b/.test(lower) ||
      /\b(all|everyone|everybody|we|we're|we are)\b[^.!?]*\beven\b/.test(lower));

  if (looksAllSettled || looksAllEven) {
    return { kind: "command", command: "settleAll" };
  }

  const amountMatch = raw.match(/\$?\s*(\d+(?:[.,]\d{1,2})?)/);

  // Balance view: "balance", "who owes", or a bare "settle up" (no amount).
  if (
    /\b(balance|balances|who owes)\b/.test(lower) ||
    (/\bsettle\b/.test(lower) && !amountMatch)
  ) {
    return { kind: "command", command: "balance" };
  }

  const hasVerb =
    /\b(paid|pay|spent|spend|bought|buy|owe|split|cost|for|settle|gave|bucks?|dollars?|treat|reimburse|repaid)\b/.test(
      lower
    );

  if (!amountMatch && !hasVerb) return { kind: "irrelevant" };

  // --- Tier 2: deterministic parse ----------------------------------------
  if (!amountMatch) return { kind: "unparsed" }; // looks relevant, no amount

  const amount = parseFloat(amountMatch[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return { kind: "unparsed" };

  // A non-even split ("20 to tom, 30 to emma", "me 60% emma 40%", "6 slices…").
  const custom = detectCustomSplits(raw, lower, ctx);

  // Settlement ("I paid Bob 20") — but not when it's really a multi-person split.
  if (!custom) {
    const settlement = parseSettlement(raw, lower, amount, ctx);
    if (settlement) return { kind: "settlement", settlement };
  }

  // Require a genuine expense signal. A bare number inside a confusing sentence
  // ("asdf 5 qwerty") should NOT become an expense — hand it to Tier 3, which
  // decides between an expense and "not sure what you mean".
  const hasExpenseSignal =
    custom != null ||
    /\b(paid|pay|spent|spend|bought|buy|cost|owe|owes|split)\b/i.test(lower) ||
    /\bfor\s+[a-z]/i.test(lower);
  if (!hasExpenseSignal) return { kind: "unparsed" };

  // Complex / conditional wording (someone treating or covering another, "except",
  // "instead", "doesn't need to pay", etc.) is beyond the rules — hand it to the
  // LLM (Tier 3), which can reason about who ends up owing what.
  const isComplex =
    !custom &&
    (/\b(treat|treating|cover|covers|covering|instead|except|because|freebie)\b/i.test(lower) ||
      /\bdo(?:es)?n['’]?t\s+(?:need|have)\b/i.test(lower) ||
      /\bno\s+need\b/i.test(lower) ||
      /\bmy\s+treat\b/i.test(lower) ||
      /\bon\s+me\b/i.test(lower) ||
      /\bbuying\b[^.]*\bfor\b/i.test(lower));
  if (isComplex) return { kind: "unparsed" };

  const mode: GroupType = ctx.mode ?? "split";
  const allIds = ctx.members.map((m) => m.id);

  let paidByMemberId: string | null = ctx.senderMemberId;
  let paidByAccountId: string | null = null;

  // Working copy we progressively strip clauses from to find the description.
  let work = raw;

  // Split clause: everything after "split ..." (may name beneficiaries).
  const splitMatch = work.match(/\bsplit\b(.*)$/i);
  const splitClause = splitMatch ? splitMatch[1] : "";
  if (splitMatch) work = work.replace(splitMatch[0], " ");

  // Subject before a spend verb, e.g. "me and Alice spent ..." / "Bob paid ...".
  const subjMatch = work.match(
    /^\s*(.+?)\s+(paid|pay|spent|spend|bought|buy|covered|owe)\b/i
  );
  const subject = subjMatch ? subjMatch[1] : "";

  let memberIds: string[] = [];

  if (mode === "joint") {
    // Every spend is charged to the group's card. No member payer.
    paidByAccountId = ctx.cardAccountId ?? null;
    paidByMemberId = null;

    // Beneficiaries come from the subject ("me and Alice") and/or split clause.
    if (/\b(everyone|all)\b/i.test(`${subject} ${splitClause}`)) {
      memberIds = allIds;
    } else {
      const set = new Set<string>([
        ...collectNames(subject, ctx),
        ...collectNames(splitClause, ctx),
      ]);
      if (/\bwith\b/i.test(splitClause)) set.add(ctx.senderMemberId);
      memberIds = [...set];
      if (memberIds.length === 0) memberIds = [ctx.senderMemberId]; // "I spent 90"
    }
    if (subjMatch) work = work.replace(subject, " "); // keep names out of description
  } else {
    // Split mode: figure out the (member or account) payer.
    for (const acct of ctx.accounts) {
      const re = new RegExp(
        `\\b(?:on|with|via|by|using)\\s+${escapeRegExp(acct.name)}\\b`,
        "i"
      );
      if (re.test(work)) {
        paidByAccountId = acct.id;
        paidByMemberId = null;
        work = work.replace(re, " ");
        break;
      }
    }
    if (paidByAccountId == null && subjMatch) {
      const who = resolveMember(subject.split(/\s+/)[0], ctx);
      if (who) {
        paidByMemberId = who;
        work = work.replace(subject, " ");
      }
    }

    // Beneficiaries: named in the split clause (+ sender), else everyone.
    if (splitMatch) {
      if (/\b(everyone|all)\b/i.test(splitClause)) {
        memberIds = allIds;
      } else {
        const set = new Set<string>(collectNames(splitClause, ctx));
        if (/\bwith\b/i.test(splitClause) || set.size > 0) set.add(ctx.senderMemberId);
        memberIds = [...set];
      }
    }
    if (memberIds.length === 0) memberIds = allIds;
  }

  // --- Confidence gate ----------------------------------------------------
  // The rules are greedy: they'll happily emit an expense even when they've
  // clearly mis-read a natural sentence. When the phrasing points to a
  // group/multi-person split but we only captured the sender (or missed an
  // explicit "everyone"), the beneficiaries were almost certainly detected
  // wrong — hand the message to Tier 3 (LLM) instead of proposing garbage.
  // Explicit custom splits (%, shares, exact amounts) are trusted as-is.
  if (!custom) {
    const beneficiaries = new Set(memberIds);
    const everyoneMeant = /\b(everyone|everybody)\b/i.test(lower);
    const everyoneCaptured =
      allIds.length > 0 && allIds.every((id) => beneficiaries.has(id));
    const saidSplit = /\bsplit\b/i.test(lower);
    const onlySender =
      memberIds.length === 1 && memberIds[0] === ctx.senderMemberId;

    // "…for everyone…" that didn't actually split across the whole group, or a
    // "split…" that collapsed to just the sender in a multi-member group.
    if (
      (everyoneMeant && !everyoneCaptured) ||
      (saidSplit && onlySender && allIds.length > 1)
    ) {
      return { kind: "unparsed" };
    }
  }

  // (custom split was detected above, before the settlement check)
  let description: string;
  let expenseAmount = amount;
  let splits: ParsedSplit[];

  if (custom) {
    splits = custom.splits;
    if (custom.amountOverride != null) {
      // "by amount": use an explicitly stated grand total if the message has one
      // (so a mismatch stays visible), otherwise the sum of the parts.
      expenseAmount = detectExplicitTotal(raw) ?? custom.amountOverride;
    } else {
      // "%"/shares apply to the stated total (prefer an explicit "paid/total N"
      // so a bare percentage value isn't mistaken for the grand total).
      expenseAmount = detectExplicitTotal(raw) ?? detectTotal(raw) ?? amount;
    }
    description = describeCustom(raw, ctx);
  } else {
    // Description: prefer text after "for" / "on" / "at", else leftovers.
    let d = "";
    const descPrep = work.match(/\b(?:for|on|at)\s+(.+)$/i);
    if (descPrep) d = descPrep[1];
    else d = work.replace(/\b(paid|pay|spent|spend|bought|buy|owe|cost)\b/gi, " ");
    d = d
      .replace(/\$?\s*\d+(?:[.,]\d{1,2})?/g, " ")
      .replace(
        /\b(dollars?|bucks?|evenly|even|everyone|everybody|all|us|them|together|total|each)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,;:]+|[.,;:]+$/g, "")
      .replace(/^(?:for|to|with|and|the|a|of)\s+|\s+(?:for|to|with|and|the|a|of)$/gi, "")
      .trim();
    description = d || "expense";
    splits = memberIds.map((memberId) => ({
      memberId,
      mode: "even" as SplitMode,
      value: 1,
    }));
  }

  return {
    kind: "expense",
    expense: {
      amount: expenseAmount,
      description,
      category: null,
      paidByMemberId,
      paidByAccountId,
      splits,
    },
  };
}
