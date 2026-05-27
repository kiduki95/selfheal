import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway git repo used as the Auto-Dev mirror source, so worktree/verify tests are hermetic
// (no dependency on a heavy external product repo). Returns the repo dir + a disposer.
export interface GitFixture {
  dir: string;
  git(args: string[]): string;
  dispose(): void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

export function makeGitFixture(files: Record<string, string> = {}): GitFixture {
  const dir = mkdtempSync(join(tmpdir(), 'selfheal-fixture-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@selfheal.local']);
  git(dir, ['config', 'user.name', 'selfheal-test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  const seed: Record<string, string> = {
    'README.md': '# fixture\n',
    'src/orders/order.ts': 'export function placeOrder() { return true; }\n',
    'src/orders/order.test.ts': 'export const t = 1;\n',
    ...files,
  };
  for (const [rel, content] of Object.entries(seed)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'seed']);

  return {
    dir,
    git: (args) => git(dir, args),
    dispose() {
      // Remove any leftover worktrees this fixture spawned, then the dir itself.
      try { git(dir, ['worktree', 'prune']); } catch { /* ignore */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
