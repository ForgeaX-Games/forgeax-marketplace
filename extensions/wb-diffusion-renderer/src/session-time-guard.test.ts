import { describe, expect, test } from 'bun:test';
import { SessionTimeGuard, type SessionStopReason } from './session-time-guard';

function createFakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout: (callback: () => void, milliseconds: number) => {
      const id = ++sequence;
      timers.set(id, { due: now + milliseconds, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    },
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].due;
        next[1].callback();
      }
      now = target;
    },
  };
}

describe('SessionTimeGuard', () => {
  test('starts only after provider ready and stops at hard limit', () => {
    const clock = createFakeClock();
    const stops: SessionStopReason[] = [];
    const guard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 300,
      idleMs: 1_000,
      pauseMs: 1_000,
      hiddenMs: 1_000,
      onStop: (reason) => stops.push(reason),
    });

    guard.observeCostState({ phase: 'inactive' });
    clock.advance(1_000);
    expect(stops).toEqual([]);

    guard.observeCostState({ phase: 'billable', startedAtMs: clock.now() });
    clock.advance(299);
    expect(stops).toEqual([]);
    clock.advance(1);
    expect(stops).toEqual(['time-limit']);
    expect(guard.getSnapshot().state).toBe('stopping');
    guard.observeCostState({ phase: 'stopped' });
    expect(guard.getSnapshot().state).toBe('stopped');
  });

  test('uses meaningful activity, pause, hidden, and one idle extension', () => {
    const clock = createFakeClock();
    const stops: SessionStopReason[] = [];
    const guard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 10_000,
      idleMs: 100,
      pauseMs: 50,
      hiddenMs: 75,
      onStop: (reason) => stops.push(reason),
    });

    guard.observeCostState({ phase: 'billable', startedAtMs: 0 });
    clock.advance(90);
    guard.touch();
    clock.advance(90);
    expect(stops).toEqual([]);
    expect(guard.extendIdle()).toBe(true);
    expect(guard.extendIdle()).toBe(false);
    clock.advance(99);
    expect(stops).toEqual([]);
    clock.advance(1);
    expect(stops).toEqual(['idle']);

    const pauseStops: SessionStopReason[] = [];
    const pauseGuard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 10_000,
      idleMs: 1_000,
      pauseMs: 50,
      hiddenMs: 75,
      onStop: (reason) => pauseStops.push(reason),
    });
    pauseGuard.observeCostState({ phase: 'billable', startedAtMs: clock.now() });
    pauseGuard.setPaused(true);
    clock.advance(50);
    expect(pauseStops).toEqual(['paused']);

    const hiddenStops: SessionStopReason[] = [];
    const hiddenGuard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 10_000,
      idleMs: 1_000,
      pauseMs: 1_000,
      hiddenMs: 75,
      onStop: (reason) => hiddenStops.push(reason),
    });
    hiddenGuard.observeCostState({ phase: 'billable', startedAtMs: clock.now() });
    hiddenGuard.setVisible(false);
    clock.advance(75);
    expect(hiddenStops).toEqual(['hidden']);
  });

  test('cancels outstanding timers and invokes the terminal callback once', () => {
    const clock = createFakeClock();
    const stops: SessionStopReason[] = [];
    const guard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 100,
      idleMs: 50,
      pauseMs: 50,
      hiddenMs: 50,
      onStop: (reason) => stops.push(reason),
    });
    guard.observeCostState({ phase: 'billable', startedAtMs: 0 });
    guard.stop('user');
    guard.stop('idle');
    clock.advance(1_000);
    expect(stops).toEqual(['user']);

    const disposedStops: SessionStopReason[] = [];
    const disposedGuard = new SessionTimeGuard({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      maxSessionMs: 50,
      idleMs: 50,
      pauseMs: 50,
      hiddenMs: 50,
      onStop: (reason) => disposedStops.push(reason),
    });
    disposedGuard.observeCostState({ phase: 'billable', startedAtMs: clock.now() });
    disposedGuard.dispose();
    clock.advance(1_000);
    expect(disposedStops).toEqual([]);
  });
});
