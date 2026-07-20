import { describe, expect, test } from 'bun:test';

import {
  evaluateIconQuality,
  evaluatePipelineQuality,
  evaluateRawQuality,
  GOLD_CUTOUT_FILL_PASS,
  GOLD_OUTPUT_COLORS_PASS,
  GOLD_OUTPUT_FILL_PASS,
} from '../shared/pipeline-quality';

describe('pipeline quality bar (gold standard)', () => {
  test('illustration-like raw fails on sample color count', () => {
    const r = evaluateRawQuality(
      { width: 1024, height: 1024, cutoutFillRatio: 0.53, sampleColors: 2902 },
      { strict: true },
    );
    expect(r.verdict).toBe('fail');
    expect(r.notes.some((n) => n.includes('采样色数'))).toBe(true);
  });

  test('gold-like raw passes strict gate', () => {
    const r = evaluateRawQuality(
      { width: 1024, height: 1024, cutoutFillRatio: 0.44, sampleColors: 709 },
      { strict: true },
    );
    expect(r.verdict).toBe('pass');
  });

  test('demo-like raw fails (non-square + tiny subject)', () => {
    const r = evaluateRawQuality({ width: 1408, height: 768, cutoutFillRatio: 0.18 }, { strict: true });
    expect(r.verdict).toBe('fail');
    expect(r.notes.some((n) => n.includes('非正方形') || n.includes('严格要求'))).toBe(true);
  });

  test('gold-like 48px icon passes', () => {
    const r = evaluateIconQuality({
      width: 48,
      height: 48,
      fillRatio: 0.59,
      uniqueColors: 534,
      qaPassed: true,
    });
    expect(r.verdict).toBe('pass');
  });

  test('demo-like blurry icon fails on color count', () => {
    const r = evaluateIconQuality({
      width: 48,
      height: 48,
      fillRatio: 0.67,
      uniqueColors: 1350,
      qaPassed: true,
    });
    expect(r.verdict).toBe('fail');
  });

  test('pipeline qualified only when raw + icon both meet bar', () => {
    const ok = evaluatePipelineQuality(
      { width: 1024, height: 1024, cutoutFillRatio: GOLD_CUTOUT_FILL_PASS },
      {
        width: 48,
        height: 48,
        fillRatio: GOLD_OUTPUT_FILL_PASS,
        uniqueColors: GOLD_OUTPUT_COLORS_PASS - 100,
        qaPassed: true,
      },
    );
    expect(ok.verdict).toBe('pass');

    const bad = evaluatePipelineQuality(
      { width: 1408, height: 768, cutoutFillRatio: 0.18 },
      {
        width: 48,
        height: 48,
        fillRatio: 0.67,
        uniqueColors: 1143,
        qaPassed: true,
      },
    );
    expect(bad.verdict).toBe('fail');
  });
});
