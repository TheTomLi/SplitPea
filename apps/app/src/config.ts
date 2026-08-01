// Base URL of the SplitPea server.
// - Local dev: defaults to localhost.
// - Production: set EXPO_PUBLIC_API_BASE_URL (Expo inlines EXPO_PUBLIC_* at build
//   time) to your deployed backend: https://api.getsplitpea.com
// - Physical device on your LAN: set it to your machine's IP, e.g.
//   http://192.168.1.20:4000
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

// Verified public support page. The environment variable can override it for a
// different deployment without requiring a source change.
const configuredKoFiUrl =
  process.env.EXPO_PUBLIC_KOFI_URL?.trim() ?? "https://ko-fi.com/splitpea";
export const KOFI_URL = /^https:\/\/(?:www\.)?ko-fi\.com\/\S+$/i.test(
  configuredKoFiUrl
)
  ? configuredKoFiUrl
  : null;
