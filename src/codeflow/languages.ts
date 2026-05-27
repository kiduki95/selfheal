import ts from 'typescript';

// Language registry (codeflow-layer.md §4). Centralizes WHICH file extensions CodeFlow parses and HOW,
// so supporting a new language is a registry edit rather than conditionals scattered across scan.ts.
//
// The JS/TS family (.ts/.tsx/.js/.jsx/.mjs/.cjs) all parse through the same TypeScript Compiler API —
// TS is a superset of JS, so one parser covers the whole family, differing only by ScriptKind. A
// genuinely different language (e.g. Python) needs a different parser; per the agreed design we defer
// extracting a neutral LanguageParser interface until that second parser actually lands (we'll know the
// real seam then). Until then this registry is the single place the JS/TS family is declared.

// Source extensions CodeFlow scans (JS/TS family — all handled by the TS Compiler API via ScriptKind).
export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

// ScriptKind per extension so JSX/TSX get JSX parsing and plain JS is parsed as loose JS (not strict TS).
// Note: ES `import`/`export` are recognized by the parser regardless of ScriptKind; CommonJS
// `require()`/`module.exports` are NOT module syntax, so symbols/edges only form for ES-module files
// (a known v1 limitation — file/module nodes still form for CommonJS files).
export function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS; // .js / .mjs / .cjs
}

// Is this a code file CodeFlow should parse? (Declaration files are excluded separately.)
export function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((e) => name.endsWith(e));
}

// Declaration files (.d.ts / .d.mts / .d.cts) carry no runtime symbols — skip them.
export function isDeclarationFile(name: string): boolean {
  return /\.d\.[cm]?ts$/.test(name);
}

// Test/spec files — excluded from the artifact graph (they are not product surface).
export function isTestSourceFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

// Module-resolution helper for ext-less import targets (e.g. './m' → './m.ts' | './m.js' | './m/index.js').
// Returns the candidate file paths to try, in priority order, given a (possibly ext-less) target.
export function resolveCandidates(toRel: string): string[] {
  const base = toRel.replace(/\.(tsx?|jsx?|[cm]js)$/, '');
  const withExt = CODE_EXTENSIONS.map((e) => base + e);
  const asIndex = CODE_EXTENSIONS.map((e) => `${base}/index${e}`);
  return [toRel, ...withExt, ...asIndex];
}

// Strip a source extension from an import specifier (so './m.js' and './m' resolve to the same base).
export function stripSourceExt(spec: string): string {
  return spec.replace(/\.(tsx?|jsx?|[cm]js)$/, '');
}
