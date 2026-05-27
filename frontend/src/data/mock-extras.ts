// ============================================================
// SelfHeal — Extended mock data: raw reviews + audit events
// ============================================================

import type { SourceKind } from './mock';

// ----- Domain types --------------------------------------------------------

export interface RawReview {
  id: string;
  src: SourceKind;
  author: string;
  country: string;
  lang: string;
  rating: number | null;
  sentiment: 'pos' | 'neg' | 'neu' | 'mix';
  priority: string;
  when: string;
  text: string;
  text_en?: string;
  category: string;
  confidence: number;
  mapped: string | null;
  mappedLabel: string;
  cluster: string | null;
  tags: string[];
  isOrphan?: boolean;
  filtered?: boolean;
}

export interface AuditEvent {
  id: string;
  t: string;
  day: string;
  actor: string;
  actorKind: 'agent' | 'human' | 'system';
  type: string;
  title: string;
  target: string;
  detail: string;
  tone: 'accent' | 'good' | 'info' | 'purple' | 'danger' | 'warn';
}

// ----- Raw reviews ---------------------------------------------------------
// Realistic, varied sample across sources / sentiment / language.
export const RAW_REVIEWS: RawReview[] = [
  {
    id: 'r_8801',
    src: 'appstore', author: '@sj_kim_pm', country: 'KR', lang: 'KR',
    rating: 1, sentiment: 'neg', priority: 'P0',
    when: '14 min ago',
    text: '한국어 인식이 진짜 너무 별로예요. 회의실에서 쓰면 거의 알아듣질 못함. 가격은 비싸고 인식률은 60% 정도밖에 안 됩니다.',
    category: 'Transcription quality',
    confidence: 0.92,
    mapped: 't_ko', mappedLabel: 'transcribe/korean-asr',
    cluster: 'cluster_91',
    tags: ['accuracy', 'noise', 'churn-risk'],
  },
  {
    id: 'r_8800',
    src: 'twitter', author: '@dev_max', country: 'US', lang: 'EN',
    rating: null, sentiment: 'pos', priority: 'P1',
    when: '18 min ago',
    text: "Loving @loopnotes but we live in Microsoft Teams. Any plan for Teams calendar/bot integration? Otherwise rolling out feels impossible.",
    category: 'Feature request',
    confidence: 0.89,
    mapped: 'orphan_teams', mappedLabel: '(unmapped) ms-teams-integration',
    cluster: 'cluster_88',
    tags: ['feature-request', 'enterprise'],
    isOrphan: true,
  },
  {
    id: 'r_8799',
    src: 'reddit', author: 'u/ada_writes', country: 'CA', lang: 'EN',
    rating: null, sentiment: 'mix', priority: 'P2',
    when: '23 min ago',
    text: "Switched from Otter to Loop. Transcription is better in English but the summary truncates anything past ~90 minutes. Our weekly EBR is 2 hours, useless.",
    category: 'Performance / output',
    confidence: 0.87,
    mapped: 's_bullets', mappedLabel: 'summary/bullet-points',
    cluster: 'cluster_84',
    tags: ['truncation', 'long-meetings'],
  },
  {
    id: 'r_8798',
    src: 'intercom', author: 'lisa@northstar.io', country: 'US', lang: 'EN',
    rating: null, sentiment: 'neg', priority: 'P0',
    when: '32 min ago',
    text: "Hard crash every time my iPad rotates while recording in Split View. Reproducible 100% on M2 iPad Pro, iPadOS 17.4.1. Lost 40 minutes of a customer call.",
    category: 'Bug / crash',
    confidence: 0.96,
    mapped: 'm_ipad', mappedLabel: 'mobile/ipad',
    cluster: 'cluster_92',
    tags: ['crash', 'reproducible'],
  },
  {
    id: 'r_8797',
    src: 'playstore', author: '@kenta_w', country: 'JP', lang: 'JP',
    rating: 2, sentiment: 'neg', priority: 'P1',
    when: '41 min ago',
    text: '日本語の話者の区別がうまくいきません。3人以上の会議で誰の発言かが完全に混ざってしまいます。',
    text_en: "Japanese speaker diarization fails — in meetings with 3+ people, attribution gets completely mixed up.",
    category: 'Transcription quality',
    confidence: 0.88,
    mapped: 't_dia', mappedLabel: 'transcribe/speaker-diarization',
    cluster: 'cluster_77',
    tags: ['diarization', 'jp'],
  },
  {
    id: 'r_8796',
    src: 'appstore', author: 'mtnclimber', country: 'US', lang: 'EN',
    rating: 5, sentiment: 'pos', priority: 'P3',
    when: '52 min ago',
    text: "Best meeting notes app I've used. The action-item extraction is uncanny. Just wish there was a home-screen widget so I could see my last meeting at a glance.",
    category: 'Feature request',
    confidence: 0.84,
    mapped: 'orphan_widget', mappedLabel: '(unmapped) ios-widget',
    cluster: 'cluster_72',
    tags: ['feature-request', 'ios'],
    isOrphan: true,
  },
  {
    id: 'r_8795',
    src: 'reddit', author: 'u/devops_dan', country: 'DE', lang: 'EN',
    rating: null, sentiment: 'neu', priority: 'P2',
    when: '1 h ago',
    text: "How does Loop handle GDPR? Where does the audio actually get stored? Couldn't find clear docs.",
    category: 'Onboarding / UX',
    confidence: 0.72,
    mapped: 'auth', mappedLabel: 'auth/',
    cluster: 'cluster_61',
    tags: ['gdpr', 'docs'],
  },
  {
    id: 'r_8794',
    src: 'twitter', author: '@notion_user', country: 'UK', lang: 'EN',
    rating: null, sentiment: 'neg', priority: 'P1',
    when: '1 h ago',
    text: "Loop's Notion sync ignores nested page permissions and dumps meeting notes into channels people shouldn't see. Disabled it for our org.",
    category: 'Bug',
    confidence: 0.94,
    mapped: 'i_notion', mappedLabel: 'integrations/notion',
    cluster: 'cluster_64',
    tags: ['permissions', 'security'],
  },
  {
    id: 'r_8793',
    src: 'intercom', author: 'priya@helixcorp.com', country: 'IN', lang: 'EN',
    rating: null, sentiment: 'pos', priority: 'P2',
    when: '1 h ago',
    text: "Would pay 2x for a 'training mode' where the model picks up our internal acronyms after a few meetings. Currently we get 'EBITDA' as 'EBA dude' constantly.",
    category: 'Feature request',
    confidence: 0.79,
    mapped: 't_en', mappedLabel: 'transcribe/english-asr',
    cluster: 'cluster_55',
    tags: ['custom-vocab'],
  },
  {
    id: 'r_8792',
    src: 'appstore', author: 'cynical_eng', country: 'US', lang: 'EN',
    rating: 1, sentiment: 'neg', priority: 'P2',
    when: '2 h ago',
    text: "App constantly drains battery on iPhone 13. Background recording for a 45-min meeting = 28% battery. Unusable on long days.",
    category: 'Performance',
    confidence: 0.91,
    mapped: 'm_ios', mappedLabel: 'mobile/ios',
    cluster: 'cluster_58',
    tags: ['battery', 'performance'],
  },
  {
    id: 'r_8791',
    src: 'reddit', author: 'u/sarah_pm', country: 'AU', lang: 'EN',
    rating: null, sentiment: 'pos', priority: 'P3',
    when: '2 h ago',
    text: "Loop's Slack digest is the most useful integration I've added in months. Daily summary into the right channel, done.",
    category: 'Praise',
    confidence: 0.88,
    mapped: 'i_slack', mappedLabel: 'integrations/slack',
    cluster: 'cluster_45',
    tags: ['praise'],
  },
  {
    id: 'r_8790',
    src: 'playstore', author: '@hcho_works', country: 'KR', lang: 'KR',
    rating: 2, sentiment: 'mix', priority: 'P1',
    when: '2 h ago',
    text: '한국어가 5명 회의에서는 거의 안 들리는데 1:1에서는 괜찮습니다. 회의실 마이크 환경에서 개선 필요.',
    text_en: "Korean works ok 1:1 but is mostly unusable in 5-person meetings. Conference room mic environments need work.",
    category: 'Transcription quality',
    confidence: 0.86,
    mapped: 't_ko', mappedLabel: 'transcribe/korean-asr',
    cluster: 'cluster_91',
    tags: ['accuracy', 'noise'],
  },
  {
    id: 'r_8789',
    src: 'intercom', author: 'enterprise-it@acme.co', country: 'US', lang: 'EN',
    rating: null, sentiment: 'neu', priority: 'P1',
    when: '3 h ago',
    text: "We need SSO via Okta SAML to roll out org-wide. Where is this on the roadmap?",
    category: 'Feature request',
    confidence: 0.93,
    mapped: 'a_sso', mappedLabel: 'auth/sso',
    cluster: 'cluster_38',
    tags: ['enterprise', 'sso'],
  },
  {
    id: 'r_8788',
    src: 'twitter', author: '@offline_first', country: 'US', lang: 'EN',
    rating: null, sentiment: 'mix', priority: 'P2',
    when: '3 h ago',
    text: "Wish Loop worked offline. I take notes on flights and Loop just stalls with 'reconnecting'.",
    category: 'Feature request',
    confidence: 0.82,
    mapped: 'orphan_offline', mappedLabel: '(unmapped) offline-mode',
    cluster: 'cluster_71',
    tags: ['offline', 'feature-request'],
    isOrphan: true,
  },
  {
    id: 'r_8787',
    src: 'appstore', author: '@nicole_b', country: 'FR', lang: 'FR',
    rating: 4, sentiment: 'mix', priority: 'P3',
    when: '4 h ago',
    text: "Excellent en anglais mais le français manque encore de précision pour les noms propres et les acronymes techniques.",
    text_en: "Great in English but French still lacks precision for proper nouns and technical acronyms.",
    category: 'Transcription quality',
    confidence: 0.81,
    mapped: 't_en', mappedLabel: 'transcribe/english-asr',
    cluster: 'cluster_47',
    tags: ['fr', 'custom-vocab'],
  },
  {
    id: 'r_8786',
    src: 'reddit', author: 'u/spammy_2026', country: '—', lang: 'EN',
    rating: null, sentiment: 'neu', priority: 'P3',
    when: '4 h ago',
    text: "🔥🔥 CRYPTO ALERT 🔥🔥 Best trades of 2026 — check my profile —",
    category: 'Spam',
    confidence: 0.99,
    mapped: null, mappedLabel: '— filtered —',
    cluster: null,
    tags: ['spam'],
    filtered: true,
  },
];

