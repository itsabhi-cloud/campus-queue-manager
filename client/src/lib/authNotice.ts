/** A one-shot message for the sign-in page ("session expired", "signed out"). Cosmetic only. */
const KEY = "qs-auth-notice";
export type AuthNotice = "expired" | "signed-out";

export function setAuthNotice(notice: AuthNotice) {
  try {
    sessionStorage.setItem(KEY, notice);
  } catch {
    // Storage can be unavailable (private mode); the notice is optional.
  }
}

export function takeAuthNotice(): AuthNotice | null {
  try {
    const value = sessionStorage.getItem(KEY) as AuthNotice | null;
    sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
