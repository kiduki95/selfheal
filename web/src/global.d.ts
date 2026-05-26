// Ambient declarations for host-provided globals.
export {};

declare global {
  interface WindowEventMap {
    // Dispatched by the command palette to open the onboarding wizard.
    'selfheal:open-wizard': CustomEvent;
  }
}
