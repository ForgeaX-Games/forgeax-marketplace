import { describe, expect, test } from 'bun:test';
import {
  canRetryIssue,
  costWarning,
  formatSessionClock,
  panelStatusText,
  phaseStatusLabel,
  stopReasonText,
} from './status';

describe('generative visuals panel status copy', () => {
  test('keeps phase labels provider-neutral', () => {
    expect(phaseStatusLabel('live')).toBe('Live');
    expect(phaseStatusLabel('failed')).toBe('Session failed');
    expect(phaseStatusLabel('waiting')).toContain('Waiting');
    expect(phaseStatusLabel('connecting')).toContain('Connecting');
  });

  test('prefers issue and activity over the phase fallback', () => {
    expect(panelStatusText({
      phase: 'failed',
      issue: {
        code: 'transport',
        message: 'Backend disconnected before becoming ready',
        retryable: true,
      },
    })).toBe('Backend disconnected before becoming ready');
    expect(panelStatusText({
      phase: 'waiting',
      activity: 'Uploading the selected image prior.',
    })).toBe('Uploading the selected image prior.');
  });

  test('allows retry only for retryable failed or degraded issues', () => {
    expect(canRetryIssue({
      phase: 'failed',
      issue: { code: 'transport', message: 'temporary', retryable: true },
    })).toBe(true);
    expect(canRetryIssue({
      phase: 'degraded',
      issue: { code: 'stale-epoch', message: 'epoch', retryable: true },
    })).toBe(true);
    expect(canRetryIssue({
      phase: 'failed',
      issue: { code: 'unauthorized', message: 'denied', retryable: false },
    })).toBe(false);
    expect(canRetryIssue({ phase: 'live' })).toBe(false);
  });

  test('formats billing clocks and cost warnings without provider vocabulary', () => {
    expect(formatSessionClock({
      state: 'billable',
      startedAtMs: 10_000,
      remainingMs: 45_000,
      canExtendIdle: true,
    }, 80_000)).toBe('1:10 elapsed · 0:45 left');
    expect(costWarning({
      state: 'billable',
      pauseRemainingMs: 15_000,
      canExtendIdle: false,
    }, true)).toContain('session still bills');
    expect(costWarning({
      state: 'billable',
      idleRemainingMs: 15_000,
      canExtendIdle: true,
    }, false)).toBe('Idle · auto-stop in 0:15');
    expect(stopReasonText('hidden')).toBe('Background limit reached');
  });
});
