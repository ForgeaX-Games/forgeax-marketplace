import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeDialogue, createReelBootstrap } from '../index';
import type { ReelHostContext } from '../engine-contract';

/** 一棵能过 schema 骨架校验的最小 scenario（id/title/rootSceneId/scenes/schemaVersion/defaultCharMs + scene 骨架）。 */
function makeScenario() {
  return {
    id: 'sc1',
    title: '测试影游',
    rootSceneId: 'intro',
    defaultCharMs: 40,
    schemaVersion: 6,
    scenes: {
      intro: {
        id: 'intro',
        title: '开场',
        durationMs: 5000,
        branches: [],
        dialogue: [
          { id: 'd1', role: 'narration', text: '很久很久以前', startMs: 0, endMs: 1000 },
          { id: 'd2', role: 'character', speaker: '爱丽丝', text: '你好', startMs: 1000 },
        ],
      },
    },
  };
}

function makeCtx(
  loadByGuid: (guid: string) => Promise<unknown> = async () => ({
    schemaVersion: 1,
    scenario: makeScenario(),
  }),
): {
  ctx: ReelHostContext;
  uiRoot: HTMLElement;
  cleanups: Array<() => void>;
  updates: Array<(dtSec: number) => void>;
} {
  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  const cleanups: Array<() => void> = [];
  const updates: Array<(dtSec: number) => void> = [];
  const ctx: ReelHostContext = {
    uiRoot,
    registerUpdate: (fn) => updates.push(fn),
    assets: { loadByGuid: vi.fn(loadByGuid) },
    registerCleanup: (fn) => cleanups.push(fn),
  };
  return { ctx, uiRoot, cleanups, updates };
}

describe('createReelBootstrap · A1 骨架', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('scenarioGuid 必填', () => {
    expect(() => createReelBootstrap('')).toThrow(/scenarioGuid/);
    // @ts-expect-error 传非 string 应被拒
    expect(() => createReelBootstrap(undefined)).toThrow(/scenarioGuid/);
  });

  it('返回一个可当引擎 bootstrap(world, ctx) 调用的函数', () => {
    const bootstrap = createReelBootstrap('g1');
    expect(typeof bootstrap).toBe('function');
    expect(bootstrap.length).toBeLessThanOrEqual(2);
  });

  it('把播放器根容器挂进 ctx.uiRoot', async () => {
    const { ctx, uiRoot } = makeCtx();
    await createReelBootstrap('g1')({}, ctx);
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root!.style.position).toBe('absolute');
  });

  it('缺 uiRoot 时回退到 document.body', async () => {
    const ctx: ReelHostContext = {
      registerUpdate: vi.fn(),
      assets: { loadByGuid: async () => ({ schemaVersion: 1, scenario: makeScenario() }) },
    };
    await createReelBootstrap('g1')({}, ctx);
    expect(document.body.querySelector('.reel-runtime-root')).not.toBeNull();
  });

  it('注册的 cleanup 会移除根容器（Stop 无残留）', async () => {
    const { ctx, uiRoot, cleanups } = makeCtx();
    await createReelBootstrap('g1')({}, ctx);
    expect(uiRoot.querySelector('.reel-runtime-root')).not.toBeNull();
    cleanups.forEach((fn) => fn());
    expect(uiRoot.querySelector('.reel-runtime-root')).toBeNull();
  });
});

