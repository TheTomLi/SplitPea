// Remembers which groups this device has joined (and under what name), so the
// user doesn't re-enter details every visit — the no-login equivalent of a
// session. For M0 (web) this uses localStorage; native gets AsyncStorage later.

import type { GroupType } from "@spliitai/core";

export interface JoinedGroup {
  inviteCode: string;
  groupName: string;
  groupType: GroupType;
  memberId: string;
  memberName: string;
}

const KEY = "spliitai.joinedGroups";

function getLocalStorage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadGroups(): JoinedGroup[] {
  const ls = getLocalStorage();
  if (!ls) return [];
  try {
    return JSON.parse(ls.getItem(KEY) ?? "[]") as JoinedGroup[];
  } catch {
    return [];
  }
}

export function saveGroup(group: JoinedGroup): void {
  const ls = getLocalStorage();
  if (!ls) return;
  const all = loadGroups().filter((g) => g.inviteCode !== group.inviteCode);
  all.unshift(group);
  ls.setItem(KEY, JSON.stringify(all));
}

/** Forget a group on this device (does not delete it on the server). */
export function removeGroup(inviteCode: string): void {
  const ls = getLocalStorage();
  if (!ls) return;
  ls.setItem(
    KEY,
    JSON.stringify(loadGroups().filter((g) => g.inviteCode !== inviteCode))
  );
}
