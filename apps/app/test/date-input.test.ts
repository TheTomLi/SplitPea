import { formatIsoDateInput } from "../src/date-input";

let failed = 0;

function expectDate(label: string, input: string, expected: string) {
  const actual = formatIsoDateInput(input);
  if (actual === expected) {
    console.log(`  ok  ${label}`);
    return;
  }

  failed++;
  console.error(`FAIL  ${label}\n      expected ${expected}\n      got      ${actual}`);
}

expectDate("keeps a complete ISO date", "2026-10-26", "2026-10-26");
expectDate("adds separators to eight digits", "20261026", "2026-10-26");
expectDate("formats a partially entered month", "20261", "2026-1");
expectDate("formats a partially entered day", "2026102", "2026-10-2");
expectDate("restores a deleted separator", "202610-26", "2026-10-26");
expectDate("normalizes pasted date separators", "2026/10/26", "2026-10-26");
expectDate("limits input to one date", "202610261234", "2026-10-26");
expectDate("allows the field to be cleared", "", "");

if (failed > 0) process.exitCode = 1;
