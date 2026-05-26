import type { RawReview } from '../src/contracts/raw-review.js';

// 합성 코퍼스 — Phase 1 분기를 두루 타도록 구성 (KO/EN, bug/feature/praise/complaint/question,
// spam, PII, 완전중복, near-dup, critical/refund 사람큐). "텍스트로 긁어온 리뷰"를 모사.
export const CORPUS: RawReview[] = [
  // --- bugs (KO) ---
  {
    source: 'app_store', source_id: 'as-001', text: '결제할 때 앱이 자꾸 튕겨요. 결제 버튼 누르면 바로 강제종료됩니다. 환불해주세요.',
    rating: 1, locale: 'ko-KR', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T10:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  {
    source: 'play_store', source_id: 'ps-001', text: '로그인이 안 돼요. 로그인 버튼 누르면 멈춤 현상이 계속됩니다. 3.2.0 업데이트 후부터 그래요.',
    rating: 2, locale: 'ko-KR', app_version: '3.2.0', platform: 'android',
    created_at: '2026-05-19T09:00:00Z', ingested_at: '2026-05-19T10:00:00Z', raw_payload: {},
  },
  // --- bug (EN) with error signature ---
  {
    source: 'app_store', source_id: 'as-002', text: 'The app crashes every time I open the map screen. I see a NullPointerException error and it force closes.',
    rating: 1, locale: 'en-US', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T11:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- bug (KO) push ---
  {
    source: 'play_store', source_id: 'ps-002', text: '푸시 알림이 안 와요. 알림 설정을 켜도 알림이 먹통이에요.',
    rating: 2, locale: 'ko-KR', app_version: '3.2.1', platform: 'android',
    created_at: '2026-05-20T08:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- feature_request ---
  {
    source: 'app_store', source_id: 'as-003', text: '다크 모드 기능 추가해주세요. 밤에 쓰기 너무 눈부셔요. 다크모드 있었으면 좋겠어요.',
    rating: 4, locale: 'ko-KR', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T07:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  {
    source: 'reddit', source_id: 'rd-001', text: 'Please add support for offline maps. It would be great if I could download maps for use without signal.',
    locale: 'en-US', platform: 'web',
    created_at: '2026-05-18T07:00:00Z', ingested_at: '2026-05-18T08:00:00Z', raw_payload: {},
  },
  // --- praise ---
  {
    source: 'app_store', source_id: 'as-004', text: '정말 최고의 앱이에요! 검색도 빠르고 완벽합니다. 잘 쓰고 있어요.',
    rating: 5, locale: 'ko-KR', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T06:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  {
    source: 'play_store', source_id: 'ps-003', text: 'Love this app, the search is amazing and it works perfectly. Best app ever!',
    rating: 5, locale: 'en-US', app_version: '3.2.1', platform: 'android',
    created_at: '2026-05-20T05:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- complaint (refund/legal → 사람 큐) ---
  {
    source: 'app_store', source_id: 'as-005', text: '광고가 너무 많아서 짜증나고 앱이 느려요. 결제했는데 환불 안 해주면 소송하겠습니다.',
    rating: 1, locale: 'ko-KR', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T04:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- question ---
  {
    source: 'reddit', source_id: 'rd-002', text: '프로필 사진은 어떻게 바꾸나요? 설정에서 못 찾겠어요. 방법 아시는 분?',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-17T04:00:00Z', ingested_at: '2026-05-17T05:00:00Z', raw_payload: {},
  },
  // --- resolution report (#5) ---
  {
    source: 'play_store', source_id: 'ps-004', text: '예전엔 로그인이 안 됐는데 업데이트 후 잘 돼요. 이제 잘 됩니다. 감사합니다.',
    rating: 4, locale: 'ko-KR', app_version: '3.2.2', platform: 'android',
    created_at: '2026-05-21T04:00:00Z', ingested_at: '2026-05-21T05:00:00Z', raw_payload: {},
  },
  // --- PII (email, phone, RRN, card, person) ---
  {
    source: 'slack', source_id: 'sl-001', text: '저는 홍길동님이고 문의가 있어요. 이메일 hong@example.com 전화 010-1234-5678 카드 4111 1111 1111 1111 주민번호 900101-1234567 로 연락주세요. 사진 업로드가 안 돼요.',
    rating: 2, locale: 'ko-KR', app_version: '3.2.1', platform: 'android',
    created_at: '2026-05-20T03:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- 완전중복 (as-001과 동일 텍스트, source_id만 다름) → dedup exact ---
  {
    source: 'app_store', source_id: 'as-006-dup', text: '결제할 때 앱이 자꾸 튕겨요. 결제 버튼 누르면 바로 강제종료됩니다. 환불해주세요.',
    rating: 1, locale: 'ko-KR', app_version: '3.2.1', platform: 'ios',
    created_at: '2026-05-20T13:00:00Z', ingested_at: '2026-05-20T13:30:00Z', raw_payload: {},
  },
  // --- near-dup (as-001 살짝 변형) → near 밴드 힌트 ---
  {
    source: 'play_store', source_id: 'ps-005-near', text: '결제할 때 앱이 자꾸 튕겨요. 결제 버튼 누르면 바로 강제종료되네요. 진짜 불편합니다.',
    rating: 1, locale: 'ko-KR', app_version: '3.2.1', platform: 'android',
    created_at: '2026-05-20T14:00:00Z', ingested_at: '2026-05-20T14:30:00Z', raw_payload: {},
  },
  // --- semanticCache HIT 후보: ps-001(고신뢰 bug)의 근접 변형. SimHash로는 중복 아님(ham>3),
  //     cosine ~0.97 → dedup near 힌트 + 과거 분류 재사용(classify LLM skip). ps-001 뒤에 와야 함. ---
  {
    source: 'play_store', source_id: 'ps-006-cache', text: '로그인이 안 돼요. 로그인 버튼 누르면 멈춤 현상이 계속됩니다. 3.2.0 업데이트 후부터 그래요. ㅜㅜ',
    rating: 2, locale: 'ko-KR', app_version: '3.2.0', platform: 'android',
    created_at: '2026-05-21T09:00:00Z', ingested_at: '2026-05-21T10:00:00Z', raw_payload: {},
  },
  // --- spam: 반복문자 ---
  {
    source: 'app_store', source_id: 'as-007-spam', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    rating: 5, locale: 'ko-KR', platform: 'ios',
    created_at: '2026-05-20T02:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  },
  // --- spam: URL 폭격 ---
  {
    source: 'reddit', source_id: 'rd-003-spam', text: 'buy now http://spam.example http://spam2.example http://spam3.example cheap deals!!!',
    locale: 'en-US', platform: 'web',
    created_at: '2026-05-16T02:00:00Z', ingested_at: '2026-05-16T03:00:00Z', raw_payload: {},
  },
];
