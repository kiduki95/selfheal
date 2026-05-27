// ============================================================
// SelfHeal store — UI slice
// ============================================================
// Client/UI state: theme, wizard (onboarding) open flag, and a small
// amount of transient view state (selected graph node, list filters).
// Server data does NOT live here — TanStack Query owns that.
//
// Route is intentionally NOT in this slice; per docs/web-architecture.md §3
// routing is delegated to the URL/router, not the store.

import type { StateCreator } from 'zustand';

export type ThemeMode = 'dark' | 'light';

/**
 * Transient, page-scoped view state. Kept deliberately minimal and typed.
 * These describe "what is currently selected/filtered on screen", not data.
 */
export interface ViewState {
  /** Currently selected node id in the Processing graph, or null. */
  selectedNodeId: string | null;
  /** Free-form per-view filter tokens (e.g. cluster, source, severity). */
  filters: Record<string, string>;
}

export interface UiSlice {
  // --- theme ---
  theme: ThemeMode;
  /** Set the theme explicitly. Applies the `data-theme` side effect. */
  setTheme: (theme: ThemeMode) => void;
  /** Flip dark <-> light. Applies the `data-theme` side effect. */
  toggleTheme: () => void;

  // --- onboarding wizard ---
  wizardOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;

  // --- transient view state ---
  view: ViewState;
  /** Select a graph node (or clear with null). */
  selectNode: (id: string | null) => void;
  /** Set a single filter key; pass undefined value to clear that key. */
  setFilter: (key: string, value: string | undefined) => void;
  /** Replace all filters at once. */
  resetFilters: () => void;
}

/**
 * Apply the theme as the `data-theme` attribute on <html>.
 *
 * This is the single place that performs the DOM side effect that
 * `app.tsx` currently does inside a `useEffect`. We run it eagerly from the
 * theme actions (rather than via a store subscriber) so the attribute stays
 * in sync without requiring any component to mount. It is SSR-safe: it
 * no-ops when `document` is unavailable.
 */
function applyTheme(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export const DEFAULT_THEME: ThemeMode = 'dark';

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set, get) => ({
  theme: DEFAULT_THEME,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },

  wizardOpen: false,
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),

  view: { selectedNodeId: null, filters: {} },
  selectNode: (id) =>
    set((state) => ({ view: { ...state.view, selectedNodeId: id } })),
  setFilter: (key, value) =>
    set((state) => {
      const filters = { ...state.view.filters };
      if (value === undefined) {
        delete filters[key];
      } else {
        filters[key] = value;
      }
      return { view: { ...state.view, filters } };
    }),
  resetFilters: () =>
    set((state) => ({ view: { ...state.view, filters: {} } })),
});

/**
 * Apply the initial theme attribute at module load so the DOM matches the
 * store's default even before any component reads from it. Safe to call on
 * the server (no-ops without `document`).
 */
export function initThemeAttribute(theme: ThemeMode = DEFAULT_THEME): void {
  applyTheme(theme);
}
