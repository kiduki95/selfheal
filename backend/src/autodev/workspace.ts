import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

// Workspace isolation (spec §4, Symphony "minimal isolation primitive"): per-run `git worktree add`
// off the product repo's local checkout (reused as the mirror source — open question #1), on branch
// `selfheal/<kind>-<ref8>`, under `workspaces/<repo-sanitized>/<ref-sanitized>/`. The agent's cwd is
// fixed to the worktree and must NOT escape it. Hooks: after_create / before_run / after_run.

// Sanitize a path segment: anything outside [A-Za-z0-9._-] → '_' (spec §4).
export function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function branchName(kind: string, ref_id: string): string {
  return `selfheal/${kind}-${ref_id.slice(0, 8)}`;
}

export interface WorkspaceHooks {
  // After the worktree exists (install deps, inject AGENTS.md, etc.). Receives the worktree path.
  afterCreate?: (path: string) => void | Promise<void>;
  // Right before the agent runs (inject brief file). Receives the worktree path.
  beforeRun?: (path: string) => void | Promise<void>;
  // After the agent run (cleanup-adjacent bookkeeping). Receives the worktree path.
  afterRun?: (path: string) => void | Promise<void>;
}

export interface WorkspaceOpts {
  // Mirror source = the product repo's local checkout (codeflow's rootDir). Must be a git repo.
  mirrorDir: string;
  // Root under which per-run worktrees are created. Default: <mirrorDir parent>/workspaces.
  workspacesRoot?: string;
  repo: string;
  kind: string;
  ref_id: string;
  hooks?: WorkspaceHooks;
  // Base ref to branch from (default: the mirror's current HEAD).
  baseRef?: string;
}

export interface Workspace {
  // Absolute path to the worktree cwd. The agent edits within this; nothing outside is reachable.
  path: string;
  branch: string;
  // Mirror HEAD (or baseRef) pinned at creation — the commit the worktree branched from. Persisted to
  // agent_runs.base_sha so the diff is well-defined and unaffected by later local edits (spec §3 net-new).
  baseSha: string;
  // Run a git command inside the worktree (typed wrapper used by orchestrator/verify).
  git(args: string[]): string;
  // Guard: assert a (possibly relative) path stays inside the worktree root. Throws on escape.
  assertInside(p: string): string;
  // Tear the worktree down (worktree remove --force + branch delete + dir rm). Idempotent.
  cleanup(): void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

// Create an isolated worktree for a run. after_create hook runs before returning.
export async function createWorkspace(opts: WorkspaceOpts): Promise<Workspace> {
  const mirror = resolve(opts.mirrorDir);
  if (!existsSync(join(mirror, '.git'))) throw new Error(`mirror is not a git repo: ${mirror}`);

  const root = resolve(opts.workspacesRoot ?? join(mirror, '..', 'workspaces'));
  const dir = join(root, sanitizeSegment(opts.repo), sanitizeSegment(`${opts.kind}-${opts.ref_id}`));
  const branch = branchName(opts.kind, opts.ref_id);

  // Clean any stale worktree at this path (re-run idempotency) before creating.
  removeWorktree(mirror, dir, branch);
  mkdirSync(root, { recursive: true });

  const base = opts.baseRef ?? git(mirror, ['rev-parse', 'HEAD']).trim();
  // -B resets the branch if it lingered from a prior crashed run.
  git(mirror, ['worktree', 'add', '-B', branch, dir, base]);

  const ws: Workspace = {
    path: dir,
    branch,
    baseSha: base,
    git: (args) => git(dir, args),
    assertInside(p: string): string {
      const abs = isAbsolute(p) ? resolve(p) : resolve(dir, p);
      const rel = relative(dir, abs);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`path escapes workspace root: ${p}`);
      }
      return abs;
    },
    cleanup() {
      removeWorktree(mirror, dir, branch);
    },
  };

  await opts.hooks?.afterCreate?.(dir);
  return ws;
}

// before_run hook wrapper (kept separate so the orchestrator drives the phases explicitly).
export async function runBeforeRun(ws: Workspace, hooks?: WorkspaceHooks): Promise<void> {
  await hooks?.beforeRun?.(ws.path);
}
export async function runAfterRun(ws: Workspace, hooks?: WorkspaceHooks): Promise<void> {
  await hooks?.afterRun?.(ws.path);
}

// Remove a worktree + its branch + the directory. Tolerant of partial / missing state.
function removeWorktree(mirror: string, dir: string, branch: string): void {
  try { git(mirror, ['worktree', 'remove', '--force', dir]); } catch { /* not registered */ }
  try { git(mirror, ['worktree', 'prune']); } catch { /* ignore */ }
  try { git(mirror, ['branch', '-D', branch]); } catch { /* branch may not exist */ }
  if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
