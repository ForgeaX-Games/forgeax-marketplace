import { useMediaStore } from '../media/mediaStore'
/** file-server 归档版 MP4 —— 与 seedance prototype/game-config.js 对齐。 */
const DIR = ''

export const COLD_CLIFF_VIDEOS = {
  s1: `${DIR}s1_02178229294664800000000000000000000ffffac1926eeccdbe8.mp4`,
  s2a: `${DIR}s2a_02178228357449900000000000000000000ffffac14d0d93e2c0a.mp4`,
  s2b: `${DIR}s2b_02178228384071100000000000000000000ffffac1814161d3b04.mp4`,
  s3: `${DIR}s3_02178237386873900000000000000000000ffffac193b2b938b02.mp4`,
  r1a: `${DIR}r1a_02178228573793900000000000000000000ffffac177fcd7acaa1.mp4`,
  r1b: `${DIR}r1b_02178228683581100000000000000000000ffffac177d8982e807.mp4`,
  r2a: `${DIR}r2a_02178228822904100000000000000000000ffffac18235b7155e0.mp4`,
  r2b: `${DIR}r2b_02178228872683900000000000000000000ffffac18226faf056f.mp4`,
  s4a: `${DIR}s4a_02178229009222900000000000000000000ffffac1743b7c639ce.mp4`,
  s4b: `${DIR}s4b_02178229050844100000000000000000000ffffac155b343c8b80.mp4`,
  l1: `${DIR}l1_02178237017921500000000000000000000ffffac15f3f9636082.mp4`,
  lb1: `${DIR}lb1_02178236862629800000000000000000000ffffac177fcd8a182f.mp4`,
  lb2: `${DIR}lb2_02178228600557100000000000000000000ffffac182b5e995a04.mp4`,
  lb3: `${DIR}lb3_02178228923008100000000000000000000ffffac158f8eb84a9a.mp4`,
  tcave: `${DIR}tcave_02178228234669700000000000000000000ffffac1415b0daf5f6.mp4`,
  tbridge: `${DIR}tbridge_02178228295373800000000000000000000ffffac193cda43129c.mp4`,
  tr1a: `${DIR}tr1a_02178228547570200000000000000000000ffffac140a389e4795.mp4`,
  tr1b: `${DIR}tr1b_02178228640395400000000000000000000ffffac140a387dd51a.mp4`,
  tr2a: `${DIR}tr2a_02178228730557800000000000000000000ffffac15b7da45a891.mp4`,
  tr2b: `${DIR}tr2b_02178228757669500000000000000000000ffffac18141621fa57.mp4`,
  tr3a: `${DIR}tr3a_02178228953149400000000000000000000ffffac1414368c9a3f.mp4`,
  tr3b: `${DIR}tr3b_02178228974099400000000000000000000ffffac1814164d9b81.mp4`,
} as const

export type ColdCliffVideoKey = keyof typeof COLD_CLIFF_VIDEOS

export function coldCliffMediaId(key: ColdCliffVideoKey): string {
  return `m-cold-${key}`
}

/** 把 prototype 视频 URL 灌进 mediaStore，供 Scene.media.ref 解析。 */
export function primeColdCliffDemoMedia(): void {
  useMediaStore.setState((s) => {
    const entries = { ...s.entries }
    for (const [key, url] of Object.entries(COLD_CLIFF_VIDEOS) as [ColdCliffVideoKey, string][]) {
      const id = coldCliffMediaId(key)
      entries[id] = {
        id,
        name: `${key}.mp4`,
        mimeType: 'video/mp4',
        size: 0,
        url,
        createdAt: entries[id]?.createdAt ?? 0,
        persistState: 'saved',
      }
    }
    return { entries }
  })
}

/** 剧本里是否引用了冷蓝悬崖 demo 视频（m-cold-*）。 */
export function scenarioUsesColdCliffMedia(
  scenes: Record<string, { media?: { kind?: string; ref?: string } }>,
): boolean {
  for (const sc of Object.values(scenes)) {
    if (sc.media?.kind === 'VIDEO' && sc.media.ref?.startsWith('m-cold-')) {
      return true
    }
  }
  return false
}

/** loadScenario / boot 后调用：有引用则确保 mediaStore 里有可播 URL。 */
export function ensureColdCliffMediaForScenario(
  scenes: Record<string, { media?: { kind?: string; ref?: string } }>,
): void {
  if (scenarioUsesColdCliffMedia(scenes)) {
    primeColdCliffDemoMedia()
  }
}