describe('createReelBootstrap · A2 加载/校验/时钟/字幕', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('用 ctx.assets.loadByGuid(scenarioGuid) 加载', async () => {
    const { ctx } = makeCtx();
    await createReelBootstrap('scenario-xyz')({}, ctx);
    expect(ctx.assets.loadByGuid).toHaveBeenCalledWith('scenario-xyz');
  });

  it('首帧渲染 elapsed=0 的台词（旁白直出、无名字前缀）', async () => {
    const { ctx, uiRoot } = makeCtx();
    await createReelBootstrap('g1')({}, ctx);
    const sub = uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement;
    expect(sub.textContent).toBe('很久很久以前');
  });

  it('registerUpdate 推进时钟后切到下一条台词（character 带名字前缀）', async () => {
    const { ctx, uiRoot, updates } = makeCtx();
    await createReelBootstrap('g1')({}, ctx);
    const sub = uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement;
    // 推进 1.2s（dt 单位=秒）→ 越过 d2.startMs=1000
    updates.forEach((fn) => fn(1.2));
    expect(sub.textContent).toBe('爱丽丝：你好');
  });

  it('非法 payload → 渲染可选中的错误浮层，不抛错崩溃', async () => {
    const { ctx, uiRoot } = makeCtx(async () => ({ nonsense: true }));
    await expect(createReelBootstrap('g1')({}, ctx)).resolves.toBeUndefined();
    const err = uiRoot.querySelector('.reel-runtime-error') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.style.userSelect).toBe('text');
    expect(err.textContent).toMatch(/影游加载失败/);
    // 无字幕层（加载失败提前返回）
    expect(uiRoot.querySelector('.reel-runtime-subtitle')).toBeNull();
  });
});

describe('createReelBootstrap · A2 媒体渲染（video/图/占位）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function withMedia(media: unknown) {
    const s = makeScenario() as unknown as { scenes: Record<string, { media?: unknown }> };
    s.scenes.intro!.media = media;
    return { schemaVersion: 1, scenario: s };
  }

  it('VIDEO 场景挂 <video>（默认带声/内联/解析后 src）', async () => {
    const { ctx, uiRoot } = makeCtx(async () => withMedia({ kind: 'VIDEO', ref: './reel-media/abc.mp4' }));
    await createReelBootstrap('g1')({}, ctx);
    const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(v.src).toMatch(/reel-media\/abc\.mp4$/);
    // A4.6：默认按带声播（jsdom play() 直接 resolve → 不降级静音）。
    expect(v.playsInline).toBe(true);
  });

  it('resolveMediaUrl 注入被应用到 src', async () => {
    const { ctx, uiRoot } = makeCtx(async () => withMedia({ kind: 'VIDEO', ref: './reel-media/abc.mp4' }));
    await createReelBootstrap('g1', { resolveMediaUrl: (r) => `https://cdn.example/${r}` })({}, ctx);
    const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
    // 注入前缀已生效（`v.src` 反射属性会规范化 `./`）。
    expect(v.src.startsWith('https://cdn.example/')).toBe(true);
    expect(v.src).toMatch(/reel-media\/abc\.mp4$/);
  });

  it('IMAGE_STATIC 场景挂 <img>', async () => {
    const { ctx, uiRoot } = makeCtx(async () => withMedia({ kind: 'IMAGE_STATIC', ref: './reel-media/pic.png' }));
    await createReelBootstrap('g1')({}, ctx);
    const img = uiRoot.querySelector('img.reel-runtime-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toMatch(/reel-media\/pic\.png$/);
    expect(uiRoot.querySelector('video')).toBeNull();
  });

  it('PLACEHOLDER / 无 ref：无媒体元素，但台词照渲染、墙钟照推进', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => withMedia({ kind: 'PLACEHOLDER' }));
    await createReelBootstrap('g1')({}, ctx);
    expect(uiRoot.querySelector('video, img.reel-runtime-image')).toBeNull();
    const sub = uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement;
    expect(sub.textContent).toBe('很久很久以前');
    updates.forEach((fn) => fn(1.2)); // 墙钟推进
    expect(sub.textContent).toBe('爱丽丝：你好');
  });

  it('VIDEO 场景以 currentTime 为时钟真源：墙钟被忽略、timeupdate 驱动台词', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => withMedia({ kind: 'VIDEO', ref: './reel-media/abc.mp4' }));
    await createReelBootstrap('g1')({}, ctx);
    const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
    const sub = uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement;
    // 墙钟推进不应影响 VIDEO 场景
    updates.forEach((fn) => fn(5));
    expect(sub.textContent).toBe('很久很久以前');
    // 视频 currentTime 前进才切台词
    v.currentTime = 1.2;
    v.dispatchEvent(new Event('timeupdate'));
    expect(sub.textContent).toBe('爱丽丝：你好');
  });
});

