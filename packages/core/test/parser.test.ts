// Run with: npx tsx packages/core/test/parser.test.ts
import { parseMessage, type ParseContext } from "../src/parser";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const ctx: ParseContext = {
  members: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "carol", name: "Carol" },
  ],
  accounts: [{ id: "visa", name: "Joint Visa" }],
  senderMemberId: "alice",
};

// Basic expense, default split among everyone.
{
  const r = parseMessage("paid 40 for dinner", ctx);
  check("basic: kind", r.kind === "expense", r);
  if (r.kind === "expense") {
    check("basic: amount", r.expense.amount === 40, r.expense.amount);
    check("basic: desc", r.expense.description === "dinner", r.expense.description);
    check("basic: payer=sender", r.expense.paidByMemberId === "alice");
    check("basic: split all 3", r.expense.splits.length === 3);
  }
}

// Split with a named person → sender + that person.
{
  const r = parseMessage("paid $40 for dinner, split with Bob", ctx);
  if (r.kind === "expense") {
    const ids = r.expense.splits.map((s) => s.memberId).sort();
    check("splitwith: alice+bob", JSON.stringify(ids) === JSON.stringify(["alice", "bob"]), ids);
    check("splitwith: desc", r.expense.description === "dinner", r.expense.description);
  } else check("splitwith: kind", false, r);
}

// Account payer via "on <card>".
{
  const r = parseMessage("100 for groceries on Joint Visa", ctx);
  if (r.kind === "expense") {
    check("account: payer", r.expense.paidByAccountId === "visa" && r.expense.paidByMemberId == null, r.expense);
    check("account: desc", r.expense.description === "groceries", r.expense.description);
  } else check("account: kind", false, r);
}

// Leading name as payer.
{
  const r = parseMessage("Bob paid 30 for lunch", ctx);
  if (r.kind === "expense") {
    check("leadname: payer=bob", r.expense.paidByMemberId === "bob", r.expense.paidByMemberId);
    check("leadname: desc", r.expense.description === "lunch", r.expense.description);
  } else check("leadname: kind", false, r);
}

// "spent ... on ..." with decimals.
{
  const r = parseMessage("spent 25.50 on coffee", ctx);
  if (r.kind === "expense") {
    check("spent: amount", r.expense.amount === 25.5, r.expense.amount);
    check("spent: desc", r.expense.description === "coffee", r.expense.description);
  } else check("spent: kind", false, r);
}

// split with everyone.
{
  const r = parseMessage("paid 90 for hotel split with everyone", ctx);
  if (r.kind === "expense") {
    check("everyone: 3 ways", r.expense.splits.length === 3, r.expense.splits.length);
  } else check("everyone: kind", false, r);
}

// Commands.
check("cmd: balance", parseMessage("balance", ctx).kind === "command");
check("cmd: settle", parseMessage("settle up", ctx).kind === "command");
check("cmd: help", parseMessage("help", ctx).kind === "command");

// Relevance gate.
check("gate: irrelevant", parseMessage("hey how are you", ctx).kind === "irrelevant");
check("gate: greeting", parseMessage("good morning team", ctx).kind === "irrelevant");
check("gate: unparsed", parseMessage("paid for stuff", ctx).kind === "unparsed");

// --- Joint (shared-card) mode -------------------------------------------
const jctx: ParseContext = {
  members: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "carol", name: "Carol" },
  ],
  accounts: [{ id: "card", name: "Shared card" }],
  senderMemberId: "alice",
  mode: "joint",
  cardAccountId: "card",
};

// "I spent X" → charged to card, only the sender owes.
{
  const r = parseMessage("I spent 90 on gas", jctx);
  if (r.kind === "expense") {
    check("joint: card payer", r.expense.paidByAccountId === "card" && r.expense.paidByMemberId == null, r.expense);
    check("joint: only sender", JSON.stringify(r.expense.splits.map((s) => s.memberId)) === JSON.stringify(["alice"]), r.expense.splits);
    check("joint: desc", r.expense.description === "gas", r.expense.description);
  } else check("joint: kind", false, r);
}

// Subject list "me and Bob spent ... evenly" → both owe the card.
{
  const r = parseMessage("me and Bob spent 100 at grocery, evenly split", jctx);
  if (r.kind === "expense") {
    const ids = r.expense.splits.map((s) => s.memberId).sort();
    check("joint: me+bob", JSON.stringify(ids) === JSON.stringify(["alice", "bob"]), ids);
    check("joint: desc grocery", r.expense.description === "grocery", r.expense.description);
    check("joint: amount", r.expense.amount === 100, r.expense.amount);
  } else check("joint: subj kind", false, r);
}

