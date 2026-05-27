import type { RawReview } from '../src/contracts/raw-review.js';

// 합성 코퍼스 — 키움증권 연동 주식 자동매매 웹앱 사용자 리뷰.
// Phase 1 분기를 두루 타도록 구성: grounded bug/feature/complaint, gap feature, praise,
// question, resolution, exact-dup, near-dup, spam, PII. "텍스트로 긁어온 리뷰"를 모사.
export const CORPUS: RawReview[] = [
  // --- GROUNDED bug: 실시간 차트 안 뜸 (issue A, 1/2) ---
  {
    source: 'app_store', source_id: 'as-101', text: '실시간 차트가 안 떠요. 종목 선택하면 차트 영역이 계속 빈 화면이고 멈춤 상태예요.',
    rating: 2, locale: 'ko-KR', app_version: '2.4.0', platform: 'web',
    created_at: '2026-05-20T10:00:00Z', ingested_at: '2026-05-20T12:00:00Z', raw_payload: {},
  }, // grounded bug (real-time chart) — issue A
  // --- GROUNDED bug: 실시간 차트 안 뜸 (issue A, 2/2, corroborates) ---
  {
    source: 'play_store', source_id: 'ps-101', text: '차트가 안 떠요ㅠㅠ 실시간 차트 화면만 가면 로딩만 돌고 안 보입니다. 다른 분들도 그런가요.',
    rating: 1, locale: 'ko-KR', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-20T11:30:00Z', ingested_at: '2026-05-20T13:00:00Z', raw_payload: {},
  }, // grounded bug (real-time chart) — issue A (corroborating)
  // --- GROUNDED bug: 자동매도 조건 저장 시 강제종료 ---
  {
    source: 'app_store', source_id: 'as-102', text: '자동매도 조건 저장하면 앱이 튕겨요. 매도 설정에서 저장 버튼 누르는 순간 강제종료됩니다.',
    rating: 1, locale: 'ko-KR', app_version: '2.4.1', platform: 'ios',
    created_at: '2026-05-21T09:00:00Z', ingested_at: '2026-05-21T10:00:00Z', raw_payload: {},
  }, // grounded bug (auto sell settings)
  // --- GROUNDED bug: 수동 주문 강제종료 ---
  {
    source: 'play_store', source_id: 'ps-102', text: '수동으로 매수 주문 누르면 강제종료돼요. 수량 입력하고 주문 버튼 클릭하면 바로 앱이 죽습니다.',
    rating: 1, locale: 'ko-KR', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-21T08:00:00Z', ingested_at: '2026-05-21T10:00:00Z', raw_payload: {},
  }, // grounded bug (manual order)
  // --- GROUNDED bug (EN): 거래내역 화면 멈춤/에러 ---
  {
    source: 'app_store', source_id: 'as-103', text: 'The trade history screen freezes and shows an error when I open it. Realized P/L never loads, the page is just stuck.',
    rating: 2, locale: 'en-US', app_version: '2.4.0', platform: 'web',
    created_at: '2026-05-19T15:00:00Z', ingested_at: '2026-05-19T16:00:00Z', raw_payload: {},
  }, // grounded bug (trade history)

  // --- GROUNDED feature_request/complaint: RSI 임계값 세밀하게 ---
  {
    source: 'reddit', source_id: 'rd-101', text: 'RSI 임계값을 더 세밀하게 설정하고 싶어요. 지금은 5단위로만 되는데 1단위로 조정 가능하게 해주세요.',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-18T07:00:00Z', ingested_at: '2026-05-18T08:00:00Z', raw_payload: {},
  }, // grounded feature_request (RSI threshold)
  // --- GROUNDED complaint: 차트 느림 ---
  {
    source: 'app_store', source_id: 'as-104', text: '실시간 차트가 너무 느려요. 종목 바꿀 때마다 한참 버벅이고 지표 갱신이 늦습니다.',
    rating: 3, locale: 'ko-KR', app_version: '2.4.0', platform: 'web',
    created_at: '2026-05-19T10:00:00Z', ingested_at: '2026-05-19T11:00:00Z', raw_payload: {},
  }, // grounded complaint (chart performance)
  // --- GROUNDED complaint: 종목 검색 불편 ---
  {
    source: 'play_store', source_id: 'ps-103', text: '종목 검색이 불편해요. 대시보드에서 종목 검색할 때 한글 초성 검색이 안 돼서 매번 전체 이름을 다 쳐야 합니다.',
    rating: 3, locale: 'ko-KR', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-19T12:00:00Z', ingested_at: '2026-05-19T13:00:00Z', raw_payload: {},
  }, // grounded complaint (stock search)

  // --- GAP feature_request: 백테스팅 ---
  {
    source: 'reddit', source_id: 'rd-102', text: '백테스팅 기능이 있으면 좋겠어요. 자동매매 전략을 과거 데이터로 시뮬레이션 돌려보고 싶습니다.',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-17T09:00:00Z', ingested_at: '2026-05-17T10:00:00Z', raw_payload: {},
  }, // gap feature_request (backtesting)
  // --- GAP feature_request: 해외주식/코인 ---
  {
    source: 'app_store', source_id: 'as-105', text: '해외주식이랑 코인도 지원해주세요. 국내 주식만 되니까 미국주식 자동매매가 안 돼서 아쉽습니다.',
    rating: 4, locale: 'ko-KR', app_version: '2.4.1', platform: 'web',
    created_at: '2026-05-18T11:00:00Z', ingested_at: '2026-05-18T12:00:00Z', raw_payload: {},
  }, // gap feature_request (overseas/crypto)
  // --- GAP feature_request: 모바일 푸시 알림 ---
  {
    source: 'play_store', source_id: 'ps-104', text: 'Please add mobile push notifications for trade fills and price alerts. Right now I have to keep the web app open to know when an order executes.',
    rating: 4, locale: 'en-US', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-18T13:00:00Z', ingested_at: '2026-05-18T14:00:00Z', raw_payload: {},
  }, // gap feature_request (push notifications/alerts)
  // --- GAP feature_request: 텔레그램 연동 / 다중 전략 ---
  {
    source: 'reddit', source_id: 'rd-103', text: '텔레그램 연동이랑 여러 전략 동시 실행 기능 추가해주세요. 전략 하나씩만 돌릴 수 있어서 불편하고, 체결 알림을 텔레그램으로 받고 싶어요.',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-17T14:00:00Z', ingested_at: '2026-05-17T15:00:00Z', raw_payload: {},
  }, // gap feature_request (telegram + multi-strategy)

  // --- PRAISE (KO) ---
  {
    source: 'app_store', source_id: 'as-106', text: '골든크로스 자동매수 설정해두니까 알아서 매매해줘서 너무 편해요. 거래내역 수익률도 한눈에 보여서 최고입니다!',
    rating: 5, locale: 'ko-KR', app_version: '2.4.1', platform: 'web',
    created_at: '2026-05-20T06:00:00Z', ingested_at: '2026-05-20T07:00:00Z', raw_payload: {},
  }, // praise (auto buy / trade history)
  // --- PRAISE (EN) ---
  {
    source: 'play_store', source_id: 'ps-105', text: 'Love the RSI and MACD auto-trading setup. The real-time chart and portfolio holdings view work great. Best Kiwoom trading app!',
    rating: 5, locale: 'en-US', app_version: '2.4.1', platform: 'web',
    created_at: '2026-05-20T05:00:00Z', ingested_at: '2026-05-20T06:00:00Z', raw_payload: {},
  }, // praise (indicators / chart / holdings)

  // --- QUESTION ---
  {
    source: 'reddit', source_id: 'rd-104', text: '계좌 추가는 어떻게 하나요? 설정에서 키움 계좌 하나 더 등록하고 싶은데 메뉴를 못 찾겠어요.',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-17T04:00:00Z', ingested_at: '2026-05-17T05:00:00Z', raw_payload: {},
  }, // question (account add)

  // --- RESOLUTION report ---
  {
    source: 'play_store', source_id: 'ps-106', text: '예전엔 실시간 차트가 안 떴는데 업데이트 후 잘 돼요. 이제 종목 눌러도 차트 바로 뜹니다. 감사합니다!',
    rating: 5, locale: 'ko-KR', app_version: '2.4.2', platform: 'web',
    created_at: '2026-05-22T04:00:00Z', ingested_at: '2026-05-22T05:00:00Z', raw_payload: {},
  }, // resolution report (chart fixed) — is_resolution_report

  // --- EXACT DUP of as-102 (자동매도 강제종료), source_id만 다름 ---
  {
    source: 'play_store', source_id: 'ps-107-dup', text: '자동매도 조건 저장하면 앱이 튕겨요. 매도 설정에서 저장 버튼 누르는 순간 강제종료됩니다.',
    rating: 1, locale: 'ko-KR', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-21T11:00:00Z', ingested_at: '2026-05-21T12:00:00Z', raw_payload: {},
  }, // exact dup of as-102 (auto sell crash) — dedup exact
  // --- NEAR-DUP of as-102 (살짝 변형) ---
  {
    source: 'app_store', source_id: 'as-107-near', text: '자동매도 조건을 저장하면 앱이 튕깁니다. 매도 설정 화면에서 저장 누르는 순간 강제종료돼요. 너무 불편해요.',
    rating: 1, locale: 'ko-KR', app_version: '2.4.1', platform: 'ios',
    created_at: '2026-05-21T12:30:00Z', ingested_at: '2026-05-21T13:00:00Z', raw_payload: {},
  }, // near-dup of as-102 (auto sell crash) — dedup near

  // --- SPAM: 반복문자 ---
  {
    source: 'app_store', source_id: 'as-108-spam', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    rating: 5, locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-20T02:00:00Z', ingested_at: '2026-05-20T03:00:00Z', raw_payload: {},
  }, // spam (char flooding)
  // --- SPAM: URL 폭격 ---
  {
    source: 'reddit', source_id: 'rd-105-spam', text: '주식 무료 리딩방 http://spam.example http://spam2.example http://spam3.example 지금 가입하세요!!!',
    locale: 'ko-KR', platform: 'web',
    created_at: '2026-05-16T02:00:00Z', ingested_at: '2026-05-16T03:00:00Z', raw_payload: {},
  }, // spam (URL bombing)

  // --- PII: email + 010 phone + 님 honorific name, about existing feature ---
  {
    source: 'slack', source_id: 'sl-101', text: '저는 홍길동님인데 키움 API 키 등록이 안 돼요. 설정에서 자꾸 인증 에러가 납니다. 이메일 gildong@example.com 또는 전화 010-1234-5678 로 연락주세요.',
    rating: 2, locale: 'ko-KR', app_version: '2.4.1', platform: 'web',
    created_at: '2026-05-20T03:00:00Z', ingested_at: '2026-05-20T04:00:00Z', raw_payload: {},
  }, // PII (settings/API key) — redaction

  // --- GAP 중복(다른 표현): 백테스팅 재요청 → rd-102와 같은 의도 (클러스터링 대상) ---
  {
    source: 'app_store', source_id: 'as-109', text: '전략을 과거 데이터로 미리 돌려보고 싶어요. 시뮬레이션으로 수익률 검증하는 기능이 없나요?',
    rating: 4, locale: 'ko-KR', app_version: '2.4.1', platform: 'web',
    created_at: '2026-05-18T15:00:00Z', ingested_at: '2026-05-18T16:00:00Z', raw_payload: {},
  }, // gap feature_request (backtesting, 다른 표현) — clusters with rd-102
  // --- GAP 중복(다른 표현): 코인 재요청 → as-105와 같은 의도 (클러스터링 대상) ---
  {
    source: 'play_store', source_id: 'ps-108', text: '비트코인이나 이더리움 자동매매도 됐으면 좋겠어요. 코인 마켓도 지원해주세요.',
    rating: 4, locale: 'ko-KR', app_version: '2.4.1', platform: 'android',
    created_at: '2026-05-18T17:00:00Z', ingested_at: '2026-05-18T18:00:00Z', raw_payload: {},
  }, // gap feature_request (crypto, 다른 표현) — clusters with as-105
];
