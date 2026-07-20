import { describe, expect, it } from 'vitest';

import type { Branch, Scenario, Scene } from '../../scenario/types';
import {
  decideSceneEnd,
  hasVisibleChoice,
  isMultiShotScene,
  makeEvalContext,
  resolveActiveShot,
  resolveGateTarget,
  timedShots,
} from '../sceneMachine';

const ctx0 = makeEvalContext({}, [], {});

function scene(partial: Partial<Scene>): Scene {
  return {
    id: 's',
    title: 's',
    media: { kind: 'PLACEHOLDER' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...partial,
  } as Scene;
}

function branch(partial: Partial<Branch>): Branch {
  return { id: 'b', kind: 'auto', targetSceneId: 'x', ...partial } as Branch;
}

describe('hasVisibleChoice', () => {
  it('条件满足的 choice → 可见', () => {
    const s = scene({ branches: [branch({ kind: 'choice', label: 'A' })] });
    expect(hasVisibleChoice(s, ctx0)).toBe(true);
  });

  it('条件不满足 + gateMode hide → 不可见', () => {
    const s = scene({
      branches: [
        branch({ kind: 'choice', label: 'A', gateMode: 'hide', condition: { all: [{ type: 'var', varId: 'love', op: 'gte', value: 10 }] } }),
      ],
    });
    expect(hasVisibleChoice(s, ctx0)).toBe(false);
  });

  it('条件不满足 + gateMode lock → 仍可见(锁定)', () => {
    const s = scene({
      branches: [
        branch({ kind: 'choice', label: 'A', gateMode: 'lock', condition: { all: [{ type: 'var', varId: 'love', op: 'gte', value: 10 }] } }),
      ],
    });
    expect(hasVisibleChoice(s, ctx0)).toBe(true);
  });
});

describe('decideSceneEnd', () => {
  it('可见 choice → choice', () => {
    const s = scene({ branches: [branch({ kind: 'choice', label: 'A' })] });
    expect(decideSceneEnd(s, ctx0)).toEqual({ type: 'choice' });
  });

  it('auto 分支 → navigate 到其 target', () => {
    const s = scene({ branches: [branch({ kind: 'auto', targetSceneId: 'next' })] });
    expect(decideSceneEnd(s, ctx0)).toEqual({ type: 'navigate', targetSceneId: 'next' });
  });

  it('choice 优先于 auto', () => {
    const s = scene({
      branches: [branch({ kind: 'auto', targetSceneId: 'next' }), branch({ kind: 'choice', label: 'A' })],
    });
    expect(decideSceneEnd(s, ctx0)).toEqual({ type: 'choice' });
  });

  it('qte + qte 分支 → qte', () => {
    const s = scene({
      qte: { cues: [], window: { perfect: 100, great: 200, good: 300 }, score: 'sum' } as never,
      branches: [branch({ kind: 'qte_pass', targetSceneId: 'p' }), branch({ kind: 'qte_fail', targetSceneId: 'f' })],
    });
    expect(decideSceneEnd(s, ctx0)).toEqual({ type: 'qte' });
  });

  it('无出口 → ending', () => {
    expect(decideSceneEnd(scene({}), ctx0)).toEqual({ type: 'ending' });
  });
});

describe('resolveGateTarget', () => {
  function scenarioOf(scenes: Record<string, Scene>): Scenario {
    return { id: 'sc', title: 't', rootSceneId: 'a', scenes, defaultCharMs: 0, schemaVersion: 8 } as unknown as Scenario;
  }

  it('无门槛 → 直接放行', () => {
    const sc = scenarioOf({ a: scene({ id: 'a' }) });
    expect(resolveGateTarget(sc, 'a', ctx0)).toEqual({ sceneId: 'a' });
  });

  it('门槛满足 → 放行', () => {
    const sc = scenarioOf({
      a: scene({ id: 'a', entryGate: { condition: { all: [{ type: 'var', varId: 'k', op: 'gte', value: 1 }] }, onFail: 'block' } }),
    });
    const ctx = makeEvalContext({ k: 2 }, [], {});
    expect(resolveGateTarget(sc, 'a', ctx)).toEqual({ sceneId: 'a' });
  });

  it('门槛不满足 + redirect → 改道目标', () => {
    const sc = scenarioOf({
      a: scene({ id: 'a', entryGate: { condition: { all: [{ type: 'var', varId: 'k', op: 'gte', value: 1 }] }, onFail: 'redirect', redirectSceneId: 'b' } }),
      b: scene({ id: 'b' }),
    });
    expect(resolveGateTarget(sc, 'a', ctx0)).toEqual({ sceneId: 'b' });
  });

  it('门槛不满足 + block → blocked + hint', () => {
    const sc = scenarioOf({
      a: scene({ id: 'a', entryGate: { condition: { all: [{ type: 'var', varId: 'k', op: 'gte', value: 1 }] }, onFail: 'block', hint: '线索不足' } }),
    });
    expect(resolveGateTarget(sc, 'a', ctx0)).toEqual({ blocked: true, hint: '线索不足' });
  });

  it('redirect 成环 → 阻断（防环）', () => {
    const sc = scenarioOf({
      a: scene({ id: 'a', entryGate: { condition: { all: [{ type: 'flag', varId: 'f', equals: true }] }, onFail: 'redirect', redirectSceneId: 'b' } }),
      b: scene({ id: 'b', entryGate: { condition: { all: [{ type: 'flag', varId: 'f', equals: true }] }, onFail: 'redirect', redirectSceneId: 'a' } }),
    });
    const r = resolveGateTarget(sc, 'a', ctx0);
    expect('blocked' in r).toBe(true);
  });
});

describe('多 shot 纯函数', () => {
  const shotScene = (shots: unknown[], mediaKind = 'PLACEHOLDER') =>
    scene({ shots: shots as never, media: { kind: mediaKind } as never });

  it('timedShots 只留合法时间码并按 startMs 升序', () => {
    const s = shotScene([
      { id: 'b', startMs: 2000, endMs: 3000 },
      { id: 'bad', startMs: 500, endMs: 500 }, // end<=start 剔除
      { id: 'a', startMs: 0, endMs: 1000 },
      { id: 'nan', startMs: NaN, endMs: 1000 }, // 非有限 剔除
    ]);
    expect(timedShots(s).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('isMultiShotScene：VIDEO 整场 → false', () => {
    const s = shotScene(
      [
        { id: 'a', startMs: 0, endMs: 1000, videoMediaRef: 'v' },
        { id: 'b', startMs: 1000, endMs: 2000, videoMediaRef: 'v2' },
      ],
      'VIDEO',
    );
    expect(isMultiShotScene(s)).toBe(false);
  });

  it('isMultiShotScene：<2 有时间码 shot → false', () => {
    expect(isMultiShotScene(shotScene([{ id: 'a', startMs: 0, endMs: 1000, videoMediaRef: 'v' }]))).toBe(false);
  });

  it('isMultiShotScene：≥2 shot 且至少一镜有媒体 → true', () => {
    const s = shotScene([
      { id: 'a', startMs: 0, endMs: 1000, videoMediaRef: 'v' },
      { id: 'b', startMs: 1000, endMs: 2000, keyframeMediaRef: 'img' },
    ]);
    expect(isMultiShotScene(s)).toBe(true);
  });

  it('isMultiShotScene：≥2 shot 但无任何媒体 → false', () => {
    const s = shotScene([
      { id: 'a', startMs: 0, endMs: 1000 },
      { id: 'b', startMs: 1000, endMs: 2000 },
    ]);
    expect(isMultiShotScene(s)).toBe(false);
  });

  it('resolveActiveShot：命中 [start,end)；空隙/末镜后 → undefined', () => {
    const s = shotScene([
      { id: 'a', startMs: 0, endMs: 1000, videoMediaRef: 'v' },
      { id: 'b', startMs: 2000, endMs: 3000, keyframeMediaRef: 'img' },
    ]);
    expect(resolveActiveShot(s, 0)?.id).toBe('a');
    expect(resolveActiveShot(s, 999)?.id).toBe('a');
    expect(resolveActiveShot(s, 1000)).toBeUndefined(); // [0,1000) 已出
    expect(resolveActiveShot(s, 1500)).toBeUndefined(); // 空隙
    expect(resolveActiveShot(s, 2500)?.id).toBe('b');
    expect(resolveActiveShot(s, 3000)).toBeUndefined(); // 末镜后
  });
});
