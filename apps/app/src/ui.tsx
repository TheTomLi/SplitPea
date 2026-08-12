// Shared UI primitives and styles used across screens and panels.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);
export const USE_NATIVE_DRIVER = Platform.OS !== "web";

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/** Tactile touch-down feedback shared by buttons and selectable chips. */
function PressMotion({
  children,
  disabled,
  pressedScale = 0.98,
}: {
  children: (handlers: {
    onPressIn: () => void;
    onPressOut: () => void;
  }) => ReactNode;
  disabled?: boolean;
  pressedScale?: number;
}) {
  const reduceMotion = useReduceMotion();
  const value = useRef(new Animated.Value(1)).current;

  function animate(toValue: number, duration: number) {
    if (disabled) return;
    value.stopAnimation();
    Animated.timing(value, {
      toValue,
      duration,
      easing: EASE_OUT,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }

  return (
    <Animated.View
      style={
        reduceMotion
          ? {
              opacity: value.interpolate({
                inputRange: [pressedScale, 1],
                outputRange: [0.82, 1],
              }),
            }
          : { transform: [{ scale: value }] }
      }
    >
      {children({
        onPressIn: () => animate(pressedScale, 100),
        onPressOut: () => animate(1, 140),
      })}
    </Animated.View>
  );
}

/** A subtle, reduced-motion-aware entrance for occasional state changes. */
export function MotionReveal({
  children,
  offset = 8,
  duration = 180,
  style,
}: {
  children: ReactNode;
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 140 : duration,
      easing: EASE_OUT,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [duration, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: reduceMotion
                ? 0
                : progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [offset, 0],
                  }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Keep occasional content mounted long enough to leave along its entry path. */
export function MotionPresence({
  children,
  visible,
  offset = 8,
  style,
}: {
  children: ReactNode;
  visible: boolean;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const lastChildren = useRef(children);
  const [rendered, setRendered] = useState(visible);
  if (children != null) lastChildren.current = children;

  useEffect(() => {
    progress.stopAnimation();
    if (visible) {
      setRendered(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduceMotion ? 140 : 180,
        easing: EASE_OUT,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
      return;
    }
    if (!rendered) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 140,
      easing: EASE_OUT,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [progress, reduceMotion, visible]);

  if (!rendered) return null;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          pointerEvents: visible ? "auto" : "none",
          transform: [
            {
              translateY: reduceMotion
                ? 0
                : progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [offset, 0],
                  }),
            },
          ],
        },
      ]}
    >
      {lastChildren.current}
    </Animated.View>
  );
}

/** Crossfade a compact label without moving the surrounding layout. */
export function MotionText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [rendered, setRendered] = useState(text);
  const previousText = useRef(text);

  useEffect(() => {
    if (previousText.current === text) return;
    opacity.stopAnimation();
    Animated.timing(opacity, {
      toValue: 0,
      duration: 70,
      easing: EASE_OUT,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (!finished) return;
      previousText.current = text;
      setRendered(text);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 70,
        easing: EASE_OUT,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    });
  }, [opacity, text]);

  return <Animated.Text style={[style, { opacity }]}>{rendered}</Animated.Text>;
}

export const COLORS = {
  blue: "#2563eb",
  brand: "#176B4D",
  brandPressed: "#10543B",
  brandSoft: "#E7F4ED",
  brandFaint: "#F3FAF6",
  green: "#167A55",
  red: "#C93636",
  ink: "#17211C",
  gray: "#66736C",
  grayLight: "#8A9690",
  border: "#DCE4DF",
  borderStrong: "#C8D2CC",
  bg: "#F4F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#F0F3F1",
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
    <PressMotion disabled={disabled}>
      {({ onPressIn, onPressOut }) => (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
          style={[
            u.btn,
            variant === "secondary" ? u.btnSecondary : u.btnPrimary,
            disabled && u.btnDisabled,
          ]}
        >
          <Text
            style={variant === "secondary" ? u.btnTextSecondary : u.btnTextPrimary}
          >
            {label}
          </Text>
        </Pressable>
      )}
    </PressMotion>
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
    <PressMotion>
      {({ onPressIn, onPressOut }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={[u.chip, selected ? u.chipOn : u.chipOff]}
        >
          <Text style={selected ? u.chipTextOn : u.chipTextOff}>{label}</Text>
        </Pressable>
      )}
    </PressMotion>
  );
}

export const u = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 12,
    shadowColor: "#17211C",
    shadowOpacity: 0.045,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.2,
    fontWeight: "700",
    color: COLORS.ink,
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: COLORS.gray },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
  },
  error: { color: COLORS.red, fontSize: 14, lineHeight: 20 },
  muted: { color: COLORS.gray, fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  btn: {
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: COLORS.brand },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnDisabled: { opacity: 0.42 },
  btnTextPrimary: { color: "#fff", fontWeight: "700", fontSize: 15, lineHeight: 20 },
  btnTextSecondary: { color: COLORS.ink, fontWeight: "600", fontSize: 15, lineHeight: 20 },

  chip: {
    borderRadius: 12,
    minHeight: 40,
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderWidth: 1,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipOff: { backgroundColor: COLORS.surface, borderColor: COLORS.borderStrong },
  chipTextOn: { color: "#fff", fontWeight: "600" },
  chipTextOff: { color: COLORS.ink },

  // Overlay used by the panels (add expense / balances / accounts).
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    justifyContent: "flex-end",
  },
  overlayScrim: { backgroundColor: "rgba(17, 27, 22, 0.38)" },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(255,255,255,0.72)",
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 16,
    maxHeight: "90%",
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -8 },
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    fontWeight: "700",
    color: COLORS.ink,
  },
});
