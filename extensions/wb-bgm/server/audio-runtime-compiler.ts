import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { audioBindingAssets, normalizeAudioProject, type AudioProject } from '../shared/audio-project.ts';

export interface CompileAudioRuntimeResult { files: string[] }

export class AudioRuntimeCompileError extends Error {
  readonly code: 'asset_missing' | 'binding_assets_empty';

  constructor(code: AudioRuntimeCompileError['code'], message: string) {
    super(message);
    this.name = 'AudioRuntimeCompileError';
    this.code = code;
  }
}

const OUTPUT_FILES = [
  'src/forgeax-audio/runtime.ts',
  'src/forgeax-audio/generated-bindings.ts',
  'src/forgeax-audio/index.ts',
] as const;

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function generatedBindingsSource(project: AudioProject): string {
  let marker = 0;
  const assetFiles: string[] = [];
  const runtimeAsset = (asset: import('../shared/audio-project.ts').AudioAssetRef) => {
    assetFiles.push(asset.file);
    return { ...asset, url: `__FORGEAX_AUDIO_URL_${marker++}__` };
  };
  const runtimeProject = {
    schemaVersion: 'forgeax-audio-runtime/1',
    projectId: project.projectId,
    revision: project.revision,
    bindings: project.bindings.map((binding) => ({
      ...binding,
      assets: binding.assets.map(runtimeAsset),
      ...(binding.follow?.cases ? {
        follow: {
          ...binding.follow,
          cases: binding.follow.cases.map((item) => ({
            ...item,
            assets: item.assets.map(runtimeAsset),
          })),
        },
      } : {}),
    })),
  };
  let serialized = JSON.stringify(runtimeProject, null, 2);
  for (let index = 0; index < assetFiles.length; index++) {
    const placeholder = JSON.stringify(`__FORGEAX_AUDIO_URL_${index}__`);
    const relativeUrl = JSON.stringify(`../../audio/${assetFiles[index]}`);
    serialized = serialized.replace(placeholder, `new URL(${relativeUrl}, import.meta.url).href`);
  }
  return [
    "import type { RuntimeAudioProject } from './runtime';",
    '',
    `export const forgeaxAudioProject: RuntimeAudioProject = ${serialized};`,
    '',
  ].join('\n');
}

async function atomicWriteGroup(gameDir: string, files: Array<{ relativePath: string; content: string }>): Promise<void> {
  const prepared: Array<{ temporary: string; target: string }> = [];
  try {
    for (const file of files) {
      const target = join(gameDir, file.relativePath);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${prepared.length}`;
      await writeFile(temporary, file.content, 'utf8');
      prepared.push({ temporary, target });
    }
    for (const file of prepared) await rename(file.temporary, file.target);
  } catch (error) {
    throw error;
  }
}

export async function compileAudioRuntime(
  gameDir: string,
  inputProject: AudioProject,
  runtimeSource: string,
): Promise<CompileAudioRuntimeResult> {
  const project = normalizeAudioProject(inputProject, inputProject.projectId);
  try {
    const manifest = JSON.parse(await readFile(join(gameDir, 'audio', 'manifest.json'), 'utf8')) as {
      tracks?: Array<{ assetId?: string; shaping?: import('../shared/audio-project.ts').AudioShapingParams }>;
    };
    const shapingByAsset = new Map(
      (manifest.tracks ?? [])
        .filter((track): track is { assetId: string; shaping?: import('../shared/audio-project.ts').AudioShapingParams } => typeof track.assetId === 'string')
        .map((track) => [track.assetId, track.shaping]),
    );
    for (const binding of project.bindings) {
      for (const asset of audioBindingAssets(binding)) {
        const shaping = asset.shaping ?? shapingByAsset.get(asset.assetId);
        if (shaping) asset.shaping = shaping;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const binding of project.bindings) {
    if (!binding.enabled) continue;
    if (binding.assets.length === 0) {
      throw new AudioRuntimeCompileError(
        'binding_assets_empty',
        `binding '${binding.eventId}' has no audio assets`,
      );
    }
    for (const asset of audioBindingAssets(binding)) {
      if (!await isFile(join(gameDir, 'audio', asset.file))) {
        throw new AudioRuntimeCompileError('asset_missing', `audio asset '${asset.file}' does not exist`);
      }
    }
  }
  const indexSource = [
    "import { createForgeaxAudioRuntime } from './runtime';",
    "import { forgeaxAudioProject } from './generated-bindings';",
    '',
    'export const gameAudio = createForgeaxAudioRuntime(forgeaxAudioProject);',
    "export type { AudioEventContext } from './runtime';",
    '',
  ].join('\n');
  await atomicWriteGroup(gameDir, [
    { relativePath: OUTPUT_FILES[0], content: runtimeSource },
    { relativePath: OUTPUT_FILES[1], content: generatedBindingsSource(project) },
    { relativePath: OUTPUT_FILES[2], content: indexSource },
  ]);
  return { files: [...OUTPUT_FILES] };
}
