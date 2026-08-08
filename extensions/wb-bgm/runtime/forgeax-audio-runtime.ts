export type RuntimeAudioBus = 'sfx' | 'music' | 'voice';
export type RuntimeConditionValue = string | number | boolean | Array<string | number | boolean>;
export type RuntimeFollowValue = string | number | boolean;

export interface AudioPoint { x: number; y: number; z: number }

export interface AudioEventContext {
  emitter?: AudioPoint;
  listener?: { position: AudioPoint; forward?: AudioPoint; up?: AudioPoint };
  [key: string]: unknown;
}

export interface RuntimeAudioShaping {
  gainDb: number;
  pitchSemitones: number;
  highpassHz: number;
  lowpassHz: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
}

export interface RuntimeAudioAsset {
  assetId: string;
  file: string;
  url: string;
  name?: string;
  shaping?: RuntimeAudioShaping;
}

export interface RuntimeAudioBinding {
  eventId: string;
  label: string;
  enabled: boolean;
  kind: RuntimeAudioBus;
  assets: RuntimeAudioAsset[];
  variation: { mode: 'single' | 'sequential' | 'random-no-repeat' };
  trigger: { delayMs: number; cooldownMs: number; probability: number };
  playback: {
    volume: number;
    bus: RuntimeAudioBus;
    spatial: '2d' | '3d';
    mode: 'one-shot' | 'loop';
    fadeInMs: number;
    fadeOutMs: number;
    stopEventId?: string;
  };
  shaping?: RuntimeAudioShaping;
  follow?: {
    field: string;
    label?: string;
    defaultValue: RuntimeFollowValue;
    cases?: Array<{
      value: RuntimeFollowValue;
      label?: string;
      assets: RuntimeAudioAsset[];
    }>;
    range?: {
      min: number;
      max: number;
      volumeStart: number;
      volumeEnd: number;
      pitchStart: number;
      pitchEnd: number;
      lowpassStart: number;
      lowpassEnd: number;
    };
  };
  conditions: Array<{
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
    value: RuntimeConditionValue;
  }>;
}

export interface RuntimeAudioProject {
  schemaVersion: 'forgeax-audio-runtime/1';
  projectId: string;
  revision: number;
  bindings: RuntimeAudioBinding[];
}

export interface AudioPlayRequest {
  bindingId: string;
  eventId: string;
  asset: RuntimeAudioAsset;
  volume: number;
  bus: RuntimeAudioBus;
  loop: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  spatial: '2d' | '3d';
  context: AudioEventContext;
}

export interface AudioHandle {
  stop(fadeOutMs: number): void;
  update?(request: AudioPlayRequest): void;
}

export interface AudioPort {
  play(request: AudioPlayRequest): AudioHandle | Promise<AudioHandle | undefined> | undefined;
  setBusVolume(bus: RuntimeAudioBus | string, volume: number): void;
  dispose(): void;
}

export interface ForgeaxAudioRuntime {
  emit(eventId: string, context?: AudioEventContext): number;
  setGameValue(field: string, value: RuntimeFollowValue): void;
  stop(eventId?: string): void;
  setBusVolume(bus: RuntimeAudioBus, volume: number): void;
  dispose(): void;
}

