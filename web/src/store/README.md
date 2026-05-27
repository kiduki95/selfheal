# `web/src/store/` — client/UI state (Zustand)

Single Zustand store (v5, slice pattern, no provider) for **client/UI + session**
state. Replaces the `window` CustomEvent bus and the ad-hoc `useState` in
`app.tsx`. **Server data does not belong here** — TanStack Query owns reviews,
proposals, graph, agents, dashboard aggregates (see `docs/web-architecture.md` §1.1).

> Status: store files are created but **not yet wired**. This file is the
> handoff contract for the agent that integrates them into `app.tsx` / pages.

---

## Public API (single import surface)

Everything is re-exported from `web/src/store/index.ts`:

```ts
import {
  useAppStore,                 // the hook
  canApprove, canAdmin,        // RBAC selectors
  isAuthenticated, roleAtLeast,
  selectTheme, selectWizardOpen, selectSelectedNodeId,
} from './store';
import type { ThemeMode, Role, Session, User, ViewState } from './store';
```

Decision: **one composed store** (`useAppStore`), not split `useUiStore` /
`useSessionStore`. Slices are still authored separately (`ui.slice.ts`,
`session.slice.ts`) and flattened into one `AppState`. Subscribe with selectors
for fine-grained re-renders — selecting one field never re-renders on others.

### State + actions

| Field / action | Type | Notes |
|---|---|---|
| `theme` | `'dark' \| 'light'` | default `'dark'` |
| `setTheme(t)` | `(ThemeMode) => void` | applies `data-theme` side effect |
| `toggleTheme()` | `() => void` | flips dark/light + side effect |
| `wizardOpen` | `boolean` | onboarding wizard visibility |
| `openWizard()` / `closeWizard()` | `() => void` | |
| `view.selectedNodeId` | `string \| null` | selected Processing graph node |
| `view.filters` | `Record<string,string>` | per-view filter tokens |
| `selectNode(id)` | `(string \| null) => void` | |
| `setFilter(k, v)` | `(string, string\|undefined) => void` | `undefined` clears the key |
| `resetFilters()` | `() => void` | |
| `user` | `{ name, org }` | mock default: `Maya Ortiz` / `Loop` |
| `role` | `'viewer'\|'reviewer'\|'admin'` | mock default: `admin` |
| `authenticated` | `boolean` | `false` until hydrated from real auth |
| `setRole(r)` | `(Role) => void` | **dev helper** for testing RBAC |
| `hydrateSession(s)` | `(Session) => void` | swap-in point for real `/api/session` |
| `clearSession()` | `() => void` | sign-out → back to mock default |

### Selectors (pure, use as `useAppStore(selector)`)

- `canApprove(state)` → `boolean` — `reviewer` or `admin`.
- `canAdmin(state)` → `boolean` — `admin` only.
- `isAuthenticated(state)` → `boolean`.
- `roleAtLeast(role, min)` → `boolean` — raw helper (not a state selector).
- `selectTheme`, `selectWizardOpen`, `selectSelectedNodeId` — thin field selectors.

### Theme side effect

The `data-theme` attribute on `<html>` is applied **inside the theme actions**
(`setTheme` / `toggleTheme`) — no `useEffect` or store subscriber required.
`index.ts` also calls `initThemeAttribute(DEFAULT_THEME)` once at module load so
the DOM is correct before any component mounts. The integrator can therefore
**delete** `app.tsx`'s `useEffect(() => document.documentElement.setAttribute(...))`.

---

## `app.tsx` migration map (what each piece replaces)

| Current in `app.tsx` | Replace with |
|---|---|
| `const [theme, setTheme] = useState<ThemeMode>('dark')` | `useAppStore(selectTheme)` + `useAppStore(s => s.setTheme)` |
| `useEffect` applying `data-theme` (lines ~182-184) | **delete** — actions + `initThemeAttribute` handle it |
| `useEffect` for `selfheal:open-wizard` listener (~187-191) | **delete listener**; palette calls `openWizard()` directly |
| `useEffect` for `selfheal:toggle-theme` listener (~194-198) | **delete listener**; palette calls `toggleTheme()` directly |
| `const [showOnboarding, setShowOnboarding] = useState(false)` | `useAppStore(selectWizardOpen)` + `openWizard`/`closeWizard` |
| `Topbar` theme toggle button `onClick` | `useAppStore(s => s.toggleTheme)` |
| `Sidebar` `openOnboarding` / `OnboardingFlow onClose` | `openWizard` / `closeWizard` |

**Command palette** (`components/overlays.tsx`): the two
`window.dispatchEvent(new CustomEvent('selfheal:...'))` calls in `doAction`
become direct store calls:
- `selfheal:toggle-theme` → `useAppStore.getState().toggleTheme()`
  (or pass the action in via props/hook).
- `selfheal:open-wizard` → `useAppStore.getState().openWizard()`.

Once both listeners and both dispatches are gone, **delete the custom
`WindowEventMap` block in `web/src/global.d.ts`** (`docs/web-architecture.md` §1.3).

> Not in scope here: `route` stays as-is for now; the doc routes it to the
> URL/router (§3), a separate step. `OverlayProvider`/`useOverlays` stays a
> Context — the store does **not** absorb it.

---

## RBAC gating (how to use)

Client gating is **UX only** — real authorization is server-side
(`docs/web-architecture.md` §4.1). Gate write/destructive UI behind selectors:

```tsx
const approve = useAppStore(canApprove); // reviewer + admin
const admin   = useAppStore(canAdmin);   // admin only

{approve && <Button>Approve</Button>}          // Insights approve/reject
{admin && <Button onClick={openAddSource}>Add source</Button>} // Sources
{admin && <Button>Pause queue</Button>}        // Auto-Dev queue control
```

Hardcoded user chip in `Sidebar` (`MO` / `Maya Ortiz` / `Loop · admin`):
read from the store — `useAppStore(s => s.user)` and `useAppStore(s => s.role)`.
When a real session endpoint exists, call `hydrateSession(payload)` on login;
the mock default keeps the UI populated until then. Use `setRole` in dev to
exercise gating across roles.