describe('createReelBootstrap · A4.1 核心状态机（切场/门槛/FIN）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function scn(scenes: Record<string, unknown>, rootSceneId = 'a') {
    return { schemaVersion: 1, scenario: { id: 'g', title: 't', rootSceneId, defaultCharMs: 40, schemaVersion: 6, scenes } };
  }
  function sc(partial: Record<string, unknown>) {
    return { title: 's', durationMs: 100, branches: [], dialogue: [], ...partial };
  }
  const line = (text: string) => [{ id: 'd', role: 'narration', text, startMs: 0 }];

  it('auto 分支：播到 effectiveEnd → 自动切到 target', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({ id: 'a', branches: [{ id: 'b1', kind: 'auto', targetSceneId: 'b' }] }),
        b: sc({ id: 'b', dialogue: line('到了B') }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement;
    expect(root.dataset.reelScene).toBe('a');
    updates.forEach((fn) => fn(0.2)); // 200ms ≥ durationMs 100
    expect(root.dataset.reelScene).toBe('b');
    expect((uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement).textContent).toBe('到了B');
  });

  it('无出口分支 → FIN 全剧终浮层', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => scn({ a: sc({ id: 'a', dialogue: line('结局') }) }));
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.2));
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement;
    expect(root.dataset.reelEnded).toBe('true');
    expect(uiRoot.querySelector('.reel-runtime-ending')).not.toBeNull();
  });

  it('entryGate 不满足 + redirect → 落到改道场景', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({ id: 'a', branches: [{ id: 'b1', kind: 'auto', targetSceneId: 'locked' }] }),
        locked: sc({
          id: 'locked',
          entryGate: { condition: { all: [{ type: 'flag', varId: 'f', equals: true }] }, onFail: 'redirect', redirectSceneId: 'alt' },
        }),
        alt: sc({ id: 'alt', dialogue: line('改道了') }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.2));
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('alt');
  });

  it('entryGate 不满足 + block → 停在原地 + 门槛提示', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({ id: 'a', branches: [{ id: 'b1', kind: 'auto', targetSceneId: 'locked' }] }),
        locked: sc({
          id: 'locked',
          entryGate: { condition: { all: [{ type: 'flag', varId: 'f', equals: true }] }, onFail: 'block', hint: '条件不足' },
        }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.2));
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement;
    expect(root.dataset.reelScene).toBe('a');
    const notice = uiRoot.querySelector('.reel-runtime-gate-notice') as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe('条件不足');
  });

  it('onEnterItemEffects 一次性应用，并被下游 entryGate(hasItem) 读到', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({ id: 'a', onEnterItemEffects: [{ itemId: 'key', op: 'give' }], branches: [{ id: 'b1', kind: 'auto', targetSceneId: 'door' }] }),
        door: sc({
          id: 'door',
          entryGate: { condition: { all: [{ type: 'hasItem', itemId: 'key' }] }, onFail: 'block', hint: '需要钥匙' },
          dialogue: line('门开了'),
        }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.2));
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement;
    expect(root.dataset.reelScene).toBe('door'); // 根场景发的钥匙让门槛通过
    expect((uiRoot.querySelector('.reel-runtime-subtitle') as HTMLElement).textContent).toBe('门开了');
  });

  it('有可见 choice → 定格等待（不自动切场、不 FIN）', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({ id: 'a', branches: [{ id: 'b1', kind: 'choice', label: '前进', targetSceneId: 'b' }] }),
        b: sc({ id: 'b' }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.5));
    const root = uiRoot.querySelector('.reel-runtime-root') as HTMLElement;
    expect(root.dataset.reelScene).toBe('a'); // 停在原地等选择
    expect(uiRoot.querySelector('.reel-runtime-ending')).toBeNull();
  });
});

