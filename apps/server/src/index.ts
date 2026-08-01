import express from "express";
import { prisma } from "./db";
import { generateInviteCode } from "./invite";
import {
  computeBalances,
  computeSplitCents,
  formatStructuredMemberName,
  parseMessage,
  type SplitMode,
} from "@splitpea/core";
import { isLLMEnabled, llmParse } from "./llm";
import {
  configureHttpSecurity,
  createGroupLimiter,
  messageLimiter,
} from "./http-security";

const money = (n: number) => `$${n.toFixed(2)}`;

// Warn when a custom split's numbers don't reconcile: by-amount parts should sum
// to the total, and percentages should sum to 100%.
function splitSumNotice(
  amount: number,
  splits: { mode: string; value: number }[]
): string | null {
  if (splits.length === 0) return null;
  const mode = splits[0].mode;
  const sum = splits.reduce((a, s) => a + s.value, 0);
  if (mode === "percent" && Math.abs(sum - 100) > 0.5) {
    return `Heads up: the percentages add up to ${Number(sum.toFixed(2))}%, not 100% — tap Edit to fix the split.`;
  }
  if (mode === "exact" && Math.abs(sum - amount) > 0.01) {
    return `Heads up: the amounts add up to ${money(sum)}, but the total is ${money(amount)} — tap Edit to fix the split.`;
  }
  return null;
}

// Compute balances for a group, enriched with member names for display.
async function computeGroupBalances(groupId: string) {
  const [members, accounts, expenses, payments] = await Promise.all([
    // Active members only — removed people keep their past splits (which still
    // count toward everyone else's shares) but drop out of the balance list.
    prisma.member.findMany({ where: { groupId, removedAt: null } }),
    prisma.account.findMany({ where: { groupId } }),
    prisma.expense.findMany({ where: { groupId }, include: { splits: true } }),
    prisma.payment.findMany({ where: { groupId } }),
  ]);

  const result = computeBalances({
    members: members.map((m) => ({ id: m.id })),
    accounts: accounts.map((a) => ({ id: a.id, paidByMemberId: a.paidByMemberId })),
    expenses: expenses.map((e) => ({
      id: e.id,
      amount: e.amount,
      paidByMemberId: e.paidByMemberId,
      paidByAccountId: e.paidByAccountId,
      splits: e.splits.map((s) => ({
        memberId: s.memberId,
        mode: s.mode as SplitMode,
        value: s.value,
      })),
    })),
    payments: payments.map((p) => ({
      fromMemberId: p.fromMemberId,
      toMemberId: p.toMemberId,
      amount: p.amount,
    })),
  });

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  return {
    balances: result.balances.map((b) => ({ ...b, name: nameOf(b.memberId) })),
    settlements: result.settlements.map((s) => ({
      ...s,
      fromName: nameOf(s.from),
      toName: nameOf(s.to),
    })),
  };
}

const app = express();
const mutationLimiter = configureHttpSecurity(app);
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT ?? 4000);
const api = express.Router();
api.use(mutationLimiter);

// --- helpers ---------------------------------------------------------------

/** Look up a group by its invite code, throwing a 404-style null if missing. */
async function findGroup(inviteCode: string) {
  return prisma.group.findUnique({ where: { inviteCode } });
}

// --- routes ----------------------------------------------------------------

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Create a group and its first member (the creator). Joint groups also get a
// single card account that every spend is charged to.
api.post("/groups", createGroupLimiter, async (req, res) => {
  const { name, creatorName, type, cardName, participants } = req.body ?? {};
  if (!name || !creatorName) {
    return res.status(400).json({ error: "name and creatorName are required" });
  }
  const groupType = type === "joint" ? "joint" : "split";

  // Extra participant names (besides the creator), de-duplicated.
  const creator = String(creatorName).trim();
  const extras = Array.isArray(participants)
    ? [...new Set(
        (participants as unknown[])
          .map((p) => String(p).trim())
          .filter((p) => p && p.toLowerCase() !== creator.toLowerCase())
      )]
    : [];

  const group = await prisma.group.create({
    data: {
      name: String(name).trim(),
      type: groupType,
      inviteCode: generateInviteCode(),
      members: { create: [{ name: creator }, ...extras.map((n) => ({ name: n }))] },
    },
    include: { members: true },
  });

  if (groupType === "joint") {
    await prisma.account.create({
      data: {
        groupId: group.id,
        name: (cardName ? String(cardName).trim() : "") || "Shared card",
      },
    });
  }

  const creatorMember = group.members.find((m) => m.name === creator) ?? group.members[0];
  res.json({ group, member: creatorMember });
});

