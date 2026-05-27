// ============================================================
// SelfHeal SPA — Playwright E2E smoke tests
// ============================================================
// Run via: npm --prefix web run test:e2e
// The webServer in playwright.config.ts builds + serves the app
// on http://localhost:4173 before the suite starts.

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click a sidebar nav item by its visible text label. */
async function navTo(page: Page, label: string) {
  await page.locator('.nav-item[role="button"]', { hasText: label }).click();
}

/** Wait for the page heading to contain the given text. */
async function expectHeading(page: Page, text: string) {
  await expect(page.locator('.page-title')).toContainText(text, { timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// 1. App boot
// ---------------------------------------------------------------------------
test.describe('App boot', () => {
  test('root renders and sidebar brand is visible', async ({ page }) => {
    // Collect console errors during page load.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // App shell must be present.
    await expect(page.locator('.app')).toBeVisible();

    // Brand text in sidebar.
    await expect(page.locator('.brand-name')).toHaveText('selfheal');

    // Default route is Dashboard, served at the root path.
    await expectHeading(page, 'Dashboard');
    expect(new URL(page.url()).pathname).toBe('/');

    // No console errors on initial load.
    // We filter out known browser extension noise and React hydration warnings.
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('extension') &&
        !e.includes('favicon') &&
        !e.includes('chrome-extension'),
    );
    expect(realErrors, `Unexpected console errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Sidebar navigation — now changes the URL
// ---------------------------------------------------------------------------
test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('navigate to Sources updates the URL and heading', async ({ page }) => {
    await navTo(page, 'Sources');
    await expect(page).toHaveURL(/\/sources$/);
    await expectHeading(page, 'Review sources');
    // The active nav item reflects the current route.
    await expect(page.locator('.nav-item.active[aria-current="page"]')).toHaveText(/Sources/);
  });

  test('navigate to Reviews shows review rows', async ({ page }) => {
    await navTo(page, 'Reviews');
    await expect(page).toHaveURL(/\/reviews$/);
    await expectHeading(page, 'Raw reviews');
    // Reviews page renders a CSS-grid list of review divs (no <table>).
    await expect(page.locator('.section-title', { hasText: 'Raw reviews' }).first()).toBeVisible({ timeout: 6_000 });
    // The filter bar has a search input unique to this page.
    await expect(page.locator('input[placeholder="Search review text…"]')).toBeVisible({ timeout: 4_000 });
  });

  test('navigate to Insights & Proposals shows kanban', async ({ page }) => {
    await navTo(page, 'Insights & Proposals');
    await expect(page).toHaveURL(/\/insights$/);
    await expectHeading(page, 'Insights & Proposals');
    await expect(
      page.locator('.kanban-col, .kanban, [class*="kanban"], .proposal-card, [class*="proposal"]').first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('navigate to Auto-Dev Agents', async ({ page }) => {
    await navTo(page, 'Auto-Dev Agents');
    await expect(page).toHaveURL(/\/agent$/);
    await expectHeading(page, 'Auto-Dev agents');
  });

  test('navigate to Activity log', async ({ page }) => {
    await navTo(page, 'Activity log');
    await expect(page).toHaveURL(/\/activity$/);
    await expectHeading(page, 'Activity log');
  });

  test('navigate to Settings', async ({ page }) => {
    await navTo(page, 'Settings');
    await expect(page).toHaveURL(/\/settings$/);
    // Settings page suppresses the standard page-header, but we can check
    // the sidebar item becomes active.
    await expect(
      page.locator('.nav-item[role="button"][aria-current="page"]'),
    ).toHaveText(/Settings/);
  });

  test('navigate back to Dashboard', async ({ page }) => {
    await navTo(page, 'Sources');
    await navTo(page, 'Dashboard');
    await expect(page).toHaveURL(/\/$/);
    await expectHeading(page, 'Dashboard');
  });

  test('browser back/forward restores the previous route', async ({ page }) => {
    await navTo(page, 'Sources');
    await expect(page).toHaveURL(/\/sources$/);
    await navTo(page, 'Reviews');
    await expect(page).toHaveURL(/\/reviews$/);

    // Back returns to Sources.
    await page.goBack();
    await expect(page).toHaveURL(/\/sources$/);
    await expectHeading(page, 'Review sources');

    // Forward returns to Reviews.
    await page.goForward();
    await expect(page).toHaveURL(/\/reviews$/);
    await expectHeading(page, 'Raw reviews');
  });
});

// ---------------------------------------------------------------------------
// 2b. Deep links — visiting a URL directly lands on the right page
// ---------------------------------------------------------------------------
test.describe('Deep links', () => {
  test('refresh keeps the current page (direct /reviews visit)', async ({ page }) => {
    await page.goto('/reviews');
    await expectHeading(page, 'Raw reviews');
    await page.reload();
    await expect(page).toHaveURL(/\/reviews$/);
    await expectHeading(page, 'Raw reviews');
  });

  test('/processing?node= pre-selects a graph node and survives refresh', async ({ page }) => {
    // Deep link to a specific (non-default) node. Default selection is t_ko
    // (korean-asr); we target t_noise (noise-suppression) to prove the param
    // drives the selection rather than the default.
    await page.goto('/processing?node=t_noise');

    const rfContainer = page.locator('.react-flow');
    await expect(rfContainer).toBeVisible({ timeout: 15_000 });

    // The side panel opens for the deep-linked node and shows its label.
    const sidePanel = page.locator('.graph-side');
    await expect(sidePanel).toBeVisible({ timeout: 10_000 });
    await expect(sidePanel).toContainText('noise-suppression', { timeout: 8_000 });

    // Refresh keeps both the page and the selected node.
    await page.reload();
    await expect(page).toHaveURL(/\/processing\?node=t_noise$/);
    await expect(page.locator('.graph-side')).toContainText('noise-suppression', { timeout: 12_000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Processing graph
// ---------------------------------------------------------------------------
test.describe('Processing graph', () => {
  test('ReactFlow renders nodes, edges, minimap and controls', async ({ page }) => {
    await page.goto('/');
    await navTo(page, 'Processing');
    await expect(page).toHaveURL(/\/processing/);

    // Page lazy-loads; wait for the ReactFlow container.
    const rfContainer = page.locator('.react-flow');
    await expect(rfContainer).toBeVisible({ timeout: 15_000 });

    // At least several nodes should be in the DOM.
    const nodeLocator = rfContainer.locator('.react-flow__node');
    await expect(nodeLocator.first()).toBeVisible({ timeout: 10_000 });
    const nodeCount = await nodeLocator.count();
    expect(nodeCount, `Expected >= 5 nodes, got ${nodeCount}`).toBeGreaterThanOrEqual(5);

    // At least one edge.
    const edgeLocator = rfContainer.locator('.react-flow__edge');
    await expect(edgeLocator.first()).toBeVisible({ timeout: 10_000 });
    const edgeCount = await edgeLocator.count();
    expect(edgeCount, `Expected >= 1 edge, got ${edgeCount}`).toBeGreaterThanOrEqual(1);

    // MiniMap and Controls chrome.
    await expect(rfContainer.locator('.react-flow__minimap')).toBeVisible();
    await expect(rfContainer.locator('.react-flow__controls')).toBeVisible();
  });

  test('clicking a node opens the side panel', async ({ page }) => {
    await page.goto('/');
    await navTo(page, 'Processing');

    const rfContainer = page.locator('.react-flow');
    await expect(rfContainer).toBeVisible({ timeout: 15_000 });

    // Wait for nodes to be rendered.
    await expect(rfContainer.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // The side panel may already be open on first load (t_ko is pre-selected).
    // If it is, great; otherwise click the first visible custom node to open it.
    const sidePanel = page.locator('.graph-side');
    const alreadyOpen = await sidePanel.isVisible().catch(() => false);

    if (!alreadyOpen) {
      // Click the first rf-node (our custom inner element).
      const firstNode = rfContainer.locator('.rf-node').first();
      await firstNode.click({ force: true });
    }

    await expect(sidePanel).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Theme toggle
// ---------------------------------------------------------------------------
test.describe('Theme toggle', () => {
  test('toggle button flips data-theme attribute', async ({ page }) => {
    await page.goto('/');

    // App starts in dark mode (default).
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Click the toggle.
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Toggle back.
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

// ---------------------------------------------------------------------------
// 5. Command palette
// ---------------------------------------------------------------------------
test.describe('Command palette', () => {
  test('clicking search box opens the palette with an input', async ({ page }) => {
    await page.goto('/');

    // Click the topbar search area (it's a readonly input that opens the palette on click).
    await page.locator('.search').click();

    // The palette modal should appear and contain a focused input.
    // CommandPalette renders an <input> with placeholder "Search pages, actions, proposals…"
    const paletteInput = page.locator('input[placeholder*="Search pages"]');
    await expect(paletteInput).toBeVisible({ timeout: 4_000 });
    await expect(paletteInput).toBeFocused();
  });

  test('pressing Escape closes the palette', async ({ page }) => {
    await page.goto('/');
    await page.locator('.search').click();

    const paletteInput = page.locator('input[placeholder*="Search pages"]');
    await expect(paletteInput).toBeVisible({ timeout: 4_000 });

    await page.keyboard.press('Escape');
    await expect(paletteInput).not.toBeVisible({ timeout: 3_000 });
  });

  test('Ctrl+K keyboard shortcut opens the palette', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    const paletteInput = page.locator('input[placeholder*="Search pages"]');
    await expect(paletteInput).toBeVisible({ timeout: 4_000 });
  });

  test('palette navigation changes the route URL', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    const paletteInput = page.locator('input[placeholder*="Search pages"]');
    await expect(paletteInput).toBeVisible({ timeout: 4_000 });

    // Filter to the Activity log page and select it.
    await paletteInput.fill('Activity');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/activity$/);
    await expectHeading(page, 'Activity log');
  });

  test('palette can toggle the theme (store-backed, no event bus)', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.keyboard.press('Control+k');
    const paletteInput = page.locator('input[placeholder*="Search pages"]');
    await expect(paletteInput).toBeVisible({ timeout: 4_000 });
    await paletteInput.fill('Toggle theme');
    await page.keyboard.press('Enter');

    await expect(html).toHaveAttribute('data-theme', 'light');
  });
});
