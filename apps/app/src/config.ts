// Base URL of the SpliitAI server.
// - Local dev: defaults to localhost.
// - Production: set EXPO_PUBLIC_API_BASE_URL (Expo inlines EXPO_PUBLIC_* at build
//   time) to your deployed backend, e.g. https://spliitai.onrender.com
// - Physical device on your LAN: set it to your machine's IP, e.g.
//   http://192.168.1.20:4000
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
