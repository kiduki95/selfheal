// ============================================================
// Reviews — raw stream, filters, detail panel
// ============================================================

import { Fragment, useState } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { Icons } from '../components/icons';
import { Card, SectionHead, Badge, Button, SourceChip, Spark, SkeletonList, ErrorState } from '../components/ui';
import { useReviews } from '../api/hooks/useReviews';
import type { RawReview } from '../data/mock-extras';

interface Filters {
  src: string;
  sentiment: string;
  priority: string;
  mapped: string;
  lang: string;
  search: string;
}

export function ReviewsPage() {
  const [filters, setFilters] = useState<Filters>({
    src: 'all', sentiment: 'all', priority: 'all', mapped: 'all',
    lang: 'all', search: '',
  });
  // Selection starts unset; the first filtered row is used as a fallback below.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useReviews();
  const RAW_REVIEWS = data?.data ?? [];

  const filtered = RAW_REVIEWS.filter(r => {
    if (filters.src !== 'all' && r.src !== filters.src) return false;
    if (filters.sentiment !== 'all' && r.sentiment !== filters.sentiment) return false;
    if (filters.priority !== 'all' && r.priority !== filters.priority) return false;
    if (filters.mapped === 'orphan' && !r.isOrphan) return false;
    if (filters.mapped === 'filtered' && !r.filtered) return false;
    if (filters.lang !== 'all' && r.lang !== filters.lang) return false;
    if (filters.search && !(r.text + (r.text_en || '')).toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });

  const selected = filtered.find(r => r.id === selectedId) || filtered[0];

  return (
    <Fragment>
      {/* === Overview — summary stats === */}
      <section className="section">
        <SectionHead
          eyebrow="Overview"
          title="At a glance"
          action={<span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>last 24 hours</span>}
        />
        <div className="l-grid">
          <Card className="col-2" pad>
            <div className="t-caps">Reviews · 24h</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">487</div>
              <span className="stat-delta up mono"><Icons.ArrowUp />+12%</span>
            </div>
            <div style={{ marginTop: 6 }}><Spark data={[18, 22, 28, 31, 26, 38, 42, 39, 48]} h={24} w={200} /></div>
          </Card>
          <Card className="col-2" pad>
            <div className="t-caps">Negative</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--danger)' }} className="mono">142</div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>29%</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Top: transcription quality (38)</div>
          </Card>
          <Card className="col-2" pad>
            <div className="t-caps">Unmapped</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--warn)' }} className="mono">38</div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>orphan clusters</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>→ candidates for new modules</div>
          </Card>
          <Card className="col-2" pad>
            <div className="t-caps">Filtered out</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--fg-subtle)' }} className="mono">28</div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>spam · 5.7%</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>By haiku-4-5 filter</div>
          </Card>
          <Card className="col-4" pad>
            <div className="t-caps">Languages</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              {([['EN', 62], ['KR', 18], ['JP', 9], ['DE', 4], ['FR', 4], ['Other', 3]] as [string, number][]).map(([l, p]) =>
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{l}</span>
                  <div style={{ flex: 1, height: 3, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${p * 1.6}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{p}</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* === Filter bar === */}
      <section className="section">
        <div className="l-grid">
          <Card className="col-12">
            <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="search" style={{ width: 280 }}>
                <span className="ico"><Icons.Search /></span>
                <input
                  className="input"
                  placeholder="Search review text…"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
              <span className="dot-divider" style={{ margin: 0 }}>·</span>
              <FilterChip label="Source" value={filters.src} options={[
                ['all', 'All sources'], ['appstore', 'App Store'], ['playstore', 'Play Store'],
                ['reddit', 'Reddit'], ['twitter', 'X'], ['intercom', 'Intercom'],
              ]} onChange={(v) => setFilters({ ...filters, src: v })} />
              <FilterChip label="Sentiment" value={filters.sentiment} options={[
                ['all', 'All'], ['neg', 'Negative'], ['mix', 'Mixed'], ['neu', 'Neutral'], ['pos', 'Positive'],
              ]} onChange={(v) => setFilters({ ...filters, sentiment: v })} />
              <FilterChip label="Priority" value={filters.priority} options={[
                ['all', 'All'], ['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'],
              ]} onChange={(v) => setFilters({ ...filters, priority: v })} />
              <FilterChip label="Mapping" value={filters.mapped} options={[
                ['all', 'All'], ['orphan', 'Unmapped (orphan)'], ['filtered', 'Filtered out'],
              ]} onChange={(v) => setFilters({ ...filters, mapped: v })} />
              <FilterChip label="Language" value={filters.lang} options={[
                ['all', 'All'], ['EN', 'English'], ['KR', 'Korean'], ['JP', 'Japanese'], ['FR', 'French'], ['DE', 'German'],
              ]} onChange={(v) => setFilters({ ...filters, lang: v })} />
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{filtered.length} of {RAW_REVIEWS.length}</span>
              <Button size="sm" variant="ghost" leftIcon={<Icons.External />}>Export CSV</Button>
            </div>
          </Card>
        </div>
      </section>

      {/* === Stream — review list + detail panel === */}
      <section className="section">
        <SectionHead eyebrow="Stream" title="Raw reviews" />
        <div className="l-grid" style={{ alignItems: 'flex-start' }}>
          <Card className="col-8">
            {isLoading && <SkeletonList rows={6} />}
            {isError && (
              <ErrorState message={error instanceof Error ? error.message : 'Failed to load reviews.'} onRetry={() => refetch()} />
            )}
            {!isLoading && !isError && filtered.map(r => (
              <ReviewRow
                key={r.id} r={r}
                selected={r.id === selected?.id}
                onClick={() => setSelectedId(r.id)}
              />
            ))}
            {!isLoading && !isError && filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 12 }}>
                No reviews match these filters.
              </div>
            )}
          </Card>

          {!isLoading && !isError && selected && (
            <div className="col-4">
              <ReviewDetail r={selected} />
            </div>
          )}
        </div>
      </section>
    </Fragment>
  );
}

