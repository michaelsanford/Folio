/**
 * A remembered "this browser was signed in last time", so the app can draw
 * its shell at once instead of waiting for the server to confirm the session.
 * It holds nothing secret: the session itself lives in HttpOnly cookies and
 * the server still decides; a stale hint only costs a switch to the sign-in
 * screen once the check answers.
 */

export type AuthMode = "cognito" | "master_password" | "unconfigured";

export interface SessionHint {
  auth_mode: AuthMode;
}

const KEY = "folio:signed-in";

export function readSessionHint(): SessionHint | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionHint>;
    return parsed.auth_mode === "cognito" || parsed.auth_mode === "master_password"
      ? { auth_mode: parsed.auth_mode }
      : null;
  } catch {
    return null;
  }
}

export function writeSessionHint(hint: SessionHint): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(hint));
  } catch {
    // Private window or blocked storage: the next load just waits for the check.
  }
}

export function clearSessionHint(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
