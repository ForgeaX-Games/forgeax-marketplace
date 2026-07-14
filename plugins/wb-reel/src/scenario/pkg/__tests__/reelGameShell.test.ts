import { describe, expect, it } from 'vitest';

import { buildReelGameShell, renderReelMainTs } from '../reelGameShell';

const GUID = '11111111-2222-8333-a444-555555555555';

describe('renderReelMainTs', () => {
  it('薄壳导出 bootstrap = createReelBootstrap(guid)，import 自 @forgeax-extension/wb-reel/runtime', () => {
    const src = renderReelMainTs(GUID);
    expect(src).toMatch(/import \{ createReelBootstrap \} from '@forgeax-plugin\/wb-reel\/runtime'/);
    expect(src).toContain(`createReelBootstrap("${GUID}")`);
    expect(src).toMatch(/export const bootstrap:/);
    // A3 断言点：标注为真 BootstrapContext / World。
    expect(src).toMatch(/import type \{ BootstrapContext \} from '@forgeax\/engine-app'/);
    expect(src).toMatch(/import type \{ World \} from '@forgeax\/engine-ecs'/);
  });

  it('非法 guid 抛错', () => {
    expect(() => renderReelMainTs('not-a-uuid')).toThrow(/guid/);
  });
});

describe('buildReelGameShell', () => {
  it('forge.json：entry=main.ts、id=slug、无 defaultScene、无 reelGameGuid', () => {
    const { forge } = buildReelGameShell({ guid: GUID, slug: 'my-reel', title: '我的影游' });
    expect(forge.entry).toBe('main.ts');
    expect(forge.id).toBe('my-reel');
    expect(forge.name).toBe('我的影游');
    expect(forge.schemaVersion).toBe('1.0.0');
    expect('defaultScene' in forge).toBe(false);
    expect('reelGameGuid' in forge).toBe(false);
  });

  it('B3：从既有 forge 删除非法 reelGameGuid / defaultScene，保留合法字段(physics/preview)', () => {
    const { forge } = buildReelGameShell({
      guid: GUID,
      slug: 'my-reel',
      existingForge: {
        id: 'old-id',
        name: '旧名',
        schemaVersion: '1.0.0',
        reelGameGuid: 'deadbeef-0000-0000-0000-000000000000',
        defaultScene: '99999999-2222-8333-a444-555555555555',
        physics: false,
        preview: { some: 'cfg' },
      },
    });
    expect('reelGameGuid' in forge).toBe(false);
    expect('defaultScene' in forge).toBe(false);
    expect(forge.physics).toBe(false);
    expect(forge.preview).toEqual({ some: 'cfg' });
    // 既有 name 保留，id 强制对齐 slug。
    expect(forge.name).toBe('旧名');
    expect(forge.id).toBe('my-reel');
  });

  it('slug 必填、guid 须合法', () => {
    expect(() => buildReelGameShell({ guid: GUID, slug: '' })).toThrow(/slug/);
    expect(() => buildReelGameShell({ guid: 'bad', slug: 'x' })).toThrow(/guid/);
  });
});