// ----- Filter chip with dropdown ------------------------------------------
type FilterOption = [value: string, label: string];
interface FilterChipProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
}
function FilterChip({ label, value, options, onChange }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o[0] === value);
  const isActive = value !== 'all';
  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`btn sm ${isActive ? 'primary' : ''}`}
        style={isActive ? {} : { background: 'transparent', borderColor: 'var(--border)' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ color: isActive ? 'var(--accent-fg)' : 'var(--fg-muted)' }}>{label}:</span>
        <span style={{ marginLeft: 2 }}>{cur ? cur[1] : 'All'}</span>
        <Icons.ChevDown />
      </button>
      {open && (
        <Fragment>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 6, boxShadow: 'var(--shadow-lg)', padding: 4, minWidth: 160,
            zIndex: 10,
          }}>
            {options.map(([v, l]) => (
              <div
                key={v}
                onClick={() => { onChange(v); setOpen(false); }}
                style={{
                  padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12.5,
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: v === value ? 'var(--accent-soft)' : 'transparent',
                  color: v === value ? 'var(--accent)' : 'var(--fg)',
                }}
                onMouseEnter={(e: MouseEvent<HTMLDivElement>) => { if (v !== value) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e: MouseEvent<HTMLDivElement>) => { if (v !== value) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 12, display: 'flex', justifyContent: 'center' }}>
                  {v === value && <Icons.Check />}
                </span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </Fragment>
      )}
    </div>
  );
}

// ----- Review row ---------------------------------------------------------
interface ReviewRowProps {
  r: RawReview;
  selected: boolean;
  onClick: () => void;
}
function ReviewRow({ r, selected, onClick }: ReviewRowProps) {
  const sentColor = r.sentiment === 'neg' ? 'var(--danger)'
                  : r.sentiment === 'pos' ? 'var(--accent)'
                  : r.sentiment === 'mix' ? 'var(--warn)' : 'var(--fg-muted)';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid', gridTemplateColumns: '4px 1fr', gap: 12,
        padding: '12px 14px 12px 0',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: selected ? 'var(--surface-2)' : 'transparent',
      }}
    >
      <div style={{ background: selected ? 'var(--accent)' : 'transparent' }} />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <SourceChip src={r.src} />
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }} className="mono">{r.author}</span>
          <span className="dot-divider">·</span>
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{r.country}</span>
          <Badge subtle style={{ fontSize: 10 }}>{r.lang}</Badge>
          {r.rating != null && <Badge subtle style={{ fontSize: 10 }}>★ {r.rating}</Badge>}
          <Badge subtle style={{ color: sentColor, fontSize: 10, borderColor: 'transparent', background: 'transparent' }}>● {r.sentiment}</Badge>
          {r.filtered && <Badge subtle style={{ fontSize: 10 }}>filtered</Badge>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }} className="mono">{r.when}</span>
        </div>
        <div style={{
          fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{r.text}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {r.isOrphan && <Badge tone="warn" subtle><Icons.AlertTri /> unmapped</Badge>}
          {!r.isOrphan && !r.filtered && r.mappedLabel && (
            <Badge tone="info" subtle><Icons.Code /><span className="mono">{r.mappedLabel}</span></Badge>
          )}
          {r.category && <Badge tone={r.category === 'Spam' ? '' : 'purple'} subtle><Icons.Tag />{r.category}</Badge>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }} className="mono">
            {r.priority} · {r.id}
          </span>
        </div>
      </div>
    </div>
  );
}

