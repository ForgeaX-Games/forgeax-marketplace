import { describe, expect, test } from 'bun:test';
import { LingbotWorld2Adapter } from './lingbot-world-2';

describe('LingBot World 2 adapter', () => {
  test('declares every closed motion target it compiles', () => {
    const adapter = new LingbotWorld2Adapter(() => {
      throw new Error('not constructed');
    });
    expect(adapter.capabilities.motionTargets).toContain('navigation.forward-rate');
    expect(adapter.capabilities.motionTargets).toContain('camera.rotation.yaw-rate');
    expect(adapter.capabilities.motionTargets).not.toContain('set_camera_pose');
  });
});
