/**
 * Skill Loader —— 把同目录下的 *.skill.md 作为字符串编译进 bundle。
 *
 * 用 Vite 的 `?raw` 后缀，文件按文本读入。
 * 这样 promptForge.ts 拿到的就是"完整 system prompt"，而不是
 * 程序拼接 + 模板字符串四处散落。
 *
 * 谁要新增 skill：
 *   1. 写一份 `xxx.skill.md`（参考 cinema-video-prompt.skill.md 的结构）
 *   2. 在这里 import 并导出
 *   3. 让 promptForge 里对应的 forgeXxx() 把它当 systemPrompt 喂给 Opus
 */

import imageSkill from './cinema-image-prompt.skill.md?raw'
import videoSkill from './cinema-video-prompt.skill.md?raw'
import kineticVideoSkill from './kinetic-video-prompt.skill.md?raw'
import dialogueSkill from './dialogue-craft.skill.md?raw'
import scenarioSkill from './scenario-architect.skill.md?raw'
import scriptStructurerSkill from './script-structurer.skill.md?raw'
import scriptCuratorSkill from './script-curator.skill.md?raw'
import storyboardDirectorSkill from './storyboard-director.skill.md?raw'
import outlineArchitectSkill from './outline-architect.skill.md?raw'
import scriptExpanderSkill from './script-expander.skill.md?raw'
import proseToBeatsSkill from './prose-to-beats.skill.md?raw'
import imageToStorySeedSkill from './image-to-storyseed.skill.md?raw'
import scriptIndexScannerSkill from './script-index-scanner.skill.md?raw'
import proseToBeatsChunkedSkill from './prose-to-beats-chunked.skill.md?raw'
import batchPromptTrioSkill from './batch-prompt-trio.skill.md?raw'
import styleCuratorSkill from './style-curator.skill.md?raw'
import loglineWriterSkill from './logline-writer.skill.md?raw'
import synopsisWriterSkill from './synopsis-writer.skill.md?raw'
import forgeChatAlignerSkill from './forge-chat-aligner.skill.md?raw'
import characterVoiceCasterSkill from './character-voice-caster.skill.md?raw'
import sceneBgmComposerSkill from './scene-bgm-composer.skill.md?raw'
import seedance2PromptOptimizerSkill from './seedance2-prompt-optimizer.skill.md?raw'

export const SKILLS = {
  cinemaImagePrompt: imageSkill,
  cinemaVideoPrompt: videoSkill,
  /** 图生视频 · 动能派（黄金三角 + 屏幕交互）—— v3.8 新增；吃 directorPersona */
  kineticVideoPrompt: kineticVideoSkill,
  dialogueCraft: dialogueSkill,
  /** idea 模式 —— 从一句话**创作**整树（要发散、要审美） */
  scenarioArchitect: scenarioSkill,
  /** script 模式 —— **结构化解析**已写好的剧本（要忠于原文、禁二创） */
  scriptStructurer: scriptStructurerSkill,
  /** P2 整理 —— **保守整理**乱排剧本（修复段落/统一标题/表格转散文，禁改写、禁创作） */
  scriptCurator: scriptCuratorSkill,
  /** 分镜脚本 —— 把单个 scene 炸成 N 张电影分镜（含 A/B 双帧、时长控制、视觉锚点承接） */
  storyboardDirector: storyboardDirectorSkill,
  /** idea 多阶段 · Stage A —— 一句话 → 2-4 幕大纲（不写台词、不写画面，只立"故事骨架 + 主角 + tone"） */
  outlineArchitect: outlineArchitectSkill,
  /** idea 多阶段 · Stage B —— 单幕 beat → 成品剧本文本（场景+对白+画面描写，纯文本供下游 scriptStructurer 吃） */
  scriptExpander: scriptExpanderSkill,
  /** P3 抽 beats —— **从已有散文/小说原文里抽 beats 清单**（每 beat 带原文 quote 可审计，禁创作） */
  proseToBeats: proseToBeatsSkill,
  /** P4 一张图 → 故事种子 —— 看图后顺势创作 Outline（与 outlineArchitect 输出形状一致，下游可直接走 forgeScriptFromOutline） */
  imageToStorySeed: imageToStorySeedSkill,
  /** 长文 · Pass 1 —— 全局索引扫描器（角色名册 / 场景地图 / logline / tone）；输入全文，输出极简 JSON */
  scriptIndexScanner: scriptIndexScannerSkill,
  /** 长文 · Pass 2 —— 单 chunk beats 抽取器（强制使用 Pass 1 的全局索引 ID 做跨段对齐） */
  proseToBeatsChunked: proseToBeatsChunkedSkill,
  /** 长文 · Phase 4 —— 单 Act 一次出齐 image+storyboard+video 三件套（跨 scene 一致性 + 节省 LLM call 数 / token） */
  batchPromptTrio: batchPromptTrioSkill,
  /** Forge 模块化 · Stage 0 —— 风格策展（导演 / 编剧 / 视觉基调）, 是后续所有 skill 的上游锚点 */
  styleCurator: styleCuratorSkill,
  /** Forge 模块化 · Stage 1 —— 一句话 logline + 3 条差异化备选, 主角 / 欲望 / 阻力 三要素硬约束 */
  loglineWriter: loglineWriterSkill,
  /** Forge 模块化 · Stage 2 —— 200–380 字梗概 + 3-5 拍 beats + keyImage, logline → outline 桥梁 */
  synopsisWriter: synopsisWriterSkill,
  /** Forge 模块化 · Intent —— ForgeChatPanel 自然语言意图分类兜底（keyword router 之后的 LLM 兜底） */
  forgeChatAligner: forgeChatAlignerSkill,
  /**
   * Forge · 角色音色选角师 (v6.7) ——
   *   从 TTS 白名单里挑 3 个候选音色 + 自创角色专属基准话语,
   *   供作者试听并锚定为 character.voiceAnchor.
   */
  characterVoiceCaster: characterVoiceCasterSkill,
  /**
   * Forge · 场景 BGM 作曲指挥 (v6.7) ——
   *   单 / 多场景 → MiniMax Music 官方框架的 cinematic instrumental brief.
   *   产物直接喂给 minimax music_generation prompt 字段.
   */
  sceneBgmComposer: sceneBgmComposerSkill,
  /**
   * 官方 Seedance 2.0 提示词优化器 (sd2-pe) ——
   *   把"分镜 + 锚点素材"翻译成 Seedance 2.0 工程化提示词:
   *   @图片N/<主体N> 绑定语法、八大要素、路径 A(单镜一段式)/路径 B(多镜三段论)、
   *   一镜一运镜、镜头序号优先于绝对秒数、大头照+全身照(禁三视图)、音频/字幕特殊符号。
   *   定位: cinema-video-prompt / kinetic-video-prompt 的 Seedance 2.0 升级规范。
   */
  seedance2PromptOptimizer: seedance2PromptOptimizerSkill,
} as const

export type SkillName = keyof typeof SKILLS

/**
 * 按需取用 skill 文本。
 * 调用方一般直接 `SKILLS.cinemaVideoPrompt`，但若要做"按名称选 skill"
 * 的 UI（如未来给作者一个"选风格"下拉框），用这个函数。
 */
export function getSkill(name: SkillName): string {
  return SKILLS[name]
}
