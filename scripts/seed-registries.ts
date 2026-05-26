import { Db } from '../src/db/db.js';
import { makeEmbeddingClient } from '../src/clients/embedding/index.js';
import { toSqlVector } from '../src/util/vector.js';
import { classifyCodeRisk } from '../src/util/code-risk.js';

// feature_registry(SKOS) + code_artifact_registry 시드.
// alt_labels에 stub classifier가 뽑는 표면형을 포함 → exact alias 매칭으로 결정론적 검증.

interface FeatureSeed {
  slug: string;
  pref: string;
  alts: string[];
  desc: string;
}

const FEATURES: FeatureSeed[] = [
  { slug: 'payment', pref: '결제', alts: ['결제', '구매', '결제 화면', 'payment', 'checkout', 'purchase', 'billing'], desc: '인앱 결제, 구매, 청구 및 결제 수단 관리' },
  { slug: 'login', pref: '로그인/인증', alts: ['로그인', '로그아웃', 'login', 'log in', 'sign in', 'auth'], desc: '로그인, 회원가입, 소셜 인증, 세션 관리' },
  { slug: 'push_notifications', pref: '푸시 알림', alts: ['알림', '푸시', 'notification', 'push'], desc: '푸시 알림 수신, 알림 설정 및 권한' },
  { slug: 'search', pref: '검색', alts: ['검색', 'search'], desc: '검색창, 검색 결과, 필터 및 자동완성' },
  { slug: 'map', pref: '지도', alts: ['지도', '맵', 'map'], desc: '지도 표시, 위치, 경로 안내' },
  { slug: 'profile', pref: '프로필/계정', alts: ['프로필', 'profile', 'account'], desc: '프로필 편집, 계정 설정' },
  { slug: 'photo_upload', pref: '사진 업로드', alts: ['업로드', '사진', 'upload', 'photo', 'image'], desc: '사진/이미지 업로드 및 첨부' },
];

interface CodeSeed {
  repo: string;
  path: string;
  module: string;
  symbol: string | null;
  owners: string[];
  features: string[]; // slug
  desc: string;
}

const CODE: CodeSeed[] = [
  { repo: 'org/app-ios', path: 'Sources/Payment/PaymentView.swift', module: 'Payment', symbol: 'PaymentView.submit()', owners: ['@team-payments'], features: ['payment'], desc: '결제 화면, 결제 버튼, 결제 수단 선택' },
  { repo: 'org/app-ios', path: 'Sources/Auth/LoginViewModel.swift', module: 'Auth', symbol: 'LoginViewModel.login()', owners: ['@team-identity'], features: ['login'], desc: '로그인 화면 및 인증 처리' },
  { repo: 'org/app-ios', path: 'Sources/Notifications/PushManager.swift', module: 'Notifications', symbol: null, owners: ['@team-growth'], features: ['push_notifications'], desc: '푸시 알림 등록 및 표시' },
  { repo: 'org/app-ios', path: 'Sources/Search/SearchController.swift', module: 'Search', symbol: null, owners: ['@team-discovery'], features: ['search'], desc: '검색 입력 및 결과 렌더링' },
  { repo: 'org/app-ios', path: 'Sources/Map/MapView.swift', module: 'Map', symbol: null, owners: ['@team-maps'], features: ['map'], desc: '지도 렌더링 및 위치 추적' },
  { repo: 'org/app-ios', path: 'Sources/Media/PhotoUploader.swift', module: 'Media', symbol: 'PhotoUploader.upload()', owners: ['@team-media'], features: ['photo_upload'], desc: '사진 업로드 파이프라인' },
];

async function main() {
  const db = new Db();
  const embedder = makeEmbeddingClient();

  // 멱등 시드 — 기존 레지스트리 비우고 다시
  await db.query('DELETE FROM code_artifact_registry');
  await db.query('DELETE FROM feature_registry');

  const idBySlug = new Map<string, string>();
  for (const f of FEATURES) {
    const emb = await embedder.embed([f.pref, ...f.alts, f.desc].join(' '));
    const rows = await db.query<{ id: string }>(
      `INSERT INTO feature_registry (canonical_slug, pref_label, alt_labels, description, embedding)
       VALUES ($1,$2,$3,$4,$5::vector) RETURNING id`,
      [f.slug, f.pref, f.alts, f.desc, toSqlVector(emb.vector)],
    );
    idBySlug.set(f.slug, rows[0]!.id);
  }
  console.log(`✅ feature_registry: ${FEATURES.length} concepts`);

  const riskDist: Record<string, number> = {};
  for (const c of CODE) {
    const emb = await embedder.embed([c.path, c.module, c.symbol ?? '', c.desc].join(' '));
    const featureIds = c.features.map((s) => idBySlug.get(s)!).filter(Boolean);
    // 경로/모듈/설명 기반 risk tier (bug-hunter triage 휴리스틱 이식)
    const risk = classifyCodeRisk(c.path, c.module, c.symbol, c.desc);
    riskDist[risk.tier] = (riskDist[risk.tier] ?? 0) + 1;
    await db.query(
      `INSERT INTO code_artifact_registry (repo, path, module, symbol, owners, feature_ids, description, embedding, risk_tier, risk_score)
       VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7,$8::vector,$9,$10)
       ON CONFLICT (repo, path, symbol) DO UPDATE
         SET risk_tier = EXCLUDED.risk_tier, risk_score = EXCLUDED.risk_score`,
      [c.repo, c.path, c.module, c.symbol, c.owners, featureIds, c.desc, toSqlVector(emb.vector), risk.tier, risk.score],
    );
  }
  console.log(`✅ code_artifact_registry: ${CODE.length} artifacts (risk: ${JSON.stringify(riskDist)})`);

  await db.close();
}

main().catch((e) => {
  console.error('❌ seed failed:', e.message);
  process.exit(1);
});
