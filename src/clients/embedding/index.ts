import { config } from '../../config.js';
import type { EmbeddingClient } from './types.js';
import { LocalEmbeddingClient } from './local.js';
import { CohereEmbeddingClient } from './cohere.js';

export function makeEmbeddingClient(): EmbeddingClient {
  if (config.embeddingClient === 'cohere') {
    if (!config.cohereApiKey) throw new Error('EMBEDDING_CLIENT=cohere but COHERE_API_KEY is not set');
    return new CohereEmbeddingClient(config.cohereApiKey);
  }
  return new LocalEmbeddingClient();
}
