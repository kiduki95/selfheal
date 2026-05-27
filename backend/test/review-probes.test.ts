import { describe, it, expect } from 'vitest';
import { verifyGapProposal } from '../src/insight/insight.js';

// Independent review probes for the uncommitted Insight changes (⑤ + ⑦).
// These are PURE tests written by the reviewer to exercise paths the author's
// own suite does not cover at all (no existing test references verifyGapProposal
// or structured `connections`).

const real = new Set(['app/checkout', 'app/auth', 'components/cart', 'lib']);

describe('⑦ verifyGapProposal — structured connections path', () => {
  it('all structured connections real → grounded', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'x', body: 'b', connections: ['app/auth', 'components/cart'] },
      real,
    );
    expect(v.verdict).toBe('grounded');
    expect(v.referenced.sort()).toEqual(['app/auth', 'components/cart']);
    expect(v.invented).toEqual([]);
  });

  it('a connection not in the code graph → invented → partial', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'x', body: 'b', connections: ['app/auth', 'app/ghost'] },
      real,
    );
    expect(v.verdict).toBe('partial');
    expect(v.invented).toEqual(['app/ghost']);
  });

  it('empty connections array falls back to regex extraction (does NOT trust structured)', () => {
    // body mentions a real module in backticks; structured path is skipped because [] is falsy-length.
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'connects to `app/auth`', body: '', connections: [] },
      real,
    );
    expect(v.referenced).toContain('app/auth'); // proves regex fallback ran
  });

  it('missing connections (undefined) falls back to regex', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'connects to `app/auth`', body: '' },
      real,
    );
    expect(v.referenced).toContain('app/auth');
  });

  // FIXED (was a divergence the reviewer found): the structured path now applies the same norm()
  // trailing `/` `\`` trim as the regex path, so a trailing-slash connection matches the real module.
  it('structured connection with trailing slash is normalized → grounded', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'x', body: 'b', connections: ['app/auth/'] },
      real,
    );
    expect(v.invented).toEqual([]);
    expect(v.referenced).toEqual(['app/auth']);
    expect(v.verdict).toBe('grounded');
  });

  it('new_module placement is always moduleExists even if module absent from graph', () => {
    const v = verifyGapProposal(
      { placement: 'new_module', module: 'BrandNewModule', connection: 'x', body: 'b', connections: ['app/auth'] },
      real,
    );
    expect(v.moduleExists).toBe(true);
    expect(v.verdict).toBe('grounded'); // all connections real
  });

  it('existing_module placement whose module is absent from graph → ungrounded regardless of connections', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/does-not-exist', connection: 'x', body: 'b', connections: ['app/auth'] },
      real,
    );
    expect(v.moduleExists).toBe(false);
    expect(v.verdict).toBe('ungrounded');
  });

  it('structured path dedups repeated connections', () => {
    const v = verifyGapProposal(
      { placement: 'existing_module', module: 'app/checkout', connection: 'x', body: 'b', connections: ['app/auth', 'app/auth', 'app/ghost', 'app/ghost'] },
      real,
    );
    expect(v.referenced).toEqual(['app/auth']);
    expect(v.invented).toEqual(['app/ghost']);
  });
});