// Verb-first, no subject → default to sender only.
{
  const r = parseMessage("spent 12.50 on coffee", jctx);
  if (r.kind === "expense") {
    check("joint: default sender", JSON.stringify(r.expense.splits.map((s) => s.memberId)) === JSON.stringify(["alice"]), r.expense.splits);
  } else check("joint: default kind", false, r);
}

// "everyone" still means all.
{
  const r = parseMessage("spent 60 on dinner split with everyone", jctx);
  if (r.kind === "expense") {
    check("joint: everyone", r.expense.splits.length === 3, r.expense.splits.length);
  } else check("joint: everyone kind", false, r);
}

// --- Settlements ---------------------------------------------------------
// Split mode (sender = Alice).
{
  const r = parseMessage("I paid Bob 20", ctx);
  if (r.kind === "settlement") {
    check("settle: I paid Bob", r.settlement.fromMemberId === "alice" && r.settlement.toMemberId === "bob" && r.settlement.amount === 20, r.settlement);
  } else check("settle: kind", false, r);
}
{
  const r = parseMessage("Bob paid me 15", ctx);
  if (r.kind === "settlement") {
    check("settle: Bob paid me", r.settlement.fromMemberId === "bob" && r.settlement.toMemberId === "alice", r.settlement);
  } else check("settle: kind2", false, r);
}
{
  const r = parseMessage("paid back Carol 10", ctx);
  if (r.kind === "settlement") {
    check("settle: paid back Carol", r.settlement.fromMemberId === "alice" && r.settlement.toMemberId === "carol", r.settlement);
  } else check("settle: kind3", false, r);
}
// An expense is NOT mistaken for a settlement.
check("settle: expense not settlement", parseMessage("paid 40 for dinner", ctx).kind === "expense");
// "settle up" with no amount is the balance command.
check("settle: bare settle = balance", parseMessage("settle up", ctx).kind === "command");

// Joint mode: pay the card.
{
  const r = parseMessage("I paid the card 50", jctx);
  if (r.kind === "settlement") {
    check("settle joint: card", r.settlement.fromMemberId === "alice" && r.settlement.toMemberId === null && r.settlement.amount === 50, r.settlement);
  } else check("settle joint: kind", false, r);
}
{
  const r = parseMessage("I settled 30", jctx);
  if (r.kind === "settlement") {
    check("settle joint: settled N", r.settlement.toMemberId === null && r.settlement.amount === 30, r.settlement);
  } else check("settle joint: kind2", false, r);
}

// --- Settle all ----------------------------------------------------------
const isSettleAll = (t: string) => {
  const r = parseMessage(t, ctx);
  return r.kind === "command" && r.command === "settleAll";
};
check("settleAll: settled for everyone", isSettleAll("settled for everyone"));
check("settleAll: settle everyone up", isSettleAll("settle everyone up"));
check("settleAll: everyone is settled", isSettleAll("everyone is settled"));
check("settleAll: all settled", isSettleAll("all settled"));
check("settleAll: all square", isSettleAll("we are all square"));
check("settleAll: reset balances", isSettleAll("reset balances"));
check("settleAll: nobody owes anybody", isSettleAll("everything is paid up. nobody owes anybody."));
check("settleAll: no one owes", isSettleAll("no one owes anything anymore"));
check("settleAll: were all even", isSettleAll("we're all even now"));
check("settleAll: everything paid up", isSettleAll("everything is paid up"));
// Guard: an expense that happens to contain "even"/a number is NOT settle-all.
check("settleAll: 'we split 40 even' not settleAll", !isSettleAll("we split 40 even"));
// "settle up" (no all/everyone) is still the balance view, not settle-all.
{
  const r = parseMessage("settle up", ctx);
  check("settleAll: 'settle up' stays balance", r.kind === "command" && r.command === "balance", r);
}
// A specific settlement is not settle-all.
check("settleAll: 'I paid Bob 20' not settleAll", !isSettleAll("I paid Bob 20"));

// --- Custom splits (by amount / percent / shares) ------------------------
const tctx: ParseContext = {
  members: [
    { id: "sam", name: "Sam" },
    { id: "tom", name: "Tom" },
    { id: "emma", name: "Emma" },
  ],
  accounts: [],
  senderMemberId: "sam",
  mode: "split",
};
const splitMap = (r: ReturnType<typeof parseMessage>) =>
  r.kind === "expense"
    ? Object.fromEntries(r.expense.splits.map((s) => [s.memberId, `${s.mode}:${s.value}`]))
    : null;

