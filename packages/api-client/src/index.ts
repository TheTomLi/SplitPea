import type {
  Account,
  Expense,
  Group,
  GroupType,
  Member,
  Message,
  SplitMode,
} from "@spliitai/core";

export interface SplitInput {
  memberId: string;
  mode: SplitMode;
  value: number;
}

export interface NewExpense {
  amount: number;
  description: string;
  category?: string;
  paidByMemberId?: string;
  paidByAccountId?: string;
  splits: SplitInput[];
  createdVia?: "manual" | "rules" | "llm";
}

export interface MemberBalanceView {
  memberId: string;
  name: string;
  paid: number;
  owed: number;
  net: number;
}

export interface SettlementView {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  toName: string;
}

/** An ephemeral, not-yet-committed expense the host parsed from a message. */
export interface ExpenseProposal {
  amount: number;
  description: string;
  category?: string | null;
  paidByMemberId?: string | null;
  paidByAccountId?: string | null;
  payerLabel: string;
  /** Who the expense is for: "everyone" (all members) or a names list. */
  forLabel: string;
  splits: SplitInput[];
  splitMemberNames: string[];
  /** Per-person amounts (what each person owes for this expense). */
  splitBreakdown: { name: string; amount: number }[];
  /** Optional host heads-up (e.g. a referenced person isn't in the group). */
  notice?: string;
}

/** An ephemeral, not-yet-committed settlement the host parsed from a message. */
export interface SettlementProposal {
  fromMemberId: string;
  fromName: string;
  toMemberId: string | null;
  toLabel: string;
  amount: number;
  /** Optional host heads-up (e.g. a referenced person isn't in the group). */
  notice?: string;
}

export interface PostMessageResult {
  userMessage: Message;
  hostMessage?: Message;
  proposal?: ExpenseProposal;
  settlementProposal?: SettlementProposal;
  settleAllProposal?: { count: number };
}

// Typed client for the SpliitAI server. Uses the global `fetch`, which exists
// in the browser, React Native, and Node 18+, so this file is reused unchanged
// across web, mobile, and server-side tests.

export interface ApiClientOptions {
  /** Base URL of the server, e.g. "http://localhost:4000". */
  baseUrl: string;
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore non-JSON error bodies */
    }
    // Surface the server's human-readable message directly; only fall back to a
    // generic message when there isn't one (never leak "API 409:" to the user).
    const message = detail || res.statusText || `Something went wrong (${res.status}).`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function createApiClient({ baseUrl }: ApiClientOptions) {
  return {
    health: () => request<{ ok: boolean }>(baseUrl, "/api/health"),

    createGroup: (
      name: string,
      creatorName: string,
      type: GroupType = "split",
      cardName?: string,
      participants?: string[]
    ) =>
      request<{ group: Group; member: Member }>(baseUrl, "/api/groups", {
        method: "POST",
        body: JSON.stringify({ name, creatorName, type, cardName, participants }),
      }),

    addMember: (inviteCode: string, name: string) =>
      request<{ member: Member }>(baseUrl, `/api/groups/${inviteCode}/members`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),

    renameMember: (inviteCode: string, memberId: string, name: string) =>
      request<{ member: Member }>(
        baseUrl,
        `/api/groups/${inviteCode}/members/${memberId}`,
        { method: "PATCH", body: JSON.stringify({ name }) }
      ),

    removeMember: (inviteCode: string, memberId: string) =>
      request<{ ok: boolean }>(
        baseUrl,
        `/api/groups/${inviteCode}/members/${memberId}`,
        { method: "DELETE" }
      ),

    getGroup: (inviteCode: string) =>
      request<{ group: Group; members: Member[] }>(
        baseUrl,
        `/api/groups/${inviteCode}`
      ),

    deleteGroup: (inviteCode: string) =>
      request<{ ok: boolean }>(baseUrl, `/api/groups/${inviteCode}`, {
        method: "DELETE",
      }),

    joinGroup: (inviteCode: string, name: string) =>
      request<{ member: Member }>(
        baseUrl,
        `/api/groups/${inviteCode}/join`,
        { method: "POST", body: JSON.stringify({ name }) }
      ),

    getMessages: (inviteCode: string) =>
      request<{ messages: Message[] }>(
        baseUrl,
        `/api/groups/${inviteCode}/messages`
      ),

    postMessage: (inviteCode: string, memberId: string, text: string) =>
      request<PostMessageResult>(
        baseUrl,
        `/api/groups/${inviteCode}/messages`,
        { method: "POST", body: JSON.stringify({ memberId, text }) }
      ),

    getAccounts: (inviteCode: string) =>
      request<{ accounts: Account[] }>(
        baseUrl,
        `/api/groups/${inviteCode}/accounts`
      ),

    createAccount: (inviteCode: string, name: string, paidByMemberId?: string) =>
      request<{ account: Account }>(
        baseUrl,
        `/api/groups/${inviteCode}/accounts`,
        { method: "POST", body: JSON.stringify({ name, paidByMemberId }) }
      ),

    getExpenses: (inviteCode: string) =>
      request<{ expenses: Expense[] }>(
        baseUrl,
        `/api/groups/${inviteCode}/expenses`
      ),

    createExpense: (inviteCode: string, expense: NewExpense) =>
      request<{ expense: Expense; hostMessage: Message }>(
        baseUrl,
        `/api/groups/${inviteCode}/expenses`,
        { method: "POST", body: JSON.stringify(expense) }
      ),

    createPayment: (
      inviteCode: string,
      fromMemberId: string,
      toMemberId: string | null,
      amount: number
    ) =>
      request<{ hostMessage: Message }>(
        baseUrl,
        `/api/groups/${inviteCode}/payments`,
        { method: "POST", body: JSON.stringify({ fromMemberId, toMemberId, amount }) }
      ),

    settleAll: (inviteCode: string) =>
      request<{ ok: boolean; count: number }>(
        baseUrl,
        `/api/groups/${inviteCode}/settle-all`,
        { method: "POST" }
      ),

    getBalances: (inviteCode: string) =>
      request<{
        balances: MemberBalanceView[];
        settlements: SettlementView[];
        groupType: GroupType;
        cardName: string | null;
      }>(baseUrl, `/api/groups/${inviteCode}/balances`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
