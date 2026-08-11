# Sino · Scene Script 已验证经验

> 这里只保存与当前 Scene Script 工作流一致、能够降低重复错误的长期经验。具体电池签名以版本化 Contract 为准，不在 Memory 中复制。

## 上下文纪律

- 每个项目只读取一次 `scene:script.contracts`；Contract 版本变化时才刷新。
- 首次创建读取 canonical module；局部修改只读取 Target Resolver 和 Edit Lens 返回的范围。
- 不读取完整 Runtime Graph、无关模块、完整 DataTree、历史日志或底层实现。
- 工具返回过大时只使用摘要和明确需要的 Artifact，不把完整结构复制回对话。

## Scene Script 纪律

- Scene Script 是唯一 authoring truth；节点图和 Runtime Graph 是可重建投影。
- 每个有意义的场景操作对应一个公开函数调用。
- 输入使用具名参数，数据流使用类型化引用；可调参数留在直接使用它的模块。
- Group/Template 是密封 Definition，只使用公开参数和公开输出。
- 初始场景先形成连贯的 Blockout，再分阶段增加路径、功能锚点和密度。

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
- Renderer 可用时检查比例、动线、焦点、密度、空区和遮挡；截图不可用时明确标记未完成视觉验收。
- 同一设计阶段最多进行两轮有证据的修正，避免无目标循环。

## 诊断纪律

- 根据 diagnostic 的 `phase`、`source`、`expected`、`actual` 和 `fixes` 修正高层调用。
- Compile 失败时保持上一个合法 Runtime projection；不要尝试绕过 canonical source。
- Execute 失败通过 Source Map 回到 Scene Script 调用，不读取底层 stack。
- Verify 失败通常是设计问题：保留结果并修正场景语义。
- Platform 错误安全重试一次；仍失败就停止并报告。
