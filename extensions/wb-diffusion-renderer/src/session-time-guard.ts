import type { VisualSessionCostState } from './adapter';

export type SessionStopReason = 'time-limit' | 'idle' | 'paused' | 'hidden' | 'pagehide' | 'user';

export interface SessionTimeGuardSnapshot {
  readonly state: VisualSessionCostState['phase'];
  readonly startedAtMs?: number;
  readonly deadlineAtMs?: number;
  readonly remainingMs?: number;
  readonly idleRemainingMs?: number;
  readonly pauseRemainingMs?: number;
  readonly hiddenRemainingMs?: number;
  readonly stopReason?: SessionStopReason;
  readonly canExtendIdle: boolean;
}

export interface SessionTimeGuardOptions {
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly onStop: (reason: SessionStopReason) => void;
  readonly onChange?: () => void;
  readonly maxSessionMs?: number;
  readonly idleMs?: number;
  readonly pauseMs?: number;
  readonly hiddenMs?: number;
}

const DEFAULT_MAX_SESSION_MS = 5 * 60_000;
const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_PAUSE_MS = 15_000;
const DEFAULT_HIDDEN_MS = 30_000;

/**
 * Centralizes all client-side spending cutoffs. Callers only report lifecycle
 * signals; this module owns timer precedence and invokes one stop callback.
 */
export class SessionTimeGuard {
  private readonly now: () => number;
  private readonly setTimer: NonNullable<SessionTimeGuardOptions['setTimeout']>;
  private readonly clearTimer: NonNullable<SessionTimeGuardOptions['clearTimeout']>;
  private readonly maxSessionMs: number;
  private readonly idleMs: number;
  private readonly pauseMs: number;
  private readonly hiddenMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private startedAtMs?: number;
  private deadlineAtMs?: number;
  private lastActivityAtMs?: number;
  private pausedAtMs?: number;
  private hiddenAtMs?: number;
  private stopReason?: SessionStopReason;
  private idleExtensionUsed = false;
  private ended = false;

  constructor(private readonly options: SessionTimeGuardOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimeout
      ?? ((callback, milliseconds) => globalThis.setTimeout(callback, milliseconds));
    this.clearTimer = options.clearTimeout
      ?? ((timer) => globalThis.clearTimeout(timer));
    this.maxSessionMs = options.maxSessionMs ?? DEFAULT_MAX_SESSION_MS;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
    this.hiddenMs = options.hiddenMs ?? DEFAULT_HIDDEN_MS;
  }

  observeCostState(cost: VisualSessionCostState | undefined): void {
    if (cost?.phase === 'billable' && this.startedAtMs === undefined) {
      const now = this.now();
      this.startedAtMs = cost.startedAtMs ?? now;
      this.deadlineAtMs = this.startedAtMs + this.maxSessionMs;
      this.lastActivityAtMs = now;
      this.stopReason = undefined;
      this.reschedule();
      return;
    }
    if (cost?.phase === 'stopped') {
      this.clearScheduledTimer();
      this.ended = true;
      this.options.onChange?.();
      return;
    }
    if (cost?.phase === 'inactive' || cost === undefined) {
      this.reset();
    }
  }

  touch(): void {
    if (this.startedAtMs === undefined || this.stopReason) return;
    this.lastActivityAtMs = this.now();
    this.reschedule();
  }

  setPaused(paused: boolean): void {
    if (this.startedAtMs === undefined || this.stopReason) return;
    this.pausedAtMs = paused ? this.now() : undefined;
    this.reschedule();
  }

  setVisible(visible: boolean): void {
    if (this.startedAtMs === undefined || this.stopReason) return;
    this.hiddenAtMs = visible ? undefined : this.now();
    this.reschedule();
  }

  extendIdle(): boolean {
    if (this.idleExtensionUsed || this.startedAtMs === undefined || this.stopReason) return false;
    this.idleExtensionUsed = true;
    this.lastActivityAtMs = this.now();
    this.reschedule();
    return true;
  }

