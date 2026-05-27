// ============================================================
// SelfHeal — Shared UI primitives
// ============================================================

import { useState, useCallback, createContext, useContext } from 'react';
import type { ReactNode, CSSProperties, ButtonHTMLAttributes } from 'react';
import { Icons } from './icons';

// ----- Button --------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'lg' | 'sm';
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  kbd?: string;
  className?: string;
}

function Button({ children, variant = 'default', size, leftIcon, rightIcon, kbd, onClick, className = '', ...rest }: ButtonProps) {
  const cls = [
    'btn',
    variant === 'primary' && 'primary',
    variant === 'ghost' && 'ghost',
    variant === 'danger' && 'danger',
    size === 'lg' && 'lg',
    size === 'sm' && 'sm',
    className,
  ].filter(Boolean).join(' ');
  // Defensive: strip any leaked unknown DOM attrs from runtime instrumentation
  const safeRest: Record<string, unknown> = { ...rest };
  delete safeRest.leftIcon;
  delete safeRest.rightIcon;
  return (
    <button className={cls} onClick={onClick} {...safeRest}>
      {leftIcon}
      {children}
      {rightIcon}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

// ----- Badge ---------------------------------------------------------------
interface BadgeProps {
  children?: ReactNode;
  tone?: string;
  dot?: boolean;
  subtle?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void;
}

function Badge({ children, tone, dot, subtle, className = '', style, onClick }: BadgeProps) {
  const cls = ['badge', tone, dot && 'dot', subtle && 'subtle', className].filter(Boolean).join(' ');
  return <span className={cls} style={style} onClick={onClick}>{children}</span>;
}

// ----- Card ----------------------------------------------------------------
interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  pad?: boolean;
  padLg?: boolean;
  style?: CSSProperties;
}

function Card({ title, action, children, className = '', pad = false, padLg = false, style }: CardProps) {
  const bodyCls = ['card-body', padLg ? 'pad-lg' : pad ? '' : 'flush'].filter(Boolean).join(' ');
  return (
    <div className={`card ${className}`} style={style}>
      {title && (
        <div className="card-title">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      <div className={bodyCls}>{children}</div>
    </div>
  );
}

// ----- Section header ------------------------------------------------------
// Editorial group label: caps eyebrow + serif title + hairline rule to the
// right edge, with an optional action. Used to structure dashboard/page rows.
interface SectionHeadProps {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
}

function SectionHead({ eyebrow, title, action }: SectionHeadProps) {
  return (
    <div className="section-head">
      <div className="section-head-text">
        {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
        <div className="section-title">{title}</div>
      </div>
      <div className="section-rule" />
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}

// ----- Tabs ----------------------------------------------------------------
interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
}

function Tabs({ items, value, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <div
          key={it.value}
          className={`tab ${value === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count != null && <span className="tab-count">{it.count}</span>}
        </div>
      ))}
    </div>
  );
}

// ----- Switch --------------------------------------------------------------
interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

function Switch({ on, onChange }: SwitchProps) {
  return (
    <div
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!on); } }}
    />
  );
}

// ----- Sparkline -----------------------------------------------------------
interface SparkProps {
  data: number[];
  h?: number;
  w?: number;
  fill?: boolean;
}

function Spark({ data, h = 28, w = 92, fill = true }: SparkProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return [x, y];
  });
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {fill && <path d={fillPath} fill="var(--accent-soft)" />}
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SparkBarsProps {
  data: number[];
  h?: number;
  w?: number;
}

function SparkBars({ data, h = 28, w = 92 }: SparkBarsProps) {
  const max = Math.max(...data, 1);
  const bw = w / data.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {data.map((v, i) => {
        const bh = (v / max) * h;
        return (
          <rect
            key={i}
            x={i * (bw + 1)}
            y={h - bh}
            width={bw}
            height={bh}
            fill={i === data.length - 1 ? 'var(--accent)' : 'var(--accent-soft)'}
            rx="0.8"
          />
        );
      })}
    </svg>
  );
}

// ----- Source chip ---------------------------------------------------------
const SRC_META: Record<string, { name: string; bg: string; letter: string }> = {
  appstore:  { name: 'App Store',   bg: '#0a84ff', letter: 'A' },
  playstore: { name: 'Play Store',  bg: '#34a853', letter: 'P' },
  reddit:    { name: 'Reddit',      bg: '#ff4500', letter: 'R' },
  twitter:   { name: 'X',           bg: '#1a1a1a', letter: 'X' },
  github:    { name: 'GitHub',      bg: '#6e40c9', letter: 'G' },
  discord:   { name: 'Discord',     bg: '#5865f2', letter: 'D' },
  web:       { name: 'Web crawl',   bg: '#525252', letter: 'W' },
  intercom:  { name: 'Intercom',    bg: '#1e88e5', letter: 'I' },
};

interface SourceChipProps {
  src: string;
  label?: string;
}

function SourceChip({ src, label }: SourceChipProps) {
  const m = SRC_META[src] || SRC_META.web;
  const iconOnly = label === '';
  return (
    <span className="src-chip" style={iconOnly ? { padding: 3 } : undefined}>
      <span className="src-ico" style={{ background: m.bg }}>{m.letter}</span>
      {!iconOnly && (label || m.name)}
    </span>
  );
}

// ----- Priority dot --------------------------------------------------------
interface PriDotProps {
  p: number;
}

function PriDot({ p }: PriDotProps) {
  return <span className={`proposal-pri-dot p${p}`} title={`P${p}`} />;
}

// ----- Toast stack ---------------------------------------------------------
interface Toast {
  title: string;
  body?: string;
  icon?: ReactNode;
  duration?: number;
}

type ToastCtxValue = ((t: Toast) => void) | null;

const ToastCtx = createContext<ToastCtxValue>(null);

interface ToastProviderProps {
  children?: ReactNode;
}

interface ToastInstance extends Toast {
  id: string;
}

function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastInstance[]>([]);
  const push = useCallback((t: Toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t.duration || 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <div className="ico">{t.icon || <Icons.Check />}</div>
            <div style={{ flex: 1 }}>
              <div className="title">{t.title}</div>
              {t.body && <div className="body">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

const useToast = (): ((t: Toast) => void) => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
};

// ----- Heatmap row ---------------------------------------------------------
interface HeatRowProps {
  values: number[];
  max?: number;
}

function HeatRow({ values, max }: HeatRowProps) {
  const m = max || Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {values.map((v, i) => {
        const a = Math.min(1, v / m);
        return (
          <div
            key={i}
            style={{
              width: 11, height: 11, borderRadius: 2,
              background: v === 0
                ? 'var(--surface-2)'
                : `color-mix(in srgb, var(--accent) ${Math.round((0.14 + a * 0.66) * 100)}%, transparent)`,
            }}
            title={`${v}`}
          />
        );
      })}
    </div>
  );
}

// ----- Skeleton ------------------------------------------------------------
// Shimmer placeholder block. Compose several to fake list/card layouts while a
// query is loading. Styling (.skeleton + shimmer) lives in styles.css.
interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

function Skeleton({ width = '100%', height = 14, radius = 'var(--radius)', style }: SkeletonProps) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

// A few skeleton rows inside a card body — the common "loading a list" case.
interface SkeletonListProps {
  rows?: number;
  className?: string;
}

function SkeletonList({ rows = 5, className }: SkeletonListProps) {
  return (
    <div className={`list ${className || ''}`} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="list-row top" key={i} style={{ padding: '12px 16px', gap: 12 }}>
          <Skeleton width={28} height={28} radius="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width={`${70 - (i % 3) * 12}%`} height={12} />
            <Skeleton width={`${45 - (i % 2) * 10}%`} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ----- Empty / Error states ------------------------------------------------
interface StatePanelProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  tone?: 'muted' | 'danger';
}

function StatePanel({ icon, title, body, action, tone = 'muted' }: StatePanelProps) {
  const color = tone === 'danger' ? 'var(--danger)' : 'var(--fg-subtle)';
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        gap: 8, padding: '40px 24px', color: 'var(--fg-muted)',
      }}
    >
      {icon && <div style={{ color, width: 22, height: 22 }}>{icon}</div>}
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</div>
      {body && <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5, maxWidth: 340 }}>{body}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

interface EmptyStateProps {
  title?: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

function EmptyState({ title = 'Nothing here yet', body, action, icon }: EmptyStateProps) {
  return <StatePanel icon={icon ?? <Icons.Inbox />} title={title} body={body} action={action} />;
}

interface ErrorStateProps {
  title?: ReactNode;
  message?: ReactNode;
  onRetry?: () => void;
}

function ErrorState({ title = 'Couldn’t load data', message, onRetry }: ErrorStateProps) {
  return (
    <StatePanel
      tone="danger"
      icon={<Icons.AlertTri />}
      title={title}
      body={message}
      action={onRetry && (
        <Button size="sm" variant="ghost" leftIcon={<Icons.Refresh />} onClick={onRetry}>Retry</Button>
      )}
    />
  );
}

export {
  Button, Badge, Card, SectionHead, Tabs, Switch, Spark, SparkBars, SourceChip, PriDot,
  ToastProvider, useToast, HeatRow, SRC_META,
  Skeleton, SkeletonList, EmptyState, ErrorState,
};
export type { Toast };
