import { spawn, execFileSync } from 'node:child_process';
import type { AgentDriver, AgentDriverInput, AgentDriverResult } from './types.js';
import type { GroundedBrief } from '../brief.js';
import type { LlmUsage } from '../../clients/llm/types.js';

// Real coding-agent driver — drives the SUBSCRIPTION Claude (`claude -p`, headless) inside the run's
// isolated git worktree (cwd), with file-editing tools enabled and turns bounded. Zero metered API
// cost (consumes the logged-in Claude Code subscription, not the Anthropic API) — see
// [[api-key-after-subscription]]. The orchestrator/verify loop is unchanged; this just swaps the stub.
//
// Safety: the agent runs ONLY in the throwaway worktree (dry-run, never pushed), is restricted to
// file tools (no Bash by default → can't run arbitrary shell), and its output is gated by the
// deterministic verify scope/build/test gate before any handoff. Bad output → rejected + retried.
//
// Harness note: the live `claude` invocation is non-deterministic and needs the subscription, so it
// is NOT unit-tested. The PURE pieces that decide behaviour — the prompt builder and the
// git-diff → changed-files parse — are exported and tested in test/autodev-unit.test.ts.

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');

// Build the agent task prompt from the CodeFlow-grounded brief (+ retry feedback). Pure & testable.
export function buildAgentPrompt(brief: GroundedBrief, attempt: number, feedback?: string): string {
  const header = [
    'You are an autonomous coding agent working INSIDE an isolated git worktree (your current directory).',
    'Implement the brief below by editing files in THIS workspace only. Rules:',
    '- Write a FAILING test that reproduces the problem FIRST (TDD), then the MINIMAL change to make it pass.',
    '- Edit ONLY files within the declared scope (target files / blast-radius / their tests). Do NOT touch unrelated files.',
    '- Do NOT run git, do NOT commit, do NOT push — the harness handles version control.',
    '- Keep the diff small and match the surrounding code conventions.',
    'When finished, output a SINGLE concise line summarizing what you changed (this becomes the commit message).',
  ].join('\n');

  const retry = attempt > 0 && feedback
    ? `\n\n## Previous attempt FAILED verification (attempt ${attempt})\n${feedback}\nFix these specific issues and stay within scope.`
    : '';

  return `${header}\n\n---\n\n${brief.instructions}${retry}`;
}

// Parse `git status --porcelain` output → repo-relative changed paths (add/modify/delete/rename/untracked).
// Pure & testable; the orchestrator records this and verify recomputes it independently.
export function parseChangedFiles(porcelain: string): string[] {
  const out = new Set<string>();
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const rest = line.slice(3);
    const raw = rest.includes(' -> ') ? rest.split(' -> ')[1]! : rest; // rename → new path
    out.add(raw.trim().replace(/^"|"$/g, '').replace(/\\/g, '/'));
  }
  return [...out];
}

interface CliAgentResult { result: string; usage: LlmUsage; turns: number; }

function runClaudeAgent(prompt: string, cwd: string): Promise<CliAgentResult> {
  const model = process.env.AGENT_MODEL ?? 'sonnet';
  const maxTurns = process.env.AGENT_MAX_TURNS ?? '30';
  const permissionMode = process.env.AGENT_PERMISSION_MODE ?? 'acceptEdits';
  // No Bash by default → the agent can't run arbitrary shell; the harness runs build/test in verify.
  const allowedTools = process.env.AGENT_ALLOWED_TOOLS ?? 'Read,Edit,Write,Glob,Grep';
  const timeoutMs = Number(process.env.AGENT_TIMEOUT_MS ?? 600_000); // coding takes longer than a classify call

  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--output-format', 'json', '--model', model,
      '--permission-mode', permissionMode,
      '--max-turns', String(maxTurns),
      '--allowedTools', allowedTools,
    ];
    // shell:false + fixed-constant args + prompt via stdin → no escaping/injection surface.
    const child = spawn(CLAUDE_BIN, args, { shell: false, cwd });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude agent timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude agent exited ${code}: ${(err || out).slice(0, 500)}`));
      try {
        const j = JSON.parse(out);
        const u = j.usage ?? {};
        resolve({
          result: String(j.result ?? ''),
          turns: Number(j.num_turns ?? 0),
          usage: {
            model: `claude-cli/${model}`,
            tokens_in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            tokens_out: u.output_tokens ?? 0,
            cached_tokens: u.cache_read_input_tokens ?? 0,
            duration_ms: j.duration_ms ?? 0,
          },
        });
      } catch (e) {
        reject(new Error(`claude agent output parse failed: ${(e as Error).message}\n${out.slice(0, 500)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Pick a one-line commit summary from the model's free-text result (last non-empty line, trimmed).
function summarize(result: string, brief: GroundedBrief): string {
  const lines = result.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  return (last && last.length <= 200 ? last : `${brief.kind}: ${brief.title}`).replace(/^["'`]|["'`]$/g, '');
}

export class ClaudeCliAgentDriver implements AgentDriver {
  readonly kind = 'claude-cli' as const;

  async run(input: AgentDriverInput): Promise<AgentDriverResult> {
    const prompt = buildAgentPrompt(input.brief, input.attempt, input.feedback);
    const r = await runClaudeAgent(prompt, input.workspace);
    // Truth of what changed = the worktree's git status, not the model's self-report.
    const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: input.workspace, encoding: 'utf8' });
    return {
      filesChanged: parseChangedFiles(porcelain),
      summary: summarize(r.result, input.brief),
      turnCount: r.turns,
      usage: r.usage,
    };
  }
}
