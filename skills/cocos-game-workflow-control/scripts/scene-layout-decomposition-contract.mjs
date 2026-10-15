/**
 * effect-image 场景布局拆解与几何证据合同。
 *
 * 布局拆解必须独立于素材生产事实，保证 coverage region、layout node 和
 * 运行时 placement 能够在 V3/V4 形成确定性的双向绑定与逐节点证据。
 */

import { validateEffectImageParentChildLayoutNodes } from "./layout-node-parent-geometry.mjs";
import { resolveVisualValidationMode, visualGeometryDifferenceExceeds, visualBoundsOutsideViewport } from "./visual-validation-policy.mjs";

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 读取 snake_case/camelCase 合同字段。 */
function field(value, ...names) {
  for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name];
  return undefined;
}

/** 提取布局 binding 的统一身份视图，供双 binding 和根身份做确定性比较。 */
function layoutBindingIdentity(binding) {
  return {
    sceneId: field(binding, "scene_id", "sceneId"),
    stateId: field(binding, "state_id", "stateId"),
    baselineVersion: field(binding, "visual_baseline_version", "visualBaselineVersion"),
    layoutVersion: field(binding, "layout_contract_version", "layoutContractVersion"),
    layoutDecompositionVersion: field(binding, "layout_decomposition_version", "layoutDecompositionVersion"),
    viewport: field(binding, "viewport", "target_viewport", "targetViewport"),
  };
}

/** 判断正数尺寸对象。 */
function validSize(value) {
  return isObject(value) && Number.isInteger(value.width) && value.width > 0 && Number.isInteger(value.height) && value.height > 0;
}

/** 判断正数 viewport。 */
function validViewport(value) {
  return validSize(value) && Number.isFinite(value.width) && Number.isFinite(value.height);
}

