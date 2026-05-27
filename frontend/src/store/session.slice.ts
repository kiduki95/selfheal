// ============================================================
// SelfHeal store — session slice
// ============================================================
// Identity + RBAC role. Currently a MOCK that mirrors the hardcoded
// "Maya Ortiz / Loop · admin" user chip in app.tsx.
//
// Per docs/web-architecture.md §4.1, real identity comes later from an
// OIDC/session endpoint. The shape here is intentionally "hydratable":
// `hydrateSession` accepts the same `Session` shape a real
// `GET /api/session` (or auth callback) would return, so swapping mock for
// live is a single call with no shape change.

import type { StateCreator } from 'zustand';

/** RBAC roles. viewer < reviewer < admin (see selectors.ts for the order). */
export type Role = 'viewer' | 'reviewer' | 'admin';

export interface User {
  name: string;
  /** Organization / workspace display name (e.g. "Loop"). */
  org: string;
}

/** The hydratable session payload — matches a future /api/session response. */
export interface Session {
  user: User;
  role: Role;
}

export interface SessionSlice {
  user: User;
  role: Role;
  /** Whether the session has been hydrated from a real source yet. */
  authenticated: boolean;
  /** Dev helper to flip role for testing RBAC gating. */
  setRole: (role: Role) => void;
  /** Replace identity + role from a real auth/session endpoint. */
  hydrateSession: (session: Session) => void;
  /** Reset to the unauthenticated default (e.g. on sign-out). */
  clearSession: () => void;
}

/**
 * Mock default matching the current hardcoded user chip in app.tsx
 * ("Maya Ortiz", "Loop · admin"). `authenticated: false` flags that this is
 * a placeholder, not a real session — UI may show a "mock identity" hint.
 */
export const MOCK_SESSION: Session = {
  user: { name: 'Maya Ortiz', org: 'Loop' },
  role: 'admin',
};

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set) => ({
  user: MOCK_SESSION.user,
  role: MOCK_SESSION.role,
  authenticated: false,
  setRole: (role) => set({ role }),
  hydrateSession: (session) =>
    set({ user: session.user, role: session.role, authenticated: true }),
  clearSession: () =>
    set({ user: MOCK_SESSION.user, role: MOCK_SESSION.role, authenticated: false }),
});
