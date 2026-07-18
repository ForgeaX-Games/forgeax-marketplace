import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { Document, WebIO } from '@gltf-transform/core';
import { cookExternalAssetFields, cookExternalAssetMeta } from './cook.ts';
import type { ExternalAssetMeta } from './types.ts';

async function buildGlb(meshCount: number): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (let i = 0; i < meshCount; i += 1) {
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position);
    const mesh = doc.createMesh(`mesh-${i}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`node-${i}`).setMesh(mesh));
  }
  return new WebIO().writeBinary(doc);
}

function oneByOnePng(): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  const idat = chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255])));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

async function buildTexturedGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const tex = doc.createTexture('base-color').setImage(oneByOnePng()).setMimeType('image/png');
  const material = doc.createMaterial('mat-0').setBaseColorTexture(tex);
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
  const mesh = doc.createMesh('mesh-0').addPrimitive(prim);
  scene.addChild(doc.createNode('node-0').setMesh(mesh));
  return new WebIO().writeBinary(doc);
}

async function buildSkinnedAnimatedGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const joints = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    .setBuffer(buffer);
  const weights = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .setBuffer(buffer);
  const ibm = doc
    .createAccessor()
    .setType('MAT4')
    .setArray(new Float32Array(16).map((_, i) => (i % 5 === 0 ? 1 : 0)))
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('JOINTS_0', joints)
    .setAttribute('WEIGHTS_0', weights);
  const mesh = doc.createMesh('skinned-mesh').addPrimitive(prim);
  const joint = doc.createNode('Hips');
  const skin = doc.createSkin('skin-0').addJoint(joint).setInverseBindMatrices(ibm);
  const node = doc.createNode('skinned').setMesh(mesh).setSkin(skin);
  scene.addChild(joint);
  scene.addChild(node);

  const input = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(joint).setTargetPath('translation').setSampler(sampler);
  doc.createAnimation('idle').addSampler(sampler).addChannel(channel);
  const input2 = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const output2 = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
    .setBuffer(buffer);
  const sampler2 = doc.createAnimationSampler().setInput(input2).setOutput(output2).setInterpolation('LINEAR');
  const channel2 = doc.createAnimationChannel().setTargetNode(joint).setTargetPath('translation').setSampler(sampler2);
  doc.createAnimation('move').addSampler(sampler2).addChannel(channel2);

  return new WebIO().writeBinary(doc);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('single-mesh GLB → mesh + scene subAssets', async () => {
  const glb = await buildGlb(1);
  const contentHash = `sha256:${sha256Hex(glb)}`;
  const meta = await cookExternalAssetFields(glb, contentHash, 'prop-test.glb');
  expect(meta).not.toBeNull();
  expect(meta!.kind).toBe('external-asset-package');
  const byKind = Object.fromEntries(meta!.subAssets.map((s) => [s.kind, s]));
  expect(Object.keys(byKind).sort()).toEqual(['mesh', 'scene']);
});

test('textured GLB → mesh + material + scene + texture', async () => {
  const glb = await buildTexturedGlb();
  const meta = await cookExternalAssetFields(glb, `sha256:${sha256Hex(glb)}`, 'prop-tex.glb');
  const kinds = new Set(meta!.subAssets.map((s) => s.kind));
  expect([...kinds].sort()).toEqual(['material', 'mesh', 'scene', 'texture']);
});

test('skinned+animated GLB → skeleton/skin/animation-clip', async () => {
  const glb = await buildSkinnedAnimatedGlb();
  const result = await cookExternalAssetMeta(glb, `sha256:${sha256Hex(glb)}`, 'hero.glb', {
    animationSlotKeys: ['idle', 'move'],
    slotGuidRegistry: { idle: '11111111-1111-1111-1111-111111111111' },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const kinds = result.meta.subAssets.map((s) => s.kind);
  expect(kinds).toContain('skeleton');
  expect(kinds).toContain('skin');
  const clips = result.meta.subAssets.filter((s) => s.kind === 'animation-clip');
  expect(clips.length).toBe(2);
  expect(clips[0]!.guid).toBe('11111111-1111-1111-1111-111111111111');
});

test('existingMeta reuses GUID by (kind, sourceIndex)', async () => {
  const glb = await buildGlb(1);
  const hash = `sha256:${sha256Hex(glb)}`;
  const first = await cookExternalAssetFields(glb, hash, 'prop.glb');
  const existing: ExternalAssetMeta = {
    ...first!,
    subAssets: first!.subAssets.map((s) =>
      s.kind === 'mesh' ? { ...s, guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } : s,
    ),
  };
  const second = await cookExternalAssetMeta(glb, hash, 'prop.glb', { existingMeta: existing });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  const mesh = second.meta.subAssets.find((s) => s.kind === 'mesh')!;
  expect(mesh.guid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('required Draco → engine_unsupported_extension', async () => {
  const glb = await buildGlb(1);
  // Patch JSON chunk to claim required Draco (without real compression).
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as Record<string, unknown>;
  json.extensionsRequired = ['KHR_draco_mesh_compression'];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // Rebuild a minimal invalid-but-parseable GLB for extension check (cook fails before WebIO if required).
  const out = new Uint8Array(20 + jsonBytes.length + 4);
  out.set(glb.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(12, jsonBytes.length, true);
  new DataView(out.buffer).setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonBytes, 20);
  const result = await cookExternalAssetMeta(out, 'sha256:dead', 'draco.glb');
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe('engine_unsupported_extension');
});

test('bad bytes → null via compat wrapper', async () => {
  const meta = await cookExternalAssetFields(new Uint8Array([1, 2, 3]), 'sha256:bad', 'bad.glb');
  expect(meta).toBeNull();
});

test('mesh GUID stays sha256(hash:sourceIndex)', async () => {
  const glb = await buildGlb(1);
  const bareHash = sha256Hex(glb);
  const meta = await cookExternalAssetFields(glb, `sha256:${bareHash}`, 'prop-test.glb');
  const mesh = meta!.subAssets.find((s) => s.kind === 'mesh')!;
  const hex = createHash('sha256').update(`${bareHash}:0`).digest('hex');
  const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  expect(mesh.guid).toBe(expected);
});
