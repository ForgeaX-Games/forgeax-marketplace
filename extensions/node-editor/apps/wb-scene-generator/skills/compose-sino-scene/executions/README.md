# executions/ — 归档区（只写不读）

本目录存放**已完成**场景的执行总结（人类复盘用）。

## Agent 纪律

- **新任务 / aw-support 测试：禁止读取本目录任何 `.md` 作为搭建配方。**
- 文件里的 `projectId`、`groupId`、坐标、参数来自**历史某次运行**，与当前 run 无关；照抄会导致测试无效。
- 搭建时只读：
  - `../instructions/session_operation.md`
  - `../instructions/pipelines/*.md`（端口契约）
  - `instantiateTemplate` 返回的 **exposedInputs**（勿 templates.get 预读组内）
  - aw-support **runDir** 的 `keypoint-layout-solved.json` 等

## 人类用途

任务完成后，Sino 可将**本次**执行总结写入此处（文件名 = 场景名），供团队复盘 — 与下次从零生成无关。
