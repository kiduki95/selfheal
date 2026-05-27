// ============================================================
// SelfHeal store — composition root
// ============================================================
// Single Zustand store composed from typed slices (slice pattern).
// No provider needed — import `useAppStore` anywhere.
//
//   const theme = useAppStore((s) => s.theme);
//   const toggleTheme = useAppStore((s) => s.toggleTheme);
//   const allowed = useAppStore(canApprove); // derived selector
//
// See ./README.md for the full handoff contract and app.tsx migration map.

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { createUiSlice, initThemeAttribute, DEFAULT_THEME } from './ui.slice';
import type { UiSlice } from './ui.slice';
import { createSessionSlice } from './session.slice';
import type { SessionSlice } from './session.slice';

/** The full store state: every slice flattened into one object. */
export type AppState = UiSlice & SessionSlice;

// Compose slices. Each slice's StateCreator is widened to the full AppState
// so cross-slice reads (get) stay type-safe as the store grows.
const createRootSlice: StateCreator<AppState, [], [], AppState> = (...args) => ({
  ...(createUiSlice as StateCreator<AppState, [], [], UiSlice>)(...args),
  ...(createSessionSlice as StateCreator<AppState, [], [], SessionSlice>)(...args),
});

export const useAppStore = create<AppState>()(createRootSlice);

// Keep the <html data-theme> attribute in sync with the store's initial
// theme at module load, so the DOM is correct before any component mounts.
// (Theme actions apply the attribute on every subsequent change.)
initThemeAttribute(DEFAULT_THEME);

// Re-export slice types and selectors for a single import surface.
export type { UiSlice, ThemeMode, ViewState } from './ui.slice';
export type { SessionSlice, Session, User, Role } from './session.slice';
export {
  canApprove,
  canAdmin,
  isAuthenticated,
  roleAtLeast,
  selectTheme,
  selectWizardOpen,
  selectSelectedNodeId,
} from './selectors';
