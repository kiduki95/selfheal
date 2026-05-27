// ============================================================
// SelfHeal store — derived selectors
// ============================================================
// Pure functions over the composed store state. Use with the store hook for
// fine-grained subscriptions, e.g. `useAppStore(canApprove)`.
//
// RBAC source of truth: these gate UI only. Real authorization is enforced
// server-side (docs/web-architecture.md §4.1) — client gating is UX, not security.

import type { Role } from './session.slice';
import type { AppState } from './index';

/** Role ranking, low -> high. Used for "at least this role" checks. */
const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  reviewer: 1,
  admin: 2,
};

/** True if `role` is at least `min` in the RBAC hierarchy. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** reviewer + admin can approve/reject proposals. */
export function canApprove(state: AppState): boolean {
  return roleAtLeast(state.role, 'reviewer');
}

/** admin-only: sources, settings, queue control. */
export function canAdmin(state: AppState): boolean {
  return roleAtLeast(state.role, 'admin');
}

/** Convenience: is this a real (hydrated) session vs the mock placeholder. */
export function isAuthenticated(state: AppState): boolean {
  return state.authenticated;
}

// --- UI selectors (thin, but keep call sites uniform) ---

export const selectTheme = (state: AppState) => state.theme;
export const selectWizardOpen = (state: AppState) => state.wizardOpen;
export const selectSelectedNodeId = (state: AppState) => state.view.selectedNodeId;