export interface ForgeaxAudioRuntimeOptions {
  port?: AudioPort;
  now?: () => number;
  random?: () => number;
  schedule?: (run: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

function contextValue(context: AudioEventContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function conditionMatches(
  actual: unknown,
  operator: RuntimeAudioBinding['conditions'][number]['operator'],
  expected: RuntimeConditionValue,
): boolean {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in': return Array.isArray(expected) && expected.some((item) => item === actual);
  }
}

function bindingMatches(binding: RuntimeAudioBinding, context: AudioEventContext): boolean {
  return binding.conditions.every((condition) => (
    conditionMatches(contextValue(context, condition.field), condition.operator, condition.value)
  ));
}

const DEFAULT_SHAPING: RuntimeAudioShaping = {
  gainDb: 0,
  pitchSemitones: 0,
  highpassHz: 20,
  lowpassHz: 20_000,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function mergeShaping(
  ...layers: Array<RuntimeAudioShaping | Partial<RuntimeAudioShaping> | undefined>
): RuntimeAudioShaping | undefined {
  const active = layers.filter((layer): layer is RuntimeAudioShaping | Partial<RuntimeAudioShaping> => Boolean(layer));
  if (active.length === 0) return undefined;
  const result = { ...DEFAULT_SHAPING };
  for (const layer of active) {
    result.gainDb += layer.gainDb ?? 0;
    result.pitchSemitones += layer.pitchSemitones ?? 0;
    result.eqLowDb += layer.eqLowDb ?? 0;
    result.eqMidDb += layer.eqMidDb ?? 0;
    result.eqHighDb += layer.eqHighDb ?? 0;
    if (layer.highpassHz !== undefined) result.highpassHz = Math.max(result.highpassHz, layer.highpassHz);
    if (layer.lowpassHz !== undefined) result.lowpassHz = Math.min(result.lowpassHz, layer.lowpassHz);
  }
  result.gainDb = clamp(result.gainDb, -24, 12);
  result.pitchSemitones = clamp(result.pitchSemitones, -12, 12);
  result.eqLowDb = clamp(result.eqLowDb, -12, 12);
  result.eqMidDb = clamp(result.eqMidDb, -12, 12);
  result.eqHighDb = clamp(result.eqHighDb, -12, 12);
  result.highpassHz = clamp(result.highpassHz, 20, 2_000);
  result.lowpassHz = clamp(result.lowpassHz, Math.max(1_000, result.highpassHz + 100), 20_000);
  return result;
}

interface BrowserSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  filters?: {
    highpass: BiquadFilterNode;
    lowShelf: BiquadFilterNode;
    midPeak: BiquadFilterNode;
    highShelf: BiquadFilterNode;
    lowpass: BiquadFilterNode;
  };
  context: AudioContext;
  stopped: boolean;
  nodes: AudioNode[];
}

class BrowserAudioHandle implements AudioHandle {
  constructor(private readonly value: BrowserSource) {}

  stop(fadeOutMs: number): void {
    if (this.value.stopped) return;
    this.value.stopped = true;
    const { context, source, gain } = this.value;
    const now = context.currentTime;
    const stopAt = now + Math.max(0, fadeOutMs) / 1_000;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fadeOutMs > 0) gain.gain.linearRampToValueAtTime(0, stopAt);
      else gain.gain.setValueAtTime(0, now);
      source.stop(stopAt);
    } catch {
      // The browser may already have ended this one-shot source.
    }
  }

  update(request: AudioPlayRequest): void {
    if (this.value.stopped) return;
    const shaping = request.asset.shaping;
    const now = this.value.context.currentTime;
    this.value.source.playbackRate.setTargetAtTime(
      shaping ? 2 ** (shaping.pitchSemitones / 12) : 1,
      now,
      0.03,
    );
    const targetVolume = Math.max(0, request.volume) * (shaping ? 10 ** (shaping.gainDb / 20) : 1);
    this.value.gain.gain.setTargetAtTime(targetVolume, now, 0.03);
    if (shaping && this.value.filters) {
      this.value.filters.highpass.frequency.setTargetAtTime(shaping.highpassHz, now, 0.03);
      this.value.filters.lowShelf.gain.setTargetAtTime(shaping.eqLowDb, now, 0.03);
      this.value.filters.midPeak.gain.setTargetAtTime(shaping.eqMidDb, now, 0.03);
      this.value.filters.highShelf.gain.setTargetAtTime(shaping.eqHighDb, now, 0.03);
      this.value.filters.lowpass.frequency.setTargetAtTime(shaping.lowpassHz, now, 0.03);
    }
    const emitter = request.context.emitter;
    if (emitter && this.value.panner) {
      this.value.panner.positionX.setTargetAtTime(emitter.x, now, 0.03);
      this.value.panner.positionY.setTargetAtTime(emitter.y, now, 0.03);
      this.value.panner.positionZ.setTargetAtTime(emitter.z, now, 0.03);
    }
  }
}

