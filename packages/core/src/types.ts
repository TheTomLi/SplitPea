// Shared domain types for SplitPea.
// Pure TypeScript — no framework or runtime dependencies — so these are reused
// verbatim by the server, the api-client, and the Expo (web + mobile) app.

/** How an expense is split across a beneficiary. */
export type SplitMode = "even" | "shares" | "percent" | "exact";

/**
 * The nature of a group, chosen at creation and never changed:
 * - "split": classic bill-splitting; everyone pays with their own money.
 * - "joint": a single shared card; every spend is charged to it and each member
 *   owes the card their share.
 */
export type GroupType = "split" | "joint";

/** Who sent a chat message. */
export type MessageRole = "user" | "host";

/** How an expense entry was produced (used for trust / analytics). */
export type CreatedVia = "manual" | "rules" | "llm";

export interface Group {
  id: string;
  name: string;
  type: GroupType;
  inviteCode: string;
  createdAt: string;
  lastActivityAt: string;
}

/** A person in a group. No account/login — identified by name per group. */
export interface Member {
  id: string;
  groupId: string;
  name: string;
}

/**
 * A payer that is not necessarily a person — e.g. "Joint Visa", "Alice's cash".
 * `paidByMemberId`, when set, is the member who actually settles this account's
 * real statement, enabling automatic settle-up for the shared-card scenario.
 */
export interface Account {
  id: string;
  groupId: string;
  name: string;
  paidByMemberId?: string | null;
}

/** One beneficiary allocation of an expense (who should bear the cost). */
export interface Split {
  id: string;
  expenseId: string;
  memberId: string;
  mode: SplitMode;
  value: number;
}

export interface Expense {
  id: string;
  groupId: string;
  amount: number;
  description: string;
  category?: string | null;
  date: string;
  /** Who fronted the money — a member OR an account (exactly one set). */
  paidByMemberId?: string | null;
  paidByAccountId?: string | null;
  createdVia: CreatedVia;
  createdAt: string;
  archivedAt?: string | null;
  splits?: Split[];
}

/** A repayment between people, or to the shared card when toMemberId is null. */
export interface Payment {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId?: string | null;
  amount: number;
  date?: string | null;
  statementFrom?: string | null;
  statementTo?: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  groupId: string;
  memberId?: string | null;
  role: MessageRole;
  text: string;
  /** Optional structured card the host renders instead of plain text. */
  cardType?: string | null;
  cardPayload?: string | null;
  createdAt: string;
}
