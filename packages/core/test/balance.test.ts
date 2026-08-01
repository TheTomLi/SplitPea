// Lightweight assertion-based tests (run with: npx tsx packages/core/test/balance.test.ts)
import { computeBalances, type BalanceInput } from "../src/balance";

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

function net(input: BalanceInput) {
  const r = computeBalances(input);
  return Object.fromEntries(r.balances.map((b) => [b.memberId, b.net]));
}

// 1. Simple even split: Alice pays $40 dinner, split with Bob.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [],
    expenses: [
      {
        id: "e1",
        amount: 40,
        paidByMemberId: "A",
        splits: [
          { memberId: "A", mode: "even", value: 1 },
          { memberId: "B", mode: "even", value: 1 },
        ],
      },
    ],
  };
  eq("even split net", net(input), { A: 20, B: -20 });
  const s = computeBalances(input).settlements;
  eq("even split settle", s, [{ from: "B", to: "A", amount: 20 }]);
}

// 2. Odd cents even split: $10 across 3 → 3.34 / 3.33 / 3.33, sums to 10.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }, { id: "C" }],
    accounts: [],
    expenses: [
      {
        id: "e1",
        amount: 10,
        paidByMemberId: "A",
        splits: [
          { memberId: "A", mode: "even", value: 1 },
          { memberId: "B", mode: "even", value: 1 },
          { memberId: "C", mode: "even", value: 1 },
        ],
      },
    ],
  };
  const b = computeBalances(input).balances;
  const owedSum = b.reduce((acc, m) => acc + m.owed, 0);
  eq("odd cents owed sums to amount", owedSum, 10);
}

// 3. Shared-card scenario: Joint Visa (owned by Alice) pays $100 groceries,
//    split evenly Alice/Bob. Alice settles the card, so Bob owes Alice $50.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [{ id: "visa", paidByMemberId: "A" }],
    expenses: [
      {
        id: "e1",
        amount: 100,
        paidByAccountId: "visa",
        splits: [
          { memberId: "A", mode: "even", value: 1 },
          { memberId: "B", mode: "even", value: 1 },
        ],
      },
    ],
  };
  eq("shared-card net", net(input), { A: 50, B: -50 });
  eq("shared-card settle", computeBalances(input).settlements, [
    { from: "B", to: "A", amount: 50 },
  ]);
}

// 4. Shared-card personal purchase: Joint Visa (Alice) pays $60 for Bob's shirt,
//    split 100% Bob. Bob owes Alice the full $60.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [{ id: "visa", paidByMemberId: "A" }],
    expenses: [
      {
        id: "e1",
        amount: 60,
        paidByAccountId: "visa",
        splits: [{ memberId: "B", mode: "exact", value: 60 }],
      },
    ],
  };
  eq("shared-card personal net", net(input), { A: 60, B: -60 });
}

// 5. Percentage split: Alice pays $200, 25% Alice / 75% Bob.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [],
    expenses: [
      {
        id: "e1",
        amount: 200,
        paidByMemberId: "A",
        splits: [
          { memberId: "A", mode: "percent", value: 25 },
          { memberId: "B", mode: "percent", value: 75 },
        ],
      },
    ],
  };
  eq("percent net", net(input), { A: 150, B: -150 });
}

// 6. Settlement (split mode): A pays 40 dinner w/ B, then B repays A $20 → even.
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [],
    expenses: [
      {
        id: "e1",
        amount: 40,
        paidByMemberId: "A",
        splits: [
          { memberId: "A", mode: "even", value: 1 },
          { memberId: "B", mode: "even", value: 1 },
        ],
      },
    ],
    payments: [{ fromMemberId: "B", toMemberId: "A", amount: 20 }],
  };
  eq("settlement zeros out", net(input), { A: 0, B: 0 });
  eq("settlement no settle-up", computeBalances(input).settlements, []);
}

// 7. Settlement (joint mode): Alice owes card 90, pays card 40 → owes 50 (-net).
{
  const input: BalanceInput = {
    members: [{ id: "A" }, { id: "B" }],
    accounts: [{ id: "card", paidByMemberId: null }],
    expenses: [
      {
        id: "e1",
        amount: 90,
        paidByAccountId: "card",
        splits: [{ memberId: "A", mode: "even", value: 1 }],
      },
    ],
    payments: [{ fromMemberId: "A", toMemberId: null, amount: 40 }],
  };
  const b = computeBalances(input).balances.find((x) => x.memberId === "A")!;
  eq("joint settlement owes card 50", -b.net, 50);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
