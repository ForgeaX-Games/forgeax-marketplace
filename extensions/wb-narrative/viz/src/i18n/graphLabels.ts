import { t, tStepLabel } from "./index";

/** Graph-only node ids (composite / fork layout) → i18n key. */
const GRAPH_NODE_LABEL_KEY: Record<string, string> = {
  "qsg::quest": "node.qsgQuest",
  "qsg::scene": "node.qsgScene",
  "vn_outline_acts::acts": "node.threeActScript",
  "qsg::scene::p1": "node.skeletonExtract",
  "qsg::scene::p2": "node.sceneExpand",
  "qsg::scene::p3": "node.merge",
  "qsg::scene::p1::merge": "node.skeletonMerge",
};

/** Localize a React Flow node label from its id + stored fallback (usually Chinese from layout). */
export function resolveGraphNodeLabel(nodeId: string, fallback: string): string {
  const stepHit = tStepLabel(nodeId, "");
  if (stepHit && stepHit !== `step.${nodeId}.label`) return stepHit;
  const gKey = GRAPH_NODE_LABEL_KEY[nodeId];
  if (gKey) {
    const hit = t(gKey);
    if (hit !== gKey) return hit;
  }
  return fallback;
}
