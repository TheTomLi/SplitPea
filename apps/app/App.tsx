import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Account, GroupType, Member, Message } from "@spliitai/core";
import type { ExpenseProposal, SettlementProposal } from "@spliitai/api-client";
import { api } from "./src/api";
import { loadGroups, removeGroup, saveGroup, type JoinedGroup } from "./src/storage";
import {
  BalancesPanel,
  ExpenseCard,
  ExpenseForm,
  type ExpenseFormInitial,
  MembersPanel,
  ProposalCard,
  SettleAllProposalCard,
  SettlementProposalCard,
} from "./src/panels";
import { Chip } from "./src/ui";

/** On web, read an invite code from the URL (?g=CODE) for shareable links. */
function getInviteFromUrl(): string {
  try {
    const loc = (globalThis as unknown as { location?: Location }).location;
    if (!loc) return "";
    return new URLSearchParams(loc.search).get("g") ?? "";
  } catch {
    return "";
  }
}

/** Build a shareable web link for a group (web only). */
function shareLinkFor(code: string): string {
  try {
    const loc = (globalThis as unknown as { location?: Location }).location;
    if (loc?.origin) return `${loc.origin}/?g=${code}`;
  } catch {
    /* ignore */
  }
  return `code ${code}`;
}

type Screen =
  | { name: "home" }
  | { name: "join"; code: string }
  | { name: "chat"; group: JoinedGroup };

