import type { PipelineCtx } from '../../contracts/stage.js';
import { Db } from '../../db/db.js';
import { makeLlmClient } from '../../clients/llm/index.js';
import { makeEmbeddingClient } from '../../clients/embedding/index.js';
import { InMemoryMetrics, type MetricsSink } from '../../observability/metrics.js';
import { pipelineVersions } from '../../config.js';

// PipelineCtx 조립 — env에 따라 stub/real 클라이언트 선택 (§config). metrics는 호출자가 주입(런 단위 집계).
export function makeContext(db = new Db(), metrics: MetricsSink = new InMemoryMetrics()): PipelineCtx {
  return {
    db,
    llm: makeLlmClient(),
    embedder: makeEmbeddingClient(),
    metrics,
    versions: pipelineVersions(),
    now: () => new Date(),
  };
}
