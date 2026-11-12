/**
 * Whether a data change was made by another program (docs/CHANGE-NOTICE-U15.md). The native side reports every commit to a
 * module's file, including the module's own. A module's own commit follows one of its command calls closely (the adapter
 * stamps each call at start and end); a change that arrives when the module has been quiet for longer than this is
 * another program's. A change made by another program while the module is busy is not reported (documented limit).
 */
export const OWN_WRITE_WINDOW_MS = 3000;

export function isExternalChange(lastModuleActivityMs: number | undefined, nowMs: number): boolean {
  return lastModuleActivityMs === undefined || nowMs - lastModuleActivityMs > OWN_WRITE_WINDOW_MS;
}