  stop(reason: SessionStopReason): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.clearScheduledTimer();
    this.options.onChange?.();
    this.options.onStop(reason);
  }

  dispose(): void {
    this.clearScheduledTimer();
  }

  getSnapshot(): SessionTimeGuardSnapshot {
    const now = this.now();
    const elapsed = this.startedAtMs === undefined ? undefined : Math.max(0, now - this.startedAtMs);
    const remainingMs = this.deadlineAtMs === undefined ? undefined : Math.max(0, this.deadlineAtMs - now);
    const idleRemainingMs = this.lastActivityAtMs === undefined
      ? undefined
      : Math.max(0, this.idleMs - (now - this.lastActivityAtMs));
    const pauseRemainingMs = this.pausedAtMs === undefined
      ? undefined
      : Math.max(0, this.pauseMs - (now - this.pausedAtMs));
    const hiddenRemainingMs = this.hiddenAtMs === undefined
      ? undefined
      : Math.max(0, this.hiddenMs - (now - this.hiddenAtMs));
    return {
      state: this.stopReason ? (this.ended ? 'stopped' : 'stopping') : this.startedAtMs === undefined ? 'inactive' : 'billable',
      ...(this.startedAtMs === undefined ? {} : { startedAtMs: this.startedAtMs }),
      ...(this.deadlineAtMs === undefined ? {} : { deadlineAtMs: this.deadlineAtMs }),
      ...(remainingMs === undefined ? {} : { remainingMs }),
      ...(idleRemainingMs === undefined ? {} : { idleRemainingMs }),
      ...(pauseRemainingMs === undefined ? {} : { pauseRemainingMs }),
      ...(hiddenRemainingMs === undefined ? {} : { hiddenRemainingMs }),
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      canExtendIdle: !this.idleExtensionUsed && this.startedAtMs !== undefined && !this.stopReason,
    };
  }

  private reschedule(): void {
    this.clearScheduledTimer();
    if (this.startedAtMs === undefined || this.stopReason) return;
    const now = this.now();
    const due = [
      this.deadlineAtMs,
      this.lastActivityAtMs === undefined ? undefined : this.lastActivityAtMs + this.idleMs,
      this.pausedAtMs === undefined ? undefined : this.pausedAtMs + this.pauseMs,
      this.hiddenAtMs === undefined ? undefined : this.hiddenAtMs + this.hiddenMs,
    ].filter((value): value is number => value !== undefined);
    const next = Math.min(...due);
    // A short tick keeps the compact clock and last-15s warnings honest while
    // still scheduling the exact policy deadline.
    this.timer = this.setTimer(() => this.expire(), Math.max(0, Math.min(next - now, 1_000)));
    this.options.onChange?.();
  }

  private expire(): void {
    if (this.stopReason || this.startedAtMs === undefined) return;
    const now = this.now();
    if (this.deadlineAtMs !== undefined && now >= this.deadlineAtMs) {
      this.stop('time-limit');
    } else if (this.pausedAtMs !== undefined && now >= this.pausedAtMs + this.pauseMs) {
      this.stop('paused');
    } else if (this.hiddenAtMs !== undefined && now >= this.hiddenAtMs + this.hiddenMs) {
      this.stop('hidden');
    } else if (this.lastActivityAtMs !== undefined && now >= this.lastActivityAtMs + this.idleMs) {
      this.stop('idle');
    } else {
      this.reschedule();
    }
  }

  private reset(): void {
    this.clearScheduledTimer();
    this.startedAtMs = undefined;
    this.deadlineAtMs = undefined;
    this.lastActivityAtMs = undefined;
    this.pausedAtMs = undefined;
    this.hiddenAtMs = undefined;
    this.stopReason = undefined;
    this.idleExtensionUsed = false;
    this.ended = false;
    this.options.onChange?.();
  }

  private clearScheduledTimer(): void {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }
}
