import { describe, it, expect } from 'vitest';
import { escalationReasons, isLowConfidence } from '../src/processing/escalation.js';
import { thresholds } from '../src/config.js';

// Pure escalation logic shared by the classify stage and phase1's unified path (cache hit AND miss).
describe('escalationReasons', () => {
  it('flags critical severity', () => {
    expect(escalationReasons({ severity: 'critical', categoryConfidence: 0.99, text: 'app crashes' })).toContain('critical');
  });

  it('flags refund/legal keywords in either language', () => {
    expect(escalationReasons({ severity: 'low', categoryConfidence: 0.99, text: '환불 해주세요' })).toContain('refund_legal');
    expect(escalationReasons({ severity: 'low', categoryConfidence: 0.99, text: 'I want a refund' })).toContain('refund_legal');
  });

  it('flags low confidence below the human-queue floor', () => {
    expect(escalationReasons({ severity: 'low', categoryConfidence: thresholds.classifyLowConf - 0.01, text: 'meh' })).toContain('low_confidence');
  });

  it('returns no reasons for a confident, benign, non-critical review', () => {
    expect(escalationReasons({ severity: 'low', categoryConfidence: 0.99, text: 'great app, love it' })).toEqual([]);
  });
});

describe('isLowConfidence', () => {
  it('is true only inside [classifyLowConf, classifyAccept)', () => {
    expect(isLowConfidence(thresholds.classifyLowConf)).toBe(true);
    expect(isLowConfidence(thresholds.classifyAccept - 0.001)).toBe(true);
    expect(isLowConfidence(thresholds.classifyLowConf - 0.001)).toBe(false);
    expect(isLowConfidence(thresholds.classifyAccept)).toBe(false);
  });
});