export default function App() {
  // Opening an invite link (?g=CODE) goes straight to the join screen.
  const [screen, setScreen] = useState<Screen>(() => {
    const code = getInviteFromUrl();
    return code ? { name: "join", code } : { name: "home" };
  });

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {screen.name === "home" && (
        <HomeScreen
          onOpen={(group) => setScreen({ name: "chat", group })}
          onFind={(code) => setScreen({ name: "join", code })}
        />
      )}
      {screen.name === "join" && (
        <JoinScreen
          code={screen.code}
          onOpen={(group) => setScreen({ name: "chat", group })}
          onBack={() => setScreen({ name: "home" })}
        />
      )}
      {screen.name === "chat" && (
        <ChatScreen
          group={screen.group}
          onBack={() => setScreen({ name: "home" })}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Home: create a group, join by code, or reopen a previously joined group.
// ---------------------------------------------------------------------------

function HomeScreen({
  onOpen,
  onFind,
}: {
  onOpen: (g: JoinedGroup) => void;
  onFind: (code: string) => void;
}) {
  const [groups, setGroups] = useState<JoinedGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeaveCode, setConfirmLeaveCode] = useState<string | null>(null);

  // Create form
  const [groupName, setGroupName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [groupType, setGroupType] = useState<GroupType>("split");
  const [cardName, setCardName] = useState("");
  const [participantsText, setParticipantsText] = useState("");

  // Join form
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    setGroups(loadGroups());
  }, []);

  async function handleCreate() {
    if (!groupName.trim() || !creatorName.trim()) {
      setError("Enter a group name and your name.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const participants = participantsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const { group, member } = await api.createGroup(
        groupName.trim(),
        creatorName.trim(),
        groupType,
        groupType === "joint" ? cardName.trim() || "Shared card" : undefined,
        participants
      );
      const joined: JoinedGroup = {
        inviteCode: group.inviteCode,
        groupName: group.name,
        groupType: group.type,
        memberId: member.id,
        memberName: member.name,
      };
      saveGroup(joined);
      onOpen(joined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave(g: JoinedGroup) {
    setError(null);
    setConfirmLeaveCode(null);
    try {
      const { balances } = await api.getBalances(g.inviteCode);
      const mine = balances.find((b) => b.memberId === g.memberId);
      if (mine && Math.abs(mine.net) >= 0.005) {
        setError(
          `You can't leave "${g.groupName}" yet — ` +
            (mine.net < 0
              ? `you owe $${(-mine.net).toFixed(2)}.`
              : `you're owed $${mine.net.toFixed(2)}.`) +
            " Settle up first."
        );
        return;
      }
    } catch {
      // Group likely deleted on the server — allow leaving.
    }
    removeGroup(g.inviteCode);
    setGroups(loadGroups());
  }

  return (
    <ScrollView contentContainerStyle={styles.homeContainer}>
      <Text style={styles.title}>SpliitAI</Text>
      <Text style={styles.subtitle}>Split bills by chatting.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator style={{ marginVertical: 8 }} /> : null}

      {groups.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your groups</Text>
          {groups.map((g) => (
            <View key={g.inviteCode} style={styles.groupRowWrap}>
              <Pressable style={{ flex: 1 }} onPress={() => onOpen(g)}>
                <Text style={styles.groupName}>{g.groupName}</Text>
                <Text style={styles.groupMeta}>
                  as {g.memberName} · {g.inviteCode}
                </Text>
              </Pressable>
              {confirmLeaveCode === g.inviteCode ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Pressable hitSlop={8} onPress={() => handleLeave(g)}>
                    <Text style={[styles.leaveText, { color: "#dc2626", fontWeight: "700" }]}>
                      Leave?
                    </Text>
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => setConfirmLeaveCode(null)}>
                    <Text style={styles.leaveText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable hitSlop={8} onPress={() => setConfirmLeaveCode(g.inviteCode)}>
                  <Text style={styles.leaveText}>Leave</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create a group</Text>
        <TextInput
          style={styles.input}
          placeholder="Group name (e.g. Tokyo Trip)"
          value={groupName}
          onChangeText={setGroupName}
        />
        <TextInput
          style={styles.input}
          placeholder="Your name"
          value={creatorName}
          onChangeText={setCreatorName}
        />

        <Text style={styles.groupMeta}>Group type</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip
            label="Split bills"
            selected={groupType === "split"}
            onPress={() => setGroupType("split")}
          />
          <Chip
            label="Shared card"
            selected={groupType === "joint"}
            onPress={() => setGroupType("joint")}
          />
        </View>
        <Text style={styles.typeHint}>
          {groupType === "split"
            ? "Everyone pays with their own money; the app tracks who owes whom."
            : "One shared card; every spend is charged to it and each person owes the card their share."}
        </Text>
        {groupType === "joint" && (
          <TextInput
            style={styles.input}
            placeholder="Card name (e.g. Joint Visa)"
            value={cardName}
            onChangeText={setCardName}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Other participants (comma-separated, optional)"
          value={participantsText}
          onChangeText={setParticipantsText}
        />

        <Button label="Create" onPress={handleCreate} disabled={busy} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Join a group</Text>
        <TextInput
          style={styles.input}
          placeholder="Invite code"
          autoCapitalize="characters"
          value={joinCode}
          onChangeText={setJoinCode}
        />
        <Button
          label="Find group"
          disabled={!joinCode.trim()}
          onPress={() => onFind(joinCode.trim().toUpperCase())}
        />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Join: look up a group by code, then pick who you are (or add a new name).
// ---------------------------------------------------------------------------

function JoinScreen({
  code,
  onOpen,
  onBack,
}: {
  code: string;
  onOpen: (g: JoinedGroup) => void;
  onBack: () => void;
}) {
  const [group, setGroup] = useState<{ name: string; type: GroupType } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { group, members } = await api.getGroup(code);
        setGroup({ name: group.name, type: group.type });
        setMembers(members);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  async function joinAs(name: string) {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { group: g } = await api.getGroup(code);
      const { member } = await api.joinGroup(code, name.trim());
      const joined: JoinedGroup = {
        inviteCode: g.inviteCode,
        groupName: g.name,
        groupType: g.type,
        memberId: member.id,
        memberName: member.name,
      };
      saveGroup(joined);
      onOpen(joined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.homeContainer}>
      <Pressable onPress={onBack} style={{ marginTop: 24 }}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      {loading ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {group && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join “{group.name}”</Text>
          {members.length > 0 && (
            <>
              <Text style={styles.groupMeta}>Who are you?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {members.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.name}
                    selected={false}
                    onPress={() => joinAs(m.name)}
                  />
                ))}
              </View>
              <Text style={styles.typeHint}>…or join as a new person:</Text>
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Your name"
            value={newName}
            onChangeText={setNewName}
          />
          <Button
            label="Join as new"
            disabled={busy || !newName.trim()}
            onPress={() => joinAs(newName)}
          />
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Chat: view messages and send new ones (host replies for now are canned).
// ---------------------------------------------------------------------------

function ChatScreen({
  group,
  onBack,
}: {
  group: JoinedGroup;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overlay, setOverlay] = useState<null | "expense" | "balances" | "members">(null);
  const [copied, setCopied] = useState(false);
  const isJoint = group.groupType === "joint";

  async function copyInvite() {
    const link = shareLinkFor(group.inviteCode);
    try {
      const nav = (globalThis as unknown as { navigator?: Navigator }).navigator;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* clipboard unavailable */
    }
  }
  const [proposal, setProposal] = useState<ExpenseProposal | null>(null);
  const [settlement, setSettlement] = useState<SettlementProposal | null>(null);
  const [settleAll, setSettleAll] = useState<{ count: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editInitial, setEditInitial] = useState<ExpenseFormInitial | undefined>(undefined);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  async function refresh() {
    try {
      const { messages } = await api.getMessages(group.inviteCode);
      setMessages(messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadMeta() {
    try {
      const [g, a] = await Promise.all([
        api.getGroup(group.inviteCode),
        api.getAccounts(group.inviteCode),
      ]);
      setMembers(g.members);
      setAccounts(a.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    loadMeta();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.inviteCode]);

  async function handleSend() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setSending(true);
    setError(null);
    try {
      const result = await api.postMessage(group.inviteCode, group.memberId, t);
      if (result.proposal) setProposal(result.proposal);
      if (result.settlementProposal) setSettlement(result.settlementProposal);
      if (result.settleAllProposal) setSettleAll(result.settleAllProposal);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function confirmProposal() {
    if (!proposal) return;
    setConfirming(true);
    setError(null);
    try {
      await api.createExpense(group.inviteCode, {
        amount: proposal.amount,
        description: proposal.description,
        category: proposal.category ?? undefined,
        paidByMemberId: proposal.paidByMemberId ?? undefined,
        paidByAccountId: proposal.paidByAccountId ?? undefined,
        splits: proposal.splits,
        createdVia: "rules",
      });
      setProposal(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function confirmSettlement() {
    if (!settlement) return;
    setConfirming(true);
    setError(null);
    try {
      await api.createPayment(
        group.inviteCode,
        settlement.fromMemberId,
        settlement.toMemberId,
        settlement.amount
      );
      setSettlement(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function confirmSettleAll() {
    setConfirming(true);
    setError(null);
    try {
      await api.settleAll(group.inviteCode);
      setSettleAll(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  function editProposal() {
    if (!proposal) return;
    setEditInitial({
      amount: String(proposal.amount),
      description: proposal.description,
      payerKey: proposal.paidByMemberId
        ? `m:${proposal.paidByMemberId}`
        : `a:${proposal.paidByAccountId}`,
      splits: proposal.splits,
    });
    setProposal(null);
    setOverlay("expense");
  }

  return (
    <View style={styles.chatRoot}>
      <View style={styles.chatHeader}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatTitle}>{group.groupName}</Text>
          <Pressable onPress={copyInvite}>
            <Text style={styles.chatMeta}>
              Invite code: {group.inviteCode} ·{" "}
              <Text style={{ color: BLUE }}>{copied ? "Copied!" : "Copy link"}</Text>
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.actionBar}>
        <Pressable style={styles.actionBtn} onPress={() => setOverlay("balances")}>
          <Text style={styles.actionText}>Balances</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => setOverlay("members")}>
          <Text style={styles.actionText}>People</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={() => setOverlay("expense")}
        >
          <Text style={styles.actionTextPrimary}>＋ Expense</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        style={styles.messageList}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: true })
        }
        renderItem={({ item }) => <Bubble message={item} myId={group.memberId} />}
        ListFooterComponent={
          proposal || settlement || settleAll ? (
            <View style={styles.pendingBubble}>
              <Text style={styles.bubbleHostLabel}>{HOST_NAME}</Text>
              {proposal && (
                <ProposalCard
                  proposal={proposal}
                  busy={confirming}
                  onConfirm={confirmProposal}
                  onEdit={editProposal}
                  onCancel={() => setProposal(null)}
                />
              )}
              {settlement && (
                <SettlementProposalCard
                  proposal={settlement}
                  busy={confirming}
                  onConfirm={confirmSettlement}
                  onCancel={() => setSettlement(null)}
                />
              )}
              {settleAll && (
                <SettleAllProposalCard
                  count={settleAll.count}
                  busy={confirming}
                  onConfirm={confirmSettleAll}
                  onCancel={() => setSettleAll(null)}
                />
              )}
            </View>
          ) : null
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder={
            isJoint
              ? "e.g. I spent 40 on gas"
              : "e.g. paid 40 for dinner, split with Bob"
          }
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Button label="Send" onPress={handleSend} disabled={sending} />
      </View>

      {overlay === "expense" && (
        <ExpenseForm
          inviteCode={group.inviteCode}
          members={members}
          accounts={accounts}
          myMemberId={group.memberId}
          mode={group.groupType}
          cardAccountId={isJoint ? accounts[0]?.id : undefined}
          cardName={isJoint ? accounts[0]?.name : undefined}
          initial={editInitial}
          onClose={() => {
            setOverlay(null);
            setEditInitial(undefined);
          }}
          onDone={() => {
            setOverlay(null);
            setEditInitial(undefined);
            refresh();
          }}
        />
      )}
      {overlay === "members" && (
        <MembersPanel
          inviteCode={group.inviteCode}
          members={members}
          myMemberId={group.memberId}
          onChanged={loadMeta}
          onLeave={async () => {
            try {
              const { balances } = await api.getBalances(group.inviteCode);
              const mine = balances.find((b) => b.memberId === group.memberId);
              if (mine && Math.abs(mine.net) >= 0.005) {
                throw new Error(
                  "You can't leave yet — " +
                    (mine.net < 0
                      ? `you owe $${(-mine.net).toFixed(2)}.`
                      : `you're owed $${mine.net.toFixed(2)}.`) +
                    " Settle up first."
                );
              }
            } catch (e) {
              // Re-throw balance blocks; ignore fetch failures (group gone).
              if (e instanceof Error && e.message.startsWith("You can't leave")) throw e;
            }
            removeGroup(group.inviteCode);
            onBack();
          }}
          onDelete={() => {
            removeGroup(group.inviteCode);
            onBack();
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "balances" && (
        <BalancesPanel
          inviteCode={group.inviteCode}
          onClose={() => setOverlay(null)}
        />
      )}
    </View>
  );
}

function Bubble({ message, myId }: { message: Message; myId: string }) {
  const isHost = message.role === "host";
  const isMine = !isHost && message.memberId === myId;
  const isExpenseCard = isHost && message.cardType === "expense";
  return (
    <View
      style={[
        styles.bubble,
        isHost
          ? styles.bubbleHost
          : isMine
          ? styles.bubbleMine
          : styles.bubbleOther,
        isExpenseCard && styles.bubbleHostWide,
      ]}
    >
      {isHost ? <Text style={styles.bubbleHostLabel}>{HOST_NAME}</Text> : null}
      {isExpenseCard ? (
        <ExpenseCard payload={message.cardPayload ?? null} text={message.text} />
      ) : (
        <Text style={isMine ? styles.bubbleTextMine : styles.bubbleText}>
          {message.text}
        </Text>
      )}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const BLUE = "#2563eb";

// Display name for the assistant. The message role stays "host" internally.
const HOST_NAME = "Spliit Agent";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f3f4f6" },

  // Home
  homeContainer: {
    padding: 20,
    gap: 16,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 34, fontWeight: "800", color: "#111827", marginTop: 24 },
  subtitle: { fontSize: 16, color: "#6b7280", marginBottom: 8 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  groupRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  groupRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  groupName: { fontSize: 16, fontWeight: "600", color: "#111827" },
  groupMeta: { fontSize: 13, color: "#6b7280" },
  leaveText: { fontSize: 14, fontWeight: "600", color: "#6b7280" },
  typeHint: { fontSize: 12, color: "#6b7280", fontStyle: "italic" },
  error: { color: "#dc2626", fontSize: 14, paddingHorizontal: 20 },

  // Buttons
  button: {
    backgroundColor: BLUE,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Chat
  chatRoot: { flex: 1, backgroundColor: "#f3f4f6" },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    gap: 8,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  backText: { color: BLUE, fontSize: 26, fontWeight: "600", lineHeight: 28 },
  chatTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  chatMeta: { fontSize: 12, color: "#6b7280" },
  actionBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#eef2ff",
  },
  actionBtnPrimary: { backgroundColor: BLUE, marginLeft: "auto" },
  actionText: { color: BLUE, fontWeight: "600", fontSize: 13 },
  actionTextPrimary: { color: "#fff", fontWeight: "700", fontSize: 13 },
  messageList: { flex: 1 },
  pendingBubble: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    gap: 2,
    marginTop: 8,
    paddingBottom: 4,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bubbleMine: { backgroundColor: BLUE, alignSelf: "flex-end" },
  bubbleOther: { backgroundColor: "#fff", alignSelf: "flex-start" },
  bubbleHost: {
    backgroundColor: "#ecfdf5",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#a7f3d0",
  },
  // Expense cards are host messages too — same green host bubble, just wider so
  // the split breakdown has room.
  bubbleHostWide: {
    maxWidth: "94%",
    alignSelf: "flex-start",
  },
  bubbleHostLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
    marginBottom: 2,
  },
  bubbleText: { fontSize: 15, color: "#111827" },
  bubbleTextMine: { fontSize: 15, color: "#fff" },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    alignItems: "center",
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
  },
});
