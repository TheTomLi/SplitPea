import assert from "node:assert/strict";
import test from "node:test";
import { isOriginAllowed } from "../src/http-security";

const productionOrigins = [
  "https://getsplitpea.com",
  "https://www.getsplitpea.com",
];

test("allows the production web origins", () => {
  assert.equal(
    isOriginAllowed("https://getsplitpea.com", productionOrigins, []),
    true
  );
  assert.equal(
    isOriginAllowed("https://www.getsplitpea.com", productionOrigins, []),
    true
  );
});

test("allows HTTPS Cloudflare previews only when their suffix is configured", () => {
  const suffixes = [".splitpea.pages.dev"];
  assert.equal(
    isOriginAllowed(
      "https://a1b2c3.splitpea.pages.dev",
      productionOrigins,
      suffixes
    ),
    true
  );
  assert.equal(
    isOriginAllowed(
      "http://a1b2c3.splitpea.pages.dev",
      productionOrigins,
      suffixes
    ),
    false
  );
});

test("rejects lookalike and unrelated browser origins", () => {
  assert.equal(
    isOriginAllowed("https://getsplitpea.com.example.com", productionOrigins, []),
    false
  );
  assert.equal(
    isOriginAllowed("https://example.com", productionOrigins, []),
    false
  );
});
