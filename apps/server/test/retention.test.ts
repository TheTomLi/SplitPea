import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_GROUP_RETENTION_DAYS,
  isGroupExpired,
  retentionCutoff,
  USED_GROUP_RETENTION_DAYS,
} from "../src/retention";

const now = new Date("2026-08-06T12:00:00.000Z");

test("empty groups expire after seven inactive days", () => {
  assert.equal(
    isGroupExpired(new Date("2026-07-30T11:59:59.999Z"), false, now),
    true
  );
  assert.equal(
    isGroupExpired(retentionCutoff(now, EMPTY_GROUP_RETENTION_DAYS), false, now),
    false
  );
});

test("groups with transactions retain a full year of inactivity", () => {
  assert.equal(
    isGroupExpired(new Date("2025-08-06T11:59:59.999Z"), true, now),
    true
  );
  assert.equal(
    isGroupExpired(retentionCutoff(now, USED_GROUP_RETENTION_DAYS), true, now),
    false
  );
});