// Get a group (and its members) by invite code.
api.get("/groups/:inviteCode", async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { inviteCode: req.params.inviteCode },
    include: { members: { where: { removedAt: null } } },
  });
  if (!group) return res.status(404).json({ error: "group not found" });
  res.json({ group, members: group.members });
});

// Delete a group and all its data (members, accounts, expenses, messages).
api.delete("/groups/:inviteCode", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  // Delete children first so this works consistently on SQLite and Postgres.
  await prisma.$transaction([
    prisma.split.deleteMany({ where: { expense: { groupId: group.id } } }),
    prisma.expense.deleteMany({ where: { groupId: group.id } }),
    prisma.payment.deleteMany({ where: { groupId: group.id } }),
    prisma.message.deleteMany({ where: { groupId: group.id } }),
    prisma.account.deleteMany({ where: { groupId: group.id } }),
    prisma.member.deleteMany({ where: { groupId: group.id } }),
    prisma.group.delete({ where: { id: group.id } }),
  ]);
  res.json({ ok: true });
});

// Join a group by name. Reuses an existing member with the same name.
api.post("/groups/:inviteCode/join", async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const trimmed = String(name).trim();
  let member = await prisma.member.findFirst({
    where: { groupId: group.id, name: trimmed },
  });
  if (!member) {
    member = await prisma.member.create({
      data: { groupId: group.id, name: trimmed },
    });
  }

  res.json({ member });
});

// Add a participant to a group (name must be unique within the group).
api.post("/groups/:inviteCode/members", async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const trimmed = String(name).trim();
  const existingActive = await prisma.member.findFirst({
    where: { groupId: group.id, name: trimmed, removedAt: null },
  });
  if (existingActive) {
    return res.status(409).json({ error: "a member with that name already exists" });
  }

  // If someone with this name left earlier, bring them back (with their history)
  // instead of blocking — they were settled up when they left.
  const removed = await prisma.member.findFirst({
    where: { groupId: group.id, name: trimmed, removedAt: { not: null } },
  });
  if (removed) {
    const member = await prisma.member.update({
      where: { id: removed.id },
      data: { removedAt: null },
    });
    return res.json({ member });
  }

  const member = await prisma.member.create({ data: { groupId: group.id, name: trimmed } });
  res.json({ member });
});

// Rename a participant.
api.patch("/groups/:inviteCode/members/:memberId", async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const member = await prisma.member.update({
    where: { id: req.params.memberId },
    data: { name: String(name).trim() },
  });
  res.json({ member });
});

// Remove a participant. If they've never been in an expense, delete them
// outright. If they have history, they can only be removed once their balance
// is $0 (e.g. after "settle everyone up") — and then we soft-remove them so past
// expenses stay intact and everyone else's balances are unchanged.
api.delete("/groups/:inviteCode/members/:memberId", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });
  const memberId = req.params.memberId;

  const [splits, paidExpenses, ownedAccounts, payments] = await Promise.all([
    prisma.split.count({ where: { memberId } }),
    prisma.expense.count({ where: { paidByMemberId: memberId } }),
    prisma.account.count({ where: { paidByMemberId: memberId } }),
    prisma.payment.count({
      where: { OR: [{ fromMemberId: memberId }, { toMemberId: memberId }] },
    }),
  ]);
  const hasHistory = splits + paidExpenses + ownedAccounts + payments > 0;

  if (hasHistory) {
    const { balances } = await computeGroupBalances(group.id);
    const net = balances.find((b) => b.memberId === memberId)?.net ?? 0;
    if (Math.abs(net) > 0.005) {
      return res.status(409).json({
        error:
          "This person still has a balance to settle. Settle up first (try \"settle everyone up\"), then remove them.",
      });
    }
    // Settled but has history — hide them from the roster, keep the records.
    await prisma.member.update({
      where: { id: memberId },
      data: { removedAt: new Date() },
    });
    return res.json({ ok: true });
  }

  await prisma.member.delete({ where: { id: memberId } });
  res.json({ ok: true });
});

