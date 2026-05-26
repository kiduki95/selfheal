import { z } from 'zod';

// 입력 컨트랙트 (spec §2). 위/아래 레이어는 이 컨트랙트에만 의존.
export const RawReviewSchema = z
  .object({
    source: z.string().min(1), // 'app_store' | 'play_store' | 'slack' | 'reddit' | ...
    source_id: z.string().min(1), // 소스 내 unique — 멱등성 키
    text: z.string().min(1), // 원문 (빈 리뷰는 Ingestion에서 거름)
    title: z.string().optional(),
    rating: z.number().min(1).max(5).optional(),
    locale: z.string().optional(), // BCP 47
    author: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
    app_version: z.string().optional(),
    platform: z.string().optional(), // 'ios' | 'android' | 'web' | ...
    created_at: z.string(), // ISO 8601 — 작성 시각
    ingested_at: z.string(), // ISO 8601 — 수집 시각
    raw_payload: z.record(z.unknown()).default({}),
  })
  // 불변식: created_at <= ingested_at
  .refine((r) => new Date(r.created_at).getTime() <= new Date(r.ingested_at).getTime(), {
    message: 'created_at must be <= ingested_at',
    path: ['created_at'],
  });

export type RawReview = z.infer<typeof RawReviewSchema>;