describe('createReelBootstrap · A4.2 ChoiceLayer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function scn(scenes: Record<string, unknown>, rootSceneId = 'a') {
    return { schemaVersion: 1, scenario: { id: 'g', title: 't', rootSceneId, defaultCharMs: 40, schemaVersion: 6, scenes } };
  }
  function sc(partial: Record<string, unknown>) {
    return { title: 's', durationMs: 100, branches: [], dialogue: [], ...partial };
  }
  async function bootAndEnd(payload: unknown) {
    const { ctx, uiRoot, updates } = makeCtx(async () => payload);
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.2)); // 播到场景末 → 弹选择层
    return uiRoot;
  }

  it('渲染可见 choice 卡片（文本 + 目标标题）', async () => {
    const uiRoot = await bootAndEnd(
      scn({
        a: sc({
          id: 'a',
          branches: [
            { id: 'b1', kind: 'choice', label: '往左', targetSceneId: 'L' },
            { id: 'b2', kind: 'choice', label: '往右', targetSceneId: 'R' },
          ],
        }),
        L: sc({ id: 'L', title: '左边' }),
        R: sc({ id: 'R', title: '右边' }),
      }),
    );
    const cards = uiRoot.querySelectorAll('.reel-runtime-choice-card');
    expect(cards.length).toBe(2);
    expect(cards[0]!.textContent).toContain('往左');
    expect(cards[0]!.textContent).toContain('左边');
  });

  it('点击可选卡片 → 切到目标场景、移除选择层', async () => {
    const uiRoot = await bootAndEnd(
      scn({
        a: sc({ id: 'a', branches: [{ id: 'b1', kind: 'choice', label: '前进', targetSceneId: 'b' }] }),
        b: sc({ id: 'b', dialogue: [{ id: 'd', role: 'narration', text: '到了B', startMs: 0 }] }),
      }),
    );
    (uiRoot.querySelector('.reel-runtime-choice-card') as HTMLButtonElement).click();
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('b');
    expect(uiRoot.querySelector('.reel-runtime-choice')).toBeNull();
  });

  it('选中分支的 itemEffects 落地，并被目标 entryGate(hasItem) 读到', async () => {
    const uiRoot = await bootAndEnd(
      scn({
        a: sc({
          id: 'a',
          branches: [{ id: 'b1', kind: 'choice', label: '拿钥匙开门', targetSceneId: 'door', itemEffects: [{ itemId: 'key', op: 'give' }] }],
        }),
        door: sc({
          id: 'door',
          entryGate: { condition: { all: [{ type: 'hasItem', itemId: 'key' }] }, onFail: 'block', hint: '需要钥匙' },
          dialogue: [{ id: 'd', role: 'narration', text: '门开了', startMs: 0 }],
        }),
      }),
    );
    (uiRoot.querySelector('.reel-runtime-choice-card') as HTMLButtonElement).click();
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('door');
  });

  it('条件不满足 + gateMode lock → 卡片灰显、disabled、悬停条件提示，点击无效', async () => {
    const uiRoot = await bootAndEnd(
      scn({
        a: sc({
          id: 'a',
          branches: [
            {
              id: 'b1',
              kind: 'choice',
              label: '强攻',
              targetSceneId: 'b',
              gateMode: 'lock',
              condition: { all: [{ type: 'var', varId: 'atk', op: 'gte', value: 5 }] },
            },
          ],
        }),
        b: sc({ id: 'b' }),
      }),
    );
    const card = uiRoot.querySelector('.reel-runtime-choice-card') as HTMLButtonElement;
    expect(card.classList.contains('is-locked')).toBe(true);
    expect(card.disabled).toBe(true);
    expect(card.textContent).toContain('需要');
    card.click(); // 锁定卡点击无效
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('a');
  });
});

