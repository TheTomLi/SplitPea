import { inviteCodeFromInput } from "../src/invite";

let failed = 0;

function expectCode(label: string, input: string, expected: string) {
  const actual = inviteCodeFromInput(input);
  if (actual === expected) {
    console.log(`  ok  ${label}`);
    return;
  }

  failed++;
  console.error(`FAIL  ${label}\n      expected ${expected}\n      got      ${actual}`);
}

expectCode(
  "production invite link",
  "https://getsplitpea.com/?g=ABC2DEF3",
  "ABC2DEF3"
);
expectCode(
  "link with path, extra query, and fragment",
  "https://getsplitpea.com/join?source=text&g=abc2def3#invite",
  "ABC2DEF3"
);
expectCode(
  "link without protocol",
  "getsplitpea.com/?g=ABC2DEF3",
  "ABC2DEF3"
);
expectCode("bare invite code", "  abc2def3  ", "ABC2DEF3");
expectCode("link without invite parameter", "https://getsplitpea.com/", "");
expectCode("invalid invite code", "not-an-invite", "");

if (failed > 0) process.exitCode = 1;