// ----- Audit / Activity events --------------------------------------------
// Detailed timeline events for the audit log page.
export const AUDIT_EVENTS: AuditEvent[] = [
  { id: 'ev_1042', t: '14:38:24', day: 'Today',     actor: 'agent_1847',  actorKind: 'agent',  type: 'agent_step',
    title: 'Auto-Dev step: running tests',          target: 'PR #1847',
    detail: 'AudioSessionCoordinatorTests · 8 / 8 passed (1.4s)', tone: 'good' },
  { id: 'ev_1041', t: '14:36:48', day: 'Today',     actor: 'agent_1847',  actorKind: 'agent',  type: 'agent_step',
    title: 'Auto-Dev step: code written',           target: 'fix/p-236-ipad-rotation-crash',
    detail: '4 files changed · +127 −38', tone: 'info' },
  { id: 'ev_1040', t: '14:24:11', day: 'Today',     actor: 'Maya Ortiz',  actorKind: 'human',  type: 'approval',
    title: 'Approved proposal P-236',               target: 'iPad split-view crash on rotation',
    detail: 'via Slack #selfheal-review · dispatched to Auto-Dev', tone: 'good' },
  { id: 'ev_1039', t: '14:18:02', day: 'Today',     actor: 'system',      actorKind: 'system', type: 'insight',
    title: 'New insight cluster',                   target: 'cluster_92 · 47 reviews',
    detail: 'iPad split-view crash · confidence 0.97 · skill: claude-opus-4-7', tone: 'purple' },
  { id: 'ev_1038', t: '14:02:55', day: 'Today',     actor: 'Daniel Kim',  actorKind: 'human',  type: 'reject',
    title: 'Rejected proposal P-235',               target: 'Custom summary templates',
    detail: 'Reason: Out of scope for Q1 — overlaps with workspace-templates RFC (Issue #2104)', tone: 'danger' },
  { id: 'ev_1037', t: '13:58:11', day: 'Today',     actor: 'system',      actorKind: 'system', type: 'ingestion',
    title: 'Synced reviews from App Store',         target: 'src_1',
    detail: '312 new reviews · 0 errors · 1.2s', tone: 'info' },
  { id: 'ev_1036', t: '13:42:30', day: 'Today',     actor: 'agent_1832',  actorKind: 'agent',  type: 'agent_failed',
    title: 'Auto-Dev failed at test stage',         target: 'PR draft #1832',
    detail: 'integrations/notion/sync_test.ts:128 — flaky timing assert (1 / 22 failed)', tone: 'danger' },
  { id: 'ev_1035', t: '13:11:00', day: 'Today',     actor: 'system',      actorKind: 'system', type: 'cluster',
    title: 'Re-clustering complete',                target: '148 clusters',
    detail: 'voyage-3 embeddings · k=148 · silhouette 0.71', tone: 'info' },
  { id: 'ev_1034', t: '12:48:09', day: 'Today',     actor: 'Sam Chen',    actorKind: 'human',  type: 'merge',
    title: 'Merged PR #1841',                       target: 'fix: summary truncation for >90 min meetings',
    detail: 'CI green · 8 / 8 checks · 1 approval (Maya Ortiz)', tone: 'good' },
  { id: 'ev_1033', t: '12:14:22', day: 'Today',     actor: 'Maya Ortiz',  actorKind: 'human',  type: 'settings',
    title: 'Changed schedule',                      target: 'Insight generation',
    detail: 'Cadence: Bi-weekly → Weekly (Mon 09:00 KST)', tone: 'warn' },
  { id: 'ev_1032', t: '09:00:00', day: 'Today',     actor: 'system',      actorKind: 'system', type: 'digest',
    title: 'Posted daily Slack digest',             target: '#selfheal-digest',
    detail: '34 new reviews summarized · 4 new clusters · 0 high-priority', tone: 'info' },
  { id: 'ev_1031', t: '23:14:08', day: 'Yesterday', actor: 'system',      actorKind: 'system', type: 'agent_done',
    title: 'Auto-Dev opened PR #1839',              target: 'feat: per-speaker volume normalization',
    detail: 'agent_1839 · 7 files · +389 −41 · awaiting human review', tone: 'accent' },
  { id: 'ev_1030', t: '21:02:00', day: 'Yesterday', actor: 'Priya Shah',  actorKind: 'human',  type: 'approval',
    title: 'Approved proposal P-234',               target: 'Per-speaker volume normalization',
    detail: 'via Slack · auto-dispatched to Auto-Dev', tone: 'good' },
  { id: 'ev_1029', t: '18:45:33', day: 'Yesterday', actor: 'system',      actorKind: 'system', type: 'security',
    title: 'API key rotated',                       target: 'Anthropic API',
    detail: 'Quarterly auto-rotation · old key revoked', tone: 'warn' },
  { id: 'ev_1028', t: '14:12:01', day: 'Yesterday', actor: 'Maya Ortiz',  actorKind: 'human',  type: 'invite',
    title: 'Invited team member',                   target: 'ava@loop.app',
    detail: 'Role: Read-only · Permissions: view', tone: 'info' },
  { id: 'ev_1027', t: '11:34:55', day: 'Yesterday', actor: 'system',      actorKind: 'system', type: 'ingestion',
    title: 'Source Reddit slowed',                  target: 'src_8 · r/Otter mentions',
    detail: 'Sync interval > 3h (threshold 1h) · alerted on-call', tone: 'warn' },
  { id: 'ev_1026', t: '09:00:00', day: 'Yesterday', actor: 'system',      actorKind: 'system', type: 'insight',
    title: 'Weekly insight batch',                  target: '12 clusters → 8 proposals',
    detail: 'claude-opus-4-7 · cost $2.84 · avg confidence 0.86', tone: 'purple' },
];
