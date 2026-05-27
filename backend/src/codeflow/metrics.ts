import ts from 'typescript';

// Deterministic complexity metrics from the TS AST (code-health P1 — no LLM). McCabe cyclomatic
// complexity = 1 + decision points (branch / loop / case / catch / ternary / short-circuit). LOC = the
// number of source lines a node spans. Both reuse the AST that scan.ts already parses per file.

const DECISION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause, // each non-default case label is a branch
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression, // ?:
]);

// Cyclomatic complexity of the subtree rooted at `node` (pass a function/class decl for a symbol).
export function cyclomaticComplexity(node: ts.Node): number {
  let count = 1;
  const visit = (n: ts.Node) => {
    if (DECISION_KINDS.has(n.kind)) {
      count++;
    } else if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) count++;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return count;
}

// Source lines the node spans (inclusive). For a symbol, pass its declaration node.
export function loc(node: ts.Node, sf: ts.SourceFile): number {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  return end - start + 1;
}

// Total lines of the parsed code (for .vue this is the extracted <script>, matching what was parsed).
export function fileLoc(sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1;
}
