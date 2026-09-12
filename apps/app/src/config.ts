// Base URL of the SplitPea server.
// - Local dev: defaults to localhost.
// - Production: set EXPO_PUBLIC_API_BASE_URL (Expo inlines EXPO_PUBLIC_* at build
//   time) to your deployed backend.
// - Physical device on your LAN: set it to your machine's IP, e.g.
//   http://192.168.1.20:4000
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const railwayApiBaseUrl =
  "https://splitpeaserver-production.up.railway.app";

// Some browser/network safety filters reject the newer branded API hostname
// before a request reaches Railway. Keep existing Cloudflare builds that still
// inject that value working by routing them to Railway's verified public host.
export const API_BASE_URL =
  configuredApiBaseUrl === "https://api.getsplitpea.com"
    ? railwayApiBaseUrl
    : configuredApiBaseUrl || "http://localhost:4000";

// Verified public support page. The environment variable can override it for a
// different deployment without requiring a source change.
const configuredKoFiUrl =
  process.env.EXPO_PUBLIC_KOFI_URL?.trim() ?? "https://ko-fi.com/splitpea";
export const KOFI_URL = /^https:\/\/(?:www\.)?ko-fi\.com\/\S+$/i.test(
  configuredKoFiUrl
)
  ? configuredKoFiUrl
  : null;
