---
name: forgeax-game-audio
description: Use when users ask to add BGM, SFX, or voice to a ForgeaX game; design or edit no-code audio event bindings; repair missing gameAudio events; or verify game audio coverage and playback.
---

# ForgeaX Game Audio

把音频任务完成到“游戏事件真实可播放”，不要把检索结果冒充完整接入。

## 工作流

1. **确定目标游戏**
   - 从当前会话作用域、用户指定 slug 或 `.forgeax/games/` 推断唯一目标。
   - 目标不唯一且会导致写错游戏时才追问。

2. **读取需求与代码**
   - 阅读 pillar、design、玩法说明和现有 `src/`。
   - 定位真实反馈事件、现有音频入口、manifest、`audio/cues.json` 和播放器实现。
   - 优先覆盖核心循环、失败反馈和高频交互；装饰性事件放后。

3. **先区分 BGM 与 SFX**
   - BGM 表达持续场景和情绪；SFX 表达明确事件反馈。不要用同一套标签协议。
   - BGM 进入步骤4；SFX 进入步骤5。

4. **结构化检索 BGM**
   - 从策划案提取 `scene`、最多两个 `moodIds`、`energy` 和可选 `world`。
   - `scene` 是主要条件；世界观不明确时省略 `world`，不要猜。
   - 调用 `search-bgm`，不要把复杂需求压成 `search-audio` 的单个英文标签。
   - 优先选择 `exact`；需要 `relaxed` 时说明具体放宽项；`partial` 只能作为最后备选。
   - 文件名和目录是场景、世界观硬证据；CLAP只补情绪和能量。不得把CLAP的场景、世界观建议当正式标签。
   - 正式使用资产时必须采用 Live 结果中的真实 `assetId`、`resUrl` 和版本；`dryRun` 仅用于检查标签目录。

5. **为 SFX 生成一份批量 Audio Plan**
   - 为每项填写稳定 `eventId`、必填 `playerGoal` 和标准 `cue`。
   - 玩家端与 Agent 共用在线库目录映射。需求能明确归类时填写
     `directoryCategory` 和 `directorySubcategory`；两者是英文目录 ID，
     作为硬过滤条件，不填写中文显示名。
   - 目录不明确时不要猜，省略目录字段，继续用结构化事件标签检索。
   - 仅在代码或策划案有依据时填写 `source`、`targetMaterial`、`intensity`。
   - 用 `exclude` 表达绝不能出现的语义；不要用排除词代替正向需求。
   - 同一批最多 50 项，事件 ID 不得重复。
   - 构造计划前阅读 [Audio Plan合约](references/audio-plan-contract.md)。

6. **只调用一次 `resolve-audio-plan`**
   - SFX 不调用 `search-audio`、`search-audio-v2`。
   - 使用目标 slug 作为 `slug`，通常也作为 `projectId`；没有项目声音配置时使用 `default`。
   - 正式任务使用 Live 模式，不以 `dryRun` 结果进入挂载。
   - 接受 `exact`；保留并说明 `fallback`；把 `gap/error` 作为明确缺口，不用错误素材硬凑。

7. **只调用一次 `apply-audio-plan`**
   - 将 resolve 返回的 `planId` 和 `items` 原样传入。
   - 不预先调用 `list-audio`，不逐条调用 `attach-audio`。
   - 单项失败时继续处理其他项，并保留失败原因。

8. **只读扫描可绑定事件**
   - 调用 `inspect-audio-events`，读取每个候选的 `eventId`、文件、行号、来源和置信度。
   - 扫描结果只是定位线索；结合游戏语义确认事件真正成立的位置。
   - 不在扫描阶段改代码，不把攻击输入当作命中，不从文件名虚构事件。

9. **读取并起草共享音频项目**
   - 先调用 `get-audio-project`，保存返回的 `revision`。
   - 阅读 [音频项目合约](references/audio-project-contract.md)，再调用
     `patch-audio-project`；必须传 `expectedRevision`，只提交要增改的绑定和要删除的事件 ID。
   - 将步骤7已挂载的真实资产写入绑定，不编造 `assetId` 或文件。
   - 可以设计：声音/变体、延迟、冷却、概率、音量、Bus、2D/3D、单次/循环、
     淡入淡出、停止事件、简单条件、事件级声音感觉和“跟随游戏变化”。
   - Agent 只表达五项：`eventId`、默认 `assets`、`follow.field`、值到声音的映射或数值范围、`shaping`。不要自行生成底层音频节点。
   - 不同值切换声音时使用 `follow.cases`；随数值连续改变时使用 `follow.range`。两者不能同时出现，每条绑定最多一种跟随规则。
   - `assets` 始终是安全默认声音。`follow.cases` 中的每个声音必须来自已挂载真实资产；缺少明确映射时保留默认声音，不编造取值。
   - 事件级 EQ 使用 `shaping`，只在有听感依据时调整；默认保持 0 dB 和全频段，所有数值必须在合约范围内。
   - Agent 与玩家工作台编辑的是同一份 `audio/project.draft.json`。发生
     `revision_conflict` 时重新调用 `get-audio-project`，合并用户改动，禁止覆盖。

