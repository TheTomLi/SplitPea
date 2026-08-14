import assert from "node:assert/strict";
import test from "node:test";
import { llmParse, type LlmContext } from "../src/llm";

const context: LlmContext = {
  members: [
    { id: "tom", name: "Tom" },
    { id: "emma", name: "Emma" },
  ],
  accounts: [],
  senderMemberId: "tom",
  mode: "split",
  cardAccountId: null,
};

test("Gemini requests time out instead of hanging the chat", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalTimeout = process.env.GEMINI_TIMEOUT_MS;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_TIMEOUT_MS = "25";
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    })) as typeof fetch;

  try {
    const started = Date.now();
    assert.equal(await llmParse("Emma treated Tom to dinner", context), null);
    assert.ok(Date.now() - started < 500, "timeout should return promptly");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalTimeout == null) delete process.env.GEMINI_TIMEOUT_MS;
    else process.env.GEMINI_TIMEOUT_MS = originalTimeout;
  }
});

test("LLM output with mismatched exact allocations fails closed", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    kind: "expense",
                    amount: 10,
                    description: "dinner",
                    payer: "Tom",
                    splitMembers: [],
                    splits: [
                      { name: "Tom", mode: "exact", value: 100 },
                      { name: "Emma", mode: "exact", value: 100 },
                    ],
                    unknownNames: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    assert.equal(await llmParse("ten total, one hundred each", context), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