// List messages in a group (oldest first).
api.get("/groups/:inviteCode/messages", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const messages = await prisma.message.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: "asc" },
  });
  res.json({ messages });
});

function expenseExample(
  isJoint: boolean,
  members: { id: string; name: string }[],
  senderMemberId: string
): string {
  const sender =
    members.find((m) => m.id === senderMemberId) ??
    members[0] ??
    { id: senderMemberId, name: "me" };
  const other = members.find((m) => m.id !== sender.id);
  const senderLabel = formatStructuredMemberName(sender.name);
  const otherLabel = other
    ? formatStructuredMemberName(other.name)
    : undefined;
  const forLabel = otherLabel
    ? `${senderLabel} and ${otherLabel}`
    : senderLabel;
  const payerLabel = otherLabel ?? senderLabel;
  return isJoint
    ? `$40 on dinner, for ${forLabel}, split evenly`
    : `$40 on dinner, paid by ${payerLabel}, for ${forLabel}, split evenly`;
}

function helpText(
  isJoint: boolean,
  members: { id: string; name: string }[],
  senderMemberId: string,
  cardName?: string
): string {
  const formula = isJoint
    ? "[amount] on [what], for [people], split evenly"
    : "[amount] on [what], paid by [payer], for [people], split evenly";
  const payerNote = isJoint
    ? `\n${cardName ?? "The shared card"} is always the payer.\n`
    : "";
  return (
    `I turn messages into expenses.${payerNote}\nA reliable formula is:\n${formula}\n\n` +
    `• \"${expenseExample(isJoint, members, senderMemberId)}\"\n` +
    '• "balance" to see who owes what\n' +
    '• "settle up" to see how to settle'
  );
}

