import type { PipelineCtx } from '../../contracts/stage.js';
import type { LlmCallRecord } from '../../contracts/processed-review.js';
import { inputHash } from '../../util/hash.js';

export interface Ran<Out> {
  value: Out;
  cached: boolean;
  duration_ms: number;
  llm_call?: LlmCallRecord;
}

// version-aware 캐시 래퍼 (spec §4): input_hash = hash(input + stage_version).
// 캐시 hit이면 fn 미실행 (LLM/연산 0). materialize는 review_stage_outputs에.
export async function runCached<In, Out>(
  ctx: PipelineCtx,
  rawReviewId: string,
  stageName: string,
  stageVersion: string,
  input: In,
  fn: (input: In) => Promise<{ value: Out; llm_call?: LlmCallRecord }>,
): Promise<Ran<Out>> {
  const hash = inputHash(input, stageVersion);
  const cached = await ctx.db.getStageOutput(rawReviewId, stageName, hash);
  ctx.metrics.inc(`stage.${stageName}.run`);
  if (cached !== null) {
    ctx.metrics.inc(`stage.${stageName}.cache_hit`);
    return { value: cached as Out, cached: true, duration_ms: 0 };
  }
  const t0 = Date.now();
  const { value, llm_call } = await fn(input);
  const dt = Date.now() - t0;
  ctx.metrics.observe(`stage.${stageName}.duration_ms`, dt);
  if (llm_call) {
    ctx.metrics.inc('cost.tokens_in', llm_call.tokens_in);
    ctx.metrics.inc('cost.tokens_out', llm_call.tokens_out);
    ctx.metrics.inc('cost.cached_tokens', llm_call.cached_tokens);
  }
  await ctx.db.putStageOutput(rawReviewId, stageName, stageVersion, hash, value, llm_call ?? null, dt);
  return { value, cached: false, duration_ms: dt, llm_call };
}
