import { resolveProductionContract } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";

import { validateEffectImageParentChildLayoutNodes } from "../../cocos-game-workflow-control/scripts/layout-node-parent-geometry.mjs";
import { buildDecompositionElements, decompositionElementIds, validateDecompositionElements } from "./decomposition-elements.mjs";
import { resolveVisualValidationMode, visualBoundsOutsideViewport } from "../../cocos-game-workflow-control/scripts/visual-validation-policy.mjs";


/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断字符串是否为非空合同值。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
const isString = nonEmptyString;

/** 验证证据字段是非空项目内路径列表。 */
function validatePathList(value, label, errors) {
  if (!(nonEmptyString(value) || (Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)))) errors.push(`${label} 必须是非空路径或路径列表`);
}

/** 判断布局目标边界是否为有限的正尺寸矩形。 */
function validLayoutBounds(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 读取区域的唯一布局节点声明；effect-image 不接受“稍后再补”的空绑定。 */
function declaredLayoutNodeIds(region) {
  return Array.isArray(region?.layout_node_ids) ? region.layout_node_ids : [];
}

/** 生成区域当前权威拆解元素的规范化期望投影，包含由区域归属派生的确认上下文。 */
function decompositionElements(region) { return buildDecompositionElements([region]); }
/** 返回阶段 A 元素 ID，布局节点不得在此阶段提前声明。 */
function decompositionElementIdList(region) { return decompositionElementIds(decompositionElements(region)); }

/** 读取运行时布局实现消费的节点；该字段只属于 runtime_implementation。 */
function runtimeLayoutNodeIds(region) {
  if (Array.isArray(region?.runtime_implementation?.layout_node_ids)) return region.runtime_implementation.layout_node_ids;
  const production = resolveProductionContract(region);
  return Array.isArray(production?.runtime_implementation?.layout_node_ids) ? production.runtime_implementation.layout_node_ids : [];
}

/** 收集区域内组件 placement，同时保留 component_id 供错误定位和技术提案复算。 */
function layoutPlacements(region) {
  const inventory = region.component_inventory ?? resolveProductionContract(region).component_inventory;
  const components = Array.isArray(inventory?.components) ? inventory.components : [];
  return components.flatMap((component) => (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({ ...placement, component_id: component.component_id })));
}

/** 比较两个布局边界；参考事实与运行时证据必须逐轴可复核。 */
function layoutBoundsEqual(left, right) {
  return validLayoutBounds(left) && validLayoutBounds(right)
    && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

/** 以稳定键序列化布局元数据，避免 proposal/PNG 属性顺序影响交叉校验。 */
function canonicalLayoutJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalLayoutJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalLayoutJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 校验后置布局 PNG 与前置拆解确认的双重绑定，避免 mapping 入口绕过串行硬门。 */
function validateLayoutAnnotationBinding(data, decomposition, nodeById, label, errors) {
  const annotation = decomposition.layout_annotation;
  const confirmation = decomposition.layout_annotation_confirmation;
  if (!isObject(annotation)) { errors.push(`${label}.layout_annotation 必须存在；布局图只能在拆解确认后生成`); return; }
  for (const field of ["layout_annotation_file", "layout_annotation_width", "layout_annotation_height", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id"]) if (!Object.hasOwn(annotation, field)) errors.push(`${label}.layout_annotation.${field} 必须存在`);
  for (const field of ["layout_annotation_file", "layout_review_file", "layout_nodes_file", "layout_decision_file", "decomposition_confirmation_id", "layout_decision_id", "scene_id", "state_id"]) if (!isString(annotation[field])) errors.push(`${label}.layout_annotation.${field} 必须是非空字符串`);
  if (annotation.layout_annotation_schema !== "layout-annotation/png/1" || annotation.layout_annotation_layout !== "image-plus-right-panel") errors.push(`${label}.layout_annotation schema/layout 不符合独立布局 PNG 合同`);
  for (const field of ["layout_annotation_width", "layout_annotation_height"]) if (!Number.isInteger(annotation[field]) || annotation[field] <= 0) errors.push(`${label}.layout_annotation.${field} 必须是正整数`);
  const target = data.scene_reconstruction_contract?.target_conditions;
  for (const [field, expected] of [["scene_id", target?.scene_id], ["state_id", target?.state_id]]) if (expected !== undefined && annotation[field] !== expected) errors.push(`${label}.layout_annotation.${field} 未绑定当前冻结场景`);
  const expectedNodeIds = [...nodeById.keys()]; const actualNodeIds = Array.isArray(annotation.layout_node_ids) ? annotation.layout_node_ids : null;
  if (!actualNodeIds || actualNodeIds.length === 0 || canonicalLayoutJson(actualNodeIds) !== canonicalLayoutJson(expectedNodeIds)) errors.push(`${label}.layout_annotation.layout_node_ids 必须按布局节点原顺序完整且只能来自已确认拆解`);
  if (!isObject(confirmation) || confirmation.status !== "accepted" || confirmation.confirmation_mode !== "manual") errors.push(`${label}.layout_annotation_confirmation 必须是 accepted/manual`);
  else for (const field of ["layout_annotation_file", "layout_annotation_width", "layout_annotation_height", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id"]) if (confirmation[field] !== annotation[field]) errors.push(`${label}.layout_annotation_confirmation.${field} 未绑定最终布局图或显式布局决策`);
}

/** 校验 technical_analysis 的聚合布局节点身份。 */
export function validateTechnicalLayoutNodeIds(technical, regions, label, errors) {
  const expected = regions.flatMap((region) => decompositionElementIdList(region));
  const actual = Array.isArray(technical.layout_node_ids) ? technical.layout_node_ids : technical.layout_node_ids;
  if (!Array.isArray(technical.layout_node_ids) || canonicalLayoutJson(actual) !== canonicalLayoutJson(expected)) errors.push(`${label}.proposal 技术文件 layout_node_ids 必须等于已确认 decomposition_elements ID`);
  const elementErrors = []; const elementMap = validateDecompositionElements(technical.decomposition_elements, regions, technical.canvas, `${label}.proposal.decomposition_elements`, elementErrors);
  if (elementErrors.length > 0 || !(elementMap instanceof Map) || canonicalLayoutJson(decompositionElementIds(technical.decomposition_elements ?? [])) !== canonicalLayoutJson(expected)) errors.push(...(elementErrors.length > 0 ? elementErrors : [`${label}.proposal 技术文件 decomposition_elements 与当前清单不一致`]));
}

/** 校验单个技术区域的布局节点与 placement 布局身份。 */
export function validateTechnicalRegionLayout(region, item, expectedPlacements, label, errors) {
  const expectedElementIds = decompositionElementIdList(region);
  if (!Array.isArray(item.layout_node_ids) || canonicalLayoutJson(item.layout_node_ids) !== canonicalLayoutJson(expectedElementIds)) errors.push(`${label}.proposal 技术文件 ${region.id} layout_node_ids 必须按已确认 decomposition_elements 原顺序一致`);
  const actualElements = Array.isArray(item.decomposition_elements) ? item.decomposition_elements : [];
  if (canonicalLayoutJson(actualElements) !== canonicalLayoutJson(decompositionElements(region))) errors.push(`${label}.proposal 技术文件 ${region.id} decomposition_elements 必须按当前清单原顺序一致`);
  if (expectedPlacements.some((placement) => !nonEmptyString(placement.layout_node_id)) || (Array.isArray(item.placements) && item.placements.some((placement) => !nonEmptyString(placement?.layout_node_id)))) errors.push(`${label}.proposal 技术文件 ${region.id} placement 缺少 layout_node_id`);
}

/** 校验 PNG 元数据中的布局节点和 placement 绑定。 */
export function validatePngLayoutMetadata(region, item, expectedPlacements, label, errors) {
  const expectedNodeIds = decompositionElementIdList(region);
  const expectedPlacementBindings = expectedPlacements.map((placement) => ({ placement_id: placement.placement_id, layout_node_id: placement.layout_node_id })).sort((left, right) => String(left.placement_id).localeCompare(String(right.placement_id)));
  if (!Array.isArray(item.layout_node_ids) || canonicalLayoutJson(item.layout_node_ids) !== canonicalLayoutJson(expectedNodeIds)) errors.push(`${label}.${region.id} PNG layout_node_ids 必须按当前清单原顺序一致`);
  if (!Array.isArray(item.placement_layout_node_ids) || canonicalLayoutJson(item.placement_layout_node_ids.slice().sort((left, right) => String(left?.placement_id).localeCompare(String(right?.placement_id)))) !== canonicalLayoutJson(expectedPlacementBindings)) errors.push(`${label}.${region.id} PNG placement_layout_node_ids 与当前清单不一致`);
}

/**
 * 校验 effect-image 的布局拆解、coverage region 和 placement 三方绑定。
 *
 * 布局节点是“参考图事实”，布局合同负责运行时计算，placement/runtime
 * implementation 是消费证据；三者不能各自维护一份没有交叉身份的坐标清单。
 */
export function validateEffectImageLayoutBindings(data, errors, options = {}) {
  const requireLayout = options.requireLayout ?? (options.stage === "V4" || data?.effect_image_reconstruction?.lifecycle === "v4-complete" || [data?.visualStageState, data?.visual_stage_state].includes("v2-production-planning-complete"));
  const coverageRegions = Array.isArray(data?.coverage_audit?.regions) ? data.coverage_audit.regions.filter(isObject) : [];
  const contract = data?.scene_reconstruction_contract;
  const decomposition = contract?.layout_decomposition;
  const label = "scene_reconstruction_contract.layout_decomposition";
  if (!isObject(decomposition) && !requireLayout) return null;
  if (!isObject(decomposition)) {
    errors.push(`${label} 必须是对象；effect-image 必须先冻结布局拆解`);
    return null;
  }
  const target = contract?.target_conditions;
  const binding = decomposition.layout_binding ?? decomposition.layout_contract_binding ?? decomposition.binding ?? decomposition;
  const identity = {
    scene_id: binding?.scene_id,
    state_id: binding?.state_id,
    layout_contract_version: binding?.layout_contract_version,
  };
  for (const field of Object.keys(identity)) if (!nonEmptyString(identity[field])) errors.push(`${label}.${field} 必须是非空字符串`);
  if (nonEmptyString(target?.scene_id) && identity.scene_id !== target.scene_id) errors.push(`${label}.scene_id 与冻结场景不一致`);
  if (nonEmptyString(target?.state_id) && identity.state_id !== target.state_id) errors.push(`${label}.state_id 与冻结状态不一致`);
  if (nonEmptyString(target?.layout_contract_version) && identity.layout_contract_version !== target.layout_contract_version) errors.push(`${label}.layout_contract_version 与冻结布局合同版本不一致`);

  const nodes = decomposition.layout_nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push(`${label}.layout_nodes 必须是非空数组`);
    return null;
  }
  const regionById = new Map();
  for (const [index, region] of coverageRegions.entries()) {
    if (!nonEmptyString(region.id)) continue;
    if (regionById.has(region.id)) errors.push(`coverage_audit.regions[${index}].id 重复：${region.id}`);
    regionById.set(region.id, region);
    const ids = declaredLayoutNodeIds(region);
    if (ids.length === 0 || ids.some((id) => !nonEmptyString(id))) errors.push(`coverage_audit.regions[${index}].layout_node_ids 必须是非空字符串列表`);
    if (new Set(ids).size !== ids.length) errors.push(`coverage_audit.regions[${index}].layout_node_ids 不得重复`);
  }

  const nodeById = new Map();
  const declaredByRegion = new Map();
  for (const [index, node] of nodes.entries()) {
    const nodeLabel = `${label}.layout_nodes[${index}]`;
    if (!isObject(node)) { errors.push(`${nodeLabel} 必须是对象`); continue; }
    const nodeId = node.layout_node_id;
    if (!nonEmptyString(nodeId)) { errors.push(`${nodeLabel}.layout_node_id 必须是非空字符串`); continue; }
    if (nodeById.has(nodeId)) errors.push(`${nodeLabel}.layout_node_id 重复：${nodeId}`);
    else nodeById.set(nodeId, node);
    if (!nonEmptyString(node.region_id)) errors.push(`${nodeLabel}.region_id 必须是非空字符串`);
    if (!validLayoutBounds(node.target_bounds)) errors.push(`${nodeLabel}.target_bounds 必须包含有限的 x/y 和正数 width/height`);
    if (nonEmptyString(node.scene_id) && node.scene_id !== identity.scene_id) errors.push(`${nodeLabel}.scene_id 与布局拆解身份不一致`);
    if (nonEmptyString(node.state_id) && node.state_id !== identity.state_id) errors.push(`${nodeLabel}.state_id 与布局拆解身份不一致`);
    if (nonEmptyString(node.layout_contract_version) && node.layout_contract_version !== identity.layout_contract_version) errors.push(`${nodeLabel}.layout_contract_version 与布局拆解身份不一致`);
    if (nonEmptyString(node.region_id)) {
      const nodeIds = declaredByRegion.get(node.region_id) ?? [];
      nodeIds.push(nodeId);
      declaredByRegion.set(node.region_id, nodeIds);
      const region = regionById.get(node.region_id);
      if (!region) errors.push(`${nodeLabel}.region_id 引用了不存在的 coverage region：${node.region_id}`);
      else {
        if (node.scene_id !== undefined && node.scene_id !== region.scene_id) errors.push(`${nodeLabel}.scene_id 与 coverage region 不一致`);
        if (node.state_id !== undefined && node.state_id !== region.state_id) errors.push(`${nodeLabel}.state_id 与 coverage region 不一致`);
        if (!declaredLayoutNodeIds(region).includes(nodeId)) errors.push(`${nodeLabel} 未被 coverage region.layout_node_ids 反向声明：${nodeId}`);
      }
    }
  }
  validateLayoutAnnotationBinding(data, decomposition, nodeById, label, errors);
  for (const region of coverageRegions) {
    const ids = declaredLayoutNodeIds(region);
    for (const nodeId of ids) if (!nodeById.has(nodeId)) errors.push(`coverage_audit.regions.${region.id}.layout_node_ids 引用了不存在的布局节点：${nodeId}`);
  }
  for (const [regionId, nodeIds] of declaredByRegion) {
    const region = regionById.get(regionId);
    if (region && new Set(declaredLayoutNodeIds(region)).size !== nodeIds.length) errors.push(`coverage region ${regionId} 的 layout_node_ids 与 layout_nodes 不是双向一一对应`);
  }
  for (const region of coverageRegions) if (region.id && !declaredByRegion.has(region.id)) errors.push(`coverage region ${region.id} 缺少 scene_reconstruction_contract.layout_nodes`);

  // 独立资源映射入口同样必须拦截 parent_layout_node_id 等父子几何字段缺失或伪造。
  for (const issue of validateEffectImageParentChildLayoutNodes(nodes, target?.viewport, { label, requireExecutionPlan: true })) errors.push(issue.message);

  const placementIds = new Set();
  const consumersByNode = new Map();
  const consume = (nodeId, consumerLabel) => {
    if (!nodeById.has(nodeId)) return;
    const previous = consumersByNode.get(nodeId);
    if (previous) errors.push(`布局节点 ${nodeId} 被重复消费：${previous}、${consumerLabel}`);
    else consumersByNode.set(nodeId, consumerLabel);
  };
  for (const [index, region] of coverageRegions.entries()) {
    const regionLabel = `coverage_audit.regions[${index}]`;
    const regionNodeIds = new Set(declaredLayoutNodeIds(region));
    const placements = layoutPlacements(region);
    for (const [placementIndex, placement] of placements.entries()) {
      const placementLabel = `${regionLabel}.component_inventory.placements[${placementIndex}]`;
      if (!nonEmptyString(placement.placement_id)) errors.push(`${placementLabel}.placement_id 必须是非空字符串`);
      else if (placementIds.has(placement.placement_id)) errors.push(`${placementLabel}.placement_id 重复：${placement.placement_id}`);
      else placementIds.add(placement.placement_id);
      if (!nonEmptyString(placement.layout_node_id)) { errors.push(`${placementLabel}.layout_node_id 必须是非空字符串`); continue; }
      if (!regionNodeIds.has(placement.layout_node_id)) errors.push(`${placementLabel}.layout_node_id 只能引用本 region 的 layout_node_ids：${placement.layout_node_id}`);
      consume(placement.layout_node_id, `${region.id}/${placement.placement_id}`);
    }
    const runtimeIds = runtimeLayoutNodeIds(region);
    if (runtimeIds.length > 0 && new Set(runtimeIds).size !== runtimeIds.length) errors.push(`${regionLabel}.runtime_implementation.layout_node_ids 不得重复`);
    for (const nodeId of runtimeIds) {
      if (!regionNodeIds.has(nodeId)) errors.push(`${regionLabel}.runtime_implementation.layout_node_ids 只能引用本 region 的节点：${nodeId}`);
      consume(nodeId, `${region.id}/runtime_implementation`);
    }
    if (placements.length === 0 && runtimeIds.length === 0 && regionNodeIds.size > 0) errors.push(`${regionLabel} 的布局节点没有 placement 或 runtime_implementation 消费证据`);
    for (const nodeId of regionNodeIds) if (!consumersByNode.has(nodeId)) errors.push(`${regionLabel}.layout_node_ids 存在孤立布局节点：${nodeId}`);
  }
  return { nodeById };
}

/** V4 逐布局节点复核目标 bounds、候选 bounds、几何差异和证据。 */
export function validateV4LayoutMeasurements(data, layoutBindings, errors, options = {}) {
  const mode = resolveVisualValidationMode(options, data, data?.scene_reconstruction_contract);
  const exact = mode === "exact";
  const nodes = layoutBindings?.nodeById;
  if (!(nodes instanceof Map) || nodes.size === 0) { errors.push("V4 缺少可用于逐节点几何验收的 layout_nodes"); return; }
  const cases = Array.isArray(data?.fidelity_cases) ? data.fidelity_cases : [];
  for (const [caseIndex, item] of cases.entries()) {
    const label = `fidelity_cases[${caseIndex}]`;
    const measurements = item?.layout_node_results;
    if (!Array.isArray(measurements) || measurements.length === 0) { errors.push(`${label}.layout_node_results ${exact ? "必须是非空逐节点几何差异数组" : "至少需要一个关键布局节点几何证据"}`); continue; }
    const seen = new Set();
    for (const [index, result] of measurements.entries()) {
      const resultLabel = `${label}.layout_node_results[${index}]`;
      if (!isObject(result) || !nonEmptyString(result.layout_node_id)) { errors.push(`${resultLabel}.layout_node_id 必须是非空字符串`); continue; }
      if (seen.has(result.layout_node_id)) errors.push(`${resultLabel}.layout_node_id 重复：${result.layout_node_id}`);
      seen.add(result.layout_node_id);
      const node = nodes.get(result.layout_node_id);
      if (!node) { errors.push(`${resultLabel}.layout_node_id 引用了未知布局节点：${result.layout_node_id}`); continue; }
      const targetBounds = result.target_bounds ?? result.target_measurement?.bounds;
      const candidateBounds = result.candidate_bounds ?? result.candidate_measurement?.bounds;
      if (!layoutBoundsEqual(targetBounds, node.target_bounds)) errors.push(`${resultLabel}.target_bounds 必须等于布局节点参考 target_bounds`);
      if (!validLayoutBounds(candidateBounds)) errors.push(`${resultLabel}.candidate_bounds 必须包含有限的候选几何`);
      const viewport = item?.viewport ?? data?.scene_reconstruction_contract?.target_conditions?.viewport ?? data?.scene_reconstruction_contract?.target_conditions?.target_viewport;
      const region = data?.coverage_audit?.regions?.find((item) => item?.id === node.region_id)
        ?? data?.scene_reconstruction_contract?.coverage_regions?.find((item) => (item?.region_id ?? item?.id) === node.region_id);
      const visibilitySource = { ...node, ...result, ...candidateBounds };
      if (visualBoundsOutsideViewport(candidateBounds, viewport, visibilitySource, region)) errors.push(`${resultLabel}.candidate_bounds 超出目标 viewport，存在越界或裁切`);
      if (exact && (!isObject(result.delta) || !["x", "y", "width", "height"].every((field) => Number.isFinite(result.delta[field])))) errors.push(`${resultLabel}.delta 必须逐轴记录 x/y/width/height`);
      if (!exact && result.delta != null && (!isObject(result.delta) || !["x", "y", "width", "height"].every((field) => Number.isFinite(result.delta[field])))) {
        errors.push(`${resultLabel}.delta 如提供必须逐轴记录 x/y/width/height`);
      } else if (isObject(result.delta) && validLayoutBounds(targetBounds) && validLayoutBounds(candidateBounds) && ["x", "y", "width", "height"].every((field) => Number.isFinite(result.delta[field])) && ["x", "y", "width", "height"].some((field) => result.delta[field] !== candidateBounds[field] - targetBounds[field])) {
        // 几何差异是候选测量的可重算事实，禁止手填一个与两组 bounds 不相符的 delta。
        errors.push(`${resultLabel}.delta 必须由 candidate_bounds 减 target_bounds 逐轴计算`);
      }
      if (!['passed', 'failed'].includes(result.result)) errors.push(`${resultLabel}.result 必须为 passed 或 failed`);
      validatePathList(result.evidence, `${resultLabel}.evidence`, errors);
    }
    if (exact) {
      for (const nodeId of nodes.keys()) if (!seen.has(nodeId)) errors.push(`${label}.layout_node_results 缺少布局节点：${nodeId}`);
    } else {
      const criticalIds = new Set([
        ...[...nodes.values()].filter((node) => node?.critical === true || node?.is_critical === true || node?.required === true).map((node) => node.layout_node_id).filter(nonEmptyString),
        ...(Array.isArray(item?.critical_node_ids) ? item.critical_node_ids : Array.isArray(item?.criticalNodeIds) ? item.criticalNodeIds : []).filter(nonEmptyString),
      ]);
      for (const nodeId of criticalIds) if (!seen.has(nodeId)) errors.push(`${label}.layout_node_results 缺少关键布局节点：${nodeId}`);
    }
    if (item?.conclusion === "passed" && measurements.some((result) => result?.result !== "passed")) errors.push(`${label}.conclusion=passed 与布局节点未全部通过冲突`);
  }
}
