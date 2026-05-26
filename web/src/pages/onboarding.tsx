// ============================================================
// Onboarding — first-run setup wizard (modal)
// ============================================================

import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { Icons } from '../components/icons';
import { Card, Badge, Button, SourceChip } from '../components/ui';

interface Step {
  key: string;
  label: string;
}

const STEPS: Step[] = [
  { key: 'product',     label: 'Product' },
  { key: 'repo',        label: 'Connect repo' },
  { key: 'sources',     label: 'Review sources' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'skills',      label: 'Skills & schedule' },
  { key: 'integrations',label: 'Approval flow' },
  { key: 'infra',       label: 'Infrastructure' },
  { key: 'review',      label: 'Review & finish' },
];

export function OnboardingFlow({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  const next = () => setIdx(i => Math.min(STEPS.length - 1, i + 1));
  const back = () => setIdx(i => Math.max(0, i - 1));

  return (
    <div className="onboarding" onClick={onClose}>
      <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
        {/* Rail */}
        <div className="onb-rail">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
            <div className="brand-mark"><Icons.Sparkles /></div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>Welcome to SelfHeal</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Setup · {idx + 1} of {STEPS.length}</div>
            </div>
          </div>
          {STEPS.map((s, i) => (
            <div key={s.key} className={`onb-step ${i < idx ? 'done' : ''} ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
              <div className="num">{i < idx ? <Icons.Check /> : i + 1}</div>
              <div className="lbl">{s.label}</div>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: 'var(--fg-subtle)', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            You can revisit any step from Settings later.
          </div>
        </div>

        {/* Body */}
        <div className="onb-body">
          <div className="onb-content">
            {step.key === 'product'      && <StepProduct />}
            {step.key === 'repo'         && <StepRepo />}
            {step.key === 'sources'      && <StepSources />}
            {step.key === 'competitors'  && <StepCompetitors />}
            {step.key === 'skills'       && <StepSkills />}
            {step.key === 'integrations' && <StepIntegrations />}
            {step.key === 'infra'        && <StepInfra />}
            {step.key === 'review'       && <StepReview />}
          </div>
          <div className="onb-foot">
            <Button variant="ghost" onClick={onClose}>Save & exit</Button>
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Step {idx + 1} of {STEPS.length}</span>
            <Button variant="ghost" leftIcon={<Icons.ChevLeft />} onClick={back} disabled={idx === 0}>Back</Button>
            {idx < STEPS.length - 1
              ? <Button variant="primary" rightIcon={<Icons.ArrowRight />} onClick={next}>Continue</Button>
              : <Button variant="primary" rightIcon={<Icons.Check />} onClick={onClose}>Activate SelfHeal</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface StepHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
}
function StepHeader({ title, sub }: StepHeaderProps) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--fg-strong)', letterSpacing: '-0.02em' }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

function StepProduct() {
  return (
    <Fragment>
      <StepHeader title="Tell us about your product" sub="SelfHeal listens for reviews of this product across sources you'll add next." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormRow label="Product name" hint="Shown in proposal cards & Slack posts.">
          <input className="input" defaultValue="Loop" />
        </FormRow>
        <FormRow label="One-line description" hint="Used to tune the classification skill.">
          <input className="input" defaultValue="AI meeting notes & transcription for distributed teams" />
        </FormRow>
        <FormRow label="Primary user language(s)" hint="Reviews in other languages are translated before classification.">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['English', 'Korean', 'Japanese', 'German', 'French'].map(l =>
              <Badge key={l} tone={l === 'English' || l === 'Korean' ? 'good' : ''} subtle>{l}{(l === 'English' || l === 'Korean') && ' ✓'}</Badge>
            )}
          </div>
        </FormRow>
        <FormRow label="Roadmap themes" hint="Proposals weighted toward these themes.">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['transcription quality', 'enterprise readiness', 'integrations', 'speed'].map(l =>
              <Badge key={l} tone="purple" subtle>{l}</Badge>
            )}
            <Button size="sm" variant="ghost" leftIcon={<Icons.Plus />}>Add theme</Button>
          </div>
        </FormRow>
      </div>
    </Fragment>
  );
}

function StepRepo() {
  return (
    <Fragment>
      <StepHeader title="Connect your code repository" sub="SelfHeal builds a module map and links each cluster of reviews to the relevant code." />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center' }}>
          <Icons.Github />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>loop / loop-app</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }} className="mono">main · 247k LOC · 14 contributors · last commit 6m ago</div>
          </div>
          <Badge tone="good" dot>Connected</Badge>
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FormRow label="Branch to track">
          <input className="input mono" defaultValue="main" />
        </FormRow>
        <FormRow label="Module map" hint="SelfHeal scanned 14 top-level packages and tagged 86 sub-modules. You can refine after onboarding.">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['transcribe/', 'summary/', 'integrations/', 'mobile/', 'collab/', 'auth/', 'billing/', 'web/', 'shared/'].map(m =>
              <Badge key={m} subtle><Icons.Folder /><span className="mono">{m}</span></Badge>
            )}
            <Badge subtle>+ 5 more</Badge>
          </div>
        </FormRow>
        <FormRow label="Ignore patterns" hint="Modules to skip when mapping reviews (tests, infra, docs).">
          <input className="input mono" defaultValue="**/test/**, infra/**, docs/**, scripts/**" />
        </FormRow>
      </div>
    </Fragment>
  );
}

function StepSources() {
  const [picked, setPicked] = useState<string[]>(['appstore', 'playstore', 'reddit', 'twitter']);
  const all: { k: string; l: string; d: string }[] = [
    { k: 'appstore',  l: 'Apple App Store',  d: 'Reviews via App Store Connect' },
    { k: 'playstore', l: 'Google Play',      d: 'Reviews via Play Developer API' },
    { k: 'reddit',    l: 'Reddit',           d: 'Subreddit / keyword crawl' },
    { k: 'twitter',   l: 'X / Twitter',      d: 'Mentions & keyword search' },
    { k: 'github',    l: 'GitHub issues',    d: 'Open issues / discussions' },
    { k: 'intercom',  l: 'Intercom',         d: 'Support conversations' },
    { k: 'discord',   l: 'Discord',          d: 'Community server' },
    { k: 'web',       l: 'Custom URL / RSS', d: 'Any public reviews page' },
  ];
  const toggle = (k: string) => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  return (
    <Fragment>
      <StepHeader title="Where should SelfHeal listen?" sub="Pick all the places your users talk about Loop." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {all.map(s => {
          const on = picked.includes(s.k);
          return (
            <div key={s.k} onClick={() => toggle(s.k)}
              style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 18px', gap: 10, padding: 12,
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8, cursor: 'pointer',
                background: on ? 'var(--accent-soft)' : 'var(--surface)'
              }}
            >
              <SourceChip src={s.k} label="" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{s.l}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{s.d}</div>
              </div>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-fg)' }}>
                {on && <Icons.Check />}
              </span>
            </div>
          );
        })}
      </div>
    </Fragment>
  );
}

function StepCompetitors() {
  return (
    <Fragment>
      <StepHeader title="Track competitors (optional)" sub="Comparing review patterns against similar products surfaces unmet needs you don't see in your own reviews." />
      <Card>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { name: 'Otter.ai',   sources: ['appstore', 'reddit', 'twitter'], reviews: '~ 412 / week' },
            { name: 'Fireflies',  sources: ['appstore', 'playstore', 'web'],  reviews: '~ 156 / week' },
            { name: 'Tactiq',     sources: ['appstore', 'reddit'],             reviews: '~ 38 / week' },
          ].map(c => (
            <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, alignItems: 'center', padding: '10px 6px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }} className="mono">{c.reviews}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>{c.sources.map(s => <SourceChip key={s} src={s} label="" />)}</div>
              <Badge tone="purple" subtle>competitor</Badge>
              <Button size="sm" variant="ghost" className="icon-only"><Icons.Trash /></Button>
            </div>
          ))}
          <Button variant="ghost" leftIcon={<Icons.Plus />} style={{ alignSelf: 'flex-start' }}>Add competitor</Button>
        </div>
      </Card>
    </Fragment>
  );
}

function StepSkills() {
  return (
    <Fragment>
      <StepHeader title="Skills & schedule" sub="Sensible defaults are pre-selected. You can fine-tune later in Settings → Pipeline." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card title="Models per stage">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { stage: 'Filter',    model: 'claude-haiku-4-5' },
              { stage: 'Classify',  model: 'claude-sonnet-4-6' },
              { stage: 'Insights',  model: 'claude-opus-4-7' },
              { stage: 'Auto-Dev',  model: 'claude-sonnet-4-6' },
            ].map(r => (
              <div key={r.stage} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{r.stage}</div>
                <Badge tone="purple" subtle style={{ alignSelf: 'flex-start' }}><Icons.Sparkles />{r.model}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Cadence">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Setting2 label="Insight generation" v="Weekly · Mon 09:00 KST" />
            <Setting2 label="Clustering"         v="Every 6 hours" />
            <Setting2 label="Ingestion polling"  v="Every 10 minutes" />
            <Setting2 label="Slack digest"       v="Daily · 09:00 KST" />
          </div>
        </Card>
      </div>
      <Card title="Estimated cost" style={{ marginTop: 14 }}>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <CostStat label="Monthly est." v="$94 – $128" sub="@ ~5,000 reviews / month" />
          <CostStat label="Per PR opened" v="$1.20 avg" sub="agent only · excludes inference cache" />
          <CostStat label="Prompt caching" v="Saves 90%" sub="on filter & classify stages" />
        </div>
      </Card>
    </Fragment>
  );
}

interface Setting2Props {
  label: ReactNode;
  v: ReactNode;
}
function Setting2({ label, v }: Setting2Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 8, alignItems: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{v}</div>
      <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />}>Edit</Button>
    </div>
  );
}

interface CostStatProps {
  label: ReactNode;
  v: ReactNode;
  sub: ReactNode;
}
function CostStat({ label, v, sub }: CostStatProps) {
  return (
    <div>
      <div className="t-caps">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--fg-strong)' }} className="mono">{v}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function StepIntegrations() {
  return (
    <Fragment>
      <StepHeader title="Approval flow" sub="Where humans review and approve proposals. Slack is required to complete onboarding." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center' }}>
            <Icons.Slack />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>Slack — Loop HQ</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Posts proposal cards to #selfheal-review · 3 channels configured</div>
            </div>
            <Badge tone="good" dot>Connected</Badge>
          </div>
        </Card>
        <Card>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center' }}>
            <Icons.Github />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>GitHub — loop/loop-app</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Opens issues on approval · Auto-Dev pushes branches</div>
            </div>
            <Badge tone="good" dot>Connected</Badge>
          </div>
        </Card>
        <Card>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center' }}>
            <Icons.Layers />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>Linear (optional)</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Mirror approved proposals to Linear for sprint planning</div>
            </div>
            <Button leftIcon={<Icons.Plus />}>Connect</Button>
          </div>
        </Card>
      </div>
    </Fragment>
  );
}

function StepInfra() {
  return (
    <Fragment>
      <StepHeader title="Infrastructure" sub="Where SelfHeal stores raw reviews and embeddings. Defaults work for most teams." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FormRow label="Vector DB" hint="Stores review embeddings for clustering & similarity.">
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge tone="accent" subtle>pgvector (managed)</Badge>
            <Badge subtle>Qdrant Cloud</Badge>
            <Badge subtle>Bring your own</Badge>
          </div>
        </FormRow>
        <FormRow label="Raw storage" hint="Immutable copy of every ingested review.">
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge tone="accent" subtle>AWS S3 · ap-northeast-2</Badge>
            <Badge subtle>GCS</Badge>
            <Badge subtle>R2</Badge>
          </div>
        </FormRow>
        <FormRow label="Region" hint="Where compute & DB live. Affects latency for reviewers.">
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge tone="accent" subtle>ap-northeast-2 (Seoul)</Badge>
            <Badge subtle>us-east-1</Badge>
            <Badge subtle>eu-west-1</Badge>
          </div>
        </FormRow>
        <FormRow label="Observability" hint="Optional — token usage, latency, error rates per stage.">
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge subtle>Datadog</Badge>
            <Badge subtle>Grafana Cloud</Badge>
            <Badge subtle>None</Badge>
          </div>
        </FormRow>
      </div>
    </Fragment>
  );
}

function StepReview() {
  return (
    <Fragment>
      <StepHeader title="You're ready" sub="Here's what SelfHeal will start doing in the next 10 minutes." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['1', 'Pull last 30 days of reviews', 'from App Store, Play, Reddit, X · ~3,400 expected'],
          ['2', 'Build module map', 'from loop/loop-app · 86 features in 14 modules'],
          ['3', 'First clustering pass', 'voyage-3 embeddings · k = ~150 clusters'],
          ['4', 'First insight batch', 'Opus on top 12 clusters · ~$3 one-time'],
          ['5', 'Post to #selfheal-review', 'Maya & Daniel notified · waiting for approvals'],
        ].map(([n, t, sub]) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 12, padding: '10px 14px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{n}</div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--fg-strong)', fontWeight: 500 }}>{t}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, padding: 12, border: '1px dashed var(--border-strong)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icons.Lightning />
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Auto-Dev is <strong style={{ color: 'var(--fg)' }}>off by default</strong> for the first 7 days — we'll only generate insights so you can calibrate. Flip it on from Settings → Pipeline when ready.
        </div>
      </div>
    </Fragment>
  );
}

interface FormRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}
function FormRow({ label, hint, children }: FormRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, alignItems: 'start' }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