10. **让用户预览和修改**
   - 清楚汇报建议绑定、触发时机、声音、空间方式、循环和条件。
   - 告知用户可在“音乐音效 → 事件绑定”中直接启停、增删和修改草稿。
   - 用户修改后再次调用 `get-audio-project`，以最新 revision 为准。
   - 不额外创建一张 `ask-user` 确认卡；下一步的宿主工具确认是唯一确认入口，避免用户连续确认两次。

11. **通过宿主确认应用草稿**
   - 调用需要确认的 `apply-audio-project`，传入最新 `expectedRevision`；宿主会显示允许/拒绝卡，用户拒绝时停止应用并继续保留草稿。
   - 该工具只在游戏侧生成 `src/forgeax-audio/` 运行时和
     `audio/project.json`，不修改 ForgeaX Engine、ECS、Editor Gateway 或 ToolRegistry。
   - 不手写另一套播放器，不绕过工具直接改生成文件。

12. **绑定真实游戏事件**
   - 从 `src/forgeax-audio` 导入 `gameAudio`，在事件真正成立的位置调用
     `gameAudio.emit(eventId, context)`；`eventId` 必须是字面量。
   - 单次事件的游戏值放在 context，例如
     `gameAudio.emit('player.footstep', { surface: { material: 'grass' } })`。
     持续状态或连续参数使用 `gameAudio.setGameValue(field, value)`；字段必须与草稿中的 `follow.field` 完全一致。
   - 只有 3D 绑定需要在 context 中提供发声体/监听者位置；条件引用的字段也必须存在。
   - 命中音效只能放在伤害或碰撞确认之后，不能放在攻击输入时冒充命中。
   - 只做游戏源码的最小插桩，不改引擎底层，也不重写现有事件系统。

13. **验证后再完成**
   - 调用 `verify-audio-project`；按返回的资产、运行时和插桩问题继续修复。
   - 运行项目已有 typecheck、测试和构建。
   - 从本 Skill 目录运行：

     ```bash
     bun scripts/audit-audio-bindings.ts --project-root <studio-root> --slug <slug>
     ```

   - 审计有 error 时继续修复；不要把未接通的 `pendingBindings` 留给用户。

## 完成标准

- 核心事件全部得到 `exact`、可解释的 `fallback` 或明确 `gap`。
- 应用项目中的每个启用绑定资产都有真实文件。
- `src/forgeax-audio/` 由插件生成且游戏源码从其公开入口导入。
- 每个启用事件在游戏代码中有真实 `gameAudio.emit` 触发点。
- 构建与审计通过。
- 最终报告列出 revision、applied、reused、fallback、gap 和修改过的事件位置。

## 禁止事项

- 不编造 `assetId`、`resUrl`、familyId 或文件路径。
- 不把缺少标签当作精确匹配。
- 不自行改写在线目录 ID；目录字段必须来自共享的 914 资产目录映射。
- 不增加数值质量门槛或精选资产池。
- 不把CLAP场景或世界观建议写成BGM硬标签。
- 不再用旧版 `search-audio` 处理新的BGM任务。
- 不调用旧的 SFX 搜索、列表、逐条挂载链路。
- 不修改已有混音参数来掩盖素材不匹配。
- 不把 Switch、State、Parameter 或 WebAudio 节点直接暴露给玩家；统一写成一条 `follow` 声音规则。
- 不以“文件已经下载”宣告任务完成。
- 不修改 ForgeaX Engine、ECS、Editor Gateway、ToolRegistry 等底层逻辑。
- 不绕过共享草稿直接编辑 `audio/project.json` 或 `src/forgeax-audio/` 生成文件。
- 不绕过 `apply-audio-project` 的宿主确认，也不在工具返回成功前插入游戏事件调用。
- 不在 revision 冲突时覆盖玩家从事件绑定工作台做出的修改。
