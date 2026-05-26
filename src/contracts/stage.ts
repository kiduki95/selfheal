import type { LlmClient } from '../clients/llm/types.js';
import type { EmbeddingClient } from '../clients/embedding/types.js';
import type { Db } from '../db/db.js';
import type { LlmCallRecord } from './processed-review.js';
import type { MetricsSink } from '../observability/metrics.js';

// Phase 1 stage는 리뷰 1건의 순수 함수 시그니처 (spec §4). DB/LLM은 ctx로 명시적 주입.
export interface PipelineCtx {
  db: Db;
  llm: LlmClient;
  embedder: EmbeddingClient;
  metrics: MetricsSink;
  versions: ReturnType<typeof import('../config.js').pipelineVersions>;
  now: () => Date;
}

export interface StageResult<T> {
  raw_review_id: string;
  stage_name: string;
  stage_version: string;
  input_hash: string; // hash(input_payload + stage_version)
  output: T;
  llm_call?: LlmCallRecord;
  duration_ms: number;
}

export type Stage<In, Out> = (input: In, ctx: PipelineCtx) => Promise<Out>;
