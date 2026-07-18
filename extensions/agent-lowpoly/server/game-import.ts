import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  cookExternalAssetMeta,
  normalizeGlbForEngine,
  type ExternalAssetMeta,
} from '@forgeax-extension/external-asset-meta';

export interface ImportHooks {
  beforeSourceRecheck?: () => Promise<void> | void;
  afterGlbCommit?: () => Promise<void> | void;
  beforeStateCommit?: () => Promise<void> | void;
}

interface ImportState {
  version: 1;
  game: string;
  sourcePath: string;
  sourceHash: string;
  contentHash: string;
  metaHash: string;
  assetPath: string;
  engineMetaPath: string;
  importedAt: string;
  normalizedDraco: boolean;
}

interface ResolvedPaths {
  projectRoot: string;
  game: string;
  sourceAbs: string;
  sourcePath: string;
  fileName: string;
  destinationAbs: string;
  metaAbs: string;
  stateAbs: string;
  assetPath: string;
  engineMetaPath: string;
}

export interface GameImportStatus {
  ok: true;
  imported: boolean;
  retryable: boolean;
  game: string;
  sourcePath: string;
  sourceHash: string;
  contentHash: string | null;
  assetPath: string;
  engineMetaPath: string;
  importedAt: string | null;
  message: string;
}

export interface GameImportSuccess {
  ok: true;
  imported: true;
  game: string;
  sourcePath: string;
  sourceHash: string;
  contentHash: string;
  assetPath: string;
  engineMetaPath: string;
  importedAt: string;
  normalizedDraco: boolean;
  reusedGuidCount: number;
  message: string;
}

function codedError(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeGameSlug(game: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/u.test(game);
}

function safeGlbName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.glb$/u.test(name) && name !== '.glb';
}

