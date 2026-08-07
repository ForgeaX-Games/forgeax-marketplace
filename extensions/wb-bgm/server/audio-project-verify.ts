import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { audioBindingAssets, normalizeAudioProject, type AudioProject } from '../shared/audio-project.ts';
import { inspectAudioEvents } from './audio-event-inspector.ts';

export interface AudioProjectDiagnostic {
  code: string;
  message: string;
  eventId?: string;
  file?: string;
}

export interface AudioProjectVerification {
  ok: boolean;
  errors: AudioProjectDiagnostic[];
  warnings: AudioProjectDiagnostic[];
  instrumentedEventIds: string[];
}

export async function verifyAudioProject(
  gameDir: string,
  project: AudioProject,
  options: { requireRuntime?: boolean } = {},
): Promise<AudioProjectVerification> {
  const errors: AudioProjectDiagnostic[] = [];
  const warnings: AudioProjectDiagnostic[] = [];
  let normalized: AudioProject;
  try {
    normalized = normalizeAudioProject(project, project.projectId);
  } catch (error) {
    return {
      ok: false,
      errors: [{ code: 'project_invalid', message: error instanceof Error ? error.message : String(error) }],
      warnings,
      instrumentedEventIds: [],
    };
  }

  const exists = async (path: string): Promise<boolean> => {
    try {
      return (await stat(path)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  };

  let manifestAssets: Set<string> | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(gameDir, 'audio', 'manifest.json'), 'utf8')) as {
      tracks?: Array<{ assetId?: unknown }>;
    };
    manifestAssets = new Set((manifest.tracks ?? [])
      .map((track) => track.assetId)
      .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (normalized.bindings.some((binding) => binding.assets.length > 0)) {
        warnings.push({
          code: 'manifest_missing',
          message: 'audio/manifest.json is missing; asset provider/provenance cannot be verified',
        });
      }
    } else {
      warnings.push({ code: 'manifest_invalid', message: `audio manifest cannot be read: ${(error as Error).message}` });
    }
  }

  for (const binding of normalized.bindings) {
    if (!binding.enabled) {
      warnings.push({
        code: 'binding_disabled',
        eventId: binding.eventId,
        message: `binding '${binding.eventId}' is disabled`,
      });
      continue;
    }
    if (binding.assets.length === 0) {
      errors.push({
        code: 'binding_assets_empty',
        eventId: binding.eventId,
        message: `binding '${binding.eventId}' has no audio assets`,
      });
      continue;
    }
    for (const asset of audioBindingAssets(binding)) {
      if (!await exists(join(gameDir, 'audio', asset.file))) {
        errors.push({
          code: 'asset_missing',
          eventId: binding.eventId,
          file: asset.file,
          message: `audio asset '${asset.file}' does not exist`,
        });
      }
      if (manifestAssets && !manifestAssets.has(asset.assetId)) {
        warnings.push({
          code: 'asset_not_in_manifest',
          eventId: binding.eventId,
          file: asset.file,
          message: `audio asset '${asset.assetId}' is not registered in audio/manifest.json`,
        });
      }
    }
  }

  const requireRuntime = options.requireRuntime ?? normalized.status === 'applied';
  if (requireRuntime) {
    const runtimeFiles = [
      'src/forgeax-audio/generated-bindings.ts',
      'src/forgeax-audio/index.ts',
      'src/forgeax-audio/runtime.ts',
    ];
    for (const file of runtimeFiles) {
      if (!await exists(join(gameDir, file))) {
        errors.push({
          code: 'runtime_missing',
          file,
          message: `generated runtime file '${file}' does not exist`,
        });
      }
    }
  }

  const inspection = await inspectAudioEvents(gameDir);
  const instrumentedEventIds = [...new Set(
    inspection.candidates
      .filter((candidate) => candidate.source === 'game-audio' || candidate.source === 'legacy-audio')
      .map((candidate) => candidate.eventId),
  )].sort();
  const instrumented = new Set(instrumentedEventIds);
  for (const binding of normalized.bindings) {
    if (!binding.enabled || instrumented.has(binding.eventId)) continue;
    errors.push({
      code: 'event_not_instrumented',
      eventId: binding.eventId,
      message: `event '${binding.eventId}' has no literal gameAudio.emit/play call`,
    });
  }

  return { ok: errors.length === 0, errors, warnings, instrumentedEventIds };
}