// Post a user message. The host runs the parser (relevance gate + rules) and
// replies. Expenses come back as a proposal to confirm — they are NOT committed
// here; the client confirms via POST /expenses.
api.post("/groups/:inviteCode/messages", messageLimiter, async (req, res) => {
  const { memberId, text } = req.body ?? {};
  if (!memberId || !text) {
    return res.status(400).json({ error: "memberId and text are required" });
  }

  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const userMessage = await prisma.message.create({
    data: { groupId: group.id, memberId: String(memberId), role: "user", text: String(text) },
  });

  const [members, accounts] = await Promise.all([
    prisma.member.findMany({ where: { groupId: group.id, removedAt: null } }),
    prisma.account.findMany({ where: { groupId: group.id } }),
  ]);

  const isJoint = group.type === "joint";
  const cardAccountId = isJoint ? accounts[0]?.id ?? null : null;

  let result = parseMessage(String(text), {
    members: members.map((m) => ({ id: m.id, name: m.name })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    senderMemberId: String(memberId),
    mode: isJoint ? "joint" : "split",
    cardAccountId,
  });

  // Tier 3: if the rules couldn't parse an expense-looking message, ask the LLM.
  let unknownNames: string[] = [];
  if (result.kind === "unparsed" && isLLMEnabled()) {
    const llm = await llmParse(String(text), {
      members: members.map((m) => ({ id: m.id, name: m.name })),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      senderMemberId: String(memberId),
      mode: isJoint ? "joint" : "split",
      cardAccountId,
    });
    if (llm) {
      result = llm.result;
      unknownNames = llm.unknownNames;
    }
  }

  // A friendly heads-up when the message named people who aren't in the group.
  let unknownNotice: string | null = null;
  if (unknownNames.length > 0) {
    const who = unknownNames.join(", ");
    const verb = unknownNames.length === 1 ? "isn't" : "aren't";
    unknownNotice = `Heads up: ${who} ${verb} in this group, so I left them out. Add them from the People panel if you want them included.`;
  }

  const hostReply = (t: string, cardType?: string, cardPayload?: string) =>
    prisma.message.create({
      data: { groupId: group.id, role: "host", text: t, cardType, cardPayload },
    });

  // Expense → return an ephemeral proposal (not stored, not committed).
  if (result.kind === "expense") {
    const e = result.expense;
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
    const payerLabel = e.paidByMemberId
      ? nameOf(e.paidByMemberId)
      : accounts.find((a) => a.id === e.paidByAccountId)?.name ?? "?";
    const shareCents = computeSplitCents(Math.round(e.amount * 100), e.splits);
    const splitBreakdown = [...shareCents.entries()].map(([mid, cents]) => ({
      name: nameOf(mid),
      amount: cents / 100,
    }));
    const splitMemberNames = e.splits.map((s) => nameOf(s.memberId));
    const beneficiaryIds = new Set(e.splits.map((s) => s.memberId));
    const forLabel =
      members.length > 0 && members.every((m) => beneficiaryIds.has(m.id))
        ? "everyone"
        : splitMemberNames.join(", ");
    const correctionNotice = e.corrections?.length
      ? `${e.corrections
          .map(
            (correction) =>
              `I matched “${correction.input}” to ${correction.matched}${
                correction.role === "payer" ? " as the payer" : ""
              }.`
          )
          .join(" ")} Please check the expense before confirming.`
      : null;
    const notice =
      [correctionNotice, unknownNotice, splitSumNotice(e.amount, e.splits)]
        .filter(Boolean)
        .join(" ") || undefined;
    return res.json({
      userMessage,
      proposal: {
        amount: e.amount,
        description: e.description,
        category: e.category ?? null,
        paidByMemberId: e.paidByMemberId ?? null,
        paidByAccountId: e.paidByAccountId ?? null,
        payerLabel,
        forLabel,
        splits: e.splits,
        splitMemberNames,
        splitBreakdown,
        notice,
      },
    });
  }

  // Settlement → return an ephemeral proposal (not committed until confirmed).
  if (result.kind === "settlement") {
    const s = result.settlement;
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
    const toLabel = s.toMemberId ? nameOf(s.toMemberId) : accounts[0]?.name ?? "the card";
    return res.json({
      userMessage,
      settlementProposal: {
        fromMemberId: s.fromMemberId,
        fromName: nameOf(s.fromMemberId),
        toMemberId: s.toMemberId,
        toLabel,
        amount: s.amount,
        notice: unknownNotice ?? undefined,
      },
    });
  }

  // Settle-all command → confirm before zeroing everyone.
  if (result.kind === "command" && result.command === "settleAll") {
    const { balances, settlements } = await computeGroupBalances(group.id);
    const outstanding = isJoint
      ? balances.filter((b) => -b.net > 0.005).length
      : settlements.length;
    if (outstanding === 0) {
      return res.json({
        userMessage,
        hostMessage: await hostReply("Everyone's already settled up — all balances are $0. 🎉"),
      });
    }
    return res.json({ userMessage, settleAllProposal: { count: outstanding } });
  }

  // Balance command → compute and reply with a summary.
  if (result.kind === "command" && result.command === "balance") {
    const { balances, settlements } = await computeGroupBalances(group.id);

    if (isJoint) {
      const cardName = accounts[0]?.name ?? "the card";
      // Outstanding to the card = owed - paid = -net.
      const owing = balances
        .map((b) => ({ name: b.name, out: -b.net }))
        .filter((b) => b.out > 0.005);
      const total = owing.reduce((sum, b) => sum + b.out, 0);
      const lines = owing.length
        ? owing.map((b) => `${b.name} owes ${money(b.out)}`)
        : ["Everyone's settled up. 🎉"];
      const hostMessage = await hostReply(
        `${cardName} — who owes what:\n` +
          lines.join("\n") +
          `\n\nTotal outstanding: ${money(total)}`
      );
      return res.json({ userMessage, hostMessage });
    }

    const lines = balances.map((b) =>
      b.net > 0.005
        ? `${b.name} is owed ${money(b.net)}`
        : b.net < -0.005
        ? `${b.name} owes ${money(-b.net)}`
        : `${b.name}: ${money(0)}`
    );
    const settle = settlements.length
      ? "\n\nSettle up:\n" + settlements.map((s) => `${s.fromName} → ${s.toName}: ${money(s.amount)}`).join("\n")
      : "\n\nEveryone's even. 🎉";
    const hostMessage = await hostReply("Balances:\n" + lines.join("\n") + settle);
    return res.json({ userMessage, hostMessage });
  }

  // Help.
  if (result.kind === "command" && result.command === "help") {
    return res.json({
      userMessage,
      hostMessage: await hostReply(
        helpText(isJoint, members, String(memberId), accounts[0]?.name)
      ),
    });
  }

  // A structured formula matched, but a payer/beneficiary/card did not. Never
  // send this to the LLM: explicit financial names must be resolved exactly.
  if (result.kind === "invalid") {
    return res.json({
      userMessage,
      hostMessage: await hostReply(
        "I couldn't match every payer or person in that expense. Use names from the People panel, then try:\n" +
          `\"${expenseExample(isJoint, members, String(memberId))}\"`
      ),
    });
  }

  // Couldn't confidently understand it (and the LLM, if on, wasn't sure either).
  if (result.kind === "unparsed") {
    return res.json({
      userMessage,
      hostMessage: await hostReply(
        `I'm not sure what you mean 🤔 Try \"${expenseExample(
          isJoint,
          members,
          String(memberId)
        )}\", or type \"help\".`
      ),
    });
  }

  // Irrelevant — a free, canned reply (no LLM).
  return res.json({
    userMessage,
    hostMessage: await hostReply(
      "I handle expenses and balances for this group. Type \"help\" to see what I understand."
    ),
  });
});

// --- accounts --------------------------------------------------------------

// List accounts (payers that aren't necessarily people, e.g. a shared card).
api.get("/groups/:inviteCode/accounts", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });
  const accounts = await prisma.account.findMany({
    where: { groupId: group.id },
    orderBy: { name: "asc" },
  });
  res.json({ accounts });
});

