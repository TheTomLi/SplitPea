import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  formatStructuredMemberName,
  type Account,
  type GroupType,
  type Member,
  type Message,
} from "@splitpea/core";
import type {
  ExpenseProposal,
  SettlementProposal,
  StatementPeriodView,
} from "@splitpea/api-client";
import { api } from "./src/api";
import { KOFI_URL } from "./src/config";
import { inviteCodeFromInput } from "./src/invite";
import { loadGroups, removeGroup, saveGroup, type JoinedGroup } from "./src/storage";
import {
  BalancesPanel,
  ExpenseCard,
  ExpenseForm,
  type ExpenseFormInitial,
  HistoryPanel,
  MembersPanel,
  ProposalCard,
  SettleAllProposalCard,
  SettlementProposalCard,
  StatementPeriodCard,
} from "./src/panels";
import {
  Button,
  Chip,
  COLORS,
  MotionPresence,
  MotionText,
} from "./src/ui";

/** On web, read an invite code from the current shareable URL. */
function getInviteFromUrl(): string {
  try {
    const loc = (globalThis as unknown as { location?: Location }).location;
    if (!loc) return "";
    return inviteCodeFromInput(loc.href);
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
// Home: create a group, join by link, or reopen a previously joined group.
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
  const [supportError, setSupportError] = useState<string | null>(null);
  const [confirmLeaveCode, setConfirmLeaveCode] = useState<string | null>(null);

  // Create form
  const [groupName, setGroupName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [groupType, setGroupType] = useState<GroupType>("split");
  const [cardName, setCardName] = useState("");
  const [participantsText, setParticipantsText] = useState("");

  // Join form
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

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

  async function openKoFi() {
    if (!KOFI_URL) return;
    setSupportError(null);
    try {
      await Linking.openURL(KOFI_URL);
    } catch {
      setSupportError("Couldn't open Ko-fi. Please try again.");
    }
  }

  function handleFindGroup() {
    const code = inviteCodeFromInput(joinInput);
    if (!code) {
      setJoinError(
        "That doesn't look like a SplitPea invite link. Copy the full link and try again."
      );
      return;
    }

    setJoinError(null);
    onFind(code);
  }

  return (
    <ScrollView contentContainerStyle={styles.homeContainer}>
      <View style={styles.homeHero}>
        <View style={styles.brandLockup}>
          <Image
            accessibilityLabel="SplitPea logo"
            resizeMode="contain"
            source={require("./assets/splitpea-mark.png")}
            style={styles.brandMark}
          />
          <Text style={styles.wordmark}>SplitPea</Text>
        </View>
        <Text style={styles.title}>Shared expenses, sorted.</Text>
        <Text style={styles.subtitle}>
          Create a group, describe what you spent, and let SplitPea handle the math.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator style={{ marginVertical: 8 }} /> : null}

      {groups.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionEyebrow}>RECENT</Text>
          <Text style={styles.cardTitle}>Your groups</Text>
          {groups.map((g) => (
            <View key={g.inviteCode} style={styles.groupRowWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${g.groupName}`}
                style={({ pressed }) => [
                  styles.groupOpen,
                  pressed && styles.pressablePressed,
                ]}
                onPress={() => onOpen(g)}
              >
                <View style={styles.groupAvatar}>
                  <Text style={styles.groupAvatarText}>
                    {g.groupName.trim().slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupName}>{g.groupName}</Text>
                  <Text style={styles.groupMeta}>
                    {g.memberName} · {g.inviteCode}
                  </Text>
                </View>
                <Text style={styles.groupChevron}>›</Text>
              </Pressable>
              {confirmLeaveCode === g.inviteCode ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Pressable hitSlop={8} onPress={() => handleLeave(g)}>
                    <Text
                      style={[styles.leaveText, { color: COLORS.red, fontWeight: "700" }]}
                    >
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
        <Text style={styles.sectionEyebrow}>GET STARTED</Text>
        <Text style={styles.cardTitle}>Create a group</Text>
        <Text style={styles.cardDescription}>
          Choose how the group pays. You can invite everyone after creating it.
        </Text>
        <Text style={styles.fieldLabel}>Group name</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Group name"
          placeholder="e.g. Tokyo Trip"
          placeholderTextColor={COLORS.grayLight}
          value={groupName}
          onChangeText={setGroupName}
        />
        <Text style={styles.fieldLabel}>Your name</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Your name"
          placeholder="How others will see you"
          placeholderTextColor={COLORS.grayLight}
          value={creatorName}
          onChangeText={setCreatorName}
        />

        <Text style={styles.fieldLabel}>How are you paying?</Text>
        <View style={styles.typePicker}>
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
            accessibilityLabel="Shared card name"
            placeholder="Card name, e.g. Joint Visa"
            placeholderTextColor={COLORS.grayLight}
            value={cardName}
            onChangeText={setCardName}
          />
        )}

        <Text style={styles.fieldLabel}>Other people</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Other people"
          placeholder="Names separated by commas · optional"
          placeholderTextColor={COLORS.grayLight}
          value={participantsText}
          onChangeText={setParticipantsText}
        />

        <Button label="Create group" onPress={handleCreate} disabled={busy} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionEyebrow}>HAVE AN INVITE?</Text>
        <Text style={styles.cardTitle}>Join a group</Text>
        <Text style={styles.cardDescription}>Paste the complete SplitPea link you received.</Text>
        <Text style={styles.fieldLabel}>Invite link</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="SplitPea invite link"
          placeholder="https://getsplitpea.com/?g=..."
          placeholderTextColor={COLORS.grayLight}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={joinInput}
          onChangeText={(value) => {
            setJoinInput(value);
            if (joinError) setJoinError(null);
          }}
          onSubmitEditing={handleFindGroup}
          returnKeyType="go"
        />
        {joinError ? <Text style={styles.fieldError}>{joinError}</Text> : null}
        <Button
          label="Find group"
          disabled={!joinInput.trim()}
          onPress={handleFindGroup}
        />
      </View>

      {KOFI_URL ? (
        <View style={styles.supportFooter}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Support this project on Ko-fi"
            accessibilityHint="Opens Ko-fi in your browser"
            onPress={openKoFi}
            style={({ pressed }) => [
              styles.supportLink,
              pressed && styles.supportLinkPressed,
            ]}
          >
            <Text style={styles.supportLinkText}>
              Support this project on Ko-fi ☕ ↗
            </Text>
          </Pressable>
          {supportError ? (
            <Text style={styles.supportError}>{supportError}</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Join: look up a group from its invite, then pick who you are (or add a name).
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to home"
        onPress={onBack}
        style={({ pressed }) => [styles.joinBack, pressed && styles.pressablePressed]}
      >
        <Text style={styles.joinBackIcon}>‹</Text>
        <Text style={styles.joinBackText}>Back</Text>
      </Pressable>

      {loading ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {group && (
        <View style={styles.card}>
          <Text style={styles.sectionEyebrow}>YOU’RE INVITED</Text>
          <Text style={styles.cardTitle}>Join “{group.name}”</Text>
          <Text style={styles.cardDescription}>
            Choose your existing name, or add yourself as someone new.
          </Text>
          {members.length > 0 && (
            <>
              <Text style={styles.fieldLabel}>Who are you?</Text>
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
              <Text style={styles.fieldLabel}>Not listed?</Text>
            </>
          )}
          <TextInput
            style={styles.input}
            accessibilityLabel="Your name"
            placeholder="Enter your name"
            placeholderTextColor={COLORS.grayLight}
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
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overlay, setOverlay] = useState<
    null | "expense" | "balances" | "history" | "members"
  >(null);
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
  const [statementPeriod, setStatementPeriod] = useState<StatementPeriodView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editInitial, setEditInitial] = useState<ExpenseFormInitial | undefined>(undefined);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const composerRef = useRef<TextInput>(null);

  async function refresh() {
    try {
      const { messages } = await api.getMessages(group.inviteCode);
      setMessages(messages);
      setMessagesLoaded(true);
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
    } finally {
      setMetaLoaded(true);
    }
  }

  useEffect(() => {
    refresh();
    loadMeta();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.inviteCode]);

  const senderName =
    members.find((m) => m.id === group.memberId)?.name ?? group.memberName;
  const otherName = members.find((m) => m.id !== group.memberId)?.name;
  const senderLabel = formatStructuredMemberName(senderName);
  const otherLabel = otherName
    ? formatStructuredMemberName(otherName)
    : undefined;
  const examplePayer = otherLabel ?? senderLabel;
  const examplePeople = otherLabel
    ? `${senderLabel} and ${otherLabel}`
    : senderLabel;
  const structuredExamples = isJoint
    ? otherLabel
      ? [
          `${otherLabel} and I spent $30 on dinner, split 50/50`,
          `${otherLabel} and I spent $30 on dinner: $20 on me and $10 on ${otherLabel}`,
        ]
      : ["I spent $30 on dinner"]
    : [
        `$40 on dinner, paid by ${examplePayer}, for ${examplePeople}, split evenly`,
      ];
  const cardLabel = accounts[0]?.name ?? "The shared card";
  const composerPlaceholder = isJoint
    ? otherLabel
      ? `Try: ${otherLabel} and I spent $30…`
      : "Try: I spent $30 on dinner…"
    : `Try: $40 on dinner, paid by ${examplePayer}…`;
  const hasPendingAction = Boolean(
    proposal || settlement || settleAll || statementPeriod
  );

  async function handleSend() {
    const t = text.trim();
    if (!t) return;
    if (hasPendingAction) {
      setError("Confirm, edit, or cancel the pending action before sending another message.");
      return;
    }
    setText("");
    setSending(true);
    setError(null);
    try {
      const result = await api.postMessage(group.inviteCode, group.memberId, t);
      if (result.proposal) setProposal(result.proposal);
      if (result.settlementProposal) setSettlement(result.settlementProposal);
      if (result.settleAllProposal) setSettleAll(result.settleAllProposal);
      if (result.statementPeriod) setStatementPeriod(result.statementPeriod);
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
        createdVia: proposal.createdVia,
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

  async function confirmStatementPeriod() {
    if (!statementPeriod) return;
    setConfirming(true);
    setError(null);
    try {
      await api.settleStatementPeriod(
        group.inviteCode,
        statementPeriod.from,
        statementPeriod.to,
        statementPeriod
      );
      setStatementPeriod(null);
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to groups"
          onPress={onBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressablePressed]}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatTitle}>{group.groupName}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy group invite link"
            onPress={copyInvite}
            style={{ alignSelf: "flex-start" }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.chatMeta}>Invite code: {group.inviteCode} · </Text>
              <MotionText
                text={copied ? "Copied!" : "Copy link"}
                style={styles.chatCopyText}
              />
            </View>
          </Pressable>
          <Text style={styles.chatTrust}>
            Anyone with this link can access the group. Share it only with people you trust.
          </Text>
        </View>
      </View>

      <View style={styles.actionBar}>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={() => setOverlay("balances")}
        >
          <Text style={styles.actionText}>Balances</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={() => setOverlay("history")}
        >
          <Text style={styles.actionText}>History</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={() => setOverlay("members")}
        >
          <Text style={styles.actionText}>People</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnPrimary,
            pressed && styles.actionBtnPrimaryPressed,
          ]}
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
        ListEmptyComponent={
          messagesLoaded && metaLoaded ? (
            <View style={styles.emptyChat}>
              <Text style={styles.exampleEyebrow}>TRY AN EXPENSE</Text>
              {isJoint ? (
                <Text style={styles.examplePayerNote}>
                  {cardLabel} pays automatically. Say who spent and how to split it.
                </Text>
              ) : null}
              {structuredExamples.map((example) => (
                <Pressable
                  key={example}
                  accessibilityRole="button"
                  accessibilityLabel={`Use example expense: ${example}`}
                  accessibilityHint={
                    "Fills the message input so you can edit it. " +
                    "It will not send automatically."
                  }
                  onPress={() => {
                    setText(example);
                    composerRef.current?.focus();
                  }}
                  style={({ pressed }) => [
                    styles.exampleCard,
                    pressed && styles.exampleCardPressed,
                  ]}
                >
                  <Text style={styles.exampleFormula}>{example}</Text>
                  <Text style={styles.exampleHint}>Use this example</Text>
                </Pressable>
              ))}
              <Text style={styles.exampleTemplate}>
                {isJoint
                  ? "who spent · total · what · 50/50 or exact amounts"
                  : "amount · what · paid by whom · for whom · split evenly"}
              </Text>
            </View>
          ) : (
            <ActivityIndicator style={styles.emptyLoader} />
          )
        }
        ListFooterComponent={
          <MotionPresence
            visible={Boolean(proposal || settlement || settleAll || statementPeriod)}
            style={styles.pendingBubble}
          >
            <>
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
              {statementPeriod && (
                <StatementPeriodCard
                  period={statementPeriod}
                  busy={confirming}
                  onConfirm={confirmStatementPeriod}
                  onCancel={() => setStatementPeriod(null)}
                />
              )}
            </>
          </MotionPresence>
        }
      />

      <View style={styles.composer}>
        <TextInput
          ref={composerRef}
          accessibilityLabel="Expense message"
          style={styles.composerInput}
          placeholder={composerPlaceholder}
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!sending && !hasPendingAction}
          maxLength={200}
        />
        <Button
          label={hasPendingAction ? "Review above" : "Send"}
          onPress={handleSend}
          disabled={sending || hasPendingAction}
        />
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
      {overlay === "history" && (
        <HistoryPanel
          inviteCode={group.inviteCode}
          isJoint={isJoint}
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

// Display name for the assistant. The message role stays "host" internally.
const HOST_NAME = "SplitPea Agent";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  // Home
  homeContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 56,
    gap: 20,
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  homeHero: { gap: 10, paddingTop: 20, paddingBottom: 6 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 48, height: 28 },
  wordmark: {
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.25,
    fontWeight: "700",
    color: COLORS.ink,
  },
  title: {
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.1,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 10,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.gray,
    maxWidth: 560,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    gap: 12,
    shadowColor: "#17211C",
    shadowOpacity: 0.045,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  sectionEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    fontWeight: "800",
    color: COLORS.brand,
  },
  cardTitle: {
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.4,
    fontWeight: "700",
    color: COLORS.ink,
  },
  cardDescription: { fontSize: 14, lineHeight: 20, color: COLORS.gray },
  fieldLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: COLORS.ink,
    marginTop: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
  },
  groupRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  groupOpen: {
    flex: 1,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 6,
  },
  groupAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brandSoft,
  },
  groupAvatarText: { color: COLORS.brand, fontSize: 15, fontWeight: "800" },
  groupName: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: COLORS.ink },
  groupMeta: { fontSize: 13, lineHeight: 18, color: COLORS.gray },
  groupChevron: { color: COLORS.grayLight, fontSize: 26, lineHeight: 28 },
  leaveText: { fontSize: 13, fontWeight: "600", color: COLORS.gray },
  typePicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeHint: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.gray,
    backgroundColor: COLORS.brandFaint,
    borderRadius: 10,
    padding: 10,
  },
  error: { color: COLORS.red, fontSize: 14, lineHeight: 20, paddingHorizontal: 20 },
  fieldError: { color: COLORS.red, fontSize: 13, lineHeight: 18 },
  supportFooter: { alignItems: "center", gap: 2, marginTop: 2 },
  supportLink: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  supportLinkPressed: { opacity: 0.62, transform: [{ scale: 0.98 }] },
  supportLinkText: {
    color: COLORS.gray,
    fontSize: 13,
    fontWeight: "600",
  },
  supportError: { color: COLORS.red, fontSize: 12, textAlign: "center" },
  pressablePressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  joinBack: {
    alignSelf: "flex-start",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  joinBackIcon: { color: COLORS.brand, fontSize: 26, lineHeight: 28 },
  joinBackText: { color: COLORS.brand, fontSize: 15, fontWeight: "600" },

  // Chat
  chatRoot: { flex: 1, backgroundColor: COLORS.bg },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 44,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brandSoft,
  },
  backText: { color: COLORS.brand, fontSize: 28, fontWeight: "500", lineHeight: 30 },
  chatTitle: {
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.25,
    fontWeight: "700",
    color: COLORS.ink,
  },
  chatMeta: { fontSize: 12, lineHeight: 17, color: COLORS.gray },
  chatCopyText: {
    color: COLORS.brand,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  chatTrust: { fontSize: 11, lineHeight: 15, color: COLORS.grayLight, marginTop: 2 },
  actionBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  actionBtn: {
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 11,
    justifyContent: "center",
    backgroundColor: COLORS.brandFaint,
    borderWidth: 1,
    borderColor: COLORS.brandSoft,
  },
  actionBtnPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  actionBtnPrimary: {
    backgroundColor: COLORS.brand,
    borderColor: COLORS.brand,
    marginLeft: "auto",
  },
  actionBtnPrimaryPressed: {
    backgroundColor: COLORS.brandPressed,
    transform: [{ scale: 0.97 }],
  },
  actionText: { color: COLORS.brand, fontWeight: "600", fontSize: 13 },
  actionTextPrimary: { color: "#fff", fontWeight: "700", fontSize: 13 },
  messageList: { flex: 1 },
  emptyLoader: { marginTop: 36 },
  emptyChat: {
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 28,
    gap: 9,
  },
  examplePayerNote: { color: COLORS.gray, fontSize: 13, lineHeight: 19, textAlign: "center" },
  exampleEyebrow: {
    color: COLORS.brand,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  exampleCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    shadowColor: "#17211C",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  exampleCardPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  exampleFormula: { color: COLORS.ink, fontSize: 15, lineHeight: 22 },
  exampleHint: { color: COLORS.brand, fontSize: 12, fontWeight: "700" },
  exampleTemplate: { color: COLORS.gray, fontSize: 12, lineHeight: 17, textAlign: "center" },
  pendingBubble: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    gap: 2,
    marginTop: 8,
    paddingBottom: 4,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleMine: { backgroundColor: COLORS.brand, alignSelf: "flex-end" },
  bubbleOther: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: "flex-start",
  },
  bubbleHost: {
    backgroundColor: COLORS.brandFaint,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: COLORS.brandSoft,
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
    color: COLORS.green,
    marginBottom: 2,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, color: COLORS.ink },
  bubbleTextMine: { fontSize: 15, color: "#fff" },
  composer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    alignItems: "center",
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    minHeight: 46,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 21,
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
  },
});