class BrowserAudioPort implements AudioPort {
  private context?: AudioContext;
  private master?: GainNode;
  private readonly buses = new Map<RuntimeAudioBus, GainNode>();
  private readonly busVolumes = new Map<RuntimeAudioBus, number>([
    ['sfx', 1], ['music', 1], ['voice', 1],
  ]);
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly sources = new Set<BrowserSource>();

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const scope = globalThis as typeof globalThis & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Constructor) return undefined;
    try {
      const context = new Constructor();
      const master = context.createGain();
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      return context;
    } catch {
      return undefined;
    }
  }

  private bus(bus: RuntimeAudioBus): GainNode | undefined {
    const context = this.ensureContext();
    if (!context || !this.master) return undefined;
    const current = this.buses.get(bus);
    if (current) return current;
    const gain = context.createGain();
    gain.gain.value = this.busVolumes.get(bus) ?? 1;
    gain.connect(this.master);
    this.buses.set(bus, gain);
    return gain;
  }

  private load(url: string, context: AudioContext): Promise<AudioBuffer> {
    const current = this.buffers.get(url);
    if (current) return current;
    const pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`audio HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes));
    this.buffers.set(url, pending);
    pending.catch(() => this.buffers.delete(url));
    return pending;
  }

  private syncSpatialContext(context: AudioContext, request: AudioPlayRequest, panner: PannerNode): void {
    const emitter = request.context.emitter;
    if (emitter) {
      panner.positionX.value = emitter.x;
      panner.positionY.value = emitter.y;
      panner.positionZ.value = emitter.z;
    }
    const listenerState = request.context.listener;
    if (!listenerState) return;
    const listener = context.listener;
    listener.positionX.value = listenerState.position.x;
    listener.positionY.value = listenerState.position.y;
    listener.positionZ.value = listenerState.position.z;
    if (listenerState.forward) {
      listener.forwardX.value = listenerState.forward.x;
      listener.forwardY.value = listenerState.forward.y;
      listener.forwardZ.value = listenerState.forward.z;
    }
    if (listenerState.up) {
      listener.upX.value = listenerState.up.x;
      listener.upY.value = listenerState.up.y;
      listener.upZ.value = listenerState.up.z;
    }
  }

  async play(request: AudioPlayRequest): Promise<AudioHandle | undefined> {
    const context = this.ensureContext();
    const bus = this.bus(request.bus);
    if (!context || !bus) return undefined;
    try {
      if (context.state === 'suspended') await context.resume();
      const buffer = await this.load(request.asset.url, context);
      const source = context.createBufferSource();
      const gain = context.createGain();
      const now = context.currentTime;
      const shaping = request.asset.shaping;
      source.playbackRate.value = shaping ? 2 ** (shaping.pitchSemitones / 12) : 1;
      const targetVolume = Math.max(0, request.volume) * (shaping ? 10 ** (shaping.gainDb / 20) : 1);
      if (request.fadeInMs > 0) {
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(targetVolume, now + request.fadeInMs / 1_000);
      } else {
        gain.gain.setValueAtTime(targetVolume, now);
      }
      source.buffer = buffer;
      source.loop = request.loop;
      const shapingNodes: BiquadFilterNode[] = [];
      let filters: BrowserSource['filters'];
      if (shaping) {
        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = shaping.highpassHz;
        const lowShelf = context.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.value = 200;
        lowShelf.gain.value = shaping.eqLowDb;
        const midPeak = context.createBiquadFilter();
        midPeak.type = 'peaking';
        midPeak.frequency.value = 1_200;
        midPeak.Q.value = 0.8;
        midPeak.gain.value = shaping.eqMidDb;
        const highShelf = context.createBiquadFilter();
        highShelf.type = 'highshelf';
        highShelf.frequency.value = 5_000;
        highShelf.gain.value = shaping.eqHighDb;
        const lowpass = context.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = shaping.lowpassHz;
        shapingNodes.push(highpass, lowShelf, midPeak, highShelf, lowpass);
        filters = { highpass, lowShelf, midPeak, highShelf, lowpass };
      }
      let tail: AudioNode = source;
      for (const node of shapingNodes) tail = tail.connect(node);
      tail.connect(gain);
      let panner: PannerNode | undefined;
      if (request.spatial === '3d') {
        panner = context.createPanner();
        panner.panningModel = 'equalpower';
        this.syncSpatialContext(context, request, panner);
        gain.connect(panner);
        panner.connect(bus);
      } else {
        gain.connect(bus);
      }
      const active: BrowserSource = { source, gain, panner, filters, context, stopped: false, nodes: shapingNodes };
      this.sources.add(active);
      source.onended = () => {
        active.stopped = true;
        source.disconnect();
        gain.disconnect();
        for (const node of shapingNodes) node.disconnect();
        panner?.disconnect();
        this.sources.delete(active);
      };
      source.start();
      return new BrowserAudioHandle(active);
    } catch {
      return undefined;
    }
  }

  setBusVolume(bus: RuntimeAudioBus, volume: number): void {
    const safe = Math.max(0, Math.min(4, volume));
    this.busVolumes.set(bus, safe);
    const node = this.buses.get(bus);
    if (node) node.gain.value = safe;
  }

  dispose(): void {
    for (const source of this.sources) new BrowserAudioHandle(source).stop(0);
    this.sources.clear();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = undefined;
    this.master = undefined;
    this.buses.clear();
    this.buffers.clear();
  }
}

export function createForgeaxAudioRuntime(
  project: RuntimeAudioProject,
  options: ForgeaxAudioRuntimeOptions = {},
): ForgeaxAudioRuntime {
  const port = options.port ?? new BrowserAudioPort();
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const schedule = options.schedule ?? ((run, delayMs) => setTimeout(run, delayMs));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const bindings = new Map<string, RuntimeAudioBinding[]>();
  const stopping = new Map<string, RuntimeAudioBinding[]>();
  for (const binding of project.bindings) {
    const list = bindings.get(binding.eventId) ?? [];
    list.push(binding);
    bindings.set(binding.eventId, list);
    if (binding.playback.stopEventId) {
      const stopList = stopping.get(binding.playback.stopEventId) ?? [];
      stopList.push(binding);
      stopping.set(binding.playback.stopEventId, stopList);
    }
  }
  const lastPlayedAt = new Map<string, number>();
  const selection = new Map<string, number>();
  const loopHandles = new Map<string, Set<AudioHandle>>();
  const activeLoopContexts = new Map<string, AudioEventContext>();
  const gameValues = new Map<string, RuntimeFollowValue>();
  const scheduled = new Set<unknown>();
  const scheduledByBinding = new Map<string, Set<unknown>>();
  const stopEpoch = new Map<string, number>();

  const bindingId = (binding: RuntimeAudioBinding): string => binding.eventId;

  const chooseAsset = (
    binding: RuntimeAudioBinding,
    assets: RuntimeAudioAsset[],
    poolKey: string,
  ): RuntimeAudioAsset | undefined => {
    if (assets.length === 0) return undefined;
    const selectionKey = `${bindingId(binding)}:${poolKey}`;
    const previous = selection.get(selectionKey) ?? -1;
    let index = 0;
    if (binding.variation.mode === 'sequential') {
      index = (previous + 1) % assets.length;
    } else if (binding.variation.mode === 'random-no-repeat') {
      index = Math.min(assets.length - 1, Math.floor(random() * assets.length));
      if (assets.length > 1 && index === previous) index = (index + 1) % assets.length;
    }
    selection.set(selectionKey, index);
    return assets[index];
  };

  const resolvedGameValue = (binding: RuntimeAudioBinding, context: AudioEventContext): RuntimeFollowValue | undefined => {
    const follow = binding.follow;
    if (!follow) return undefined;
    const local = contextValue(context, follow.field);
    if (typeof local === 'string' || typeof local === 'number' || typeof local === 'boolean') return local;
    return gameValues.get(follow.field) ?? follow.defaultValue;
  };

  const resolvePlayback = (
    binding: RuntimeAudioBinding,
    context: AudioEventContext,
  ): { asset: RuntimeAudioAsset; volume: number } | undefined => {
    let assets = binding.assets;
    let poolKey = 'default';
    let volumeScale = 1;
    let dynamicShaping: Partial<RuntimeAudioShaping> | undefined;
    const follow = binding.follow;
    const actual = resolvedGameValue(binding, context);
    if (follow?.cases) {
      const matched = follow.cases.find((item) => item.value === actual);
      if (matched) {
        assets = matched.assets;
        poolKey = `case:${typeof matched.value}:${String(matched.value)}`;
      }
    } else if (follow?.range) {
      const numeric = typeof actual === 'number' ? actual : Number(follow.defaultValue);
      const amount = clamp(
        (numeric - follow.range.min) / (follow.range.max - follow.range.min),
        0,
        1,
      );
      volumeScale = interpolate(follow.range.volumeStart, follow.range.volumeEnd, amount);
      dynamicShaping = {
        pitchSemitones: interpolate(follow.range.pitchStart, follow.range.pitchEnd, amount),
        lowpassHz: interpolate(follow.range.lowpassStart, follow.range.lowpassEnd, amount),
      };
      poolKey = 'range';
    }
    const asset = chooseAsset(binding, assets, poolKey);
    if (!asset) return undefined;
    const shaping = mergeShaping(asset.shaping, binding.shaping, dynamicShaping);
    return {
      asset: { ...asset, ...(shaping ? { shaping } : {}) },
      volume: clamp(binding.playback.volume * volumeScale, 0, 4),
    };
  };

  const playRequest = (
    binding: RuntimeAudioBinding,
    context: AudioEventContext,
    resolved: { asset: RuntimeAudioAsset; volume: number },
  ): AudioPlayRequest => ({
    bindingId: bindingId(binding),
    eventId: binding.eventId,
    asset: resolved.asset,
    volume: resolved.volume,
    bus: binding.playback.bus,
    loop: binding.playback.mode === 'loop',
    fadeInMs: binding.playback.fadeInMs,
    fadeOutMs: binding.playback.fadeOutMs,
    spatial: binding.playback.spatial,
    context,
  });

  const rememberPlayback = (
    binding: RuntimeAudioBinding,
    result: ReturnType<AudioPort['play']>,
    epoch: number,
  ): void => {
    if (!result) return;
    const add = (handle: AudioHandle | undefined): void => {
      if (!handle) return;
      if ((stopEpoch.get(bindingId(binding)) ?? 0) !== epoch) {
        handle.stop(binding.playback.fadeOutMs);
        return;
      }
      if (binding.playback.mode !== 'loop') return;
      const handles = loopHandles.get(bindingId(binding)) ?? new Set<AudioHandle>();
      handles.add(handle);
      loopHandles.set(bindingId(binding), handles);
    };
    if (typeof (result as Promise<AudioHandle | undefined>).then === 'function') {
      void (result as Promise<AudioHandle | undefined>).then(add).catch(() => undefined);
    } else {
      add(result as AudioHandle);
    }
  };

  const stopBinding = (binding: RuntimeAudioBinding, clearActive = true): void => {
    const id = bindingId(binding);
    if (clearActive) activeLoopContexts.delete(id);
    stopEpoch.set(id, (stopEpoch.get(id) ?? 0) + 1);
    const pending = scheduledByBinding.get(id);
    if (pending) {
      for (const handle of pending) {
        cancel(handle);
        scheduled.delete(handle);
      }
      pending.clear();
      scheduledByBinding.delete(id);
    }
    const handles = loopHandles.get(id);
    if (!handles) return;
    for (const handle of handles) handle.stop(binding.playback.fadeOutMs);
    handles.clear();
    loopHandles.delete(id);
  };

  const playBinding = (
    binding: RuntimeAudioBinding,
    context: AudioEventContext,
    prepared?: { asset: RuntimeAudioAsset; volume: number },
  ): boolean => {
    const resolved = prepared ?? resolvePlayback(binding, context);
    if (!resolved) return false;
    const epoch = stopEpoch.get(bindingId(binding)) ?? 0;
    const result = port.play(playRequest(binding, context, resolved));
    rememberPlayback(binding, result, epoch);
    return true;
  };

  return {
    emit(eventId, context = {}) {
      for (const binding of stopping.get(eventId) ?? []) stopBinding(binding);
      let accepted = 0;
      for (const binding of bindings.get(eventId) ?? []) {
        if (!binding.enabled || !bindingMatches(binding, context)) continue;
        if (binding.trigger.probability <= 0) continue;
        if (binding.trigger.probability < 1 && random() >= binding.trigger.probability) continue;
        const timestamp = now();
        const previous = lastPlayedAt.get(bindingId(binding));
        if (previous !== undefined && timestamp - previous < binding.trigger.cooldownMs) continue;
        const resolved = resolvePlayback(binding, context);
        if (!resolved) continue;
        lastPlayedAt.set(bindingId(binding), timestamp);
        if (binding.playback.mode === 'loop') activeLoopContexts.set(bindingId(binding), structuredClone(context));
        accepted++;
        if (binding.trigger.delayMs > 0) {
          const id = bindingId(binding);
          const epoch = stopEpoch.get(id) ?? 0;
          let handle: unknown;
          handle = schedule(() => {
            scheduled.delete(handle);
            const pending = scheduledByBinding.get(id);
            pending?.delete(handle);
            if (pending?.size === 0) scheduledByBinding.delete(id);
            if ((stopEpoch.get(id) ?? 0) !== epoch) return;
            playBinding(binding, context, resolved);
          }, binding.trigger.delayMs);
          scheduled.add(handle);
          const pending = scheduledByBinding.get(id) ?? new Set<unknown>();
          pending.add(handle);
          scheduledByBinding.set(id, pending);
        } else {
          playBinding(binding, context, resolved);
        }
      }
      return accepted;
    },
    setGameValue(field, value) {
      if (!field || gameValues.get(field) === value) return;
      gameValues.set(field, value);
      for (const binding of project.bindings) {
        if (!binding.enabled || binding.follow?.field !== field || binding.playback.mode !== 'loop') continue;
        const context = activeLoopContexts.get(bindingId(binding));
        if (!context) continue;
        if (binding.follow.range) {
          const resolved = resolvePlayback(binding, context);
          if (!resolved) continue;
          const request = playRequest(binding, context, resolved);
          for (const handle of loopHandles.get(bindingId(binding)) ?? []) handle.update?.(request);
        } else {
          stopBinding(binding, false);
          playBinding(binding, context);
        }
      }
    },
    stop(eventId) {
      if (eventId) {
        for (const binding of bindings.get(eventId) ?? []) stopBinding(binding);
        return;
      }
      for (const bindingList of bindings.values()) {
        for (const binding of bindingList) stopBinding(binding);
      }
    },
    setBusVolume(bus, volume) { port.setBusVolume(bus, volume); },
    dispose() {
      for (const handle of scheduled) cancel(handle);
      scheduled.clear();
      scheduledByBinding.clear();
      for (const bindingList of bindings.values()) {
        for (const binding of bindingList) stopBinding(binding);
      }
      port.dispose();
    },
  };
}