api.post("/groups/:inviteCode/accounts", async (req, res) => {
  const { name, paidByMemberId } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const account = await prisma.account.create({
    data: {
      groupId: group.id,
      name: String(name).trim(),
      paidByMemberId: paidByMemberId ? String(paidByMemberId) : null,
    },
  });
  res.json({ account });
});

// --- expenses --------------------------------------------------------------

interface SplitInput {
  memberId: string;
  mode?: SplitMode;
  value?: number;
}

api.get("/groups/:inviteCode/expenses", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });
  const expenses = await prisma.expense.findMany({
    where: { groupId: group.id },
    include: { splits: true },
    orderBy: { date: "desc" },
  });
  res.json({ expenses });
});

// Create an expense (with its beneficiary splits) and post a summary card to
// the group chat so it shows up in the conversation.
api.post("/groups/:inviteCode/expenses", async (req, res) => {
  const { amount, description, category, paidByMemberId, paidByAccountId, splits, createdVia } =
    req.body ?? {};

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  if (!description) return res.status(400).json({ error: "description is required" });
  if (!paidByMemberId && !paidByAccountId) {
    return res.status(400).json({ error: "a payer (member or account) is required" });
  }
  if (!Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "at least one split is required" });
  }

  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const expense = await prisma.expense.create({
    data: {
      groupId: group.id,
      amount: amt,
      description: String(description).trim(),
      category: category ? String(category) : null,
      paidByMemberId: paidByMemberId ? String(paidByMemberId) : null,
      paidByAccountId: paidByAccountId ? String(paidByAccountId) : null,
      createdVia: createdVia === "rules" || createdVia === "llm" ? createdVia : "manual",
      splits: {
        create: (splits as SplitInput[]).map((s) => ({
          memberId: String(s.memberId),
          mode: (s.mode ?? "even") as string,
          value: Number(s.value ?? 1),
        })),
      },
    },
    include: { splits: true },
  });

  // Build a human-readable summary for the host card.
  const [members, accounts] = await Promise.all([
    prisma.member.findMany({ where: { groupId: group.id } }),
    prisma.account.findMany({ where: { groupId: group.id } }),
  ]);
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const payerLabel = paidByMemberId
    ? memberName(String(paidByMemberId))
    : accounts.find((a) => a.id === paidByAccountId)?.name ?? "?";
  const splitMemberNames = expense.splits.map((s) => memberName(s.memberId));
  const splitLabel = splitMemberNames.join(", ");
  const beneficiaryIds = new Set(expense.splits.map((s) => s.memberId));
  const forLabel =
    members.length > 0 && members.every((m) => beneficiaryIds.has(m.id))
      ? "everyone"
      : splitLabel;

  const shareCents = computeSplitCents(
    Math.round(amt * 100),
    expense.splits.map((s) => ({
      memberId: s.memberId,
      mode: s.mode as SplitMode,
      value: s.value,
    }))
  );
  const splitBreakdown = [...shareCents.entries()].map(([mid, cents]) => ({
    name: memberName(mid),
    amount: cents / 100,
  }));

  const cardPayload = JSON.stringify({
    expenseId: expense.id,
    amount: amt,
    description: expense.description,
    payerLabel,
    forLabel,
    splitMembers: splitMemberNames,
    splitBreakdown,
  });

  const hostMessage = await prisma.message.create({
    data: {
      groupId: group.id,
      role: "host",
      text: `${money(amt)} · ${expense.description} — paid by ${payerLabel} for ${forLabel}`,
      cardType: "expense",
      cardPayload,
    },
  });

  res.json({ expense, hostMessage });
});

