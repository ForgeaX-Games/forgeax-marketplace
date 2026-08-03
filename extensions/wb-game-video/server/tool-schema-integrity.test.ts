import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const schemaRoot = resolve(import.meta.dirname, '..', 'schemas')

/** The public AI tool schemas are a compatibility contract. */
const expectedSha256: Record<string, string> = {
  'generate-keyframe.args.json': '63ba55790b8cf865c4363e8e595471de7e8ec0f40803c492ecd9621ae7337081',
  'generate-keyframe.returns.json': '99ae71e4c4ec06b0b6c938f27ddf0feaf3e9773586cf07597598cc9b825e9aac',
  'generate-node-video.args.json': 'cfca9cbe3a13d79beb1db7ab74062c91dd1ae92410d6dde868ce5c5c68fe151e',
  'generate-node-video.returns.json': 'a806a64ed821c94125411fa02854698f01c93b9a2616ec392b734ce1259defd6',
  'generate-shot-script.args.json': '122db800d4ef10b2394dd0c1bcd17406f5eac0e4617cbc2c27ccc6377ab4c177',
  'generate-shot-script.returns.json': 'f85b6287a5a082f211606a0a888ea1faa528323246f821c11cfeda59fb89361b',
  'generate-video.args.json': 'e2a75b55ce10b1c5bb7d05127cecaf9acbbd2e3cec3765815a5af0579229a03d',
  'generate-video.returns.json': '61342d2d4a1715551337c433c8dd9e666e74080a70deb24e089eee06770f579c',
  'get-asset.args.json': '2d1e9e3fbfad7ff35e9cd44d856efa27cb7465f14db8f9201ed42d351ee87094',
  'get-asset.returns.json': '68b7866bb5e57366a759c27d8d8f3d27644d23846eff27b2f6aa09d54b70be2b',
  'get-graph.args.json': 'e4b448ccaad7eaea091f7fb44490f2fcf0c383cbb814619663136729f0818ba2',
  'get-graph.returns.json': 'b2f1903ad19557931124eaa264bfaf74dce435ea5278da49c59b2ff55cfe38f6',
  'import-character-refs.args.json': 'c834f7011888ea0b23484555c9c51e3455d1aae3e7e65d041b75d5d8bb0e128e',
  'import-refs.returns.json': '0f6ce6b12b88582349e2aea05c5b052fc860a0c0c1bbfbd4a0bdfa2d1fe6bb7e',
  'import-scene-refs.args.json': '1048357fefdbd46e49a19c5591c6be378949e8de5a3cf62879888852173704d3',
  'list-assets.args.json': '9961f013ab8550e7fb2cead21c34d8478686cd2f703c0e6a176564bdaf652712',
  'list-assets.returns.json': 'c7c03e68326b0c1deef9560aee2f6a592c7e659efe6aa8912a15774efe9f75b5',
  'list-videos.args.json': '8b54160ce9a708189a5d34f19e2674a25343d49bcd9c14866926d1355e217414',
  'list-videos.returns.json': 'dd3d6b2d89f18c31a9128bcde677ec47d616b06a941e98c9c02a374d06355e7d',
  'save-graph.args.json': '511a0d5a5c2960732f7faf9464ce23e29d09fad7c366c08c9a073f9a3ef4d850',
  'save-graph.returns.json': '50f2c82a84de371b927c2f0068768e81b86928263321c64ce775d4488b6bc1cd',
}

describe('public tool schema integrity', () => {
  it('keeps all 11 tool argument and return schemas byte-for-byte compatible', () => {
    for (const [file, expected] of Object.entries(expectedSha256)) {
      const actual = createHash('sha256').update(readFileSync(resolve(schemaRoot, file))).digest('hex')
      expect(actual, file).toBe(expected)
    }
  })
})