describe('createReelBootstrap · A4.3 多 shot 切镜', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // 非整场视频 + 两个有时间码的 shot（中间留 1s 空隙）；墙钟驱动。
  function multiShotPayload() {
    return {
      schemaVersion: 1,
      scenario: {
        id: 'g',
        title: 't',
        rootSceneId: 'a',
        defaultCharMs: 40,
        schemaVersion: 6,
        scenes: {
          a: {
            id: 'a',
            title: 's',
            durationMs: 3000,
            branches: [],
            dialogue: [],
            media: { kind: 'PLACEHOLDER' },
            shots: [
              { id: 's1', startMs: 0, endMs: 1000, videoMediaRef: 'v1.mp4' },
              { id: 's2', startMs: 2000, endMs: 3000, keyframeMediaRef: 'img2.png' },
            ],
          },
        },
      },
    };
  }

  const cdn = { resolveMediaUrl: (r: string) => `https://cdn/${r}` };

  it('elapsed=0 挂首镜 <video>（按 videoMediaRef 解析）', async () => {
    const { ctx, uiRoot } = makeCtx(async () => multiShotPayload());
    await createReelBootstrap('g1', cdn)({}, ctx);
    const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(v.src).toMatch(/v1\.mp4$/);
  });

  it('墙钟推进到镜间空隙 → 黑场（无 video/img）', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => multiShotPayload());
    await createReelBootstrap('g1', cdn)({}, ctx);
    updates.forEach((fn) => fn(1.5)); // → elapsed 1500，落在 1000-2000 空隙
    expect(uiRoot.querySelector('video, img.reel-runtime-image')).toBeNull();
  });

  it('推进到次镜窗口 → 换挂该镜 <img>（keyframeMediaRef）', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => multiShotPayload());
    await createReelBootstrap('g1', cdn)({}, ctx);
    updates.forEach((fn) => fn(2.5)); // → elapsed 2500，落在 s2 [2000,3000)
    const img = uiRoot.querySelector('img.reel-runtime-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toMatch(/img2\.png$/);
    expect(uiRoot.querySelector('video')).toBeNull();
  });

  it('越过末镜 endMs（=有效结束）→ 触发 FIN（无分支）', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () => multiShotPayload());
    await createReelBootstrap('g1', cdn)({}, ctx);
    updates.forEach((fn) => fn(3.5)); // → elapsed 3500 ≥ effectiveEnd 3000
    expect(uiRoot.querySelector('.reel-runtime-ending')).not.toBeNull();
  });
});

