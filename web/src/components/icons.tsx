// ============================================================
// SelfHeal — Icon set (inline SVG)
// ============================================================

import type { FC, SVGProps } from 'react';

const SVG: FC<SVGProps<SVGSVGElement>> = ({ children, fill, ...rest }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24"
    fill={fill || "none"}
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);
const P: FC<{ d: string } & SVGProps<SVGPathElement>> = ({ d, ...r }) => <path d={d} {...r} />;

export const Icons = {
  Home:       (p) => <SVG {...p}><P d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" /></SVG>,
  Inbox:      (p) => <SVG {...p}><P d="M3 5h18v9h-6l-2 3h-2l-2-3H3V5zm0 9v4a1 1 0 001 1h16a1 1 0 001-1v-4" /></SVG>,
  Graph:      (p) => <SVG {...p}>
    <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
    <P d="M12 7l-6 10M12 7l6 10"/>
  </SVG>,
  Sparkles:   (p) => <SVG {...p}><P d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zm7 10l.8 2.4L22 16l-2.2.6L19 19l-.8-2.4L16 16l2.2-.6L19 13z" /></SVG>,
  Robot:      (p) => <SVG {...p}>
    <rect x="4" y="8" width="16" height="11" rx="2"/>
    <P d="M12 3v5M9 13h.01M15 13h.01M9 17h6"/>
  </SVG>,
  Cog:        (p) => <SVG {...p}>
    <circle cx="12" cy="12" r="3"/>
    <P d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </SVG>,
  Layers:     (p) => <SVG {...p}><P d="M12 2l9 5-9 5-9-5 9-5zm0 8l9 5-9 5-9-5 9-5z" /></SVG>,
  Activity:   (p) => <SVG {...p}><P d="M22 12h-4l-3 9L9 3l-3 9H2" /></SVG>,

  Search:     (p) => <SVG {...p}><circle cx="11" cy="11" r="7"/><P d="M21 21l-4.3-4.3"/></SVG>,
  Plus:       (p) => <SVG {...p}><P d="M12 5v14M5 12h14" /></SVG>,
  ChevDown:   (p) => <SVG {...p}><P d="M6 9l6 6 6-6" /></SVG>,
  ChevRight:  (p) => <SVG {...p}><P d="M9 18l6-6-6-6" /></SVG>,
  ChevLeft:   (p) => <SVG {...p}><P d="M15 18l-6-6 6-6" /></SVG>,
  ChevUp:     (p) => <SVG {...p}><P d="M18 15l-6-6-6 6" /></SVG>,
  ArrowRight: (p) => <SVG {...p}><P d="M5 12h14M13 6l6 6-6 6" /></SVG>,
  ArrowUp:    (p) => <SVG {...p}><P d="M12 19V5M6 11l6-6 6 6" /></SVG>,
  ArrowDown:  (p) => <SVG {...p}><P d="M12 5v14M6 13l6 6 6-6" /></SVG>,
  Check:      (p) => <SVG {...p}><P d="M5 12l5 5L20 7" /></SVG>,
  X:          (p) => <SVG {...p}><P d="M6 6l12 12M18 6l-12 12" /></SVG>,
  More:       (p) => <SVG {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
    <circle cx="19" cy="12" r="1.4" fill="currentColor"/>
  </SVG>,
  Filter:     (p) => <SVG {...p}><P d="M4 5h16l-6 8v6l-4-2v-4L4 5z" /></SVG>,
  Bell:       (p) => <SVG {...p}><P d="M6 19h12l-1.5-2v-5a4.5 4.5 0 10-9 0v5L6 19zm4 0a2 2 0 004 0" /></SVG>,
  Help:       (p) => <SVG {...p}><circle cx="12" cy="12" r="9"/><P d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></SVG>,
  Sun:        (p) => <SVG {...p}>
    <circle cx="12" cy="12" r="4"/>
    <P d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
  </SVG>,
  Moon:       (p) => <SVG {...p}><P d="M21 13A9 9 0 1111 3a7 7 0 0010 10z" /></SVG>,
  Refresh:    (p) => <SVG {...p}><P d="M3 12a9 9 0 0115-6.7L21 8m0-5v5h-5M21 12a9 9 0 01-15 6.7L3 16m0 5v-5h5" /></SVG>,
  Play:       (p) => <SVG {...p}><P d="M7 4l13 8-13 8V4z" fill="currentColor" /></SVG>,
  Pause:      (p) => <SVG {...p}><P d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none" /></SVG>,
  Pencil:     (p) => <SVG {...p}><P d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z" /></SVG>,
  Trash:      (p) => <SVG {...p}><P d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" /></SVG>,
  Eye:        (p) => <SVG {...p}><P d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></SVG>,
  Link:       (p) => <SVG {...p}><P d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1m-3 9a5 5 0 01-7 0 5 5 0 010-7l3-3a5 5 0 017 0" /></SVG>,
  External:   (p) => <SVG {...p}><P d="M14 5h5v5M19 5L11 13M14 14v4a1 1 0 01-1 1H6a1 1 0 01-1-1V11a1 1 0 011-1h4" /></SVG>,
  Code:       (p) => <SVG {...p}><P d="M16 18l6-6-6-6M8 6l-6 6 6 6M14 4l-4 16" /></SVG>,
  Branch:     (p) => <SVG {...p}>
    <circle cx="6" cy="3" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/>
    <P d="M6 5v8a5 5 0 005 5h1m6-7v0a5 5 0 01-5 5h-1"/>
  </SVG>,
  Database:   (p) => <SVG {...p}>
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <P d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>
  </SVG>,
  Calendar:   (p) => <SVG {...p}><P d="M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zm0 5h16M8 3v4M16 3v4" /></SVG>,
  Clock:      (p) => <SVG {...p}><circle cx="12" cy="12" r="9"/><P d="M12 7v5l3 2"/></SVG>,
  Tag:        (p) => <SVG {...p}>
    <P d="M20 12l-8 8L3 11V3h8l9 9z"/>
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>
  </SVG>,
  Spark:      (p) => <SVG {...p}><P d="M12 2v6M12 16v6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M16 12h6M4.9 19.1l4.2-4.2M14.9 9.1l4.2-4.2" /></SVG>,
  GitPull:    (p) => <SVG {...p}>
    <circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>
    <P d="M6 8v8M18 8v8M14 4h2a2 2 0 012 2v0"/>
  </SVG>,
  Lightning:  (p) => <SVG {...p}><P d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></SVG>,
  AlertTri:   (p) => <SVG {...p}><P d="M12 3l10 18H2L12 3zm0 7v5m0 3v.01" /></SVG>,
  Slack:      (p) => <SVG {...p}>
    <rect x="3" y="10" width="6" height="4" rx="2"/>
    <rect x="10" y="3" width="4" height="6" rx="2"/>
    <rect x="15" y="10" width="6" height="4" rx="2"/>
    <rect x="10" y="15" width="4" height="6" rx="2"/>
  </SVG>,
  Github:     (p) => <SVG {...p}><P fill="currentColor" stroke="none" d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0012 2z" /></SVG>,
  Folder:     (p) => <SVG {...p}><P d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" /></SVG>,
} satisfies Record<string, FC<SVGProps<SVGSVGElement>>>;

export type IconName = keyof typeof Icons;
