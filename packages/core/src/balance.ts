// Balance engine — the heart of SpliitAI.
//
// Given the members, accounts, and expenses of a group, it computes each
// member's net position (what they paid minus what they owe) and a minimal set
// of settle-up transactions.
//
// Shared-card model: an expense's payer can be a Member OR an Account (e.g. a
// joint card). An Account that has `paidByMemberId` set means that member
// actually settles the card's real statement, so they are treated as the payer.
// An account with no owner is treated as an external payer (its payments are not
// credited to any group member).
//
// All math is done in integer cents to avoid floating-point drift; results are
// returned in dollars.

import type { SplitMode } from "./types";

export interface BalanceMember {
  id: string;
}

export interface BalanceAccount {
  id: string;
  paidByMemberId?: string | null;
}

export interface BalanceSplit {
  memberId: string;
  mode: SplitMode;
  value: number;
}

export interface BalanceExpense {
  id: string;
  amount: number;
  paidByMemberId?: string | null;
  paidByAccountId?: string | null;
  splits: BalanceSplit[];
}

/** A settlement/repayment. `toMemberId` null = paid to the card (joint mode). */
export interface BalancePayment {
  fromMemberId: string;
  toMemberId: string | null;
  amount: number;
}

export interface BalanceInput {
  members: BalanceMember[];
  accounts: BalanceAccount[];
  expenses: BalanceExpense[];
  payments?: BalancePayment[];
}

export interface Settlement {
  from: string; // memberId who pays
  to: string; // memberId who receives
  amount: number; // dollars
}

export interface MemberBalance {
  memberId: string;
  paid: number; // dollars fronted
  owed: number; // dollars they are responsible for
  net: number; // paid - owed (positive = others owe them)
}

export interface BalanceResult {
  balances: MemberBalance[];
  settlements: Settlement[];
}

const toCents = (dollars: number): number => Math.round(dollars * 100);
const toDollars = (cents: number): number => Math.round(cents) / 100;

/**
 * Split `amountCents` across `weights` so the parts are integers that sum
 * exactly to `amountCents` (largest-remainder method).
 */
function distributeByWeights(amountCents: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amountCents * w) / total);
  const floors = exact.map(Math.floor);
  let remainder = amountCents - floors.reduce((a, b) => a + b, 0);

  const byFrac = exact
    .map((e, i) => ({ i, frac: e - floors[i] }))
    .sort((a, b) => b.frac - a.frac);

  const result = floors.slice();
  for (let k = 0; remainder > 0 && byFrac.length > 0; k++, remainder--) {
    result[byFrac[k % byFrac.length].i] += 1;
  }
  return result;
}

/**
 * Compute how many cents each split's member owes for a single expense.
 * Assumes all splits in an expense share the same mode (as in the UI).
 */
export function computeSplitCents(
  amountCents: number,
  splits: BalanceSplit[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (splits.length === 0) return result;

  const mode = splits[0].mode;
  let cents: number[];

  if (mode === "exact") {
    // Values are exact dollar amounts. Reconcile any rounding drift against the
    // largest share so the parts sum exactly to the expense amount.
    cents = splits.map((s) => toCents(s.value));
    const drift = amountCents - cents.reduce((a, b) => a + b, 0);
    if (drift !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < cents.length; i++) if (cents[i] > cents[maxIdx]) maxIdx = i;
      cents[maxIdx] += drift;
    }
  } else {
    // even / shares / percent are all proportional distributions.
    const weights =
      mode === "even" ? splits.map(() => 1) : splits.map((s) => s.value);
    cents = distributeByWeights(amountCents, weights);
  }

  splits.forEach((s, i) => {
    result.set(s.memberId, (result.get(s.memberId) ?? 0) + cents[i]);
  });
  return result;
}

/** Resolve the member who effectively paid an expense, or null if external. */
function resolvePayerMemberId(
  expense: BalanceExpense,
  accountsById: Map<string, BalanceAccount>
): string | null {
  if (expense.paidByMemberId) return expense.paidByMemberId;
  if (expense.paidByAccountId) {
    const acct = accountsById.get(expense.paidByAccountId);
    return acct?.paidByMemberId ?? null;
  }
  return null;
}

/** Greedy minimal settle-up: match biggest debtor to biggest creditor. */
function computeSettlements(netCents: Map<string, number>): Settlement[] {
  const debtors = [...netCents.entries()]
    .filter(([, c]) => c < 0)
    .map(([id, c]) => ({ id, amount: -c }));
  const creditors = [...netCents.entries()]
    .filter(([, c]) => c > 0)
    .map(([id, c]) => ({ id, amount: c }));

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amount, creditors[ci].amount);
    if (pay > 0) {
      settlements.push({
        from: debtors[di].id,
        to: creditors[ci].id,
        amount: toDollars(pay),
      });
    }
    debtors[di].amount -= pay;
    creditors[ci].amount -= pay;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }
  return settlements;
}

export function computeBalances(input: BalanceInput): BalanceResult {
  const accountsById = new Map(input.accounts.map((a) => [a.id, a]));

  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  for (const m of input.members) {
    paid.set(m.id, 0);
    owed.set(m.id, 0);
  }

  for (const expense of input.expenses) {
    const amountCents = toCents(expense.amount);

    const payerId = resolvePayerMemberId(expense, accountsById);
    if (payerId != null && paid.has(payerId)) {
      paid.set(payerId, paid.get(payerId)! + amountCents);
    }

    const shares = computeSplitCents(amountCents, expense.splits);
    for (const [memberId, cents] of shares) {
      if (owed.has(memberId)) owed.set(memberId, owed.get(memberId)! + cents);
    }
  }

  // Payments (settlements): the payer fronts cash; the recipient's obligation
  // grows by the same amount. A null recipient means "the card" (joint mode),
  // which only credits the payer.
  for (const p of input.payments ?? []) {
    const cents = toCents(p.amount);
    if (paid.has(p.fromMemberId)) paid.set(p.fromMemberId, paid.get(p.fromMemberId)! + cents);
    if (p.toMemberId && owed.has(p.toMemberId)) {
      owed.set(p.toMemberId, owed.get(p.toMemberId)! + cents);
    }
  }

  const netCents = new Map<string, number>();
  const balances: MemberBalance[] = input.members.map((m) => {
    const p = paid.get(m.id) ?? 0;
    const o = owed.get(m.id) ?? 0;
    netCents.set(m.id, p - o);
    return {
      memberId: m.id,
      paid: toDollars(p),
      owed: toDollars(o),
      net: toDollars(p - o),
    };
  });

  return { balances, settlements: computeSettlements(netCents) };
}
