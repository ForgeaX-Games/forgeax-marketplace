# Reia · 累积 lessons

这文件是 Reia 自己在每个 phase 收尾时手写的「下次别再犯」。AI 只 append 不重写。

## 2026-05-28 · 初始化
- 记忆系统就位
- 首版工具集对接的是 wb-reel 的 6 个 tool（list/get/save scenario + list-assets + generate/get video task）
- 注意：Seedance 任务异步，submit 后必须用 taskId 轮询 `reel:get-video-task`

## 2026-06-19 · 视频生成闭环（重要修正）
- 旧 `reel:generate-video` 是 fire-and-forget：只把任务丢给宿主网关拿 taskId，**产物永远落不回剧本**，作者什么都看不到。`reel:get-video-task` 也救不了（taskId 现由工坊浏览器持有，不在 agent 手里）。
- 现已改为闭环：`reel:generate-video` **必须带 `sceneId`**，投递到工坊 `/__reel__/video-queue`，由工作台走浏览器内管线生成→落盘→**`setSceneMediaRef(VIDEO)` 绑定到场景**→时间轴可见、刷新可接盘。支持 `jobs:[…]` 批量。
- 铁律：视频只能经此工具入队、且**工坊必须打开**、目标剧本是 active。确认出片用 `reel:get-scenario` 查 `scene.media.kind==="VIDEO"`，别再调 `reel:get-video-task`。