// --- payments (settlements) ------------------------------------------------

api.post("/groups/:inviteCode/payments", async (req, res) => {
  const { fromMemberId, toMemberId, amount } = req.body ?? {};
  const amt = Number(amount);
  if (!fromMemberId) return res.status(400).json({ error: "fromMemberId is required" });
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const payment = await prisma.payment.create({
    data: {
      groupId: group.id,
      fromMemberId: String(fromMemberId),
      toMemberId: toMemberId ? String(toMemberId) : null,
      amount: amt,
    },
  });

  const [members, accounts] = await Promise.all([
    prisma.member.findMany({ where: { groupId: group.id } }),
    prisma.account.findMany({ where: { groupId: group.id } }),
  ]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const fromName = nameOf(payment.fromMemberId);
  const toLabel = payment.toMemberId ? nameOf(payment.toMemberId) : accounts[0]?.name ?? "the card";

  const hostMessage = await prisma.message.create({
    data: {
      groupId: group.id,
      role: "host",
      text: `💸 ${fromName} paid ${toLabel} ${money(amt)}`,
      cardType: "settlement",
    },
  });

  res.json({ payment, hostMessage });
});

// Settle everyone up at once: record the payments that bring all balances to $0.
api.post("/groups/:inviteCode/settle-all", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });

  const isJoint = group.type === "joint";
  const { balances, settlements } = await computeGroupBalances(group.id);

  const toCreate = isJoint
    ? balances
        .map((b) => ({ memberId: b.memberId, out: Math.round(-b.net * 100) / 100 }))
        .filter((b) => b.out > 0.005)
        .map((b) => ({
          groupId: group.id,
          fromMemberId: b.memberId,
          toMemberId: null as string | null,
          amount: b.out,
        }))
    : settlements.map((s) => ({
        groupId: group.id,
        fromMemberId: s.from,
        toMemberId: s.to as string | null,
        amount: s.amount,
      }));

  if (toCreate.length === 0) {
    const hostMessage = await prisma.message.create({
      data: {
        groupId: group.id,
        role: "host",
        text: "Everyone's already settled up — all balances are $0. 🎉",
      },
    });
    return res.json({ ok: true, count: 0, hostMessage });
  }

  await prisma.payment.createMany({ data: toCreate });
  const hostMessage = await prisma.message.create({
    data: {
      groupId: group.id,
      role: "host",
      text: "✅ Everyone's settled up — all balances are back to $0.",
      cardType: "settlement",
    },
  });
  res.json({ ok: true, count: toCreate.length, hostMessage });
});

// --- balances --------------------------------------------------------------

api.get("/groups/:inviteCode/balances", async (req, res) => {
  const group = await findGroup(req.params.inviteCode);
  if (!group) return res.status(404).json({ error: "group not found" });
  const data = await computeGroupBalances(group.id);
  let cardName: string | null = null;
  if (group.type === "joint") {
    const card = await prisma.account.findFirst({ where: { groupId: group.id } });
    cardName = card?.name ?? "Shared card";
  }
  res.json({ ...data, groupType: group.type, cardName });
});

// `/api/v1` is the stable public API. Keep the original `/api` paths working
// during the web launch so any already-open client can finish its session.
app.use("/api/v1", api);
app.use(
  "/api",
  (_req, res, next) => {
    res.setHeader("Deprecation", "true");
    next();
  },
  api
);

app.listen(PORT, () => {
  console.log(`SplitPea server listening on http://localhost:${PORT}`);
  console.log(
    `Parser LLM fallback: ${isLLMEnabled() ? "ENABLED (Gemini)" : "disabled (set GEMINI_API_KEY to enable)"}`
  );
});