{
  const r = parseMessage("me and emma had dinner, total is 50, split by 20 to tom, 30 to emma", tctx);
  check("exact: amount=50", r.kind === "expense" && r.expense.amount === 50, r.kind === "expense" ? r.expense.amount : r);
  check("exact: splits", JSON.stringify(splitMap(r)) === JSON.stringify({ tom: "exact:20", emma: "exact:30" }), splitMap(r));
  if (r.kind === "expense") check("exact: desc=dinner", r.expense.description === "dinner", r.expense.description);
}
{
  const r = parseMessage("dinner is 100 for me and emma, me takes 60% emma takes 40%", tctx);
  check("pct: amount=100", r.kind === "expense" && r.expense.amount === 100, r.kind === "expense" ? r.expense.amount : r);
  check("pct: splits", JSON.stringify(splitMap(r)) === JSON.stringify({ sam: "percent:60", emma: "percent:40" }), splitMap(r));
  if (r.kind === "expense") check("pct: desc=dinner", r.expense.description === "dinner", r.expense.description);
}
// Regression: a normal even split is unaffected.
{
  const r = parseMessage("paid 40 for dinner, split with Bob", ctx);
  check("even still even", r.kind === "expense" && r.expense.splits.every((s) => s.mode === "even"), r);
}

// "<name> is <amount>" is a by-amount split, not an even split.
{
  const ectx: ParseContext = {
    members: [
      { id: "emma", name: "Emma" },
      { id: "tom", name: "Tom" },
      { id: "lydia", name: "Lydia" },
      { id: "sam", name: "Sam" },
    ],
    accounts: [],
    senderMemberId: "sam",
    mode: "split",
  };
  const r = parseMessage(
    "I paid 150 bucks for dinner for everyone, split by person Emma is 20, Tom is 30, Lydia is 50, sam is 50",
    ectx
  );
  check("is-amount: amount=150", r.kind === "expense" && r.expense.amount === 150, r.kind === "expense" ? r.expense.amount : r);
  check(
    "is-amount: exact splits",
    JSON.stringify(splitMap(r)) ===
      JSON.stringify({ emma: "exact:20", tom: "exact:30", lydia: "exact:50", sam: "exact:50" }),
    splitMap(r)
  );
  if (r.kind === "expense") check("is-amount: desc=dinner", r.expense.description === "dinner", r.expense.description);

  // "split by percent" with no "%" signs → percent mode (values checked vs 100 later).
  const rp = parseMessage(
    "I paid 150 bucks for everyone on dinner. split by percent, Emma is 20 , Tom is 30 , Lydia is 50 , sam is 50",
    ectx
  );
  check("pct-word: amount=150", rp.kind === "expense" && rp.expense.amount === 150, rp.kind === "expense" ? rp.expense.amount : rp);
  check(
    "pct-word: percent splits",
    JSON.stringify(splitMap(rp)) ===
      JSON.stringify({ emma: "percent:20", tom: "percent:30", lydia: "percent:50", sam: "percent:50" }),
    splitMap(rp)
  );
}

// --- Confidence gate: defer overconfident bad parses to the LLM ----------
// "everyone" comes before "split", so the rules only capture the sender and
// pick a junk description → should defer (unparsed), not emit a wrong expense.
check(
  "gate: for-everyone defers",
  parseMessage("I bought dinner for everyone, split evenly, it costed me 40 bucks", ctx).kind === "unparsed"
);
// A "split" clause that collapses to only the sender in a multi-member group
// is a mis-parse → defer.
check(
  "gate: lone-sender split defers",
  parseMessage("paid 40 for dinner, split with me", ctx).kind === "unparsed"
);
// "split evenly" (no names) still correctly defaults to the whole group.
check(
  "gate: bare 'split evenly' stays everyone",
  (() => {
    const r = parseMessage("paid 40 for dinner split evenly", ctx);
    return r.kind === "expense" && r.expense.splits.length === 3;
  })()
);
// A correctly-captured "everyone" is NOT downgraded.
check(
  "gate: explicit everyone stays expense",
  parseMessage("paid 90 for hotel split with everyone", ctx).kind === "expense"
);
// No group-split signal → single/default split is left alone.
check(
  "gate: plain expense unaffected",
  parseMessage("paid 40 for dinner", ctx).kind === "expense"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