describe('createReelBootstrap · A4.4 背包 HUD / 搜索热点 / 搜索段', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function scn(scene: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      scenario: {
        id: 'g',
        title: 't',
        rootSceneId: 'a',
        defaultCharMs: 40,
        schemaVersion: 7,
        scenes: { a: { id: 'a', title: 's', durationMs: 100000, branches: [], dialogue: [], media: { kind: 'PLACEHOLDER' }, ...scene } },
        ...extra,
      },
    };
  }

  it('onEnterItemEffects 入袋 → 背包 HUD 显示物品槽', async () => {
    const { ctx, uiRoot } = makeCtx(async () =>
      scn({ onEnterItemEffects: [{ itemId: 'key', op: 'give' }] }, { items: { key: { id: 'key', name: '钥匙' } } }),
    );
    await createReelBootstrap('g1')({}, ctx);
    const slot = uiRoot.querySelector('.reel-runtime-inv-slot');
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toContain('钥');
    // 无未拾取热点 → 不显示搜查按钮
    expect(uiRoot.querySelector('.reel-runtime-search-btn')).toBeNull();
  });

  it('手动搜查：按钮切换 → 热点层出现；点击热点拾取、槽位更新、热点消失', async () => {
    const { ctx, uiRoot } = makeCtx(async () =>
      scn(
        { searchLoot: [{ id: 'h1', itemId: 'key', x: 0.5, y: 0.5, r: 0.05 }] },
        { items: { key: { id: 'key', name: '钥匙' } } },
      ),
    );
    await createReelBootstrap('g1')({}, ctx);
    // 初始：有搜查按钮，无热点层
    const btn = uiRoot.querySelector('.reel-runtime-search-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(uiRoot.querySelector('.reel-runtime-spot')).toBeNull();
    // 开搜查 → 热点出现
    btn.click();
    const spot = uiRoot.querySelector('.reel-runtime-spot') as HTMLButtonElement;
    expect(spot).not.toBeNull();
    // 拾取 → 入袋、热点消失、搜查按钮消失（无未拾取）
    spot.click();
    expect(uiRoot.querySelector('.reel-runtime-spot')).toBeNull();
    expect(uiRoot.querySelector('.reel-runtime-inv-slot')!.textContent).toContain('钥');
    expect(uiRoot.querySelector('.reel-runtime-search-btn')).toBeNull();
  });

  it('搜索段：到达 startMs 定格进搜查（停表）→ 搜完自动续播 → 走到末尾 FIN', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn(
        {
          durationMs: 3000,
          searchSegments: [{ id: 'sg1', startMs: 1000, endMs: 2000, completeWhen: 'all' }],
          searchLoot: [{ id: 'h1', itemId: 'key', x: 0.5, y: 0.5, r: 0.05 }],
        },
        { items: { key: { id: 'key', name: '钥匙' } } },
      ),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(1.1)); // 越过 sg1.startMs=1000 → 进搜查
    const spot = uiRoot.querySelector('.reel-runtime-spot') as HTMLButtonElement;
    expect(spot).not.toBeNull();
    expect((uiRoot.querySelector('.reel-runtime-search-btn') as HTMLElement).textContent).toContain('搜查中');
    // 停表：搜查态下继续推墙钟不应触发 FIN
    updates.forEach((fn) => fn(5));
    expect(uiRoot.querySelector('.reel-runtime-ending')).toBeNull();
    // 搜完（唯一热点）→ 自动续播、退出搜查
    spot.click();
    expect(uiRoot.querySelector('.reel-runtime-spot')).toBeNull();
    // 续播到有效结束 → FIN（无分支）
    updates.forEach((fn) => fn(2));
    expect(uiRoot.querySelector('.reel-runtime-ending')).not.toBeNull();
  });
});

describe('createReelBootstrap · A4.5 QTE 结算 / 小游戏定格', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const QTE_WINDOW = { perfect: 80, great: 160, good: 280 };
  const QTE_SCORE = { perfect: 100, great: 60, good: 30, miss: -40 };

  function scn(scenes: Record<string, unknown>, rootSceneId = 'a') {
    return { schemaVersion: 1, scenario: { id: 'g', title: 't', rootSceneId, defaultCharMs: 40, schemaVersion: 8, scenes } };
  }
  function sc(partial: Record<string, unknown>) {
    return { title: 's', durationMs: 1000, branches: [], dialogue: [], media: { kind: 'PLACEHOLDER' }, ...partial };
  }

  it('场景末 QTE 结算：未达 passingScore → 走 qte_fail 分支', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({
          id: 'a',
          qte: { cues: [], window: QTE_WINDOW, score: QTE_SCORE, passingScore: 100 }, // 空 verdict 总分 0 < 100
          branches: [
            { id: 'p', kind: 'qte_pass', targetSceneId: 'win' },
            { id: 'f', kind: 'qte_fail', targetSceneId: 'lose' },
          ],
        }),
        win: sc({ id: 'win' }),
        lose: sc({ id: 'lose' }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(1.2)); // 越过 durationMs=1000 → 场景末结算
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('lose');
  });

  it('场景末 QTE 结算：passingScore=0（空 verdict 即通过）→ 走 qte_pass 分支', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({
          id: 'a',
          qte: { cues: [], window: QTE_WINDOW, score: QTE_SCORE, passingScore: 0 },
          branches: [
            { id: 'p', kind: 'qte_pass', targetSceneId: 'win' },
            { id: 'f', kind: 'qte_fail', targetSceneId: 'lose' },
          ],
        }),
        win: sc({ id: 'win' }),
        lose: sc({ id: 'lose' }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(1.2));
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('win');
  });

  it('小游戏触发：到达 startMs 定格（停表）→ 不越过 auto 分支切场', async () => {
    const { ctx, uiRoot, updates } = makeCtx(async () =>
      scn({
        a: sc({
          id: 'a',
          durationMs: 2000,
          minigames: [{ id: 'mg1', minigameId: 'nonexistent', startMs: 500 }],
          branches: [{ id: 'au', kind: 'auto', targetSceneId: 'b' }],
        }),
        b: sc({ id: 'b' }),
      }),
    );
    await createReelBootstrap('g1')({}, ctx);
    updates.forEach((fn) => fn(0.6)); // 越过 mg1.startMs=500 → 定格进小游戏
    // 继续推进：定格态不应推进到场景末 / auto 切场
    updates.forEach((fn) => fn(3));
    expect((uiRoot.querySelector('.reel-runtime-root') as HTMLElement).dataset.reelScene).toBe('a');
  });
});