async function existingPathHasSymlink(base: string, target: string): Promise<boolean> {
  const rel = relative(base, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return true;
  let current = base;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function resolvePaths(
  projectRootInput: string,
  game: string,
  assetPathInput: string,
  options: { createDirectories: boolean },
): Promise<ResolvedPaths> {
  const projectRoot = resolve(projectRootInput);
  if (!safeGameSlug(game)) throw codedError('invalid_session_game', 'Session-bound game slug is invalid.');
  const assetPath = assetPathInput.trim();
  if (!assetPath) throw codedError('invalid_asset_path', 'assetPath is required.');

  const lowpolyRoot = resolve(projectRoot, '.forgeax', 'workbench', 'wb-3d-lowpoly');
  let realLowpolyRoot: string;
  try {
    realLowpolyRoot = await realpath(lowpolyRoot);
  } catch {
    throw codedError('lowpoly_workspace_missing', 'Lowpoly workbench storage is unavailable.');
  }
  const candidate = isAbsolute(assetPath) ? resolve(assetPath) : resolve(lowpolyRoot, assetPath);
  let sourceStat;
  try {
    sourceStat = await lstat(candidate);
  } catch {
    throw codedError('asset_not_found', 'The exported lowpoly GLB does not exist.');
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw codedError('invalid_asset_path', 'The lowpoly source must be a regular, non-symlink GLB file.');
  }
  const sourceAbs = await realpath(candidate);
  if (!isInside(realLowpolyRoot, sourceAbs)) {
    throw codedError('invalid_asset_path', 'The source must stay inside the lowpoly workbench.');
  }
  const sourceParts = relative(realLowpolyRoot, sourceAbs).split(sep);
  const fileName = basename(sourceAbs);
  if (
    sourceParts.length < 3 ||
    sourceParts.at(-3) !== 'assets' ||
    sourceParts.at(-2) !== '3d' ||
    sourceParts.at(-1) !== fileName ||
    !safeGlbName(fileName)
  ) {
    throw codedError('invalid_asset_path', 'Only a basename GLB under a lowpoly project assets/3d directory can be delivered.');
  }

  const gamesRoot = resolve(projectRoot, '.forgeax', 'games');
  const gameDir = resolve(gamesRoot, game);
  let gameStat;
  try {
    gameStat = await lstat(gameDir);
  } catch {
    throw codedError('game_not_found', `Session-bound game does not exist: ${game}`);
  }
  if (!gameStat.isDirectory() || gameStat.isSymbolicLink()) {
    throw codedError('invalid_session_game', 'The session-bound game must be a regular project directory.');
  }
  const realGamesRoot = await realpath(gamesRoot);
  const realGameDir = await realpath(gameDir);
  if (!isInside(realGamesRoot, realGameDir)) {
    throw codedError('invalid_session_game', 'The session-bound game escapes the workspace games directory.');
  }

  const destinationDir = resolve(realGameDir, 'assets', '3d', 'props');
  if (await existingPathHasSymlink(realGameDir, destinationDir)) {
    throw codedError('invalid_asset_path', 'The destination asset directory contains a symlink.');
  }
  let resolvedDestinationDir = destinationDir;
  if (options.createDirectories) {
    await mkdir(destinationDir, { recursive: true });
  }
  try {
    const destinationStat = await lstat(destinationDir);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw codedError('invalid_asset_path', 'The destination asset path must be a regular directory.');
    }
    resolvedDestinationDir = await realpath(destinationDir);
    if (!isInside(realGameDir, resolvedDestinationDir)) {
      throw codedError('invalid_asset_path', 'The destination asset directory escapes the current game.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const destinationAbs = resolve(resolvedDestinationDir, fileName);
  const metaAbs = `${destinationAbs}.meta.json`;
  for (const target of [destinationAbs, metaAbs]) {
    try {
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw codedError('invalid_asset_path', 'Refusing to replace a non-file target in the game asset library.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const stateDir = resolve(projectRoot, '.forgeax', 'agent-lowpoly', 'imports', game);
  if (await existingPathHasSymlink(projectRoot, stateDir)) {
    throw codedError('invalid_asset_path', 'The lowpoly import-state directory contains a symlink.');
  }
  if (options.createDirectories) {
    await mkdir(stateDir, { recursive: true });
  }
  const stateAbs = resolve(stateDir, `${fileName}.json`);
  if (await existingPathHasSymlink(stateDir, stateAbs)) {
    throw codedError('invalid_asset_path', 'The lowpoly import-state target is a symlink.');
  }

  const gameRelativeAssetPath = relative(realGameDir, destinationAbs).split(sep).join('/');
  return {
    projectRoot,
    game,
    sourceAbs,
    sourcePath: relative(projectRoot, sourceAbs).split(sep).join('/'),
    fileName,
    destinationAbs,
    metaAbs,
    stateAbs,
    assetPath: gameRelativeAssetPath,
    engineMetaPath: `${gameRelativeAssetPath}.meta.json`,
  };
}

async function readMeta(path: string): Promise<ExternalAssetMeta | null> {
  return (await readMetaRecord(path))?.meta ?? null;
}

async function readMetaRecord(path: string): Promise<{ meta: ExternalAssetMeta; hash: string } | null> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ExternalAssetMeta;
    return parsed.kind === 'external-asset-package' && Array.isArray(parsed.subAssets)
      ? { meta: parsed, hash: sha256(bytes) }
      : null;
  } catch {
    return null;
  }
}

async function readState(path: string): Promise<ImportState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ImportState;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function reusedGuidCount(existing: ExternalAssetMeta | null, next: ExternalAssetMeta): number {
  if (!existing) return 0;
  const previous = new Set(existing.subAssets.map((entry) => `${entry.kind}\0${entry.sourceIndex}\0${entry.guid}`));
  return next.subAssets.filter((entry) => previous.has(`${entry.kind}\0${entry.sourceIndex}\0${entry.guid}`)).length;
}

export async function gameImportStatus(
  projectRoot: string,
  game: string,
  assetPath: string,
): Promise<GameImportStatus> {
  const paths = await resolvePaths(projectRoot, game, assetPath, { createDirectories: false });
  const sourceHash = sha256(new Uint8Array(await readFile(paths.sourceAbs)));
  const state = await readState(paths.stateAbs);
  const metaRecord = await readMetaRecord(paths.metaAbs);
  const meta = metaRecord?.meta ?? null;
  let destinationHash: string | null = null;
  try {
    destinationHash = sha256(new Uint8Array(await readFile(paths.destinationAbs)));
  } catch {
    destinationHash = null;
  }

  const imported = Boolean(
    state &&
      meta &&
      state.game === game &&
      state.sourcePath === paths.sourcePath &&
      state.sourceHash === sourceHash &&
      state.contentHash === destinationHash &&
      state.metaHash === metaRecord?.hash &&
      state.assetPath === paths.assetPath &&
      state.engineMetaPath === paths.engineMetaPath &&
      meta.source === paths.fileName,
  );
  let message = 'Not delivered to the current game yet.';
  if (imported) message = 'Delivered: the game asset and engine identity match the current lowpoly GLB.';
  else if (state && state.sourceHash !== sourceHash) message = 'The lowpoly GLB changed after delivery; re-import is required.';
  else if (destinationHash && !meta) message = 'The GLB exists in the game, but its engine identity is missing or invalid.';
  else if (state && destinationHash !== state.contentHash) message = 'The delivered game asset changed; re-import is required.';
  else if (state && metaRecord && state.metaHash !== metaRecord.hash) {
    message = 'The engine identity changed after delivery; re-import is required.';
  }

  return {
    ok: true,
    imported,
    retryable: !imported,
    game,
    sourcePath: paths.sourcePath,
    sourceHash,
    contentHash: destinationHash,
    assetPath: paths.assetPath,
    engineMetaPath: paths.engineMetaPath,
    importedAt: state?.importedAt ?? null,
    message,
  };
}

export async function importLowpolyAsset(
  projectRoot: string,
  game: string,
  assetPath: string,
  hooks: ImportHooks = {},
): Promise<GameImportSuccess> {
  const paths = await resolvePaths(projectRoot, game, assetPath, { createDirectories: true });
  const sourceBytes = new Uint8Array(await readFile(paths.sourceAbs));
  const sourceHash = sha256(sourceBytes);
  const existingMeta = await readMeta(paths.metaAbs);
  let outputBytes = sourceBytes;
  let contentHash = sourceHash;
  let normalizedDraco = false;
  let cooked = await cookExternalAssetMeta(outputBytes, contentHash, paths.fileName, { existingMeta });
  if (
    !cooked.ok &&
    cooked.code === 'engine_unsupported_extension' &&
    cooked.unsupportedExtensions?.includes('KHR_draco_mesh_compression')
  ) {
    const normalized = await normalizeGlbForEngine(outputBytes);
    if (!normalized.ok) throw codedError(normalized.code, normalized.message, true);
    outputBytes = new Uint8Array(normalized.bytes);
    contentHash = sha256(outputBytes);
    normalizedDraco = true;
    cooked = await cookExternalAssetMeta(outputBytes, contentHash, paths.fileName, { existingMeta });
  }
  if (!cooked.ok) throw codedError(cooked.code, cooked.message, cooked.code !== 'corrupt_glb');

  await hooks.beforeSourceRecheck?.();
  const sourceHashBeforeCommit = sha256(new Uint8Array(await readFile(paths.sourceAbs)));
  if (sourceHashBeforeCommit !== sourceHash) {
    throw codedError('asset_changed_retry', 'The lowpoly GLB changed during import; retry with the latest export.', true);
  }

  const importedAt = new Date().toISOString();
  const metaText = `${JSON.stringify(cooked.meta, null, 2)}\n`;
  const state: ImportState = {
    version: 1,
    game,
    sourcePath: paths.sourcePath,
    sourceHash,
    contentHash,
    metaHash: sha256(new TextEncoder().encode(metaText)),
    assetPath: paths.assetPath,
    engineMetaPath: paths.engineMetaPath,
    importedAt,
    normalizedDraco,
  };
  const nonce = `${process.pid}-${randomUUID()}`;
  const tempGlb = `${paths.destinationAbs}.__lowpoly_import_${nonce}`;
  const tempMeta = `${paths.metaAbs}.__lowpoly_import_${nonce}`;
  const tempState = `${paths.stateAbs}.__lowpoly_import_${nonce}`;
  try {
    try {
      await writeFile(tempGlb, outputBytes);
      await writeFile(tempMeta, metaText, 'utf8');
      await rename(tempGlb, paths.destinationAbs);
      await hooks.afterGlbCommit?.();
      await rename(tempMeta, paths.metaAbs);
    } catch (error) {
      throw codedError(
        'import_asset_write_failed',
        `The game asset or engine identity could not be committed: ${(error as Error).message}`,
        true,
      );
    }
    try {
      await hooks.beforeStateCommit?.();
      await writeFile(tempState, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await rename(tempState, paths.stateAbs);
    } catch (error) {
      throw codedError(
        'import_state_write_failed',
        `The GLB and engine identity were written, but delivery state could not be committed: ${(error as Error).message}`,
        true,
      );
    }
  } finally {
    await Promise.all([tempGlb, tempMeta, tempState].map((path) => rm(path, { force: true }).catch(() => undefined)));
  }

  return {
    ok: true,
    imported: true,
    game,
    sourcePath: paths.sourcePath,
    sourceHash,
    contentHash,
    assetPath: paths.assetPath,
    engineMetaPath: paths.engineMetaPath,
    importedAt,
    normalizedDraco,
    reusedGuidCount: reusedGuidCount(existingMeta, cooked.meta),
    message: 'Delivered to the current game. Edit can discover the GLB through its engine identity sidecar.',
  };
}
