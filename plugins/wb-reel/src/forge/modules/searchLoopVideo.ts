import type { Scene, SearchSegmentClip } from '../../scenario/types'

/**
 * 搜索段「静态可循环视频」提示词生成。
 *
 * 作者诉求：搜索段到达时视频要在某一帧静态循环、首尾相同、可无缝循环，
 * 且不能出现会干扰玩家搜寻的动态内容（人物走动、镜头运动、强光变化等）。
 * 这里把这套约束固化成提示词，作者一键复制后丢给视频模型生成即可。
 *
 * 设计：
 *   - 主体 = 当前场景画面（沿用 scene 的画面/背景描述，让循环段与正片同一空间）。
 *   - 强约束：静止镜头、首尾帧一致、极轻微环境呼吸感（可选）、无人物动作、
 *     无镜头运动、无转场、无文字/UI，便于做成 2~4s 无缝 loop。
 */
export function buildSearchLoopVideoPrompt(scene: Scene, segment: SearchSegmentClip): string {
  const sceneDesc =
    scene.background?.trim() ||
    scene.prompts?.scene?.trim() ||
    scene.media.prompt?.trim() ||
    scene.title ||
    '当前场景空间'
  const durMs = Math.max(1000, segment.endMs - segment.startMs)
  const durSec = Math.round(durMs / 1000)

  return [
    `静态可循环空镜（seamless looping ambient shot），用于「搜寻道具」互动段。`,
    `场景内容：${sceneDesc}。`,
    `镜头要求：固定机位、完全静止的构图（locked-off static camera, no camera movement, no pan/tilt/zoom/dolly）；`,
    `首帧与尾帧必须完全一致以便无缝循环（first frame and last frame identical, perfect seamless loop）；`,
    `画面中不得出现人物动作、行走、说话、转场或剧情推进，不得有强烈光线/明暗变化；`,
    `仅允许极其轻微、可循环的环境呼吸感（如尘埃浮动、烛火微闪）或干脆完全静止；`,
    `不要任何文字、字幕、UI、水印、放大镜或图标（这些由游戏层叠加）；`,
    `时长约 ${durSec} 秒，节奏平稳，方便玩家在画面上从容搜寻可拾取的物品。`,
  ].join(' ')
}
