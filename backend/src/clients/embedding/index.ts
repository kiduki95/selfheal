import { config, EMBED_DIM } from '../../config.js';
import type { EmbeddingClient } from './types.js';
import { LocalEmbeddingClient } from './local.js';
import { CohereEmbeddingClient } from './cohere.js';

const COHERE_DIM = 1024; // embed-multilingual-v3 native dimension

export function makeEmbeddingClient(): EmbeddingClient {
  if (config.embeddingClient === 'cohere') {
    if (!config.cohereApiKey) throw new Error('EMBEDDING_CLIENT=cohere but COHERE_API_KEY is not set');
    // Footgun guard: Cohere is 1024-dim but the schema is vector(EMBED_DIM). Every embedding INSERT
    // would fail at the DB — refuse clearly at startup instead of mid-pipeline until the column dim matches.
    if ((EMBED_DIM as number) !== COHERE_DIM) throw new Error(`EMBEDDING_CLIENT=cohere is ${COHERE_DIM}-dim but schema is vector(${EMBED_DIM}); re-migrate the embedding columns to ${COHERE_DIM} before using cohere`);
    return new CohereEmbeddingClient(config.cohereApiKey);
  }
  return new LocalEmbeddingClient();
}
