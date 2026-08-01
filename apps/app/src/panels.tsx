import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Account, GroupType, Member, SplitMode } from "@spliitai/core";
import type {
  ExpenseProposal,
  MemberBalanceView,
  NewExpense,
  SettlementProposal,
  SettlementView,
  SplitInput,
} from "@spliitai/api-client";
import { api } from "./api";
import { Button, Chip, COLORS, u } from "./ui";

const money = (n: number) => `$${n.toFixed(2)}`;

export interface ExpenseFormInitial {
  amount?: string;
  description?: string;
  payerKey?: string;
  /** Full splits (mode + per-person value) — lets Edit preserve custom splits. */
  splits?: SplitInput[];
}

const SPLIT_MODE_LABELS: { mode: SplitMode; label: string }[] = [
  { mode: "even", label: "Evenly" },
  { mode: "exact", label: "By amount" },
  { mode: "percent", label: "By %" },
];

/** Shared bottom-sheet wrapper with a title and close button. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={u.overlay}>
      <View style={u.sheet}>
        <View style={u.sheetHeader}>
          <Text style={u.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ fontSize: 22, color: COLORS.gray }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function ExpenseForm({
  inviteCode,
  members,
  accounts,
  myMemberId,
  mode = "split",
  cardAccountId,
  cardName,
  initial,
  onDone,
  onClose,
}: {
  inviteCode: string;
  members: Member[];
  accounts: Account[];
  myMemberId: string;
  mode?: GroupType;
  cardAccountId?: string | null;
  cardName?: string | null;
  initial?: ExpenseFormInitial;
  onDone: () => void;
  onClose: () => void;
}) {
  const isJoint = mode === "joint";
  const defaultPayerKey = isJoint ? `a:${cardAccountId}` : `m:${myMemberId}`;
  const defaultSelected = isJoint ? [myMemberId] : members.map((m) => m.id);

  const initialSplits = initial?.splits;
  const initialMode: SplitMode =
    initialSplits && initialSplits.length > 0 ? initialSplits[0].mode : "even";

  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [payerKey, setPayerKey] = useState(initial?.payerKey ?? defaultPayerKey);
  const [splitMode, setSplitMode] = useState<SplitMode>(initialMode);
  const [selected, setSelected] = useState<string[]>(
    initialSplits && initialMode === "even"
      ? initialSplits.map((s) => s.memberId)
      : defaultSelected
  );
  // Per-person values for non-even modes (kept as strings for the inputs).
  const [values, setValues] = useState<Record<string, string>>(
    initialSplits && initialMode !== "even"
      ? Object.fromEntries(initialSplits.map((s) => [s.memberId, String(s.value)]))
      : {}
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  // Members with a positive value entered, for non-even modes.
  const valueEntries = members
    .map((m) => ({ id: m.id, v: Number(values[m.id]) }))
    .filter((e) => Number.isFinite(e.v) && e.v > 0);
  const valuesSum = valueEntries.reduce((a, e) => a + e.v, 0);
  // In "by amount" mode the total is the sum of the entered amounts.
  const amountShown =
    splitMode === "exact" ? (valuesSum > 0 ? valuesSum.toFixed(2) : "") : amount;

  async function submit() {
    if (!description.trim()) return setError("Enter a description.");

    let amt: number;
    let splits: SplitInput[];

    if (splitMode === "even") {
      if (selected.length === 0)
        return setError("Select at least one person to split with.");
      amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return setError("Enter a valid amount.");
      splits = selected.map((memberId) => ({ memberId, mode: "even", value: 1 }));
    } else {
      if (valueEntries.length === 0)
        return setError("Enter a value for at least one person.");
      if (splitMode === "exact") {
        amt = valuesSum;
        splits = valueEntries.map((e) => ({ memberId: e.id, mode: "exact", value: e.v }));
      } else {
        if (Math.abs(valuesSum - 100) > 0.01)
          return setError("Percentages must add up to 100%.");
        amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0) return setError("Enter a valid amount.");
        splits = valueEntries.map((e) => ({ memberId: e.id, mode: "percent", value: e.v }));
      }
    }

    const expense: NewExpense = {
      amount: amt,
      description: description.trim(),
      splits,
    };
    if (payerKey.startsWith("m:")) expense.paidByMemberId = payerKey.slice(2);
    else expense.paidByAccountId = payerKey.slice(2);

    setBusy(true);
    setError(null);
    try {
      await api.createExpense(inviteCode, expense);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={initial ? "Edit expense" : "Add expense"} onClose={onClose}>
      {error ? <Text style={u.error}>{error}</Text> : null}

      <Text style={u.label}>Amount ($)</Text>
      <TextInput
        style={[u.input, splitMode === "exact" && { backgroundColor: COLORS.bg, color: COLORS.gray }]}
        placeholder="40.00"
        keyboardType="decimal-pad"
        value={amountShown}
        onChangeText={setAmount}
        editable={splitMode !== "exact"}
      />
      {splitMode === "exact" ? (
        <Text style={u.muted}>Total is the sum of the amounts below.</Text>
      ) : null}

      <Text style={u.label}>Description</Text>
      <TextInput
        style={u.input}
        placeholder="dinner"
        value={description}
        onChangeText={setDescription}
      />

      {isJoint ? (
        <Text style={u.muted}>💳 Charged to {cardName ?? "the card"}</Text>
      ) : (
        <>
          <Text style={u.label}>Paid by</Text>
          <View style={u.chipRow}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                selected={payerKey === `m:${m.id}`}
                onPress={() => setPayerKey(`m:${m.id}`)}
              />
            ))}
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={`${a.name} 💳`}
                selected={payerKey === `a:${a.id}`}
                onPress={() => setPayerKey(`a:${a.id}`)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={u.label}>{isJoint ? "How to split (who owes)" : "How to split"}</Text>
      <View style={u.chipRow}>
        {SPLIT_MODE_LABELS.map((s) => (
          <Chip
            key={s.mode}
            label={s.label}
            selected={splitMode === s.mode}
            onPress={() => setSplitMode(s.mode)}
          />
        ))}
      </View>

      {splitMode === "even" ? (
        <>
          <Text style={u.muted}>{isJoint ? "Who spent this?" : "Between"}</Text>
          <View style={u.chipRow}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                selected={selected.includes(m.id)}
                onPress={() => toggle(m.id)}
              />
            ))}
          </View>
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={u.muted}>
            {splitMode === "exact"
              ? "Dollar amount per person (leave blank to exclude)"
              : "Percentage per person (must total 100%)"}
          </Text>
          {members.map((m) => (
            <View
              key={m.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Text style={{ flex: 1, fontSize: 15, color: COLORS.ink }}>{m.name}</Text>
              <TextInput
                style={[u.input, { width: 110 }]}
                keyboardType="decimal-pad"
                placeholder={splitMode === "exact" ? "$0.00" : "0%"}
                value={values[m.id] ?? ""}
                onChangeText={(t) => setValues((v) => ({ ...v, [m.id]: t }))}
              />
            </View>
          ))}
          {splitMode === "percent" ? (
            <Text style={u.muted}>Total: {valuesSum}%</Text>
          ) : null}
        </View>
      )}

      {busy ? (
        <ActivityIndicator />
      ) : (
        <Button label={initial ? "Save expense" : "Add expense"} onPress={submit} disabled={busy} />
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function AccountsPanel({
  inviteCode,
  members,
  accounts,
  onChanged,
  onClose,
}: {
  inviteCode: string;
  members: Member[];
  accounts: Account[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerName = (id?: string | null) =>
    id ? members.find((m) => m.id === id)?.name ?? "?" : null;

  async function add() {
    if (!name.trim()) return setError("Enter an account name.");
    setBusy(true);
    setError(null);
    try {
      await api.createAccount(inviteCode, name.trim(), ownerId ?? undefined);
      setName("");
      setOwnerId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Accounts (cards)" onClose={onClose}>
      <Text style={u.muted}>
        An account is a payer that isn't a person — like a shared card. Set who
        settles its statement so balances work out automatically.
      </Text>

      {accounts.length > 0 && (
        <View style={u.card}>
          {accounts.map((a) => (
            <Text key={a.id} style={{ fontSize: 15, color: COLORS.ink }}>
              💳 {a.name}
              {ownerName(a.paidByMemberId)
                ? ` · settled by ${ownerName(a.paidByMemberId)}`
                : " · no owner"}
            </Text>
          ))}
        </View>
      )}

      {error ? <Text style={u.error}>{error}</Text> : null}
      <Text style={u.label}>New account name</Text>
      <TextInput
        style={u.input}
        placeholder="Joint Visa"
        value={name}
        onChangeText={setName}
      />
      <Text style={u.label}>Settled by (optional)</Text>
      <View style={u.chipRow}>
        <Chip label="No owner" selected={ownerId === null} onPress={() => setOwnerId(null)} />
        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.name}
            selected={ownerId === m.id}
            onPress={() => setOwnerId(m.id)}
          />
        ))}
      </View>
      <Button label="Add account" onPress={add} disabled={busy} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function MembersPanel({
  inviteCode,
  members,
  myMemberId,
  onChanged,
  onLeave,
  onDelete,
  onClose,
}: {
  inviteCode: string;
  members: Member[];
  myMemberId: string;
  onChanged: () => void | Promise<void>;
  onLeave: () => void;
  onDelete: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Leave/delete navigate away on success, so they don't call onChanged.
  const runExit = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="People" onClose={onClose}>
      {error ? <Text style={u.error}>{error}</Text> : null}

      <View style={u.card}>
        {members.map((m) => {
          const draft = drafts[m.id] ?? m.name;
          const changed = draft.trim() && draft.trim() !== m.name;
          return (
            <View key={m.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                style={[u.input, { flex: 1 }]}
                value={draft}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [m.id]: t }))}
              />
              {changed ? (
                <Button
                  label="Save"
                  onPress={() => run(() => api.renameMember(inviteCode, m.id, draft.trim()))}
                  disabled={busy}
                />
              ) : null}
              <Pressable
                onPress={() =>
                  m.id === myMemberId
                    ? setConfirmLeave(true)
                    : run(() => api.removeMember(inviteCode, m.id))
                }
                hitSlop={8}
              >
                <Text style={{ fontSize: 20, color: COLORS.red }}>✕</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text style={u.label}>Add a person</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          style={[u.input, { flex: 1 }]}
          placeholder="Name"
          value={newName}
          onChangeText={setNewName}
        />
        <Button
          label="Add"
          disabled={busy || !newName.trim()}
          onPress={() =>
            run(async () => {
              await api.addMember(inviteCode, newName.trim());
              setNewName("");
            })
          }
        />
      </View>

      <View style={{ marginTop: 8, gap: 10 }}>
        {confirmLeave ? (
          <View style={{ gap: 8 }}>
            <Text style={u.muted}>
              Leave this group on this device? You can rejoin later with the invite code.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={busy ? "Leaving…" : "Yes, leave"}
                  disabled={busy}
                  onPress={() => runExit(onLeave)}
                />
              </View>
              <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => setConfirmLeave(false)} />
            </View>
          </View>
        ) : (
          <Button
            label="Leave group (this device)"
            variant="secondary"
            disabled={busy}
            onPress={() => setConfirmLeave(true)}
          />
        )}
        {confirmDelete ? (
          <View style={{ gap: 8 }}>
            <Text style={u.error}>
              Delete this group and all its data for everyone? This can't be undone.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={busy ? "Deleting…" : "Yes, delete"}
                  disabled={busy}
                  onPress={() =>
                    runExit(async () => {
                      await api.deleteGroup(inviteCode);
                      onDelete();
                    })
                  }
                />
              </View>
              <Button label="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setConfirmDelete(true)} hitSlop={6}>
            <Text style={{ color: COLORS.red, fontWeight: "600", textAlign: "center" }}>
              Delete group for everyone
            </Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function BalancesPanel({
  inviteCode,
  onClose,
}: {
  inviteCode: string;
  onClose: () => void;
}) {
  const [balances, setBalances] = useState<MemberBalanceView[]>([]);
  const [settlements, setSettlements] = useState<SettlementView[]>([]);
  const [isJoint, setIsJoint] = useState(false);
  const [cardName, setCardName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [settling, setSettling] = useState(false);

  async function load() {
    try {
      const r = await api.getBalances(inviteCode);
      setBalances(r.balances);
      setSettlements(r.settlements);
      setIsJoint(r.groupType === "joint");
      setCardName(r.cardName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  async function settleAll() {
    setSettling(true);
    setError(null);
    try {
      await api.settleAll(inviteCode);
      setConfirmAll(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }

  // In joint mode, outstanding to the card = owed - paid = -net.
  const cardTotal = balances.reduce((sum, b) => sum + Math.max(0, -b.net), 0);
  const hasOutstanding = isJoint ? cardTotal > 0.005 : settlements.length > 0;

  return (
    <Sheet title="Balances" onClose={onClose}>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text style={u.error}>{error}</Text> : null}

      {/* Joint (shared-card) view: each person owes the card. */}
      {!loading && isJoint && (
        <>
          <Text style={u.cardTitle}>{cardName ?? "Shared card"} — who owes what</Text>
          <View style={u.card}>
            {balances.map((b) => (
              <View
                key={b.memberId}
                style={{ flexDirection: "row", justifyContent: "space-between" }}
              >
                <Text style={{ fontSize: 15, color: COLORS.ink }}>{b.name}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.ink }}>
                  {money(Math.max(0, -b.net))}
                </Text>
              </View>
            ))}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                borderTopWidth: 1,
                borderTopColor: "#e5e7eb",
                paddingTop: 8,
                marginTop: 4,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "800", color: COLORS.ink }}>
                Total outstanding
              </Text>
              <Text style={{ fontSize: 15, fontWeight: "800", color: COLORS.green }}>
                {money(cardTotal)}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Split-bills view: net balances + settle-up. */}
      {!loading && !isJoint && (
        <>
          <View style={u.card}>
            {balances.map((b) => (
              <View
                key={b.memberId}
                style={{ flexDirection: "row", justifyContent: "space-between" }}
              >
                <Text style={{ fontSize: 15, color: COLORS.ink }}>{b.name}</Text>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: b.net > 0.005 ? COLORS.green : b.net < -0.005 ? COLORS.red : COLORS.gray,
                  }}
                >
                  {b.net > 0.005
                    ? `is owed ${money(b.net)}`
                    : b.net < -0.005
                    ? `owes ${money(-b.net)}`
                    : money(0)}
                </Text>
              </View>
            ))}
          </View>

          <Text style={u.cardTitle}>Settle up</Text>
          {settlements.length === 0 ? (
            <Text style={u.muted}>Everyone's even. 🎉</Text>
          ) : (
            <View style={u.card}>
              {settlements.map((s, i) => (
                <Text key={i} style={{ fontSize: 15, color: COLORS.ink }}>
                  {s.fromName} → {s.toName}:{" "}
                  <Text style={{ fontWeight: "700" }}>{money(s.amount)}</Text>
                </Text>
              ))}
            </View>
          )}
        </>
      )}

      {!loading && hasOutstanding && (
        <View style={{ marginTop: 4, gap: 8 }}>
          {confirmAll ? (
            <>
              <Text style={u.muted}>
                Record all payments and reset everyone to $0?
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={settling ? "Settling…" : "Yes, settle everyone"}
                    onPress={settleAll}
                    disabled={settling}
                  />
                </View>
                <Button label="Cancel" variant="secondary" onPress={() => setConfirmAll(false)} />
              </View>
            </>
          ) : (
            <Button
              label="Settle everyone up"
              variant="secondary"
              onPress={() => setConfirmAll(true)}
            />
          )}
        </View>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export function ExpenseCard({ payload, text }: { payload: string | null; text: string }) {
  let parsed: {
    amount: number;
    description: string;
    payerLabel: string;
    forLabel?: string;
    splitMembers: string[];
    splitBreakdown?: { name: string; amount: number }[];
  } | null = null;
  try {
    if (payload) parsed = JSON.parse(payload);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return <Text style={{ fontSize: 15, color: COLORS.ink }}>{text}</Text>;
  }

  const breakdown = parsed.splitBreakdown;
  const forLabel = parsed.forLabel ?? parsed.splitMembers.join(", ");

  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.ink }}>
          {parsed.description}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: "800", color: COLORS.green }}>
          {money(parsed.amount)}
        </Text>
      </View>
      <Text style={u.muted}>
        Paid by {parsed.payerLabel}
        {forLabel ? ` for ${forLabel}` : ""}
      </Text>
      {breakdown && breakdown.length > 0 ? (
        <View style={{ marginTop: 2 }}>
          {breakdown.map((b, i) => (
            <Text key={i} style={{ fontSize: 13, color: COLORS.ink }}>
              {b.name}: <Text style={{ fontWeight: "700" }}>{money(b.amount)}</Text>
            </Text>
          ))}
        </View>
      ) : (
        <Text style={u.muted}>Split: {parsed.splitMembers.join(", ")}</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

/** The host's confirmation card for a parsed-but-not-yet-committed expense. */
export function ProposalCard({
  proposal,
  busy,
  onConfirm,
  onEdit,
  onCancel,
}: {
  proposal: ExpenseProposal;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={pc.wrap}>
      <Text style={pc.label}>Add this expense?</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.ink }}>
          {proposal.description}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: "800", color: COLORS.green }}>
          {money(proposal.amount)}
        </Text>
      </View>
      <Text style={u.muted}>
        Paid by {proposal.payerLabel}
        {proposal.forLabel ? ` for ${proposal.forLabel}` : ""}
      </Text>
      <View style={{ marginTop: 2 }}>
        <Text style={u.muted}>Split:</Text>
        {proposal.splitBreakdown.map((b, i) => (
          <Text key={i} style={{ fontSize: 13, color: COLORS.ink }}>
            {"  "}
            {b.name}: <Text style={{ fontWeight: "700" }}>{money(b.amount)}</Text>
          </Text>
        ))}
      </View>
      {proposal.notice ? <Text style={pc.notice}>⚠️ {proposal.notice}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <Button label={busy ? "Adding…" : "Confirm"} onPress={onConfirm} disabled={busy} />
        </View>
        <Button label="Edit" variant="secondary" onPress={onEdit} disabled={busy} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

const pc = {
  wrap: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderLeftWidth: 4,
    borderLeftColor: COLORS.blue,
    padding: 12,
    gap: 4,
  },
  label: { fontSize: 12, fontWeight: "700" as const, color: COLORS.blue },
  notice: { fontSize: 13, color: "#b45309", marginTop: 4 },
};

/** Confirmation card for "settle everyone up" (resets all balances to $0). */
export function SettleAllProposalCard({
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={pc.wrap}>
      <Text style={pc.label}>Settle everyone up?</Text>
      <Text style={{ fontSize: 15, color: COLORS.ink }}>
        This records {count} payment{count === 1 ? "" : "s"} and resets all
        balances to $0.
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <Button label={busy ? "Settling…" : "Confirm"} onPress={onConfirm} disabled={busy} />
        </View>
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

/** The host's confirmation card for a parsed settlement/repayment. */
export function SettlementProposalCard({
  proposal,
  busy,
  onConfirm,
  onCancel,
}: {
  proposal: SettlementProposal;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={pc.wrap}>
      <Text style={pc.label}>Record this payment?</Text>
      <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.ink }}>
        💸 {proposal.fromName} paid {proposal.toLabel} {money(proposal.amount)}
      </Text>
      {proposal.notice ? <Text style={pc.notice}>⚠️ {proposal.notice}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <Button label={busy ? "Recording…" : "Confirm"} onPress={onConfirm} disabled={busy} />
        </View>
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}
