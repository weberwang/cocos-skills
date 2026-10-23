/** 底板可直接承担功能根；额外结构根必须有不能由底板承担的独立职责。 */
import { hasSpriteRendering, isLayoutContainer, isSpriteContainer } from "../../cocos-game-ui-layout/scripts/display-node-role.mjs";
import { requiresNineSliceDecision } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";

/** 读取拆解与布局阶段共用的节点身份。 */
function nodeId(node) { return node?.element_id ?? node?.layout_node_id; }

/** 读取真实父级，不把独立定位参照误当作归属。 */
function parentId(node) { return node?.parent_element_id ?? node?.parent_layout_node_id; }

/** 只按显式底板职责识别可复用根，不依据图片面积、遮挡或中文名称猜测。 */
function isPanelRootCandidate(node) {
  return hasSpriteRendering(node) && (isSpriteContainer(node) || node.nine_slice_decision_required === true || requiresNineSliceDecision(node));
}

/** 检查单底板组件的额外结构根，保留多功能组织与无底板容器的原有职责。 */
export function validateContainerRootReuse(nodes, errors = [], label = "nodes") {
  if (!Array.isArray(nodes)) return errors;
  const children = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const list = children.get(parentId(node)) ?? [];
    list.push(node);
    children.set(parentId(node), list);
  }
  for (const node of nodes) {
    if (!isLayoutContainer(node) || hasSpriteRendering(node)) continue;
    const candidates = (children.get(nodeId(node)) ?? []).filter(isPanelRootCandidate);
    if (candidates.length !== 1) continue;
    const reason = node.ui_layout?.independent_container_reason;
    // 存在可用底板时，单纯包围内容不是额外建根的依据；不在这里自动改树或合并资产。
    if (typeof reason !== "string" || !reason.trim()) errors.push(`${label}.${nodeId(node)} 应优先复用底板 ${nodeId(candidates[0])} 作为根，额外纯结构容器必须声明 ui_layout.independent_container_reason`);
  }
  return errors;
}
