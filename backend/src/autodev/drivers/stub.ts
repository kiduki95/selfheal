import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve, relative } from 'node:path';
import type { AgentDriver, AgentDriverInput, AgentDriverResult } from './types.js';
import type { GroundedBrief } from '../brief.js';

// A scripted edit the stub applies to the workspace. Tests inject these to drive the full
// orchestration/verify/artifact path deterministically without a model.
export interface ScriptedEdit {
  // Repo-relative path (resolved against the workspace cwd; absolute / .. is rejected as escape).
  path: string;
  // 'write' overwrites, 'append' appends. Default 'write'.
  mode?: 'write' | 'append';
  content: string;
}

// Behaviour knobs for deterministic test scenarios (spec §9.2 cases).
export interface StubScript {
  // Exact edits to apply. If omitted, the stub derives a default edit from the brief's first target file.
  edits?: ScriptedEdit[];
  // When true, apply NO edits → empty diff (drives the empty-diff rejection case).
  noChanges?: boolean;
  // Edits keyed by attempt number: attempt 0 fails verify (e.g. out of scope / no test), a later
  // attempt fixes it. Lets a single test exercise the bounded-retry loop deterministically.
  perAttempt?: Record<number, ScriptedEdit[]>;
  // Human summary override.
  summary?: string;
}

// LLM-free, deterministic coding-agent driver (spec §3, first scope). It applies scripted edits into
// the workspace cwd so the orchestrator, workspace isolation, verify gate, PR artifact and agent_runs
// persistence can all be exercised by fast repeatable tests — the harness regime: test the LOOP, not a model.
export class StubAgentDriver implements AgentDriver {
  readonly kind = 'stub' as const;
  constructor(private readonly script: StubScript = {}) {}

  async run(input: AgentDriverInput): Promise<AgentDriverResult> {
    const root = resolve(input.workspace);
    const edits = this.resolveEdits(input.brief, input.attempt);
    const changed: string[] = [];
    for (const e of edits) {
      const rel = e.path;
      // Hard isolation: the agent must not escape the workspace root (spec §4).
      if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new Error(`StubAgentDriver: refusing to write outside workspace: ${rel}`);
      }
      const abs = join(root, rel);
      if (relative(root, abs).startsWith('..')) throw new Error(`StubAgentDriver: path escapes workspace: ${rel}`);
      mkdirSync(dirname(abs), { recursive: true });
      if ((e.mode ?? 'write') === 'append' && existsSync(abs)) appendFileSync(abs, e.content);
      else writeFileSync(abs, e.content);
      changed.push(rel.replace(/\\/g, '/'));
    }
    return {
      filesChanged: [...new Set(changed)],
      summary: this.script.summary ?? `stub: ${input.brief.kind} for ${input.brief.title}`,
      turnCount: 1,
    };
  }

  private resolveEdits(brief: GroundedBrief, attempt: number): ScriptedEdit[] {
    if (this.script.noChanges) return [];
    if (this.script.perAttempt && this.script.perAttempt[attempt]) return this.script.perAttempt[attempt]!;
    if (this.script.edits) return this.script.edits;
    // Default deterministic edit: drop a marker file derived from the brief inside the first target
    // file's directory (or repo root). Enough to produce a non-empty in-scope diff.
    const anchor = brief.targetFiles[0] ?? brief.targetModule ?? 'selfheal-autodev';
    const dir = anchor.includes('/') ? dirname(anchor) : '';
    const path = (dir ? `${dir}/` : '') + `selfheal-${brief.kind}-${brief.ref_id.slice(0, 8)}.txt`;
    return [{ path, content: `// stub edit for ${brief.title}\n` }];
  }
}
