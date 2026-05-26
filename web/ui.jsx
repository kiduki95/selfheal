// ============================================================
// SelfHeal — Shared UI primitives
// ============================================================

const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

// ----- Button --------------------------------------------------------------
function Button({ children, variant = 'default', size, leftIcon, rightIcon, kbd, onClick, className = '', ...rest }) {
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
  const safeRest = { ...rest };
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
function Badge({ children, tone, dot, subtle, className = '' }) {
  const cls = ['badge', tone, dot && 'dot', subtle && 'subtle', className].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}

// ----- Card ----------------------------------------------------------------
function Card({ title, action, children, className = '', pad = false, padLg = false }) {
  return (
    <div className={`card ${className}`}>
      {title && (
        <div className="card-title">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      <div className={pad ? 'card-pad' : padLg ? 'card-pad-lg' : ''}>{children}</div>
    </div>
  );
}

// ----- Tabs ----------------------------------------------------------------
function Tabs({ items, value, onChange }) {
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
function Switch({ on, onChange }) {
  return <div className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

// ----- Sparkline -----------------------------------------------------------
function Spark({ data, h = 28, w = 92, fill = true }) {
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

function SparkBars({ data, h = 28, w = 92 }) {
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
const SRC_META = {
  appstore:  { name: 'App Store',   bg: '#0a84ff', letter: 'A' },
  playstore: { name: 'Play Store',  bg: '#34a853', letter: 'P' },
  reddit:    { name: 'Reddit',      bg: '#ff4500', letter: 'R' },
  twitter:   { name: 'X',           bg: '#1a1a1a', letter: 'X' },
  github:    { name: 'GitHub',      bg: '#6e40c9', letter: 'G' },
  discord:   { name: 'Discord',     bg: '#5865f2', letter: 'D' },
  web:       { name: 'Web crawl',   bg: '#525252', letter: 'W' },
  intercom:  { name: 'Intercom',    bg: '#1e88e5', letter: 'I' },
};

function SourceChip({ src, label }) {
  const m = SRC_META[src] || SRC_META.web;
  const iconOnly = label === '';
  return (
    <span className="src-chip" style={iconOnly ? { padding: 3 } : null}>
      <span className="src-ico" style={{ background: m.bg }}>{m.letter}</span>
      {!iconOnly && (label || m.name)}
    </span>
  );
}

// ----- Priority dot --------------------------------------------------------
function PriDot({ p }) {
  return <span className={`proposal-pri-dot p${p}`} title={`P${p}`} />;
}

// ----- Toast stack ---------------------------------------------------------
const ToastCtx = React.createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
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

const useToast = () => React.useContext(ToastCtx);

// ----- Heatmap row ---------------------------------------------------------
function HeatRow({ values, max }) {
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
              background: v === 0 ? 'var(--surface-2)' : `rgba(0, 212, 168, ${0.15 + a * 0.65})`,
            }}
            title={`${v}`}
          />
        );
      })}
    </div>
  );
}

Object.assign(window, {
  Button, Badge, Card, Tabs, Switch, Spark, SparkBars, SourceChip, PriDot,
  ToastProvider, useToast, HeatRow, SRC_META,
});