// ----- Review detail panel ------------------------------------------------
function ReviewDetail({ r }: { r: RawReview }) {
  const sentColor = r.sentiment === 'neg' ? 'var(--danger)'
                  : r.sentiment === 'pos' ? 'var(--accent)'
                  : r.sentiment === 'mix' ? 'var(--warn)' : 'var(--fg-muted)';
  return (
    <div className="card" style={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 120px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SourceChip src={r.src} />
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{r.author}</span>
          <Button variant="ghost" className="icon-only" style={{ marginLeft: 'auto' }}><Icons.External /></Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Badge subtle>{r.country}</Badge>
          <Badge subtle>{r.lang}</Badge>
          {r.rating != null && <Badge subtle>★ {r.rating}</Badge>}
          <Badge subtle style={{ color: sentColor }}>● {r.sentiment}</Badge>
          <Badge subtle>{r.priority}</Badge>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }} className="mono">{r.id}</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        <div className="t-caps" style={{ marginBottom: 6 }}>Text</div>
        <div style={{
          padding: 12, background: 'var(--bg-soft)', borderRadius: 6,
          fontSize: 13, color: 'var(--fg)', lineHeight: 1.55, marginBottom: 10,
          fontFamily: r.lang === 'KR' || r.lang === 'JP' ? 'inherit' : 'inherit',
        }}>
          {r.text}
        </div>
        {r.text_en && (
          <Fragment>
            <div className="t-caps" style={{ marginBottom: 6 }}>English translation</div>
            <div style={{
              padding: 12, background: 'var(--bg-soft)', borderRadius: 6,
              fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.55, marginBottom: 14,
              fontStyle: 'italic',
            }}>
              {r.text_en}
            </div>
          </Fragment>
        )}

        {!r.filtered && (
          <Fragment>
            <div className="t-caps" style={{ marginTop: 14, marginBottom: 6 }}>AI classification</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <ClassRow k="Category" v={r.category} />
              <ClassRow k="Confidence" v={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${r.confidence * 100}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.confidence.toFixed(2)}</span>
                </div>
              } />
              <ClassRow k="Sentiment" v={<span style={{ color: sentColor }}>● {r.sentiment}</span>} />
              <ClassRow k="Priority" v={<Badge subtle>{r.priority}</Badge>} />
              <ClassRow k="Tags" v={
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.tags.map(t => <Badge subtle key={t} style={{ fontSize: 10 }}>#{t}</Badge>)}
                </div>
              } />
            </div>

            <div className="t-caps" style={{ marginTop: 14, marginBottom: 6 }}>Mapping</div>
            <div style={{
              padding: 12,
              background: r.isOrphan ? 'var(--warn-soft)' : 'var(--accent-soft)',
              borderRadius: 6,
              border: r.isOrphan ? '1px dashed var(--warn)' : '1px solid var(--accent)',
              marginBottom: 14,
            }}>
              {r.isOrphan ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Icons.AlertTri />
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--warn)' }}>Unmapped — orphan cluster</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.45 }}>
                    Doesn't match any existing module. Grouped with <span className="mono fg-strong">{r.mappedLabel}</span>.
                  </div>
                </div>
              ) : r.filtered ? null : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Icons.Code />
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>Mapped to module</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12.5, color: 'var(--fg-strong)' }}>{r.mappedLabel}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                    Cluster <span className="mono">{r.cluster}</span> · joined by similarity to 187 other reviews
                  </div>
                </div>
              )}
            </div>
          </Fragment>
        )}

        {r.filtered && (
          <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 6, border: '1px dashed var(--border-strong)', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Icons.Filter />
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>Filtered by first-stage skill</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              Classified as spam by <span className="mono">claude-haiku-4-5</span> with confidence 0.99. Excluded from downstream stages.
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, background: 'var(--bg-soft)' }}>
        {!r.filtered && (
          <Fragment>
            <Button variant="ghost" leftIcon={<Icons.Sparkles />} style={{ flex: 1 }}>View cluster</Button>
            <Button variant="ghost" leftIcon={<Icons.Pencil />}>Reclassify</Button>
          </Fragment>
        )}
        {r.filtered && (
          <Fragment>
            <Button variant="ghost" leftIcon={<Icons.Refresh />} style={{ flex: 1 }}>Restore to pipeline</Button>
            <Button variant="ghost" leftIcon={<Icons.Pencil />}>Tune filter</Button>
          </Fragment>
        )}
      </div>
    </div>
  );
}

interface ClassRowProps {
  k: string;
  v: ReactNode;
}
function ClassRow({ k, v }: ClassRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center' }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{k}</div>
      <div style={{ fontSize: 12.5, color: 'var(--fg)' }}>{v}</div>
    </div>
  );
}
