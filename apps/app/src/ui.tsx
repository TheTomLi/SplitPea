// Shared UI primitives and styles used across screens and panels.
import { Pressable, StyleSheet, Text } from "react-native";

export const COLORS = {
  blue: "#2563eb",
  green: "#059669",
  red: "#dc2626",
  ink: "#111827",
  gray: "#6b7280",
  border: "#d1d5db",
  bg: "#f3f4f6",
};

export function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        u.btn,
        variant === "secondary" ? u.btnSecondary : u.btnPrimary,
        disabled && u.btnDisabled,
      ]}
    >
      <Text style={variant === "secondary" ? u.btnTextSecondary : u.btnTextPrimary}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[u.chip, selected ? u.chipOn : u.chipOff]}
    >
      <Text style={selected ? u.chipTextOn : u.chipTextOff}>{label}</Text>
    </Pressable>
  );
}

export const u = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: COLORS.ink },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.gray },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  error: { color: COLORS.red, fontSize: 14 },
  muted: { color: COLORS.gray, fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: COLORS.blue },
  btnSecondary: { backgroundColor: "#e5e7eb" },
  btnDisabled: { opacity: 0.5 },
  btnTextPrimary: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnTextSecondary: { color: COLORS.ink, fontWeight: "700", fontSize: 15 },

  chip: {
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipOn: { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  chipOff: { backgroundColor: "#fff", borderColor: COLORS.border },
  chipTextOn: { color: "#fff", fontWeight: "600" },
  chipTextOff: { color: COLORS.ink },

  // Overlay used by the panels (add expense / balances / accounts).
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 14,
    maxHeight: "88%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: COLORS.ink },
});