/** 判断布局边界框是否为有限的正尺寸矩形。 */
function validLayoutBounds(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 判断结构化字段是否声明了有效内容；数组允许调用方明确声明为空。 */
function hasStructuredValue(value, { allowEmptyArray = false } = {}) {
  if (Array.isArray(value)) return allowEmptyArray || value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return nonEmptyString(value) || typeof value === "number" || typeof value === "boolean";
}

/** 判断证据字段是否提供了可复核路径或结构化身份。 */
function hasEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 生成带阶段、场景、区域和退回点的确定性布局错误。 */
function contractError(stage, contract, region, message, details = {}) {
  const target = contract?.target_conditions ?? contract?.target ?? contract?.frozen_target ?? {};
  const scene = region?.scene_id ?? region?.sceneId ?? target.scene_id ?? target.sceneId ?? "?";
  const state = region?.state_id ?? region?.stateId ?? target.state_id ?? target.stateId ?? "?";
  const annotation = region?.annotation_number ?? region?.annotationNumber ?? "*";
  const regionId = region?.region_id ?? region?.regionId ?? region?.id ?? "*";
  const missing = details.missing ? ` 缺失视觉事实=${details.missing}` : "";
  const expected = details.expected ?? "完整冻结场景合同与对应证据";
  const actual = details.actual ?? "missing";
  const returnStage = details.returnStage ?? (stage === "V1" || stage === "V2" ? "V1/PROPOSAL" : stage);
  const rootCause = details.rootCause ?? (returnStage === "V1/PROPOSAL" ? "方案缺失" : stage === "V3" ? "执行问题" : stage === "V4" || stage === "VALIDATING" ? "验收问题" : "方案缺失");
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${regionId} 根因=${rootCause} ${message}${missing} 预期证据=${expected} 实际证据=${actual} 应退回阶段=${returnStage}`;
}

/** 判断一个合同是否明确进入 effect-image 忠实还原模式。 */
export function isEffectImageContract(contract, manifest = null, options = {}) {
  return options.effectImage === true
    || options.effect_image === true
    || manifest?.effect_image_reconstruction?.applicability === "effect-image"
    || manifest?.effectImageReconstruction?.applicability === "effect-image"
    || contract?.effect_image_reconstruction?.applicability === "effect-image"
    || contract?.effectImageReconstruction?.applicability === "effect-image";
}

/** 校验布局绑定与冻结目标一致，避免布局合同只带一个孤立的 target SHA。 */
export function validateLayoutBinding(binding, targetInfo, contract, stage, errors, label, { requireViewport = true, requireBaseline = true, requireLayoutVersion = true, requireReconstructionVersion = false, requireLayoutIdentity = false } = {}) {
  if (!isObject(binding)) {
    errors.push(contractError(stage, contract, null, `${label} 必须是对象`, { missing: label, returnStage: "V1/PROPOSAL" }));
    return null;
  }
  const required = [
    [["scene_id", "sceneId"], "scene_id"],
    [["state_id", "stateId"], "state_id"],
  ];
  if (requireBaseline) required.push([["visual_baseline_version", "visualBaselineVersion"], "visual_baseline_version"]);
  if (requireViewport) required.push([["viewport", "target_viewport", "targetViewport"], "viewport"]);
  if (requireLayoutVersion) required.push([["layout_contract_version", "layoutContractVersion"], "layout_contract_version"]);
  if (requireReconstructionVersion) required.push([["reconstruction_contract_version", "reconstructionContractVersion", "contract_version", "contractVersion"], "reconstruction_contract_version"]);
  if (requireLayoutIdentity) {
    required.push([["layout_decomposition_version", "layoutDecompositionVersion"], "layout_decomposition_version"]);
  }
  for (const [names, text] of required) {
    const value = field(binding, ...names);
    const valid = text === "viewport" ? validViewport(value) : nonEmptyString(value);
    if (!valid) errors.push(contractError(stage, contract, binding, `${label} 缺少 ${text}`, { missing: `${label}.${text}`, returnStage: "V1/PROPOSAL" }));
  }
  const bindingSceneId = field(binding, "scene_id", "sceneId");
  if (targetInfo?.sceneId && bindingSceneId !== targetInfo.sceneId) errors.push(contractError(stage, contract, binding, `${label} scene_id 与冻结目标不一致`, { expected: targetInfo.sceneId, actual: bindingSceneId, returnStage: "V1/PROPOSAL" }));
  const bindingStateId = field(binding, "state_id", "stateId");
  if (targetInfo?.stateId && bindingStateId !== targetInfo.stateId) errors.push(contractError(stage, contract, binding, `${label} state_id 与冻结目标不一致`, { expected: targetInfo.stateId, actual: bindingStateId, returnStage: "V1/PROPOSAL" }));
  const bindingViewport = field(binding, "viewport", "target_viewport", "targetViewport");
  if (bindingViewport !== undefined && !validViewport(bindingViewport)) errors.push(contractError(stage, contract, binding, `${label} viewport 无效`, { expected: "正数 viewport", actual: JSON.stringify(bindingViewport), returnStage: "V1/PROPOSAL" }));
  if (targetInfo?.viewport && validViewport(bindingViewport) && (bindingViewport.width !== targetInfo.viewport.width || bindingViewport.height !== targetInfo.viewport.height)) {
    errors.push(contractError(stage, contract, binding, `${label} viewport 与冻结目标不一致`, { expected: `${targetInfo.viewport.width}x${targetInfo.viewport.height}`, actual: `${bindingViewport.width}x${bindingViewport.height}`, returnStage: "V1/PROPOSAL" }));
  }
  const bindingBaseline = field(binding, "visual_baseline_version", "visualBaselineVersion");
  if (targetInfo?.baselineVersion && bindingBaseline !== undefined && bindingBaseline !== targetInfo.baselineVersion) errors.push(contractError(stage, contract, binding, `${label} visual baseline version 与冻结目标不一致`, { expected: targetInfo.baselineVersion, actual: bindingBaseline, returnStage: "V1/PROPOSAL" }));
  const bindingLayoutVersion = field(binding, "layout_contract_version", "layoutContractVersion");
  if (targetInfo?.layoutVersion && bindingLayoutVersion !== targetInfo.layoutVersion) errors.push(contractError(stage, contract, binding, `${label} layout contract version 与冻结目标不一致`, { expected: targetInfo.layoutVersion, actual: bindingLayoutVersion, returnStage: "V1/PROPOSAL" }));
  const bindingLayoutDecompositionVersion = field(binding, "layout_decomposition_version", "layoutDecompositionVersion");
  if (targetInfo?.layoutDecompositionVersion && bindingLayoutDecompositionVersion !== targetInfo.layoutDecompositionVersion) errors.push(contractError(stage, contract, binding, `${label} layout_decomposition_version 与冻结目标不一致`, { expected: targetInfo.layoutDecompositionVersion, actual: bindingLayoutDecompositionVersion, returnStage: "V1/PROPOSAL" }));
  return layoutBindingIdentity(binding);
}

/** 校验两个 effect-image 布局 binding 的完整身份一致，禁止同一场景出现漂移。 */
export function validateLayoutBindingConsistency(firstBinding, secondBinding, contract, stage, errors, firstLabel = "responsive_contract layout binding", secondLabel = "layout_decomposition binding", effectImage = false) {
  if (!effectImage || !isObject(firstBinding) || !isObject(secondBinding)) return;
  const first = layoutBindingIdentity(firstBinding);
  const second = layoutBindingIdentity(secondBinding);
  for (const [key, text] of [
    ["sceneId", "scene_id"],
    ["stateId", "state_id"],
    ["baselineVersion", "visual_baseline_version"],
    ["layoutVersion", "layout_contract_version"],
    ["layoutDecompositionVersion", "layout_decomposition_version"],
  ]) {
    if (first[key] !== undefined && second[key] !== undefined && first[key] !== second[key]) errors.push(contractError(stage, contract, secondBinding, `${firstLabel} 与 ${secondLabel} 的 ${text} 不一致`, { expected: String(first[key]), actual: String(second[key]), returnStage: "V1/PROPOSAL" }));
  }
  if (validViewport(first.viewport) && validViewport(second.viewport) && (first.viewport.width !== second.viewport.width || first.viewport.height !== second.viewport.height)) {
    errors.push(contractError(stage, contract, secondBinding, `${firstLabel} 与 ${secondLabel} 的 target viewport 不一致`, { expected: `${first.viewport.width}x${first.viewport.height}`, actual: `${second.viewport.width}x${second.viewport.height}`, returnStage: "V1/PROPOSAL" }));
  }
}

/** 校验 scene contract 根部已有的布局身份，避免形成 responsive/layout 之外的第三份漂移。 */
export function validateRootLayoutIdentity(contract, targetInfo, responsiveBinding, decompositionBinding, stage, errors, effectImage = false) {
  if (!effectImage || !isObject(contract)) return;
  const candidates = [];
  for (const [names, label] of [
    [["layout_identity", "layoutIdentity"], "scene contract root layout identity"],
    [["scene_layout_identity", "sceneLayoutIdentity"], "scene contract root scene layout identity"],
    [["layout_contract_identity", "layoutContractIdentity"], "scene contract root layout contract identity"],
    [["layout_contract_binding", "layoutContractBinding"], "scene contract root layout binding"],
    [["scene_reconstruction_binding", "sceneReconstructionBinding"], "scene contract root scene reconstruction binding"],
    [["layout_binding", "layoutBinding"], "scene contract root layout binding"],
  ]) {
    const value = field(contract, ...names);
    if (value !== undefined) candidates.push({ value, label });
  }
  const directIdentityNames = [
    "scene_id", "sceneId", "state_id", "stateId",
    "visual_baseline_version", "visualBaselineVersion", "layout_contract_version", "layoutContractVersion",
    "layout_decomposition_version", "layoutDecompositionVersion",
    "viewport", "target_viewport", "targetViewport",
  ];
  if (directIdentityNames.some((name) => contract[name] !== undefined && contract[name] !== null)) candidates.push({ value: contract, label: "scene contract root layout identity" });
  for (const { value, label } of candidates) {
    validateLayoutBinding(value, targetInfo, contract, stage, errors, label, { requireViewport: true, requireBaseline: true, requireLayoutVersion: true, requireLayoutIdentity: true });
    validateLayoutBindingConsistency(value, responsiveBinding, contract, stage, errors, label, "responsive_contract layout binding", true);
    validateLayoutBindingConsistency(value, decompositionBinding, contract, stage, errors, label, "layout_decomposition binding", true);
  }
}

/** 校验单个布局节点的几何事实和运行时布局策略。 */
export function validateLayoutNode(node, contract, targetInfo, stage, errors, index, requireIdentity = false) {
  const label = `layout_nodes[${index}]`;
  if (!isObject(node)) {
    errors.push(contractError(stage, contract, node, `${label} 必须是对象`, { missing: label, returnStage: "V1/PROPOSAL" }));
    return;
  }
  const required = [
    [["layout_node_id", "layoutNodeId"], "layout_node_id"],
    [["region_id", "regionId"], "region_id"],
    [["coordinate_space", "coordinateSpace"], "coordinate_space"],
    [["reference_id", "referenceId"], "reference_id"],
    [["self_anchor", "selfAnchor"], "self_anchor"],
    [["reference_anchor", "referenceAnchor"], "reference_anchor"],
    [["offset"], "offset"],
    [["target_bounds", "targetBounds", "bounds"], "target_bounds"],
    [["size_policy", "sizePolicy"], "size_policy"],
    [["z_order", "zOrder"], "z_order"],
    [["clip_policy", "clipPolicy"], "clip_policy"],
    [["responsive_rule", "responsiveRule"], "responsive_rule"],
  ];
  if (requireIdentity) required.push(
    [["scene_id", "sceneId"], "scene_id"],
    [["state_id", "stateId"], "state_id"],
    [["layout_contract_version", "layoutContractVersion"], "layout_contract_version"],
  );
  for (const [names, text] of required) {
    const value = field(node, ...names);
    const valid = text === "offset"
      ? isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
      : text === "target_bounds"
        ? validLayoutBounds(value)
        : text === "z_order"
          ? Number.isFinite(value)
          : ["layout_node_id", "region_id", "coordinate_space", "reference_id"].includes(text)
            ? nonEmptyString(value)
          : hasStructuredValue(value);
    if (!valid) errors.push(contractError(stage, contract, node, `${label} 缺少或无效 ${text}`, { missing: `layout_nodes[${index}].${text}`, returnStage: "V1/PROPOSAL" }));
  }
  const nodeSceneId = field(node, "scene_id", "sceneId");
  if (nodeSceneId !== undefined && targetInfo?.sceneId && nodeSceneId !== targetInfo.sceneId) errors.push(contractError(stage, contract, node, `${label} scene_id 与冻结目标不一致`, { expected: targetInfo.sceneId, actual: nodeSceneId, returnStage: "V1/PROPOSAL" }));
  const nodeStateId = field(node, "state_id", "stateId");
  if (nodeStateId !== undefined && targetInfo?.stateId && nodeStateId !== targetInfo.stateId) errors.push(contractError(stage, contract, node, `${label} state_id 与冻结目标不一致`, { expected: targetInfo.stateId, actual: nodeStateId, returnStage: "V1/PROPOSAL" }));
  const nodeLayoutVersion = field(node, "layout_contract_version", "layoutContractVersion");
  if (nodeLayoutVersion !== undefined && targetInfo?.layoutVersion && nodeLayoutVersion !== targetInfo.layoutVersion) errors.push(contractError(stage, contract, node, `${label} layout contract version 与冻结目标不一致`, { expected: targetInfo.layoutVersion, actual: nodeLayoutVersion, returnStage: "V1/PROPOSAL" }));
  const bounds = field(node, "target_bounds", "targetBounds", "bounds");
  const coordinateSpace = String(field(node, "coordinate_space", "coordinateSpace") ?? "").toLowerCase();
  // viewport/screen 节点使用逻辑目标视口校验，世界节点才回退到效果图原始画布。
  const canvas = /viewport|screen|logical/.test(coordinateSpace)
    ? targetInfo?.viewport ?? targetInfo?.size
    : targetInfo?.size ?? targetInfo?.viewport;
  if (validLayoutBounds(bounds) && validSize(canvas)) {
    const inside = bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= canvas.width && bounds.y + bounds.height <= canvas.height;
    if (!inside) errors.push(contractError(stage, contract, node, `${label} target_bounds 必须位于冻结目标画布内`, { expected: `0<=x,y 且 right<=${canvas.width}, bottom<=${canvas.height}`, actual: JSON.stringify(bounds), returnStage: "V1/PROPOSAL" }));
  }
}

/** 校验 effect-image 的布局分解、节点身份和布局合同绑定。 */
export function validateLayoutDecomposition(contract, targetInfo, stage, errors, effectImage = false, options = {}) {
  if (!effectImage) return { decomposition: null, nodes: [], nodeById: new Map(), binding: null };
  const decomposition = field(contract, "layout_decomposition", "layoutDecomposition", "layout_decomposition_contract", "layoutDecompositionContract");
  if (options.requireLayout === false) {
    // V2/V3 不执行最终几何验收，但文本等合同仍需按 ID 引用冻结的 V2 节点源。
    const sourceNodes = isObject(decomposition) ? field(decomposition, "layout_nodes", "layoutNodes") : undefined;
    const nodes = Array.isArray(sourceNodes) ? sourceNodes : [];
    const nodeById = new Map();
    for (const [index, node] of nodes.entries()) {
      const nodeId = field(node, "layout_node_id", "layoutNodeId");
      if (!isObject(node) || !nonEmptyString(nodeId)) {
        errors.push(contractError(stage, contract, node, `V2 layout_nodes[${index}] 必须包含 layout_node_id`, { missing: `layout_nodes[${index}].layout_node_id`, returnStage: "V1/PROPOSAL" }));
      } else if (nodeById.has(nodeId)) {
        errors.push(contractError(stage, contract, node, "V2 layout_node_id 重复", { actual: nodeId, returnStage: "V1/PROPOSAL" }));
      } else nodeById.set(nodeId, node);
    }
    return { decomposition, nodes, nodeById, binding: null };
  }
  if (!isObject(decomposition)) {
    errors.push(contractError(stage, contract, null, "effect-image 缺少 layout_decomposition", { missing: "layout_decomposition", returnStage: "V1/PROPOSAL" }));
    return { decomposition: null, nodes: [], nodeById: new Map(), binding: null };
  }
  const nodes = field(decomposition, "layout_nodes", "layoutNodes");
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push(contractError(stage, contract, decomposition, "layout_decomposition.layout_nodes 必须是非空数组", { missing: "layout_nodes", returnStage: "V1/PROPOSAL" }));
    return { decomposition, nodes: [], nodeById: new Map(), binding: null };
  }
  const explicitBinding = field(decomposition, "layout_binding", "layoutBinding", "layout_contract_binding", "layoutContractBinding", "scene_reconstruction_binding", "sceneReconstructionBinding", "binding");
  // effect-image 的两种身份形态都必须包含完整绑定；直接结构只是字段位置不同，不能降低身份门槛。
  const binding = explicitBinding ?? decomposition;
  validateLayoutBinding(binding, targetInfo, contract, stage, errors, "layout_decomposition binding", { requireViewport: true, requireBaseline: true, requireLayoutVersion: true, requireLayoutIdentity: true });
  const nodeById = new Map();
  for (const [index, node] of nodes.entries()) {
    validateLayoutNode(node, contract, targetInfo, stage, errors, index, !explicitBinding);
    const nodeId = field(node, "layout_node_id", "layoutNodeId");
    if (!nonEmptyString(nodeId)) continue;
    if (nodeById.has(nodeId)) errors.push(contractError(stage, contract, node, "layout_node_id 重复", { actual: nodeId, returnStage: "V1/PROPOSAL" }));
    else nodeById.set(nodeId, node);
  }
  // effect-image 的父容器、相对测量和显式视觉对齐统一由共享几何合同校验。
  for (const issue of validateEffectImageParentChildLayoutNodes(nodes, targetInfo?.viewport, { label: "layout_nodes" })) {
    const node = issue.index >= 0 ? nodes[issue.index] : decomposition;
    errors.push(contractError(stage, contract, node, issue.message, { returnStage: "V1/PROPOSAL" }));
  }
  return { decomposition, nodes, nodeById, binding };
}

/** 校验 coverage region 与 layout node 的双向完整绑定。 */
export function validateLayoutRegionBindings(regions, layoutInfo, contract, stage, errors, effectImage = false) {
  if (!effectImage || !Array.isArray(regions) || layoutInfo.nodes.length === 0) return;
  const regionById = new Map(regions.map((region) => [field(region, "region_id", "regionId", "id"), region]));
  const assigned = new Map();
  for (const region of regions) {
    const regionId = field(region, "region_id", "regionId", "id");
    const ids = field(region, "layout_node_ids", "layoutNodeIds");
    if (!Array.isArray(ids)) continue;
    for (const nodeId of ids) {
      if (assigned.has(nodeId) && assigned.get(nodeId) !== regionId) errors.push(contractError(stage, contract, region, "layout_node_id 跨 region 重复绑定", { actual: `${nodeId}=${assigned.get(nodeId)},${regionId}`, returnStage: "V1/PROPOSAL" }));
      else assigned.set(nodeId, regionId);
      if (!layoutInfo.nodeById.has(nodeId)) errors.push(contractError(stage, contract, region, "coverage region layout_node_ids 存在孤立引用", { missing: nodeId, returnStage: "V1/PROPOSAL" }));
    }
  }
  for (const [nodeId, node] of layoutInfo.nodeById.entries()) {
    const nodeRegionId = field(node, "region_id", "regionId");
    const region = regionById.get(nodeRegionId);
    if (!region) {
      errors.push(contractError(stage, contract, node, "layout node region_id 未对应 coverage region", { missing: nodeRegionId, returnStage: "V1/PROPOSAL" }));
      continue;
    }
    const ids = field(region, "layout_node_ids", "layoutNodeIds") ?? [];
    if (!ids.includes(nodeId)) errors.push(contractError(stage, contract, node, "layout node 未被对应 coverage region layout_node_ids 反向声明", { missing: nodeId, returnStage: "V1/PROPOSAL" }));
    if (assigned.get(nodeId) && assigned.get(nodeId) !== nodeRegionId) errors.push(contractError(stage, contract, node, "layout node 与 coverage region 跨 region 错绑", { expected: nodeRegionId, actual: assigned.get(nodeId), returnStage: "V1/PROPOSAL" }));
    const nodeSceneId = field(node, "scene_id", "sceneId");
    const regionSceneId = field(region, "scene_id", "sceneId");
    if (nodeSceneId !== undefined && regionSceneId !== undefined && nodeSceneId !== regionSceneId) errors.push(contractError(stage, contract, node, "layout node scene_id 与 coverage region 不一致", { expected: regionSceneId, actual: nodeSceneId, returnStage: "V1/PROPOSAL" }));
    const nodeStateId = field(node, "state_id", "stateId");
    const regionStateId = field(region, "state_id", "stateId");
    if (nodeStateId !== undefined && regionStateId !== undefined && nodeStateId !== regionStateId) errors.push(contractError(stage, contract, node, "layout node state_id 与 coverage region 不一致", { expected: regionStateId, actual: nodeStateId, returnStage: "V1/PROPOSAL" }));
  }
  for (const region of regions) {
    const ids = field(region, "layout_node_ids", "layoutNodeIds") ?? [];
    for (const nodeId of ids) if (!layoutInfo.nodeById.has(nodeId)) continue;
    const nodeIdsForRegion = new Set(layoutInfo.nodes.filter((node) => field(node, "region_id", "regionId") === field(region, "region_id", "regionId", "id")).map((node) => field(node, "layout_node_id", "layoutNodeId")));
    for (const nodeId of nodeIdsForRegion) if (!ids.includes(nodeId)) errors.push(contractError(stage, contract, region, "coverage region 缺少对应 layout node 引用", { missing: nodeId, returnStage: "V1/PROPOSAL" }));
    const orderedNodeIdsForRegion = layoutInfo.nodes.filter((node) => field(node, "region_id", "regionId") === field(region, "region_id", "regionId", "id")).map((node) => field(node, "layout_node_id", "layoutNodeId"));
    if (JSON.stringify(ids) !== JSON.stringify(orderedNodeIdsForRegion)) errors.push(contractError(stage, contract, region, "coverage region layout_node_ids 必须按已确认拆解元素原顺序绑定", { expected: JSON.stringify(orderedNodeIdsForRegion), actual: JSON.stringify(ids), returnStage: "V1/PROPOSAL" }));
  }
}

/** 提取预声明容差中的数值规则；布局合同不提供跨项目默认阈值。 */
function toleranceLimit(definition) {
  if (!isObject(definition)) return null;
  const values = [];
  const visit = (value) => {
    if (isObject(value)) for (const [key, nested] of Object.entries(value)) {
      if (key === "value" && typeof nested === "number" && Number.isFinite(nested) && nested >= 0) values.push(nested);
      else visit(nested);
    }
  };
  visit(definition);
  return values.length ? Math.max(...values) : null;
}

/** 收集 delta 中的数值差异。 */
function numericDeltas(value, result = []) {
  if (typeof value === "number" && Number.isFinite(value)) result.push(Math.abs(value));
  else if (isObject(value)) for (const nested of Object.values(value)) numericDeltas(nested, result);
  else if (Array.isArray(value)) for (const nested of value) numericDeltas(nested, result);
  return result;
}

/** 从目标和候选测量本身推导数值差异，避免伪造 delta=0。 */
function numericFactDeltas(targetValue, candidateValue, result = []) {
  if (typeof targetValue === "number" && typeof candidateValue === "number" && Number.isFinite(targetValue) && Number.isFinite(candidateValue)) result.push(Math.abs(candidateValue - targetValue));
  else if (Array.isArray(targetValue) && Array.isArray(candidateValue)) for (let index = 0; index < Math.max(targetValue.length, candidateValue.length); index += 1) numericFactDeltas(targetValue[index], candidateValue[index], result);
  else if (isObject(targetValue) && isObject(candidateValue)) for (const key of new Set([...Object.keys(targetValue), ...Object.keys(candidateValue)])) numericFactDeltas(targetValue[key], candidateValue[key], result);
  return result;
}

/** 判断布局目标事实是否发生结构化差异。 */
function factsDiffer(targetValue, candidateValue) {
  if (targetValue === undefined || candidateValue === undefined) return false;
  try { return JSON.stringify(targetValue) !== JSON.stringify(candidateValue); } catch { return String(targetValue) !== String(candidateValue); }
}

/** 校验 V4 effect-image 布局几何预验收，确保正式 Scene 的每个节点都被实际测量。 */
export function validateLayoutGeometryFacts(contract, preacceptance, stage, errors, layoutInfo, options = {}) {
  const mode = resolveVisualValidationMode(options, contract);
  const exact = mode === "exact";
  const geometry = field(preacceptance, "layout_geometry", "layoutGeometry", "layout_geometry_check", "layoutGeometryCheck");
  if (!isObject(geometry)) {
    if (exact) errors.push(contractError(stage, contract, preacceptance, "V4 同屏组合缺少 layout_geometry 几何检查", { missing: "layout_geometry", returnStage: "V3/V4", rootCause: "执行问题" }));
    return;
  }
  const formalLayout = field(geometry, "formal_layout_structure", "formalLayoutStructure", "formal_layout", "formalLayout", "structure", "formal_structure")
    ?? field(preacceptance, "formal_layout_structure", "formalLayoutStructure", "formal_layout", "formalLayout", "layout_structure", "layoutStructure");
  if (exact && !hasStructuredValue(formalLayout)) errors.push(contractError(stage, contract, geometry, "V4 layout_geometry 缺少正式布局结构", { missing: "layout_geometry.formal_layout_structure", returnStage: "V3/V4", rootCause: "执行问题" }));
  const measurements = field(geometry, "node_measurements", "nodeMeasurements", "actual_measurements", "actualMeasurements", "layout_node_measurements", "layoutNodeMeasurements", "measurements");
  if (!Array.isArray(measurements) || measurements.length === 0) {
    if (exact) errors.push(contractError(stage, contract, geometry, "V4 layout_geometry 缺少所有节点实际测量", { missing: "layout_geometry.node_measurements", returnStage: "V3/V4", rootCause: "执行问题" }));
    else errors.push(contractError(stage, contract, geometry, "V4 layout_geometry 至少需要一个关键 layout node 实际测量", { missing: "layout_geometry.node_measurements", returnStage: "V3/V4", rootCause: "验收问题" }));
    return;
  }
  const expectedIds = new Set(layoutInfo.nodes.map((node) => field(node, "layout_node_id", "layoutNodeId")).filter(nonEmptyString));
  const criticalIds = new Set([
    ...layoutInfo.nodes.filter((node) => node?.critical === true || node?.is_critical === true || node?.required === true).map((node) => field(node, "layout_node_id", "layoutNodeId")).filter(nonEmptyString),
    ...(Array.isArray(geometry.critical_node_ids) ? geometry.critical_node_ids : Array.isArray(geometry.criticalNodeIds) ? geometry.criticalNodeIds : []).filter(nonEmptyString),
  ]);
  const seenIds = new Set();
  const sceneRegions = new Map((field(contract, "coverage_regions", "coverageRegions", "regions") ?? []).map((region) => [field(region, "region_id", "regionId", "id"), region]));
  const tolerances = field(contract, "predeclared_tolerances", "predeclaredTolerances", "tolerance_set", "toleranceSet", "tolerances");
  const toleranceDefinitions = new Map((Array.isArray(tolerances) ? tolerances : []).filter(isObject).map((item) => [field(item, "id", "tolerance_id", "toleranceId"), item]).filter(([id]) => nonEmptyString(id)));
  for (const key of ["missing_node_ids", "missingNodeIds", "extra_node_ids", "extraNodeIds", "orphan_node_ids", "orphanNodeIds"]) {
    const value = geometry[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((id) => !nonEmptyString(id)))) errors.push(contractError(stage, contract, geometry, `V4 layout_geometry.${key} 必须是字符串数组`, { actual: JSON.stringify(value), returnStage: "V3/V4", rootCause: "执行问题" }));
    if (exact && Array.isArray(value) && value.length > 0) errors.push(contractError(stage, contract, geometry, `V4 layout_geometry 存在 ${key}，不能有 missing/extra/orphan`, { actual: JSON.stringify(value), returnStage: "V3/V4", rootCause: "执行问题" }));
  }
  for (const [index, measurement] of measurements.entries()) {
    const label = `layout_geometry.node_measurements[${index}]`;
    if (!isObject(measurement)) {
      errors.push(contractError(stage, contract, measurement, `${label} 必须是对象`, { missing: label, returnStage: "V3/V4", rootCause: "执行问题" }));
      continue;
    }
    const nodeId = field(measurement, "layout_node_id", "layoutNodeId", "node_id", "nodeId");
    const node = layoutInfo.nodeById.get(nodeId);
    if (!nonEmptyString(nodeId)) errors.push(contractError(stage, contract, measurement, `${label} 缺少 layout_node_id`, { missing: `${label}.layout_node_id`, returnStage: "V3/V4", rootCause: "执行问题" }));
    else if (seenIds.has(nodeId)) errors.push(contractError(stage, contract, measurement, `${label} layout_node_id 重复`, { actual: nodeId, returnStage: "V3/V4", rootCause: "执行问题" }));
    else seenIds.add(nodeId);
    if (!node) errors.push(contractError(stage, contract, measurement, `${label} 引用 extra/orphan layout_node_id`, { actual: nodeId, returnStage: "V3/V4", rootCause: "执行问题" }));
    const targetBounds = field(measurement, "target_bounds", "targetBounds", "target_measurement", "targetMeasurement") ?? field(node, "target_bounds", "targetBounds", "bounds");
    const actualBounds = field(measurement, "actual_bounds", "actualBounds", "candidate_bounds", "candidateBounds", "runtime_bounds", "runtimeBounds", "candidate_measurement", "candidateMeasurement", "measurement");
    const delta = field(measurement, "delta", "delta_measurement", "deltaMeasurement");
    const toleranceId = field(measurement, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
    const result = String(field(measurement, "result", "status", "verdict") ?? "").toLowerCase();
    const regionId = field(node, "region_id", "regionId");
    const sceneRegion = sceneRegions.get(regionId);
    if (!validLayoutBounds(targetBounds)) errors.push(contractError(stage, contract, measurement, `${label} 缺少有效 target_bounds`, { missing: `${label}.target_bounds`, returnStage: "V3/V4", rootCause: "执行问题" }));
    if (!validLayoutBounds(actualBounds)) errors.push(contractError(stage, contract, measurement, `${label} 缺少有效 actual/candidate bounds`, { missing: `${label}.actual_bounds`, returnStage: "V3/V4", rootCause: "执行问题" }));
    const targetViewport = field(field(contract, "target_conditions", "targetConditions") ?? {}, "viewport", "target_viewport", "targetViewport");
    const visibilitySource = { ...node, ...measurement, ...actualBounds };
    if (visualBoundsOutsideViewport(actualBounds, targetViewport, visibilitySource, sceneRegion)) {
      errors.push(contractError(stage, contract, measurement, `${label} actual/candidate bounds 超出目标 viewport，存在越界或裁切`, { expected: `0<=x,y 且 right<=${targetViewport.width}, bottom<=${targetViewport.height}`, actual: JSON.stringify(actualBounds), returnStage: "V3/V4", rootCause: "验收问题" }));
    }
    if (exact && !hasStructuredValue(delta)) errors.push(contractError(stage, contract, measurement, `${label} 缺少 delta`, { missing: `${label}.delta`, returnStage: "V3/V4", rootCause: "执行问题" }));
    if (exact && (!nonEmptyString(toleranceId) || !toleranceDefinitions.has(toleranceId))) errors.push(contractError(stage, contract, measurement, `${label} 必须引用预声明 tolerance ID`, { missing: `${label}.tolerance_reference`, expected: [...toleranceDefinitions.keys()].join(",") || "predeclared_tolerances", returnStage: "V3/V4", rootCause: "方案缺失" }));
    const regionToleranceId = field(sceneRegion, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
    if (exact && regionToleranceId && toleranceId !== regionToleranceId) errors.push(contractError(stage, contract, measurement, `${label} tolerance 必须引用对应 coverage region 的预声明 ID`, { expected: regionToleranceId, actual: toleranceId, returnStage: "V3/V4", rootCause: "方案缺失" }));
    if (!["passed", "pass", "failed", "fail"].includes(result)) errors.push(contractError(stage, contract, measurement, `${label} result 不能为 unknown/unverified/missing`, { actual: result || "missing", returnStage: "V3/V4", rootCause: "执行问题" }));
    if (!hasEvidence(field(measurement, "evidence", "evidence_paths", "evidencePaths"))) errors.push(contractError(stage, contract, measurement, `${label} 缺少几何 evidence`, { missing: `${label}.evidence`, returnStage: "V3/V4", rootCause: "执行问题" }));
    const limit = toleranceDefinitions.has(toleranceId) ? toleranceLimit(toleranceDefinitions.get(toleranceId)) : null;
    const exceeds = exact
      ? limit !== null && [...numericDeltas(delta), ...numericFactDeltas(targetBounds, actualBounds)].some((value) => value > limit)
      : visualGeometryDifferenceExceeds(targetBounds, actualBounds, delta, { mode, declaredLimit: limit });
    if (exceeds) errors.push(contractError(stage, contract, measurement, exact ? `${label} 几何结果超出预声明 tolerance` : `${label} 几何偏差超过 usability 允许范围`, { expected: exact ? `<=${limit}` : "小于等于有限 usability 几何容差", actual: JSON.stringify(delta), returnStage: "V3/V4", rootCause: "验收问题" }));
    if ((result === "passed" || result === "pass") && exceeds) errors.push(contractError(stage, contract, measurement, exact ? `${label} PASS 不能掩盖超容差几何差异` : `${label} PASS 不能掩盖明显几何偏差`, { returnStage: "V3/V4", rootCause: "验收问题" }));
  }
  if (exact) {
    for (const nodeId of expectedIds) if (!seenIds.has(nodeId)) errors.push(contractError(stage, contract, { id: nodeId }, "V4 layout_geometry 缺少 layout node 实际测量", { missing: nodeId, returnStage: "V3/V4", rootCause: "执行问题" }));
    for (const nodeId of seenIds) if (!expectedIds.has(nodeId)) errors.push(contractError(stage, contract, { id: nodeId }, "V4 layout_geometry 存在 extra/orphan 实际测量", { actual: nodeId, returnStage: "V3/V4", rootCause: "执行问题" }));
  } else for (const nodeId of criticalIds) if (!seenIds.has(nodeId)) errors.push(contractError(stage, contract, { id: nodeId }, "V4 layout_geometry 缺少关键 layout node 实际测量", { missing: nodeId, returnStage: "V3/V4", rootCause: "验收问题" }));
  const geometryResult = String(field(geometry, "result", "status", "verdict", "conclusion", "geometry_result", "geometryResult") ?? "").toLowerCase();
  if ((exact && !["passed", "pass"].includes(geometryResult)) || (!exact && ["failed", "fail"].includes(geometryResult))) errors.push(contractError(stage, contract, geometry, "V4 layout_geometry 几何结果未通过", { actual: geometryResult || "missing", returnStage: "V3/V4", rootCause: "验收问题" }));
  const failedMeasurements = measurements.filter((measurement) => !["passed", "pass"].includes(String(field(measurement, "result", "status", "verdict") ?? "").toLowerCase()));
  if (["passed", "pass"].includes(geometryResult) && failedMeasurements.length > 0) errors.push(contractError(stage, contract, geometry, "V4 layout_geometry=passed 与节点几何结果失败冲突", { actual: `${failedMeasurements.length} 个节点未通过`, returnStage: "V3/V4", rootCause: "验收问题" }));
}

/** 校验 effect-image V4 每个布局节点的目标/候选边界、差异和证据。 */
export function validateEffectImageLayoutNodeFidelity(item, sceneContract, stage, errors, toleranceDefinitions, sceneRegions, options = {}) {
  const mode = resolveVisualValidationMode(options, sceneContract);
  const exact = mode === "exact";
  const label = "layout_node_results";
  const decomposition = field(sceneContract, "layout_decomposition", "layoutDecomposition", "layout_decomposition_contract", "layoutDecompositionContract");
  const nodes = isObject(decomposition) && Array.isArray(field(decomposition, "layout_nodes", "layoutNodes")) ? field(decomposition, "layout_nodes", "layoutNodes") : [];
  const nodeById = new Map(nodes.map((node) => [field(node, "layout_node_id", "layoutNodeId"), node]).filter(([id]) => nonEmptyString(id)));
  if (nodeById.size === 0) {
    errors.push(contractError(stage, item, item, "effect-image fidelity case 缺少 layout_decomposition.layout_nodes，不能生成逐节点布局证据", { missing: "layout_nodes", returnStage: "VALIDATING", rootCause: "方案缺失" }));
    return;
  }
  const results = field(item, "layout_node_results", "layoutNodeResults", "per_layout_node_results", "perLayoutNodeResults", "layout_geometry_results", "layoutGeometryResults", "layout_node_diff_results", "layoutNodeDiffResults");
  if (!Array.isArray(results) || results.length === 0) {
    errors.push(contractError(stage, item, item, exact ? `effect-image ${label} 必须是非空逐节点布局差异证据` : `effect-image ${label} 至少需要一个关键布局节点证据`, { missing: label, returnStage: "VALIDATING", rootCause: "验收问题" }));
    return;
  }
  for (const key of ["missing_node_ids", "missingNodeIds", "extra_node_ids", "extraNodeIds", "orphan_node_ids", "orphanNodeIds"]) {
    const value = item[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((id) => !nonEmptyString(id)))) errors.push(contractError(stage, item, item, `effect-image ${label}.${key} 必须是字符串数组`, { actual: JSON.stringify(value), returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (exact && Array.isArray(value) && value.length > 0) errors.push(contractError(stage, item, item, `effect-image ${label} 存在 ${key}`, { actual: JSON.stringify(value), returnStage: "VALIDATING", rootCause: "验收问题" }));
  }
  const seen = new Set();
  for (const [index, result] of results.entries()) {
    const resultLabel = `${label}[${index}]`;
    if (!isObject(result)) {
      errors.push(contractError(stage, item, item, `${resultLabel} 必须是对象`, { missing: resultLabel, returnStage: "VALIDATING", rootCause: "验收问题" }));
      continue;
    }
    const nodeId = field(result, "layout_node_id", "layoutNodeId", "node_id", "nodeId");
    const node = nodeById.get(nodeId);
    if (!nonEmptyString(nodeId)) errors.push(contractError(stage, item, result, `${resultLabel} 缺少 layout_node_id`, { missing: `${resultLabel}.layout_node_id`, returnStage: "VALIDATING", rootCause: "验收问题" }));
    else if (seen.has(nodeId)) errors.push(contractError(stage, item, result, `${resultLabel} layout_node_id 重复`, { actual: nodeId, returnStage: "VALIDATING", rootCause: "验收问题" }));
    else seen.add(nodeId);
    if (!node) errors.push(contractError(stage, item, result, `${resultLabel} 引用 extra/orphan layout_node_id`, { actual: nodeId, returnStage: "VALIDATING", rootCause: "验收问题" }));
    const targetBounds = field(result, "target_bounds", "targetBounds", "target_measurement", "targetMeasurement");
    const candidateBounds = field(result, "candidate_bounds", "candidateBounds", "actual_bounds", "actualBounds", "runtime_bounds", "runtimeBounds", "candidate_measurement", "candidateMeasurement");
    const delta = field(result, "delta", "delta_measurement", "deltaMeasurement");
    const toleranceId = field(result, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
    const resultValue = String(field(result, "result", "status", "verdict") ?? "").toLowerCase();
    const regionId = field(node, "region_id", "regionId");
    const sceneRegion = sceneRegions?.get?.(regionId);
    if (!validLayoutBounds(targetBounds)) errors.push(contractError(stage, item, result, `${resultLabel} 缺少有效 target bounds`, { missing: `${resultLabel}.target_bounds`, returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (!validLayoutBounds(candidateBounds)) errors.push(contractError(stage, item, result, `${resultLabel} 缺少有效 candidate bounds`, { missing: `${resultLabel}.candidate_bounds`, returnStage: "VALIDATING", rootCause: "验收问题" }));
    const caseViewport = field(item, "viewport", "target_viewport", "targetViewport");
    const targetViewport = validViewport(caseViewport) ? caseViewport : field(field(sceneContract, "target_conditions", "targetConditions") ?? {}, "viewport", "target_viewport", "targetViewport");
    const visibilitySource = { ...node, ...result, ...candidateBounds };
    if (visualBoundsOutsideViewport(candidateBounds, targetViewport, visibilitySource, sceneRegion)) errors.push(contractError(stage, item, result, `${resultLabel} candidate bounds 超出目标 viewport，存在越界或裁切`, { expected: `0<=x,y 且 right<=${targetViewport.width}, bottom<=${targetViewport.height}`, actual: JSON.stringify(candidateBounds), returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (exact && !hasStructuredValue(delta)) errors.push(contractError(stage, item, result, `${resultLabel} 缺少 delta`, { missing: `${resultLabel}.delta`, returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (exact && (!nonEmptyString(toleranceId) || !toleranceDefinitions.has(toleranceId))) errors.push(contractError(stage, item, result, `${resultLabel} 必须引用预声明 tolerance ID`, { missing: `${resultLabel}.tolerance_reference`, expected: [...toleranceDefinitions.keys()].join(",") || "scene_reconstruction_contract.predeclared_tolerances", returnStage: "VALIDATING", rootCause: "方案缺失" }));
    const regionToleranceId = field(sceneRegion, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
    if (exact && regionToleranceId && toleranceId !== regionToleranceId) errors.push(contractError(stage, item, result, `${resultLabel} tolerance 必须引用对应 coverage region 的预声明 ID`, { expected: regionToleranceId, actual: toleranceId, returnStage: "VALIDATING", rootCause: "方案缺失" }));
    if (!["passed", "pass", "failed", "fail"].includes(resultValue)) errors.push(contractError(stage, item, result, `${resultLabel} result 不能为 unknown/unverified/missing`, { actual: resultValue || "missing", returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (!hasEvidence(field(result, "evidence", "evidence_paths", "evidencePaths"))) errors.push(contractError(stage, item, result, `${resultLabel} 缺少 layout diff evidence`, { missing: `${resultLabel}.evidence`, returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (node && validLayoutBounds(targetBounds) && factsDiffer(targetBounds, field(node, "target_bounds", "targetBounds", "bounds"))) errors.push(contractError(stage, item, result, `${resultLabel} target bounds 未绑定冻结 layout node`, { expected: JSON.stringify(field(node, "target_bounds", "targetBounds", "bounds")), actual: JSON.stringify(targetBounds), returnStage: "VALIDATING", rootCause: "验收问题" }));
    const limit = toleranceDefinitions.has(toleranceId) ? toleranceLimit(toleranceDefinitions.get(toleranceId)) : null;
    const exceeds = exact
      ? limit !== null && [...numericDeltas(delta), ...numericFactDeltas(targetBounds, candidateBounds)].some((value) => value > limit)
      : visualGeometryDifferenceExceeds(targetBounds, candidateBounds, delta, { mode, declaredLimit: limit });
    if (exceeds) errors.push(contractError(stage, item, result, exact ? `${resultLabel} 存在未解释差异：几何 delta 超出预声明 tolerance` : `${resultLabel} 几何偏差超过 usability 允许范围`, { expected: exact ? `<=${limit}` : "小于等于有限 usability 几何容差", actual: JSON.stringify(delta), returnStage: "VALIDATING", rootCause: "验收问题" }));
    if ((resultValue === "passed" || resultValue === "pass") && exceeds) errors.push(contractError(stage, item, result, exact ? `${resultLabel} PASS 不能掩盖超容差布局差异` : `${resultLabel} PASS 不能掩盖明显几何偏差`, { returnStage: "VALIDATING", rootCause: "验收问题" }));
  }
  if (exact) {
    for (const nodeId of nodeById.keys()) if (!seen.has(nodeId)) errors.push(contractError(stage, item, { id: nodeId }, `effect-image ${label} 缺少 layout node 证据`, { missing: nodeId, returnStage: "VALIDATING", rootCause: "验收问题" }));
    for (const nodeId of seen) if (!nodeById.has(nodeId)) errors.push(contractError(stage, item, { id: nodeId }, `effect-image ${label} 存在 extra/orphan layout node 证据`, { actual: nodeId, returnStage: "VALIDATING", rootCause: "验收问题" }));
  } else {
    const criticalIds = new Set([
      ...nodes.filter((node) => node?.critical === true || node?.is_critical === true || node?.required === true).map((node) => field(node, "layout_node_id", "layoutNodeId")).filter(nonEmptyString),
      ...(Array.isArray(item.critical_node_ids) ? item.critical_node_ids : Array.isArray(item.criticalNodeIds) ? item.criticalNodeIds : []).filter(nonEmptyString),
    ]);
    for (const nodeId of criticalIds) if (!seen.has(nodeId)) errors.push(contractError(stage, item, { id: nodeId }, `effect-image ${label} 缺少关键 layout node 证据`, { missing: nodeId, returnStage: "VALIDATING", rootCause: "验收问题" }));
  }
  const failed = results.filter((result) => ["failed", "fail", "unknown", "unverified", "missing"].includes(String(field(result, "result", "status", "verdict") ?? "").toLowerCase()));
  if (failed.length > 0 && ["passed", "PASS"].includes(String(item.conclusion ?? ""))) errors.push(contractError(stage, item, item, `effect-image ${label} 存在未通过节点但 fidelity case=PASS`, { actual: `${failed.length} 个节点未通过`, returnStage: "VALIDATING", rootCause: "验收问题" }));
}