describe('createReelBootstrap · A4.6 unmute 交互', () => {
  const origPlay = HTMLMediaElement.prototype.play;
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    HTMLMediaElement.prototype.play = origPlay;
  });

  function videoScene() {
    const s = makeScenario() as unknown as { scenes: Record<string, { media?: unknown }> };
    s.scenes.intro!.media = { kind: 'VIDEO', ref: './reel-media/x.mp4' };
    return { schemaVersion: 1, scenario: s };
  }

  it('autoplay 带声被拒 → 降级静音 + 浮出「点击恢复声音」；点击后 unmute', async () => {
    // 未静音 play 拒绝，静音 play 通过（模拟浏览器 autoplay 策略）。
    HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
      return this.muted ? Promise.resolve() : Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    const { ctx, uiRoot } = makeCtx(async () => videoScene());
    await createReelBootstrap('g1')({}, ctx);
    await vi.waitFor(() => {
      expect(uiRoot.querySelector('.reel-runtime-unmute')).not.toBeNull();
    });
    const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
    expect(v.muted).toBe(true);
    (uiRoot.querySelector('.reel-runtime-unmute') as HTMLButtonElement).click();
    expect(v.muted).toBe(false);
    expect(uiRoot.querySelector('.reel-runtime-unmute')).toBeNull();
  });

  it('autoplay 带声成功 → 无 unmute 按钮、视频带声', async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    const { ctx, uiRoot } = makeCtx(async () => videoScene());
    await createReelBootstrap('g1')({}, ctx);
    await vi.waitFor(() => {
      const v = uiRoot.querySelector('video.reel-runtime-video') as HTMLVideoElement;
      expect(v.muted).toBe(false);
    });
    expect(uiRoot.querySelector('.reel-runtime-unmute')).toBeNull();
  });
});

describe('activeDialogue 纯函数', () => {
  const lines = [
    { id: 'a', role: 'narration' as const, text: 'A', startMs: 0, endMs: 1000 },
    { id: 'b', role: 'character' as const, text: 'B', startMs: 1000 },
    { id: 'c', role: 'character' as const, text: 'C', startMs: 3000, endMs: 4000 },
  ];

  it('取 startMs ≤ elapsed 里最大的一条', () => {
    expect(activeDialogue(lines, 0)?.id).toBe('a');
    expect(activeDialogue(lines, 999)?.id).toBe('a');
    expect(activeDialogue(lines, 1000)?.id).toBe('b');
    expect(activeDialogue(lines, 2500)?.id).toBe('b'); // b 无 endMs，持续到 c
    expect(activeDialogue(lines, 3000)?.id).toBe('c');
  });

  it('候选有 endMs 且已过 → 空档不显示', () => {
    expect(activeDialogue(lines, 4000)).toBeUndefined(); // c 已 endMs=4000
    expect(activeDialogue(lines, 5000)).toBeUndefined();
  });

  it('elapsed 早于所有 startMs → 无', () => {
    expect(activeDialogue([{ id: 'x', role: 'narration', text: 'X', startMs: 500 }], 100)).toBeUndefined();
  });
});
