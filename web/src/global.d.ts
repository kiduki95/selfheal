// Ambient declarations for host-provided globals.
//
// The former `selfheal:*` WindowEventMap block is gone: the command-palette
// event bus was replaced by direct Zustand store actions
// (useAppStore.getState().toggleTheme() / .openWizard()), so there are no
// custom window events left to type (docs/web-architecture.md §1.3).
export {};
