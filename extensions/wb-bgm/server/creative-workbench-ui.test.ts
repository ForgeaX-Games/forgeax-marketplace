import { describe, expect, test } from 'bun:test';

import {
  creativeRequestSummary,
  formatCreativeDuration,
  validateCreativeRequest,
  type CreativeRequest,
} from '../src/creativeWorkbench.ts';

function bgmRequest(): CreativeRequest {
  return {
    mode: 'generate',
    kind: 'bgm',
    sourceMode: 'new',
    prompt: '黑暗奇幻 Boss 战，持续推进',
    direction: '减少鼓点',
    durationSeconds: 60,
    loop: true,
    instrumental: true,
    variationCount: 2,
    projectId: 'test-project',
  };
}

describe('player creative workbench', () => {
  test('validates the minimum player input without provider-specific fields', () => {
    const request = bgmRequest();
    expect(validateCreativeRequest(request)).toBeNull();
    expect(validateCreativeRequest({ ...request, prompt: '' }))
      .toBe('请先描述想生成的声音');
    expect(validateCreativeRequest({
      ...request,
      sourceMode: 'customize',
      reference: undefined,
    })).toBe('请先从资产库选择一个参考声音');
  });

  test('summarizes generation inputs for real API results', () => {
    const request = bgmRequest();
    expect(creativeRequestSummary(request)).toContain('黑暗奇幻 Boss 战');
    expect(creativeRequestSummary(request)).toContain('减少鼓点');
    expect(creativeRequestSummary(request)).toContain('可循环');
    expect(creativeRequestSummary(request)).toContain('纯音乐');
  });

  test('formats preview duration for generated assets', () => {
    expect(formatCreativeDuration(5)).toBe('00:05');
    expect(formatCreativeDuration(130)).toBe('02:10');
  });
});
