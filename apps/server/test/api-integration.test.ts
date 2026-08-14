import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(serverRoot, "../..");
const tempRoot = mkdtempSync(join(tmpdir(), "splitpea-api-test-"));
const databaseUrl = `file:${join(tempRoot, "test.db")}`;

let server: ChildProcess;
let baseUrl = "";

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      const port = typeof address === "object" && address ? address.port : 0;
      socket.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("test API did not start in time");
}

async function request(
  path: string,
  method = "GET",
  body?: unknown
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  // Copy the checked-in local schema fixture. This avoids invoking Prisma's
  // native schema engine during tests and still gives every run an isolated DB.
  copyFileSync(join(serverRoot, "prisma/dev.db"), join(tempRoot, "test.db"));

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["--import", "tsx", join(serverRoot, "src/index.ts")],
    {
      cwd: repoRoot,
      env: {
        ...env,
        PORT: String(port),
        NODE_ENV: "test",
        GEMINI_API_KEY: "",
        GROUP_RATE_LIMIT_MAX: "1000",
        MESSAGE_RATE_LIMIT_MAX: "1000",
        RATE_LIMIT_MAX_MUTATIONS: "1000",
      },
      stdio: "pipe",
    }
  );
  await waitForServer();
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(tempRoot, { recursive: true, force: true });
});

test("API rejects cross-group IDs, invalid splits, and duplicate names", async () => {
  assert.equal(
    (await request("/groups", "POST", { name: "   ", creatorName: "Alice" })).status,
    400
  );

  const a = await request("/groups", "POST", {
    name: "Trip A",
    creatorName: "Alice",
    participants: ["Bob", "bob", "ALICE"],
    type: "split",
  });
  assert.equal(a.status, 200);
  assert.equal(a.data.group.members.length, 2, "participant names are case-insensitively unique");
  const alice = a.data.group.members.find((member: any) => member.name === "Alice");
  const bob = a.data.group.members.find((member: any) => member.name === "Bob");

  const b = await request("/groups", "POST", {
    name: "Trip B",
    creatorName: "Mallory",
    type: "split",
  });
  assert.equal(b.status, 200);
  const mallory = b.data.member;

  const joined = await request(`/groups/${a.data.group.inviteCode}/join`, "POST", {
    name: "ALICE",
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.member.id, alice.id, "joining with different case reuses the member");

  assert.equal(
    (await request(`/groups/${a.data.group.inviteCode}/members`, "POST", { name: " bob " })).status,
    409
  );
  assert.equal(
    (
      await request(
        `/groups/${a.data.group.inviteCode}/members/${alice.id}`,
        "PATCH",
        { name: "BOB" }
      )
    ).status,
    409
  );

  assert.equal(
    (
      await request(
        `/groups/${a.data.group.inviteCode}/members/${mallory.id}`,
        "PATCH",
        { name: "Stolen" }
      )
    ).status,
    404
  );
  const untouchedB = await request(`/groups/${b.data.group.inviteCode}`);
  assert.equal(untouchedB.data.members[0].name, "Mallory");
  assert.equal(
    (
      await request(
        `/groups/${a.data.group.inviteCode}/members/${mallory.id}`,
        "DELETE"
      )
    ).status,
    404
  );

  assert.equal(
    (
      await request(`/groups/${a.data.group.inviteCode}/messages`, "POST", {
        memberId: mallory.id,
        text: "paid 10 for dinner",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(`/groups/${a.data.group.inviteCode}/messages`, "POST", {
        memberId: alice.id,
        text: "x".repeat(201),
      })
    ).status,
    400
  );
  assert.equal((await request(`/groups/${a.data.group.inviteCode}/messages`)).data.messages.length, 0);

  const unsafeProposal = await request(
    `/groups/${a.data.group.inviteCode}/messages`,
    "POST",
    {
      memberId: alice.id,
      text: "I paid 10 for dinner, 100 for Alice and 100 for Bob",
    }
  );
  assert.equal(unsafeProposal.status, 200);
  assert.equal(unsafeProposal.data.proposal, undefined);
  assert.match(unsafeProposal.data.hostMessage.text, /couldn't safely create/i);

  const expensePath = `/groups/${a.data.group.inviteCode}/expenses`;
  const baseExpense = {
    amount: 10,
    description: "Dinner",
    paidByMemberId: alice.id,
  };
  assert.equal(
    (
      await request(expensePath, "POST", {
        ...baseExpense,
        paidByMemberId: mallory.id,
        splits: [{ memberId: alice.id, mode: "even", value: 1 }],
      })
    ).status,
    400
  );
  const foreignAccount = await request(
    `/groups/${b.data.group.inviteCode}/accounts`,
    "POST",
    { name: "Mallory cash", paidByMemberId: mallory.id }
  );
  assert.equal(foreignAccount.status, 200);
  assert.equal(
    (
      await request(expensePath, "POST", {
        amount: 10,
        description: "Foreign payer",
        paidByAccountId: foreignAccount.data.account.id,
        splits: [{ memberId: alice.id, mode: "even", value: 1 }],
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(expensePath, "POST", {
        ...baseExpense,
        splits: [{ memberId: mallory.id, mode: "even", value: 1 }],
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(expensePath, "POST", {
        ...baseExpense,
        splits: [
          { memberId: alice.id, mode: "exact", value: 100 },
          { memberId: bob.id, mode: "exact", value: 100 },
        ],
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(expensePath, "POST", {
        ...baseExpense,
        splits: [
          { memberId: alice.id, mode: "percent", value: 70 },
          { memberId: bob.id, mode: "percent", value: 20 },
        ],
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(expensePath, "POST", {
        ...baseExpense,
        splits: [
          { memberId: alice.id, mode: "even", value: 1 },
          { memberId: bob.id, mode: "even", value: 1 },
        ],
      })
    ).status,
    200
  );

  assert.equal(
    (
      await request(`/groups/${a.data.group.inviteCode}/accounts`, "POST", {
        name: "Cash",
        paidByMemberId: mallory.id,
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(`/groups/${a.data.group.inviteCode}/payments`, "POST", {
        fromMemberId: mallory.id,
        toMemberId: alice.id,
        amount: 5,
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(`/groups/${a.data.group.inviteCode}/payments`, "POST", {
        fromMemberId: alice.id,
        toMemberId: mallory.id,
        amount: 5,
      })
    ).status,
    400
  );
});
