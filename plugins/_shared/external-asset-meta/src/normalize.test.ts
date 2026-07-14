import { expect, test } from 'bun:test';
import { Document, WebIO } from '@gltf-transform/core';
import { normalizeGlbForEngine } from './normalize.ts';
import { cookExternalAssetMeta } from './cook.ts';
import { createHash } from 'node:crypto';

async function buildPlainGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position);
  scene.addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
  return new WebIO().writeBinary(doc);
}

test('normalize plain GLB succeeds and remains cookable', async () => {
  const glb = await buildPlainGlb();
  const result = await normalizeGlbForEngine(glb);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const hash = `sha256:${createHash('sha256').update(result.bytes).digest('hex')}`;
  const cooked = await cookExternalAssetMeta(result.bytes, hash, 'plain.glb');
  expect(cooked.ok).toBe(true);
});

test('normalize corrupt bytes fails structured', async () => {
  const result = await normalizeGlbForEngine(new Uint8Array([0, 1, 2, 3]));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe('corrupt_glb');
});
