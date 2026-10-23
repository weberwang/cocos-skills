#!/usr/bin/env node

/**
 * V2 阶段 B 的自动布局视觉决策合同。
 *
 * 对齐语义由智能视觉判断显式给出，不能由几何距离反推；本模块只负责
 * 验证决策文件与已确认拆解元素逐项按序对应，并把它转换为只读查找表。
 */
import { isValidAxisAlignment } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { normalizeCenterAlignment } from "../../cocos-game-ui-layout/scripts/center-alignment.mjs";

export const AUTOMATIC_LAYOUT_DECISION_SCHEMA = "automatic-layout-decision/1.0";
export const AUTOMATIC_LAYOUT_DECISION_METHOD = "visual-judgement";

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断非空字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/**
 * 校验自动布局的显式视觉决策，并返回 element_id 到双轴对齐的映射。
 * 决策数组必须与确认 proposal 完全相等且顺序一致，防止漏绑、重复、调序或偷偷新增节点。
 */
export function validateAutomaticLayoutDecision(document, context = {}, errors = [], label = "automatic_layout_decision") {
  if (!isObject(document)) { errors.push(`${label} 必须是 JSON 对象`); return null; }
  for (const field of ["decision_schema", "decision_id", "decision_method", "scene_id", "state_id", "decomposition_confirmation_id"]) {
    if (!nonEmptyString(document[field])) errors.push(`${label}.${field} 必须是非空字符串`);
  }
  if (document.decision_schema !== AUTOMATIC_LAYOUT_DECISION_SCHEMA) errors.push(`${label}.decision_schema 必须为 ${AUTOMATIC_LAYOUT_DECISION_SCHEMA}`);
  if (document.decision_method !== AUTOMATIC_LAYOUT_DECISION_METHOD) errors.push(`${label}.decision_method 必须为 ${AUTOMATIC_LAYOUT_DECISION_METHOD}`);
  for (const [field, expected] of [["scene_id", context.sceneId ?? context.scene_id], ["state_id", context.stateId ?? context.state_id], ["decomposition_confirmation_id", context.decompositionConfirmationId ?? context.decomposition_confirmation_id]]) {
    if (expected !== undefined && document[field] !== expected) errors.push(`${label}.${field} 未绑定当前已确认拆解/冻结目标`);
  }
  const expectedElements = Array.isArray(context.elements) ? context.elements : [];
  const expectedIds = expectedElements.map((element) => element?.element_id).filter(nonEmptyString);
  const decisions = document.elements;
  if (!Array.isArray(decisions) || decisions.length === 0) { errors.push(`${label}.elements 必须是非空数组`); return null; }
  const seen = new Set(); const map = new Map();
  for (const [index, item] of decisions.entries()) {
    if (!isObject(item) || !nonEmptyString(item.element_id)) { errors.push(`${label}.elements[${index}] 必须绑定非空 element_id`); continue; }
    if (seen.has(item.element_id)) errors.push(`${label}.elements[${index}] 重复绑定 element_id：${item.element_id}`);
    seen.add(item.element_id);
    if (!isValidAxisAlignment({ horizontal: item.horizontal_alignment, vertical: item.vertical_alignment })) errors.push(`${label}.elements[${index}] 必须声明合法 horizontal_alignment/vertical_alignment`);
    else {
      const alignment = { horizontal: item.horizontal_alignment, vertical: item.vertical_alignment };
      try {
        normalizeCenterAlignment(alignment, item.center_alignment, `${label}.elements[${index}].center_alignment`);
        // 组合成员的默认居中由整体约束接管，不能提前转成独立严格居中。
        map.set(item.element_id, { ...alignment, ...(item.center_alignment !== undefined ? { center_alignment: structuredClone(item.center_alignment) } : {}) });
      } catch (error) { errors.push(error.message); }
    }
  }
  const actualIds = decisions.map((item) => item?.element_id);
  if (expectedIds.length === 0 || new Set(expectedIds).size !== expectedIds.length || decisions.length !== expectedIds.length || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) errors.push(`${label}.elements 必须按原顺序与已确认 decomposition_elements 逐项对应`);
  return errors.length > 0 ? null : map;
}

/** 读取决策文件中的稳定 ID，供布局 PNG/确认身份绑定。 */
export function automaticLayoutDecisionId(document) { return isObject(document) && nonEmptyString(document.decision_id) ? document.decision_id : null; }
