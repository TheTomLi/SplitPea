import type { PrismaClient } from "@prisma/client";

export const EMPTY_GROUP_RETENTION_DAYS = 7;
export const USED_GROUP_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Pure policy helper used by tests and operational reporting.
 * "Has transactions" means at least one expense or payment; chat-only groups
 * use the shorter empty-group retention window.
 */
export function isGroupExpired(
  lastActivityAt: Date,
  hasTransactions: boolean,
  now = new Date()
): boolean {
  const days = hasTransactions
    ? USED_GROUP_RETENTION_DAYS
    : EMPTY_GROUP_RETENTION_DAYS;
  return lastActivityAt < retentionCutoff(now, days);
}

/**
 * Delete expired groups in the database. The predicates are evaluated as part
 * of each DELETE, so a newly-touched group or a group that just received its
 * first transaction cannot be removed by a stale cleanup decision.
 *
 * Direct children use ON DELETE CASCADE. Splits cascade through expenses.
 */
export async function cleanupExpiredGroups(
  db: PrismaClient,
  now = new Date()
): Promise<{ emptyDeleted: number; usedDeleted: number }> {
  const emptyCutoff = retentionCutoff(now, EMPTY_GROUP_RETENTION_DAYS);
  const usedCutoff = retentionCutoff(now, USED_GROUP_RETENTION_DAYS);

  const [empty, used] = await db.$transaction([
    db.group.deleteMany({
      where: {
        lastActivityAt: { lt: emptyCutoff },
        expenses: { none: {} },
        payments: { none: {} },
      },
    }),
    db.group.deleteMany({
      where: {
        lastActivityAt: { lt: usedCutoff },
        OR: [{ expenses: { some: {} } }, { payments: { some: {} } }],
      },
    }),
  ]);

  return { emptyDeleted: empty.count, usedDeleted: used.count };
}
