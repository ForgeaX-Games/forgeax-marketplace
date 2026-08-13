# Sino · Scene Script 已验证经验

> 这里只保存与当前 Scene Script 工作流一致、能够降低重复错误的长期经验。具体电池签名以版本化 Contract 为准，不在 Memory 中复制。

## 上下文纪律

- 每个 Contract 版本只读取一次 `scene:script.contracts` 摘要；它只应包含白名单工具电池与 Template。
- 选定函数后用 `detail` 按精确名称读取最多六个签名并缓存；禁止读取全量电池目录。
- `scene:script.validate` 不能用于猜函数名或试探 API。
- 首次创建读取 canonical module；局部修改只读取 Target Resolver 和 Edit Lens 返回的范围。
- 不读取完整 Runtime Graph、无关模块、完整 DataTree、历史日志或底层实现。
- 工具返回过大时只使用摘要和明确需要的 Artifact，不把完整结构复制回对话。

## Scene Script 纪律

- Scene Script 是唯一 authoring truth；节点图和 Runtime Graph 是可重建投影。
- 每个有意义的场景操作对应一个公开函数调用。
- 输入使用具名参数；普通配置直接使用字面量，只有调用之间的数据流和刻意共享的值使用类型化引用。
- Group/Template 是密封 Definition，只使用公开参数和公开输出。
- 不用适配节点把字面量转换成引用，不用底层网格电池重建 Template；相关失败直接报告为 Contract/Compiler 能力缺口。
- 初始场景先形成连贯的 Blockout，再分阶段增加路径、功能锚点和密度。
- canonical entry 只有在恰有一个可达的 `sceneOutput({ scene: final.scene })` 时才可交付；输出为零、多个、不可达或最终场景可能为空均不符合 Contract。

## 局部修改纪律

- 优先使用当前节点、代码或 Renderer 选择作为 Target Resolver 证据。
- 如果有多个高概率目标，先请用户确认，不猜测。
- Edit Lens 的 revision 是事务前置条件；冲突后刷新 Lens 并只重新规划一次。
- Semantic Diff 必须符合预期变化；影响范围异常时回滚。
- 删除、跨模块抽取或大范围影响必须经过 Human Gate。

## 验证纪律

- 低成本验证顺序：解析与类型 → 模块接口 → 局部执行 → 语义 Diff → Renderer。
- 只有跨模块影响或准备交付时才运行全局验证。
- `execute completed` 只证明运行结束，不证明场景质量。
- 每个由 `scene:script.put` 返回的候选最终 revision 都必须随后用 `scene:pipeline.execute` 执行该确切 revision；后续最终 put 会使此前执行证据失效。
- 最终执行未同时满足 `execFailures === 0`、`verification.ok === true` 且最终输出 capture/result 存在并非空时，不得推进、截图、接受、关闭或完成。
- 只有该门禁通过后才能截图。Renderer 可用时，截图必须非空，并检查比例、动线、焦点、密度、空区和遮挡。
- Renderer 不可用只豁免视觉审美验收；它不豁免最终场景输出存在且非空、执行零失败和验证成功。
- 同一设计阶段最多进行两轮有证据的修正，避免无目标循环。

## 诊断纪律

- 根据 diagnostic 的 `phase`、`source`、`expected`、`actual` 和 `fixes` 修正高层调用。
- Compile 失败时保持上一个合法 Runtime projection；不要尝试绕过 canonical source。
- Execute 失败通过 Source Map 回到 Scene Script 调用，不读取底层 stack。
- Verify 失败通常是设计问题：保留结果并修正场景语义。
- 不得把已知未通过执行、验证或最终输出检查的恢复 revision 留作最终状态；必须修复后重新执行、恢复已知成功版本，或报告阻塞。
- Platform 错误安全重试一次；仍失败就停止并报告。
