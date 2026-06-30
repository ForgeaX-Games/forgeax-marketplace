/**
 * Architecture 程序化布局助手（后端入口）。
 *
 * 真正的纯计算实现 vendored 在 `shared/types/geometry/arch-layout.ts`（编译到
 * `vendor/dist`），这样**电池层**（`g_building_shell` 在 runtime 跑）与**后端**
 * 都能共享同一份递归二分（BSP）逻辑，避免双实现漂移。这里只做 re-export，给
 * 后端代码 / 单测一个稳定的 `services/baker/arch/layout.js` 路径。
 */

export {
  subdivideFootprint,
  roomToWalls,
  type RoomRect,
  type WallSeg,
  type LayoutOptions,
} from '../../../../../vendor/dist/shared/types/index.js';
