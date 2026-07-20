import type { VisualPresentationIssue, VisualSessionPhase } from '@forgeax/types/visual-generation';
import type { SessionStopReason, SessionTimeGuardSnapshot } from './session-time-guard';

/** Provider-neutral phase labels shown in the Panel status strip. */
export function phaseStatusLabel(phase: VisualSessionPhase): string {
  switch (phase) {
    case 'idle':
      return 'Choose a backend and start';
    case 'waiting':
      return 'Waiting for session or first frame…';
    case 'connecting':
      return 'Connecting…';
    case 'live':
      return 'Live';
    case 'degraded':
      return 'Waiting for a usable Studio world';
    case 'failed':
      return 'Session failed';
    case 'stopped':
      return 'Stopped';
    default: {
      const _exhaustive: never = phase;
      return String(_exhaustive);
    }
  }
}

export function panelStatusText(options: {
  readonly phase: VisualSessionPhase;
  readonly issue?: VisualPresentationIssue;
  readonly activity?: string;
}): string {
  return options.issue?.message
    ?? options.activity
    ?? phaseStatusLabel(options.phase);
}

export function canRetryIssue(options: {
  readonly phase: VisualSessionPhase;
  readonly issue?: VisualPresentationIssue;
}): boolean {
  if (!options.issue?.retryable) return false;
  return options.phase === 'failed' || options.phase === 'degraded';
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatSessionClock(cost: SessionTimeGuardSnapshot, nowMs = Date.now()): string | undefined {
  if (cost.startedAtMs === undefined || cost.remainingMs === undefined) return undefined;
  return `${formatDuration(nowMs - cost.startedAtMs)} elapsed · ${formatDuration(cost.remainingMs)} left`;
}

export function costWarning(cost: SessionTimeGuardSnapshot, paused: boolean): string | undefined {
  if (cost.state === 'stopping') return 'Stopping and releasing GPU…';
  if (paused && cost.pauseRemainingMs !== undefined) {
    return `Paused · session still bills · auto-stop in ${formatDuration(cost.pauseRemainingMs)}`;
  }
  if (cost.hiddenRemainingMs !== undefined && cost.hiddenRemainingMs <= 15_000) {
    return `Page hidden · auto-stop in ${formatDuration(cost.hiddenRemainingMs)}`;
  }
  if (cost.idleRemainingMs !== undefined && cost.idleRemainingMs <= 15_000) {
    return `Idle · auto-stop in ${formatDuration(cost.idleRemainingMs)}`;
  }
  return undefined;
}

export function stopReasonText(reason: SessionStopReason | undefined): string | undefined {
  if (!reason) return undefined;
  const labels: Record<SessionStopReason, string> = {
    'time-limit': 'Session time limit reached',
    idle: 'Idle limit reached',
    paused: 'Pause limit reached',
    hidden: 'Background limit reached',
    pagehide: 'Page closed',
    user: 'Stopped',
  };
  return labels[reason];
}
