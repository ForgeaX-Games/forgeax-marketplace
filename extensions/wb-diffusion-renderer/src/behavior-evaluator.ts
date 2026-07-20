import type {
  VisualActor,
  VisualBehaviorInstance,
  VisualEffectBundle,
  VisualMotionTrack,
  VisualPresentationEntry,
  VisualPresentationProgram,
  VisualSourceSnapshot,
} from '@forgeax/types/visual-generation';
import type {
  ResolvedEffectFrame,
  ResolvedMotionTimeline,
  ResolvedMotionValue,
  ResolvedPromptContribution,
  VisualAdapterCapabilities,
  VisualEffectDiagnostic,
} from './effect-frame';

interface PromptCandidate extends ResolvedPromptContribution {
  readonly priority: number;
}

const MAX_PROMPT_CHARACTERS = 2_000;

function sourceId(
  recipeKey: string,
  instanceId: string,
  phase: string,
  effectId: string,
): string {
  return `${recipeKey}\u0000${instanceId}\u0000${phase}\u0000${effectId}`;
}

function manifestRevision(manifest: VisualPresentationEntry): string {
  const canonicalize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalize(record[key])}`
      )).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const canonical = canonicalize(manifest);
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `v2-${(hash >>> 0).toString(16)}`;
}

function actorLookup(actors: readonly VisualActor[] | undefined): Map<string, VisualActor> {
  return new Map((actors ?? []).map((actor) => [actor.id, actor]));
}

function scalar(
  instance: VisualBehaviorInstance,
  key: string,
  actors: ReadonlyMap<string, VisualActor>,
): string | undefined {
  if (key === 'actor.id') return instance.actorId;
  if (key === 'target.id') return instance.targetId;
  if (key === 'actor.name') {
    return instance.actorId ? actors.get(instance.actorId)?.name : undefined;
  }
  if (key === 'target.name') {
    return instance.targetId ? actors.get(instance.targetId)?.name : undefined;
  }
  if (key === 'intensity') return instance.intensity?.toString();
  if (key.startsWith('param.')) {
    const value = instance.parameters?.[key.slice('param.'.length)];
    return value === undefined ? undefined : String(value);
  }
  return undefined;
}

function interpolate(
  text: string,
  instance: VisualBehaviorInstance,
  actors: ReadonlyMap<string, VisualActor>,
): { readonly value?: string; readonly missing?: string } {
  let missing: string | undefined;
  const value = text.replace(/\{([a-z]+(?:\.[a-zA-Z0-9_-]+)?)\}/g, (raw, key: string) => {
    const replacement = scalar(instance, key, actors);
    if (replacement === undefined) {
      missing ??= key;
      return raw;
    }
    return replacement;
  });
  return missing ? { missing } : { value };
}

function trackValue(track: VisualMotionTrack, signals: Record<string, boolean | number | string>): number | undefined {
  if (track.source.kind === 'constant') return track.source.value;
  const signal = signals[track.source.key];
  if (typeof signal !== 'number') return undefined;
  const scaled = signal * track.source.scale;
  return track.source.invert ? -scaled : scaled;
}

function normalizedSignals(
  manifest: VisualPresentationEntry,
  program: VisualPresentationProgram,
  diagnostics: VisualEffectDiagnostic[],
): Record<string, boolean | number | string> {
  const declarations = new Map(manifest.signals.map((signal) => [signal.key, signal]));
  const normalized: Record<string, boolean | number | string> = {};
  for (const [key, declaration] of declarations) {
    const raw = program.signals[key] ?? declaration.default;
    if (typeof raw !== declaration.type) {
      diagnostics.push({
        code: 'invalid-signal',
        message: `Signal "${key}" must be ${declaration.type}; using its declared default`,
      });
      normalized[key] = declaration.default;
      continue;
    }
    if (typeof raw === 'number') {
      const clamped = Math.max(declaration.min ?? -Infinity, Math.min(declaration.max ?? Infinity, raw));
      if (clamped !== raw) {
        diagnostics.push({
          code: 'invalid-signal',
          message: `Signal "${key}" was clamped to its declared range`,
        });
      }
      normalized[key] = Math.round(clamped * 1_000) / 1_000;
      continue;
    }
    normalized[key] = raw;
  }
  for (const key of Object.keys(program.signals)) {
    if (!declarations.has(key)) {
      diagnostics.push({
        code: 'invalid-signal',
        message: `Signal "${key}" is not declared by this presentation entry`,
      });
    }
  }
  return normalized;
}

function addBundle(
  bundle: VisualEffectBundle | undefined,
  phase: string,
  recipeKey: string,
  instance: VisualBehaviorInstance,
  signals: Record<string, boolean | number | string>,
  actors: ReadonlyMap<string, VisualActor>,
  capabilities: VisualAdapterCapabilities,
  prompts: PromptCandidate[],
  motion: Array<{ readonly value: number; readonly track: VisualMotionTrack; readonly sourceId: string }>,
  timelines: ResolvedMotionTimeline[],
  diagnostics: VisualEffectDiagnostic[],
): boolean {
  if (!bundle) return true;
  const localPrompts: PromptCandidate[] = [];
  const localMotion: Array<{ readonly value: number; readonly track: VisualMotionTrack; readonly sourceId: string }> = [];
  const localTimelines: Array<Omit<ResolvedMotionTimeline, 'boundPrompts'>> = [];
  const logicalPhase = phase.split(':', 1)[0];
  if (logicalPhase === 'enter' || logicalPhase === 'exit' || logicalPhase === 'trigger') {
    for (const override of instance.effectOverrides?.timelines ?? []) {
      if (override.phase !== logicalPhase) continue;
      const track = bundle.motion.find((candidate) => candidate.id === override.trackId);
      if (track?.timeline) continue;
      diagnostics.push({
        code: 'invalid-override',
        message: `Timeline override references unknown or non-timeline track "${override.trackId}"`,
        instanceId: instance.instanceId,
      });
    }
  }
  for (const effect of bundle.prompt) {
    const id = sourceId(recipeKey, instance.instanceId, phase, effect.id);
    if (!capabilities.prompt) {
      diagnostics.push({
        code: 'unsupported-effect',
        message: `Adapter does not support prompt effect "${effect.id}"`,
        instanceId: instance.instanceId,
      });
      if (effect.required) return false;
      continue;
    }
    const resolved = interpolate(effect.text, instance, actors);
    if (!resolved.value) {
      diagnostics.push({
        code: 'missing-placeholder',
        message: `Prompt effect "${effect.id}" is missing "${resolved.missing}"`,
        instanceId: instance.instanceId,
      });
      if (effect.required) return false;
      continue;
    }
    localPrompts.push({
      slot: effect.slot,
      text: resolved.value,
      mode: effect.mode,
      sourceId: id,
      priority: effect.priority,
      ...(instance.order !== undefined ? { order: instance.order } : {}),
    });
  }
  for (const track of bundle.motion) {
    const id = sourceId(recipeKey, instance.instanceId, phase, track.id);
    if (!capabilities.motionTargets.has(track.target)) {
      diagnostics.push({
        code: 'unsupported-effect',
        message: `Adapter does not support motion target "${track.target}"`,
        instanceId: instance.instanceId,
      });
      if (track.required) return false;
      continue;
    }
    if (track.timeline) {
      if (phase !== 'active' && phase !== 'baseline') {
        const logicalPhase = phase.split(':', 1)[0] as 'enter' | 'exit' | 'trigger';
        const override = instance.effectOverrides?.timelines.find((candidate) => (
          candidate.phase === logicalPhase && candidate.trackId === track.id
        ));
        localTimelines.push({
          sourceId: id,
          target: track.target,
          blend: track.blend,
          priority: track.priority,
          durationChunks: override?.durationChunks ?? track.timeline.durationChunks,
          interpolation: override?.interpolation ?? track.timeline.interpolation,
          keyframes: (override?.keyframes ?? track.timeline.keyframes).map((frame) => ({
            at: frame.at,
            value: Math.max(-1, Math.min(1, track.scaleByIntensity
              ? frame.value * (instance.intensity ?? 1)
              : frame.value)),
          })),
        });
      }
      continue;
    }
    const value = trackValue(track, signals);
    if (value === undefined) {
      diagnostics.push({
        code: 'invalid-signal',
        message: `Motion track "${track.id}" requires numeric signal "${track.source.kind === 'signal' ? track.source.key : ''}"`,
        instanceId: instance.instanceId,
      });
      if (track.required) return false;
      continue;
    }
    localMotion.push({
      value: Math.max(-1, Math.min(1, track.scaleByIntensity ? value * (instance.intensity ?? 1) : value)),
      track,
      sourceId: id,
    });
  }
  const boundPrompts: ResolvedPromptContribution[] = localPrompts.map(({ priority: _priority, ...prompt }) => prompt);
  // A transition prompt describing a timeline must exist exactly for that
  // timeline's provider-confirmed lifetime. The Adapter latches it from the
  // descriptor, then removes it on completion; retaining it in the durable
  // frame would resurrect it on every later reconcile.
  if (localTimelines.length === 0) prompts.push(...localPrompts);
  motion.push(...localMotion);
  for (const timeline of localTimelines) {
    timelines.push({ ...timeline, boundPrompts });
  }
  return true;
}

function mergePromptContributions(prompts: readonly PromptCandidate[], promptOrder: readonly string[]): ResolvedPromptContribution[] {
  const canonicalPrompt: ResolvedPromptContribution[] = [];
  const orderedSlots = [
    ...promptOrder.filter((slot, index, slots) => slots.indexOf(slot) === index),
    ...[...new Set(prompts.map((candidate) => candidate.slot))]
      .filter((slot) => !promptOrder.includes(slot))
      .sort(),
  ];
  for (const slot of orderedSlots) {
    const candidates = prompts.filter((candidate) => candidate.slot === slot);
    const replace = candidates
      .filter((candidate) => candidate.mode === 'replace')
      .sort((left, right) => (
        right.priority - left.priority
        || (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
        || left.sourceId.localeCompare(right.sourceId)
      ))[0];
    if (replace) {
      canonicalPrompt.push({
        slot,
        text: replace.text,
        mode: replace.mode,
        sourceId: replace.sourceId,
        ...(replace.order !== undefined ? { order: replace.order } : {}),
      });
    }
    const seen = new Set<string>();
    for (const append of candidates
      .filter((candidate) => candidate.mode === 'append')
      .sort((left, right) => (
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
        || right.priority - left.priority
        || left.sourceId.localeCompare(right.sourceId)
      ))) {
      const canonicalText = append.text.trim().replace(/\s+/g, ' ');
      if (seen.has(canonicalText)) continue;
      seen.add(canonicalText);
      canonicalPrompt.push({
        slot,
        text: append.text,
        mode: append.mode,
        sourceId: append.sourceId,
        ...(append.order !== undefined ? { order: append.order } : {}),
      });
    }
  }
  return canonicalPrompt;
}

/** Pure program-to-frame compiler. It never reads clock, DOM, or Provider state. */
export function evaluateVisualPresentation(
  snapshot: VisualSourceSnapshot,
  manifest: VisualPresentationEntry,
  capabilities: VisualAdapterCapabilities,
  waterline = 0,
): ResolvedEffectFrame {
  if (!snapshot.stamp || !snapshot.program) {
    throw new Error('Visual presentation evaluation requires a stamped program snapshot');
  }
  const program = snapshot.program;
  const prompts: PromptCandidate[] = [];
  const motion: Array<{ readonly value: number; readonly track: VisualMotionTrack; readonly sourceId: string }> = [];
  const timelines: ResolvedMotionTimeline[] = [];
  const diagnostics: VisualEffectDiagnostic[] = [];
  const signals = normalizedSignals(manifest, program, diagnostics);
  const actors = actorLookup(snapshot.intent?.value.scene.actors);
  if (program.creativeDirection?.trim()) {
    prompts.push({
      slot: 'creative-direction',
      text: program.creativeDirection.trim(),
      mode: 'append',
      sourceId: '__program__\u0000creative-direction',
      priority: 0,
    });
  }
  const baseline: VisualBehaviorInstance = { recipeKey: '__baseline__', instanceId: '__baseline__' };
  addBundle(
    manifest.baseline,
    'baseline',
    '__baseline__',
    baseline,
    signals,
    actors,
    capabilities,
    prompts,
    motion,
    timelines,
    diagnostics,
  );
  const recipes = new Map(manifest.recipes.map((recipe) => [recipe.key, recipe]));
  for (const instance of [...program.activeBehaviors].sort((a, b) => (
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    || a.instanceId.localeCompare(b.instanceId)
  ))) {
    const recipe = recipes.get(instance.recipeKey);
    if (!recipe) {
      diagnostics.push({ code: 'unknown-recipe', message: `Unknown recipe "${instance.recipeKey}"`, instanceId: instance.instanceId });
      continue;
    }
    if (!addBundle(
      recipe.active,
      'active',
      recipe.key,
      instance,
      signals,
      actors,
      capabilities,
      prompts,
      motion,
      timelines,
      diagnostics,
    )) {
      diagnostics.push({
        code: 'instance-rejected',
        message: `Behavior instance "${instance.instanceId}" requires unsupported or invalid effects`,
        instanceId: instance.instanceId,
      });
    }
  }
  for (const transition of program.journal.entries.filter((entry) => entry.sequence > waterline)) {
    const instance = transition.instance;
    const recipe = recipes.get(instance.recipeKey);
    if (!recipe) continue;
    const phase = transition.type === 'behavior-enter'
      ? 'enter'
      : transition.type === 'behavior-exit' ? 'exit' : 'trigger';
    if (!addBundle(
      recipe[phase],
      `${phase}:${transition.sequence}`,
      recipe.key,
      instance,
      signals,
      actors,
      capabilities,
      prompts,
      motion,
      timelines,
      diagnostics,
    )) {
      diagnostics.push({
        code: 'instance-rejected',
        message: `Behavior instance "${instance.instanceId}" requires unsupported or invalid effects`,
        instanceId: instance.instanceId,
      });
    }
  }
  const resolvedMotion: ResolvedMotionValue[] = [];
  for (const target of new Set(motion.map((candidate) => candidate.track.target))) {
    const candidates = motion.filter((candidate) => candidate.track.target === target);
    const replace = candidates.filter((candidate) => candidate.track.blend === 'replace')
      .sort((a, b) => b.track.priority - a.track.priority || a.sourceId.localeCompare(b.sourceId))[0];
    const add = candidates.filter((candidate) => candidate.track.blend === 'add')
      .reduce((sum, candidate) => sum + candidate.value, 0);
    resolvedMotion.push({ target, value: Math.max(-1, Math.min(1, (replace?.value ?? 0) + add)) });
  }
  const canonicalPrompt = mergePromptContributions(prompts, manifest.promptOrder ?? []);
  const promptCharacters = canonicalPrompt.reduce((total, contribution) => total + contribution.text.length, 0);
  if (promptCharacters > MAX_PROMPT_CHARACTERS) {
    diagnostics.push({
      code: 'prompt-budget',
      message: `Resolved prompt is ${promptCharacters} characters; the budget is ${MAX_PROMPT_CHARACTERS}`,
    });
  }
  return {
    stamp: snapshot.stamp,
    manifestRevision: manifestRevision(manifest),
    prompt: canonicalPrompt,
    continuousMotion: resolvedMotion.sort((a, b) => a.target.localeCompare(b.target)),
    timelines: timelines.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    signals,
    transitions: program.journal.entries.filter((entry) => entry.sequence > waterline),
    lifecycle: {
      desiredPlayback: program.lifecycle.desiredPlayback,
      ...(program.lifecycle.restartSequence > 0 ? { restartToken: String(program.lifecycle.restartSequence) } : {}),
    },
    diagnostics,
  };
}

/** Merge durable frame prompts with adapter-latched timeline prompts. */
export function mergeLatchedPrompts(
  durable: readonly ResolvedPromptContribution[],
  latched: readonly ResolvedPromptContribution[],
  promptOrder: readonly string[] = [],
): ResolvedPromptContribution[] {
  const candidates: PromptCandidate[] = [
    ...durable.map((prompt) => ({ ...prompt, priority: 0 })),
    // Latched transient prompts outrank durable peers so short-lived vertical prose
    // survives Presenter waterline advance for the bound timeline duration.
    ...latched.map((prompt) => ({ ...prompt, priority: 100 })),
  ];
  return mergePromptContributions(candidates, promptOrder);
}
