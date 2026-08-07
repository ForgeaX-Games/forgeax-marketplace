import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  AUDIO_PROJECT_SCHEMA,
  AudioProjectError,
  normalizeAudioProject,
  type AudioBinding,
  type AudioProject,
} from '../shared/audio-project.ts';

export interface PatchAudioProjectArgs {
  projectId: string;
  expectedRevision: number;
  upsertBindings?: AudioBinding[];
  removeEventIds?: string[];
}

export interface AudioProjectStoreDeps {
  now?: () => Date;
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) {
      throw new AudioProjectError('invalid_project', `invalid JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function readAudioProject(gameDir: string, projectId: string): Promise<AudioProject> {
  const audioDir = join(gameDir, 'audio');
  const draft = await readJson(join(audioDir, 'project.draft.json'));
  if (draft !== undefined) return normalizeAudioProject(draft, projectId);
  const applied = await readJson(join(audioDir, 'project.json'));
  if (applied !== undefined) {
    return { ...normalizeAudioProject(applied, projectId), status: 'draft' };
  }
  return {
    schemaVersion: AUDIO_PROJECT_SCHEMA,
    projectId,
    revision: 0,
    status: 'draft',
    updatedAt: '',
    bindings: [],
  };
}

export async function readAppliedAudioProject(
  gameDir: string,
  projectId: string,
): Promise<AudioProject | undefined> {
  const applied = await readJson(join(gameDir, 'audio/project.json'));
  if (applied === undefined) return undefined;
  return { ...normalizeAudioProject(applied, projectId), status: 'applied' };
}

export async function writeAppliedAudioProject(
  gameDir: string,
  input: AudioProject,
): Promise<AudioProject> {
  const applied: AudioProject = {
    ...normalizeAudioProject(input, input.projectId),
    status: 'applied',
  };
  await atomicWriteJson(join(gameDir, 'audio/project.json'), applied);
  return applied;
}

export async function patchAudioProject(
  gameDir: string,
  args: PatchAudioProjectArgs,
  deps: AudioProjectStoreDeps = {},
): Promise<AudioProject> {
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
    throw new AudioProjectError('bad_input', 'expectedRevision must be a non-negative integer');
  }
  const current = await readAudioProject(gameDir, args.projectId);
  if (current.revision !== args.expectedRevision) {
    throw new AudioProjectError(
      'revision_conflict',
      `audio project revision changed from ${args.expectedRevision} to ${current.revision}`,
      current.revision,
    );
  }

  const normalizedUpserts = normalizeAudioProject({ bindings: args.upsertBindings ?? [] }, args.projectId).bindings;
  const removeIds = new Set((args.removeEventIds ?? []).map((eventId) => {
    const probe = normalizeAudioProject({ bindings: [{ eventId, assets: [] }] }, args.projectId);
    return probe.bindings[0]!.eventId;
  }));
  const bindings = current.bindings.filter((binding) => !removeIds.has(binding.eventId));
  const positions = new Map(bindings.map((binding, index) => [binding.eventId, index]));
  for (const binding of normalizedUpserts) {
    const index = positions.get(binding.eventId);
    if (index === undefined) {
      positions.set(binding.eventId, bindings.length);
      bindings.push(binding);
    } else {
      bindings[index] = binding;
    }
  }
  const next = normalizeAudioProject({
    schemaVersion: AUDIO_PROJECT_SCHEMA,
    projectId: args.projectId,
    revision: current.revision + 1,
    status: 'draft',
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    bindings,
  }, args.projectId);
  await atomicWriteJson(join(gameDir, 'audio/project.draft.json'), next);
  return next;
}
