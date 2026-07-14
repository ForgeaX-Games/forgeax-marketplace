/// <reference path="./draco3dgltf.d.ts" />
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, unpartition } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import type { NormalizeResult } from './types.ts';

function parseGlbJson(glbBytes: Uint8Array): { extensionsRequired?: string[] } | null {
  if (glbBytes.length < 20) return null;
  const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLen = view.getUint32(12, true);
  if (jsonLen <= 0 || 20 + jsonLen > glbBytes.length) return null;
  try {
    return JSON.parse(new TextDecoder().decode(glbBytes.subarray(20, 20 + jsonLen))) as {
      extensionsRequired?: string[];
    };
  } catch {
    return null;
  }
}

let decoderPromise: Promise<unknown> | undefined;
function getDecoder(): Promise<unknown> {
  if (decoderPromise === undefined) {
    decoderPromise = draco3d.createDecoderModule();
  }
  return decoderPromise;
}

/**
 * Decode Draco (if present) and rewrite a GLB the engine can ingest:
 * VertexLayout.SEPARATE + prune + unpartition; no required KHR_draco_mesh_compression.
 */
export async function normalizeGlbForEngine(glbBytes: Uint8Array): Promise<NormalizeResult> {
  const json = parseGlbJson(glbBytes);
  if (json === null) {
    return { ok: false, code: 'corrupt_glb', message: 'GLB header/JSON chunk is corrupt or not a GLB.' };
  }

  const required = json.extensionsRequired ?? [];
  const needsDraco = required.includes('KHR_draco_mesh_compression');

  try {
    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression])
      .registerDependencies({
        'draco3d.decoder': await getDecoder(),
      });
    io.setVertexLayout(VertexLayout.SEPARATE);

    let document;
    try {
      document = await io.readBinary(glbBytes);
    } catch (err) {
      return {
        ok: false,
        code: 'decode_failed',
        message: err instanceof Error ? err.message : 'Failed to decode GLB (Draco/corrupt).',
      };
    }

    // Drop Draco extension so the written GLB does not require it.
    for (const ext of [...document.getRoot().listExtensionsUsed()]) {
      if (ext.extensionName === 'KHR_draco_mesh_compression') {
        ext.dispose();
      }
    }

    await document.transform(prune(), unpartition());

    let out: Uint8Array;
    try {
      out = await io.writeBinary(document);
    } catch (err) {
      return {
        ok: false,
        code: 'write_failed',
        message: err instanceof Error ? err.message : 'Failed to write normalized GLB.',
      };
    }

    const outJson = parseGlbJson(out);
    const stillRequired = outJson?.extensionsRequired?.includes('KHR_draco_mesh_compression') ?? false;
    if (stillRequired) {
      return {
        ok: false,
        code: 'write_failed',
        message: 'Normalized GLB still lists KHR_draco_mesh_compression as required.',
      };
    }

    return { ok: true, bytes: out, changed: needsDraco || out.length !== glbBytes.length };
  } catch (err) {
    return {
      ok: false,
      code: 'decode_failed',
      message: err instanceof Error ? err.message : 'normalizeGlbForEngine failed',
    };
  }
}
