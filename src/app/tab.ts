/**
 * Who is playing in THIS tab (DESIGN A-29). Two children share one computer,
 * so a fresh open starts on "Who's playing?" rather than reopening the last
 * child. The child picked is remembered in sessionStorage: it survives a
 * reload (and the e2e flows' page.goto) in the same tab, and is gone when the
 * tab closes. Storage that throws (blocked site data) simply means the picker
 * shows again.
 */
const KEY = 'bg:tab:child';

export function tabChild(): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberTabChild(pid: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (pid) sessionStorage.setItem(KEY, pid);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered: a reload shows the picker, nothing else changes.
  }
}
