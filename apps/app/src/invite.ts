const INVITE_CODE_PATTERN = /^[2-9A-HJ-KM-NP-Z]{8}$/i;

function normalizeInviteCode(value: string | null): string {
  const code = value?.trim().toUpperCase() ?? "";
  return INVITE_CODE_PATTERN.test(code) ? code : "";
}

/**
 * Extract an invite code from a copied SplitPea link. Bare codes remain
 * supported so existing invites and manually shared codes keep working.
 */
export function inviteCodeFromInput(value: string): string {
  const input = value.trim();
  if (!input) return "";

  const candidates = [input];
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    candidates.push(`https://${input}`);
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const code = normalizeInviteCode(url.searchParams.get("g"));
      if (code) return code;
    } catch {
      // It may be a bare invite code rather than a URL.
    }
  }

  return normalizeInviteCode(input);
}
