import cors from "cors";
import type { Express, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const productionOrigins = [
  "https://getsplitpea.com",
  "https://www.getsplitpea.com",
];

const developmentOrigins = [
  ...productionOrigins,
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
];

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function allowedOriginsFromEnvironment(): string[] {
  const configured = csv(process.env.CORS_ALLOWED_ORIGINS);
  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === "production"
    ? productionOrigins
    : developmentOrigins;
}

export function isOriginAllowed(
  origin: string,
  allowedOrigins = allowedOriginsFromEnvironment(),
  allowedHostnameSuffixes = csv(process.env.CORS_ALLOWED_ORIGIN_SUFFIXES)
): boolean {
  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    return allowedHostnameSuffixes.some((configuredSuffix) => {
      const suffix = configuredSuffix.toLowerCase().replace(/^\./, "");
      const hostname = url.hostname.toLowerCase();
      return suffix.length > 0 &&
        (hostname === suffix || hostname.endsWith(`.${suffix}`));
    });
  } catch {
    return false;
  }
}

const rejectDisallowedBrowserOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("Origin");
  // Native apps and command-line clients normally send no Origin header.
  if (!origin || isOriginAllowed(origin)) return next();
  return res.status(403).json({ error: "This web origin is not allowed." });
};

const rateLimitResponse = {
  error: "Too many requests. Please wait a moment and try again.",
};

function mutationLimiter(): RequestHandler {
  return rateLimit({
    windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, FIFTEEN_MINUTES),
    limit: positiveInteger(process.env.RATE_LIMIT_MAX_MUTATIONS, 180),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
    message: rateLimitResponse,
  });
}

export const createGroupLimiter = rateLimit({
  windowMs: ONE_HOUR,
  limit: positiveInteger(process.env.GROUP_RATE_LIMIT_MAX, 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const messageLimiter = rateLimit({
  windowMs: FIVE_MINUTES,
  limit: positiveInteger(process.env.MESSAGE_RATE_LIMIT_MAX, 40),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitResponse,
});

export function configureHttpSecurity(app: Express): RequestHandler {
  if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1") {
    // Railway terminates TLS at one reverse proxy in front of the app.
    app.set("trust proxy", 1);
  }

  app.disable("x-powered-by");
  app.use(rejectDisallowedBrowserOrigin);
  app.use(
    cors({
      origin: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      maxAge: 86_400,
    })
  );

  return mutationLimiter();
}
