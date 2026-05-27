// CodeFlow layer — public entry. Scans a target repo into a queryable code map.
// (Per-layer run entry, matching the modular structure in docs/architecture.md §4.)
export { scanRepo, type ScanResult, type ScanOptions, type FeatureSpec, type ArtifactNode, type EdgeSpec, type NodeKind } from './scan.js';
export { persistScan, type PersistStats } from './persist.js';
