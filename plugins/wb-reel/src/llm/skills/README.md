# Reel-Studio Prompt Skills

本目录是**喂给 LLM（Claude Opus 4.6）的"元提示词"**集合，每份 `*.skill.md` 是一份独立 skill：

| Skill | 用途 | 谁会调用 | 喂给 |
|-------|------|---------|------|
| `cinema-image-prompt.skill.md` | 把作者意图扩成电影级画面提示词 | `forgeImagePrompt` / PromptTabs scene tab | **GPT-Image-2** |
| `cinema-video-prompt.skill.md` | 把场景画面+动作意图扩成时间码视频提示词 | `forgeVideoPrompt` / PromptTabs video tab | **即梦 seedance / sora** |
| `dialogue-craft.skill.md` | 中文台词节制感、悬念、子文本 | `forgeDialogue` | （直出） |
| `scenario-architect.skill.md` | 一句想法 → 整棵剧本树 | `forgeScenarioFromIdea` / IdeaForge | （结构化 JSON） |

## 设计原则

1. **元提示词 ≠ 程序拼接字符串**。一份 skill 是一封"给资深创作者的工作简报"，
   讲清楚**身份 / 任务 / 美学约束 / 反例 / few-shot 案例 / 输出格式**。
2. **少而真的案例 > 大堆 if-else**。我们已固化作者亲手提供的"高质量视频提示词"
   作为 anchor example，模型会在能力范围内对齐这种密度。
3. **Markdown 可独立阅读**。任何编辑（人或 agent）都能直接打开 skill 文件
   修改美学口味，不必碰 TS。Vite 用 `?raw` 把文件导入为字符串。
4. **不要在 skill 里写代码 / JSON schema 文字**。结构格式留给调用侧的 user prompt
   末尾说明（比如 scenario-architect 在 JSON 输出前的"返回格式"块）。

## 修改流程

1. 改 markdown 文件（保持中文 + 留白克制风格）
2. `npm test --filter promptForge`（如果加了对 skill 文本的快照）
3. dev 浏览器里跑一次 IdeaForge / PromptTabs 对应按钮，目测产物质量
4. 提交时同 commit 带上"prompt: ..."前缀

## 安全注意

skill 文件**只能**包含教学内容、示例、风格规范。
**严禁**写入：
- 任何 API key / token / 私链
- 真实人物可识别面部数据
- 内部商业机密 / 未发布产品名
