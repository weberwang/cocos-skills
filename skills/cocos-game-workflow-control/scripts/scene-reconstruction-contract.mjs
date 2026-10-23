/**
 * 效果图还原的场景级合同与保真证据校验。
 *
 * 资源生产合同只能说明“文件如何产出”，不能说明资源在正式 Scene 中
 * 应该呈现成什么画面。本模块把冻结效果图的构图、区域事实、运行时事实
 * 和比较证据收敛成独立的机器门，供 V1-V4 入口共享。
 */

import { validateVisualPostApprovalReviewFields } from "./visual-human-review-contract.mjs";
import { isWorkflowDpr, workflowDprError } from "./workflow-dpr-contract.mjs";
import {
  isEffectImageContract,
  validateEffectImageLayoutNodeFidelity,
  validateLayoutDecomposition,
  validateLayoutGeometryFacts,
  validateLayoutBinding,
  validateLayoutBindingConsistency,
  validateRootLayoutIdentity,
  validateLayoutRegionBindings,
  resolveSceneV2LayoutSource,
} from "./scene-layout-decomposition-contract.mjs";
import { validateDisplayLayerPlanning } from "./display-layer-planning-contract.mjs";
import { validateSceneTextDecomposition } from "./scene-text-decomposition-contract.mjs";
import { validateSceneVisualRouteContract } from "./scene-visual-route-contract.mjs";
import { validateLayoutAnnotationConfirmation } from "./layout_annotation_confirmation.mjs";
import { resolveVisualValidationMode, validateVisualValidationPolicy, visualGeometryDifferenceExceeds, visualBoundsOutsideViewport } from "./visual-validation-policy.mjs";

export { validateDisplayLayerPlanning } from "./display-layer-planning-contract.mjs";
export { validateSceneVisualRouteAnalysis, validateSceneVisualRouteContract } from "./scene-visual-route-contract.mjs";

/** 判断是否为普通对象。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断标准 sha256 身份。 */
export function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

/** 读取 snake_case/camelCase 合同字段，避免同一个字段出现两套语义。 */
function field(value, ...names) {
  for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name];
  return undefined;
}

/** 读取非空字段并保持完整的场景、阶段和退回定位信息。 */
function requiredString(value, names, label, errors, context = {}) {
  const result = field(value, ...names);
  if (!nonEmptyString(result)) {
    const stage = context.stage ?? "V1";
    const contract = context.contract ?? value;
    const region = context.region ?? value;
    const returnStage = context.returnStage ?? (stage === "V1" || stage === "V2" ? "V1/PROPOSAL" : stage);
    errors.push(contractError(stage, contract, region, `${label} 缺失`, {
      missing: context.missing ?? label,
      expected: context.expected ?? "冻结场景合同字段中的非空字符串",
      actual: result === undefined || result === null ? "missing" : String(result),
      returnStage,
      rootCause: context.rootCause ?? (returnStage === "V1/PROPOSAL" ? "方案缺失" : "验收问题"),
    }));
  }
  return result;
}

/** 判断正数尺寸对象。 */
function validSize(value) {
  return isObject(value) && Number.isInteger(value.width) && value.width > 0 && Number.isInteger(value.height) && value.height > 0;
}

/** 判断正数 viewport。 */
function validViewport(value) {
  return validSize(value) && Number.isFinite(value.width) && Number.isFinite(value.height);
}

/** 生成带阶段、场景、区域和退回点的确定性错误。 */
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

/** 读取合同版本；版本缺失时不能把旧工件当作新合同。 */
function contractVersion(contract) {
  return field(contract, "contract_version", "contractVersion", "version", "scene_reconstruction_contract_version");
}

/** 判断合同是否显式声明字段；空数组是有效声明，undefined/null 则不是。 */
function hasContractField(value, names) {
  return isObject(value) && names.some((name) => Object.hasOwn(value, name));
}

/** V1 必须记录参考事实与技术硬约束的冲突，即使当前没有冲突。 */
function validateReferenceTechnicalConflicts(contract, stage, errors) {
  const names = ["reference_technical_conflicts", "referenceTechnicalConflicts", "reference_technical_constraint_conflicts", "referenceTechnicalConstraintConflicts", "reference_constraint_conflicts", "referenceConstraintConflicts", "reference_vs_technical_conflicts", "referenceVsTechnicalConflicts", "reference_hard_constraint_conflicts", "referenceHardConstraintConflicts", "constraint_conflicts", "constraintConflicts", "hard_constraint_conflicts", "hardConstraintConflicts"];
  const value = field(contract, ...names);
  if (!hasContractField(contract, names)) {
    errors.push(contractError(stage, contract, null, "V1 场景合同缺少参考与技术硬约束冲突记录", { missing: "reference_technical_conflicts", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(contractError(stage, contract, null, "参考与技术硬约束冲突记录必须是数组（允许为空）", { missing: "reference_technical_conflicts[]", actual: String(value), returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return;
  }
  value.forEach((item, index) => {
    if (!isObject(item)) errors.push(contractError(stage, contract, null, `参考与技术硬约束冲突记录[${index}] 必须是结构化对象`, { missing: `reference_technical_conflicts[${index}]`, actual: String(item), returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  });
}

/** 判断 V2 拆解方案字段是否包含可复核内容。 */
function hasEvidenceValue(value) {
  return nonEmptyString(value) || (Array.isArray(value) && value.length > 0) || (isObject(value) && Object.keys(value).length > 0) || typeof value === "boolean";
}

/** V2 必须提供拆解图、技术 JSON、coverage 和生产方案，缺任一项均退回 V1。 */
function validateV2StageArtifacts(contract, stage, errors) {
  // V2 是从冻结图拆出的生产方案门，不再接受旧的 Cocos 候选或方向审批工件。
  for (const oldKey of ["v2_scene_candidate", "v2SceneCandidate", "v2_dynamic_sample", "v2DynamicSample", "v2_structured_review", "v2StructuredReview", "visual_human_approval", "visualHumanApproval"]) {
    if (Object.hasOwn(contract, oldKey)) errors.push(contractError(stage, contract, null, `V2 不再接受旧式工件 ${oldKey}`, { missing: "decomposition_annotation/technical_decomposition/visual_decomposition_confirmation", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  }
  for (const [names, text] of [
    [["decomposition_annotation", "decompositionAnnotation", "v2_decomposition_annotation", "v2DecompositionAnnotation"], "拆解标注图"],
    [["technical_decomposition", "technicalDecomposition", "proposal_technical_json", "proposalTechnicalJson", "v2_technical_decomposition", "v2TechnicalDecomposition"], "技术拆解 JSON"],
    [["visual_decomposition_confirmation", "visualDecompositionConfirmation", "decomposition_confirmation", "decompositionConfirmation"], "拆解确认"],
    [["visual_production_contract", "visualProductionContract", "production_contract", "productionContract"], "生产合同"],
    [["visual_production_units", "visualProductionUnits", "production_units", "productionUnits"], "生产单元计划"],
    [["coverage_audit", "coverageAudit", "coverage"], "coverage 审计"],
  ]) {
    const value = field(contract, ...names);
    if (!hasEvidenceValue(value)) errors.push(contractError(stage, contract, null, `V2 还原方案缺少 ${text}`, { missing: names[0], returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  }
  const confirmation = field(contract, "visual_decomposition_confirmation", "visualDecompositionConfirmation", "decomposition_confirmation", "decompositionConfirmation") ?? {};
  const status = field(confirmation, "status", "verdict", "result");
  const mode = field(confirmation, "confirmation_mode", "confirmationMode", "mode");
  if (isObject(confirmation)) {
    if (!["accepted", "PASS", "passed"].includes(String(status))) errors.push(contractError(stage, contract, null, "V2 拆解确认必须 accepted/PASS", { missing: "visual_decomposition_confirmation.status", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    if (mode !== undefined && mode !== "manual") errors.push(contractError(stage, contract, null, "V2 拆解确认必须来自 manual 用户确认", { missing: "visual_decomposition_confirmation.confirmation_mode=manual", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  }
  errors.push(...validateVisualPostApprovalReviewFields(contract, { stage: "V2" }));
}

/** V2 阶段 B 的最终门：布局图必须以后置生成，并绑定已通过的拆解确认。 */
function validateV2LayoutStage(contract, targetInfo, stage, errors, requireFinalLayout = true, layoutInfo = {}, options = {}) {
  if (!requireFinalLayout) return;
  const decomposition = field(contract, "layout_decomposition", "layoutDecomposition");
  const annotation = decomposition?.layout_annotation ?? decomposition?.layoutAnnotation;
  const layoutSource = decomposition?.layout_source ?? decomposition?.layoutSource;
  const decompositionConfirmation = field(contract, "visual_decomposition_confirmation", "visualDecompositionConfirmation", "decomposition_confirmation", "decompositionConfirmation");
  if (!isObject(annotation)) {
    errors.push(contractError(stage, contract, decomposition, "V2 缺少后置布局标注图产物；拆解确认后才可生成布局图", { missing: "layout_decomposition.layout_annotation", returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
  } else {
    for (const key of ["layout_annotation_file", "layout_annotation_width", "layout_annotation_height", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id"]) if (!hasContractField(annotation, [key])) errors.push(contractError(stage, contract, annotation, `V2 布局标注图缺少 ${key}`, { missing: `layout_annotation.${key}`, returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
    if (annotation.decomposition_confirmation_id !== decompositionConfirmation?.confirmation_id) errors.push(contractError(stage, contract, annotation, "布局标注图未绑定当前已确认拆解 ID", { missing: "decomposition_confirmation_id", returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
    if (!nonEmptyString(layoutSource?.nodes_file) || annotation.layout_nodes_file !== layoutSource.nodes_file) errors.push(contractError(stage, contract, annotation, "布局标注必须引用唯一 layout_source.nodes_file", { expected: layoutSource?.nodes_file ?? "layout_source.nodes_file", actual: annotation.layout_nodes_file, returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
  }
  if (!isObject(decompositionConfirmation) || !["accepted", "passed", "PASS"].includes(String(field(decompositionConfirmation, "status", "verdict", "result"))) || field(decompositionConfirmation, "confirmation_mode", "confirmationMode", "mode") !== "manual") errors.push(contractError(stage, contract, decompositionConfirmation, "布局阶段前置拆解确认必须是 manual accepted", { missing: "visual_decomposition_confirmation", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  const layoutConfirmation = decomposition?.layout_annotation_confirmation ?? decomposition?.layoutAnnotationConfirmation;
  if (isObject(layoutConfirmation) && layoutConfirmation.layout_nodes_file !== layoutSource?.nodes_file) errors.push(contractError(stage, contract, layoutConfirmation, "布局确认必须引用同一个 layout_source.nodes_file", { expected: layoutSource?.nodes_file ?? "layout_source.nodes_file", actual: layoutConfirmation.layout_nodes_file, returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
  validateLayoutAnnotationConfirmation(layoutConfirmation, { sceneId: targetInfo?.sceneId, stateId: targetInfo?.stateId, viewport: targetInfo?.viewport, referenceFile: contract?.reference_target?.original_file, proposalFile: decompositionConfirmation?.proposal_file, decompositionConfirmationId: decompositionConfirmation?.confirmation_id, layoutNodes: layoutInfo.nodes, layoutSourceFile: layoutInfo.sourcePath, projectRoot: options.projectRoot, checkFiles: options.forceLayoutSourceFiles === true && options.checkFiles === true }, errors, "layout_decomposition.layout_annotation_confirmation");
  if (isObject(annotation) && isObject(layoutConfirmation)) {
    // 独立布局确认必须逐字段锁定同一最终 PNG，不能只复用上游拆解确认。
    for (const key of ["layout_annotation_file", "layout_annotation_width", "layout_annotation_height", "layout_annotation_schema", "layout_annotation_layout", "layout_review_file", "layout_nodes_file", "decomposition_confirmation_id", "layout_decision_file", "layout_decision_id", "scene_id", "state_id"]) if (annotation[key] !== layoutConfirmation[key]) errors.push(contractError(stage, contract, layoutConfirmation, `布局确认未绑定布局图字段 ${key}`, { missing: `layout_annotation_confirmation.${key}`, returnStage: "V2/PROPOSAL", rootCause: "方案缺失" }));
  }
}

/** 校验冻结目标条件，确保比较绑定显式 viewport 和动态封顶范围内的 DPR。 */
function validateTargetConditions(contract, manifest, stage, errors, effectImage = false) {
  const target = field(contract, "target_conditions", "targetConditions", "target", "frozen_target", "frozenTarget");
  if (!isObject(target)) {
    errors.push(contractError(stage, contract, null, "scene_reconstruction_contract.target_conditions 必须是对象", { missing: "target_conditions", returnStage: "V1/PROPOSAL" }));
    return null;
  }
  const requiredContext = { stage, contract, region: target, returnStage: "V1/PROPOSAL", rootCause: "方案缺失" };
  const size = field(target, "original_pixel_size", "originalPixelSize", "original_size", "originalSize", "pixel_size", "pixelSize");
  if (!validSize(size)) errors.push(contractError(stage, contract, null, "冻结目标必须记录原始像素尺寸", { missing: "original_pixel_size.width/height", returnStage: "V1/PROPOSAL" }));
  const sceneId = requiredString(target, ["scene_id", "sceneId"], "冻结目标 scene_id", errors, requiredContext);
  const stateId = requiredString(target, ["state_id", "stateId"], "冻结目标 state_id", errors, requiredContext);
  const viewport = field(target, "viewport", "target_viewport", "targetViewport");
  if (!validViewport(viewport)) errors.push(contractError(stage, contract, null, "冻结目标必须记录精确 viewport", { missing: "viewport.width/height", returnStage: "V1/PROPOSAL" }));
  if (!isWorkflowDpr(target.dpr)) errors.push(contractError(stage, contract, null, workflowDprError("冻结目标 dpr", target.dpr), { missing: "dpr", returnStage: "V1/PROPOSAL" }));
  requiredString(target, ["locale", "language"], "冻结目标 locale", errors, requiredContext);
  const seed = field(target, "random_seed", "randomSeed", "seed");
  if (!(Number.isInteger(seed) || nonEmptyString(seed))) errors.push(contractError(stage, contract, null, "冻结目标必须记录 random seed", { missing: "random_seed", returnStage: "V1/PROPOSAL" }));
  requiredString(target, ["input_trace", "inputTrace"], "冻结目标 input trace", errors, requiredContext);
  requiredString(target, ["animation_sample", "animationSample", "stable_frame", "stableFrame"], "冻结目标稳定帧/动画采样", errors, requiredContext);
  const baselineVersion = requiredString(target, ["visual_baseline_version", "visualBaselineVersion"], "冻结目标 visual baseline version", errors, requiredContext);
  const layoutVersion = requiredString(target, ["layout_contract_version", "layoutContractVersion"], "冻结目标 layout contract version", errors, requiredContext);
  const layoutIdentity = field(target, "layout_identity", "layoutIdentity", "layout_contract_binding", "layoutContractBinding") ?? target;
  const layoutDecompositionVersion = field(layoutIdentity, "layout_decomposition_version", "layoutDecompositionVersion");
  if (effectImage) {
    requiredString(layoutIdentity, ["layout_decomposition_version", "layoutDecompositionVersion"], "冻结目标 layout_decomposition_version", errors, { ...requiredContext, region: target, missing: "target_conditions.layout_decomposition_version" });
  }
  if (manifest?.reference_target?.scene_ids && sceneId && !manifest.reference_target.scene_ids.includes(sceneId)) errors.push(contractError(stage, contract, null, "场景合同 scene_id 不在冻结目标范围内", { actual: sceneId, returnStage: "V1/PROPOSAL" }));
  if (manifest?.reference_target?.state_ids && stateId && !manifest.reference_target.state_ids.includes(stateId)) errors.push(contractError(stage, contract, null, "场景合同 state_id 不在冻结目标范围内", { actual: stateId, returnStage: "V1/PROPOSAL" }));
  if (manifest?.visual_baseline?.version && baselineVersion && baselineVersion !== manifest.visual_baseline.version) errors.push(contractError(stage, contract, null, "场景合同 visual baseline version 不一致", { expected: manifest.visual_baseline.version, actual: baselineVersion, returnStage: "V1/PROPOSAL" }));
  return { target, sceneId, stateId, size, viewport, baselineVersion, layoutVersion, layoutDecompositionVersion };
}

/** 验证区域事实；runtime owner 也必须承担完整 fidelity obligation。 */
function validateCoverageRegion(region, contract, stage, toleranceIds, errors, effectImage = false, requireLayout = true, mode = "usability") {
  const label = `scene_reconstruction_contract.coverage_regions[${region?.annotation_number ?? "?"}]`;
  if (!isObject(region)) {
    errors.push(contractError(stage, contract, null, `${label} 必须是对象`, { missing: "coverage region", returnStage: "V1/PROPOSAL" }));
    return;
  }
  if (effectImage && requireLayout) {
    const layoutNodeIds = field(region, "layout_node_ids", "layoutNodeIds");
    // effect-image 的区域是布局合同的最小覆盖单元；空数组不能表示“稍后再绑定”。
    if (!Array.isArray(layoutNodeIds) || layoutNodeIds.length === 0 || layoutNodeIds.some((id) => !nonEmptyString(id))) {
      errors.push(contractError(stage, contract, region, `${label} effect-image 必须声明非空 layout_node_ids`, { missing: "layout_node_ids", returnStage: "V1/PROPOSAL" }));
    } else if (new Set(layoutNodeIds).size !== layoutNodeIds.length) {
      errors.push(contractError(stage, contract, region, `${label} layout_node_ids 不能重复`, { actual: JSON.stringify(layoutNodeIds), returnStage: "V1/PROPOSAL" }));
    }
  }
  const requiredFacts = [
    [["annotation_number", "annotationNumber"], "annotation_number"],
    [["region_id", "regionId", "id"], "region_id"],
    [["coordinate_space", "coordinateSpace"], "coordinate_space"],
    [["anchor_reference", "anchorReference", "anchor", "reference_element", "referenceElement"], "anchor/reference"],
    [["relative_alignment", "relativeAlignment", "alignment"], "relative_alignment"],
    [["z_order", "zOrder", "layer"], "z-order/layer"],
    [["target_visibility", "targetVisibility", "visible_state", "visibleState"], "target visibility"],
    [["size_strategy", "sizeStrategy", "width_height_strategy", "widthHeightStrategy"], "width/height strategy"],
    [["spacing", "spacing_facts", "spacingFacts", "whitespace"], "spacing/whitespace"],
    [["typography_facts", "typographyFacts", "typography"], "typography facts"],
    [["color_facts", "colorFacts", "color"], "color facts"],
    [["material_texture_facts", "materialTextureFacts", "material_facts", "materialFacts", "material"], "material/texture facts"],
    [["lighting_shadow_facts", "lightingShadowFacts", "lighting"], "lighting/shadow facts"],
    [["decorative_density_facts", "decorativeDensityFacts", "decoration_density", "decorationDensity"], "decorative density facts"],
    [["clipping_cropping_facts", "clippingCroppingFacts", "clipping"], "clipping/cropping facts"],
    [["responsive_behavior", "responsiveBehavior"], "responsive behavior"],
    [["implementation_owner", "implementationOwner", "owner"], "implementation owner"],
    [["implementation_plan", "implementationPlan"], "implementation plan"],
    [["applicable_states", "applicableStates", "states"], "applicable states"],
    [["evidence", "evidence_paths", "evidencePaths"], "evidence"],
    [["approved_exception_ids", "approvedExceptionIds", "exception_ids", "exceptionIds"], "approved exception IDs"],
  ];
  // usability 模式不要求为普通几何偏差预先填写精确 tolerance；身份、布局和可用性事实仍保留。
  if (mode === "exact") requiredFacts.splice(requiredFacts.length - 1, 0, [["tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId"], "predeclared tolerance"]);
  for (const [names, text] of requiredFacts) {
    const value = field(region, ...names);
    const valid = Array.isArray(value) ? (text === "approved exception IDs" || value.length > 0) : isObject(value) ? Object.keys(value).length > 0 : nonEmptyString(value) || typeof value === "number" || typeof value === "boolean";
    if (!valid) errors.push(contractError(stage, contract, region, `${label} 缺少 ${text}`, { missing: text, returnStage: "V1/PROPOSAL" }));
  }
  const bounds = field(region, "target_bounds", "targetBounds", "bounds");
  if (!validSize(bounds) || typeof bounds.x !== "number" || typeof bounds.y !== "number") errors.push(contractError(stage, contract, region, `${label} 必须包含 target bounds`, { missing: "target_bounds.x/y/width/height", returnStage: "V1/PROPOSAL" }));
  const tolerance = field(region, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
  if (nonEmptyString(tolerance) && toleranceIds.size > 0 && !toleranceIds.has(tolerance)) errors.push(contractError(stage, contract, region, `${label} 引用了未预声明容差`, { expected: [...toleranceIds].join(","), actual: tolerance, returnStage: "V1/PROPOSAL" }));
  const owner = field(region, "implementation_owner", "implementationOwner", "owner");
  if (["runtime-program", "runtime-rendered", "runtime-data"].includes(owner)) {
    const obligations = field(region, "fidelity_obligations", "fidelityObligations", "runtime_fidelity_obligation", "runtimeFidelityObligation");
    if (!isObject(obligations) && !(Array.isArray(obligations) && obligations.length > 0) && !nonEmptyString(obligations)) errors.push(contractError(stage, contract, region, `${label} runtime owner 缺少 fidelity obligations`, { missing: "fidelity_obligations", returnStage: "V1/PROPOSAL" }));
  }
}

/** 验证整屏构图、响应式绑定和实现计划。 */
function validateCompositionAndResponsive(contract, targetInfo, stage, errors, effectImage = false, mode = "usability") {
  const composition = field(contract, "composition", "composition_contract", "compositionContract", "full_scene_composition");
  if (!isObject(composition)) {
    errors.push(contractError(stage, contract, null, "缺少完整场景构图合同", { missing: "composition", returnStage: "V1/PROPOSAL" }));
  } else {
    for (const [names, text] of [
      [["vertical_order", "verticalOrder", "region_order", "regionOrder"], "HUD/规则/统计/棋盘/工具纵向顺序"],
      [["inter_region_spacing", "interRegionSpacing", "spacing"], "区域间间距"],
      [["relative_sizes", "relativeSizes", "size_relations", "sizeRelations"], "区域相对尺寸"],
      [["visual_center_of_gravity", "visualCenterOfGravity", "focal_point", "focalPoint"], "主视觉重心"],
      [["whitespace", "white_space", "empty_space", "emptySpace"], "空白区位置和许可范围"],
      [["alignments", "alignment_relations", "alignmentRelations"], "对齐关系"],
      [["visual_hierarchy", "visualHierarchy", "layer_hierarchy", "layerHierarchy"], "组件视觉层级"],
      [["background_focus_foreground_occlusion", "backgroundFocusForegroundOcclusion", "occlusion"], "背景焦点与前景遮挡"],
    ]) {
      const value = field(composition, ...names);
      if (!(Array.isArray(value) ? value.length > 0 : isObject(value) ? Object.keys(value).length > 0 : nonEmptyString(value))) errors.push(contractError(stage, contract, null, `构图合同缺少 ${text}`, { missing: text, returnStage: "V1/PROPOSAL" }));
    }
  }
  const responsive = field(contract, "responsive_contract", "responsiveContract", "responsive");
  if (!isObject(responsive)) errors.push(contractError(stage, contract, null, "缺少响应式合同", { missing: "responsive_contract", returnStage: "V1/PROPOSAL" }));
  else {
    const targetViewport = field(responsive, "target_viewport", "targetViewport");
    if (!validViewport(targetViewport)) errors.push(contractError(stage, contract, null, "响应式合同缺少精确目标 viewport", { missing: "responsive_contract.target_viewport", returnStage: "V1/PROPOSAL" }));
    const other = field(responsive, "other_viewports", "otherViewports", "verification_viewports", "verificationViewports");
    if (mode === "exact" && (!Array.isArray(other) || other.length === 0)) errors.push(contractError(stage, contract, null, "响应式合同缺少其他 viewport 验证关系", { missing: "responsive_contract.other_viewports", returnStage: "V1/PROPOSAL" }));
    const invariants = field(responsive, "relationship_invariants", "relationshipInvariants", "invariants");
    if (mode === "exact" && (!Array.isArray(invariants) || invariants.length === 0)) errors.push(contractError(stage, contract, null, "响应式合同缺少关系不变量", { missing: "responsive_contract.relationship_invariants", returnStage: "V1/PROPOSAL" }));
    const binding = field(responsive, "layout_contract_binding", "layoutContractBinding", "layout_contract", "layoutContract");
    if (!isObject(binding)) errors.push(contractError(stage, contract, null, "响应式合同缺少 target-bound layout contract", { missing: "responsive_contract.layout_contract_binding", returnStage: "V1/PROPOSAL" }));
    else {
      for (const [names, text] of [[["scene_id", "sceneId"], "scene_id"], [["state_id", "stateId"], "state_id"], [["visual_baseline_version", "visualBaselineVersion"], "visual_baseline_version"], [["reconstruction_contract_version", "reconstructionContractVersion", "contract_version", "contractVersion"], "reconstruction_contract_version"]]) requiredString(binding, names, `layout contract binding ${text}`, errors, { stage, contract, region: binding, returnStage: "V1/PROPOSAL", rootCause: "方案缺失" });
      if (effectImage) validateLayoutBinding(binding, targetInfo, contract, stage, errors, "responsive_contract layout binding", { requireViewport: true, requireBaseline: true, requireLayoutVersion: true, requireLayoutIdentity: true });
    }
    if (targetInfo && validViewport(targetViewport) && (targetViewport.width !== targetInfo.viewport.width || targetViewport.height !== targetInfo.viewport.height)) errors.push(contractError(stage, contract, null, "响应式目标 viewport 与冻结目标不一致", { expected: `${targetInfo.viewport.width}x${targetInfo.viewport.height}`, actual: `${targetViewport.width}x${targetViewport.height}`, returnStage: "V1/PROPOSAL" }));
  }
  const tolerances = field(contract, "predeclared_tolerances", "predeclaredTolerances", "tolerance_set", "toleranceSet", "tolerances");
  if (mode === "exact" && (!Array.isArray(tolerances) || tolerances.length === 0)) errors.push(contractError(stage, contract, null, "缺少项目预声明容差集合", { missing: "predeclared_tolerances", returnStage: "V1/PROPOSAL" }));
  else if (Array.isArray(tolerances)) for (const [index, item] of tolerances.entries()) {
    if (!isObject(item) || !nonEmptyString(item.id ?? item.tolerance_id ?? item.toleranceId)) errors.push(contractError(stage, contract, null, `predeclared_tolerances[${index}] 缺少精确 ID`, { missing: `predeclared_tolerances[${index}].id`, returnStage: "V1/PROPOSAL" }));
    if (isObject(item) && item.value === undefined && item.rules === undefined && item.measurements === undefined) errors.push(contractError(stage, contract, null, `predeclared_tolerances[${index}] 缺少可执行规则`, { missing: `predeclared_tolerances[${index}].rules`, returnStage: "V1/PROPOSAL" }));
  }
  const plan = field(contract, "implementation_plan", "implementationPlan", "scene_implementation_plan", "sceneImplementationPlan");
  if (!isObject(plan)) errors.push(contractError(stage, contract, null, "缺少完整场景实现计划", { missing: "implementation_plan", returnStage: "V1/PROPOSAL" }));
  else for (const [names, text] of [[["resources", "resource_plan", "resourcePlan"], "资源"], [["layout", "layout_plan", "layoutPlan"], "布局"], [["runtime_objects", "runtimeObjects", "structured_runtime_objects", "structuredRuntimeObjects"], "结构化运行时对象"], [["composition", "composition_plan", "compositionPlan"], "视觉组合"]]) {
    const value = field(plan, ...names);
    if (!(Array.isArray(value) ? value.length > 0 : isObject(value) ? Object.keys(value).length > 0 : nonEmptyString(value))) errors.push(contractError(stage, contract, null, `实现计划缺少 ${text} 计划`, { missing: text, returnStage: "V1/PROPOSAL" }));
  }
  return Array.isArray(tolerances) ? new Set(tolerances.map((item) => item?.id ?? item?.tolerance_id ?? item?.toleranceId).filter(nonEmptyString)) : new Set();
}

/** 判断组合验收字段是否表达确定性通过，而不是只写一句 PASS。 */
function passedCombinationFact(value) {
  if (value === true) return true;
  if (typeof value === "string") return ["passed", "pass", "unchanged", "preserved", "none", "no-redesign", "not-detected"].includes(value.trim().toLowerCase());
  if (isObject(value)) return [value.status, value.result, value.verdict, value.conclusion].some((item) => typeof item === "string" && ["passed", "pass", "unchanged", "preserved", "none", "no-redesign", "not-detected"].includes(item.trim().toLowerCase())) || value.passed === true || value.unchanged === true;
  return false;
}

/** 读取 V3 同屏组合中的正式资产、布局、视觉事实和提示词绑定。 */
function validateEffectImageCombinationFacts(contract, preacceptance, stage, errors, manifest = null) {
  const formalAssets = field(preacceptance, "formal_assets", "formalAssets", "formal_asset_ids", "formalAssetIds", "actual_formal_assets", "actualFormalAssets");
  if (!(Array.isArray(formalAssets) && formalAssets.length > 0 || isObject(formalAssets) && Object.keys(formalAssets).length > 0)) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合必须使用当前正式资产清单", { missing: "formal_assets", returnStage: "V2/V3", rootCause: "执行问题" }));
  const currentAssetIds = new Set((Array.isArray(manifest?.assets) ? manifest.assets : []).map((asset) => field(asset, "id", "asset_id", "assetId")).filter(nonEmptyString));
  if (currentAssetIds.size > 0 && Array.isArray(formalAssets)) {
    const declaredAssetIds = formalAssets.map((asset) => isObject(asset) ? field(asset, "id", "asset_id", "assetId") : asset).filter(nonEmptyString);
    if (declaredAssetIds.length === 0 || declaredAssetIds.some((assetId) => !currentAssetIds.has(assetId))) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合 formal_assets 未绑定当前正式资产身份", { missing: "formal_assets.current_asset_ids", returnStage: "V2/V3", rootCause: "执行问题" }));
  }
  const formalLayout = field(preacceptance, "formal_layout_structure", "formalLayoutStructure", "formal_layout", "formalLayout", "layout_structure", "layoutStructure")
    ?? field(field(preacceptance, "layout_geometry", "layoutGeometry"), "formal_layout_structure", "formalLayoutStructure", "formal_layout", "formalLayout");
  if (!(nonEmptyString(formalLayout) || isObject(formalLayout))) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合必须使用正式布局结构", { missing: "formal_layout_structure", returnStage: "V2/V3", rootCause: "执行问题" }));

  const fidelity = field(preacceptance, "visual_fidelity", "visualFidelity", "fidelity_checks", "fidelityChecks", "visual_checks", "visualChecks") ?? {};
  const fidelityNames = [
    ["contour", "轮廓"], ["proportion", "比例"], ["pose", "姿态"], ["icon_semantics", "图标语义"], ["full_scene_composition", "整屏构图"],
  ];
  for (const [names, label] of fidelityNames) {
    const value = field(fidelity, names, names === "icon_semantics" ? "iconSemantics" : names === "full_scene_composition" ? "fullSceneComposition" : names);
    if (!passedCombinationFact(value)) errors.push(contractError(stage, contract, preacceptance, `V3 同屏组合缺少${label}未偏离冻结目标的确定性事实`, { missing: `visual_fidelity.${names}`, returnStage: "V2/V3", rootCause: "执行问题" }));
  }
  const redesign = field(preacceptance, "redesign_check", "redesignCheck", "redesign_status", "redesignStatus", "unapproved_redesign", "unapprovedRedesign", "redesign_detected", "redesignDetected");
  if (redesign === undefined) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合缺少未经批准重新设计检查", { missing: "redesign_check", returnStage: "V2/V3", rootCause: "执行问题" }));
  else if (!passedCombinationFact(redesign) && !(isObject(redesign) && redesign.approved === true && nonEmptyString(redesign.change_request_id ?? redesign.changeRequestId))) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合存在未经批准的重新设计", { missing: "approved_change_request", returnStage: "V2/V3", rootCause: "执行问题" }));

  const coverageRegions = field(contract, "coverage_regions", "coverageRegions", "regions") ?? [];
  const hasImageGeneration = Array.isArray(coverageRegions) && coverageRegions.some((region) => field(region, "production_method", "productionMethod") === "image-generation" || field(region, "image_generation_required", "imageGenerationRequired") === true);
  const binding = field(preacceptance, "prompt_contract_binding", "promptContractBinding", "prompt_contract_audit", "promptContractAudit", "generation_record_bindings", "generationRecordBindings");
  const bindings = Array.isArray(binding) ? binding : isObject(binding) ? [binding] : [];
  if (hasImageGeneration && bindings.length === 0) errors.push(contractError(stage, contract, preacceptance, "V3 同屏组合缺少提示词合同与实际生成记录绑定", { missing: "prompt_contract_binding", returnStage: "V2/V3", rootCause: "执行问题" }));
  const knownRegions = new Set(coverageRegions.map((item) => field(item, "region_id", "regionId", "id")).filter(nonEmptyString));
  for (const [index, item] of bindings.entries()) {
    const record = field(item, "generation_record", "generationRecord", "actual_generation_record", "actualGenerationRecord") ?? item;
    const bindingRecordId = field(item, "record_id", "recordId", "generation_record_id", "generationRecordId") ?? field(record, "record_id", "recordId", "generation_record_id", "generationRecordId");
    const bindingRegion = field(item, "region_id", "regionId", "region_ids", "regionIds") ?? field(record, "region_id", "regionId", "region_ids", "regionIds");
    const hasRegion = Array.isArray(bindingRegion) ? bindingRegion.length > 0 && bindingRegion.every((regionId) => knownRegions.size === 0 || knownRegions.has(regionId)) : nonEmptyString(bindingRegion) && (knownRegions.size === 0 || knownRegions.has(bindingRegion));
    if (!hasRegion) errors.push(contractError(stage, contract, preacceptance, `提示词合同绑定[${index}] 缺少当前 region ID`, { missing: `prompt_contract_binding[${index}].region_id`, returnStage: "V2/V3", rootCause: "执行问题" }));
    if (!nonEmptyString(bindingRecordId)) errors.push(contractError(stage, contract, preacceptance, `提示词合同绑定[${index}] 缺少实际 generation_record ID`, { missing: `prompt_contract_binding[${index}].record_id`, returnStage: "V2/V3", rootCause: "执行问题" }));
  }
}

/** 验证 V4 同屏组合预验收必须使用正式 Scene 结构。 */
export function validateSceneCombinationPreacceptance(contract, stage = "V4", options = {}) {
  const errors = [];
  if (String(stage).toUpperCase() !== "V4") {
    return [contractError(stage, contract, null, "同屏正式 Scene 组合只允许在 V4 运行验收，不属于 V3 资源门", { returnStage: "V4", rootCause: "验收问题" })];
  }
  const mode = resolveVisualValidationMode(options, options.manifest, contract);
  validateVisualValidationPolicy(errors, "visual_validation", options, options.manifest, contract);
  const preacceptance = field(contract, "combination_preacceptance", "combinationPreacceptance", "same_screen_preacceptance", "sameScreenPreacceptance");
  if (!isObject(preacceptance)) {
    errors.push(contractError(stage, contract, null, "缺少同屏组合预验收", { missing: "combination_preacceptance", returnStage: "V2/V3" }));
    return errors;
  }
  for (const [names, text] of [[["status", "conclusion"], "status"], [["formal_scene_structure", "formalSceneStructure", "scene_structure", "sceneStructure"], "formal Scene structure"], [["layout_calculation_identity", "layoutCalculationIdentity", "layout_identity", "layoutIdentity"], "layout calculation identity"], [["evidence", "evidence_paths", "evidencePaths"], "组合样片 evidence"]]) {
    const value = field(preacceptance, ...names);
    if (!(nonEmptyString(value) || (isObject(value) && Object.keys(value).length > 0) || (Array.isArray(value) && value.length > 0))) errors.push(contractError(stage, contract, null, `同屏组合预验收缺少 ${text}`, { missing: text, returnStage: "V2/V3" }));
  }
  if (!['passed', 'PASS'].includes(String(field(preacceptance, "status", "conclusion")))) errors.push(contractError(stage, contract, null, "同屏组合预验收必须通过", { actual: field(preacceptance, "status", "conclusion"), returnStage: "V2/V3" }));
  if (field(preacceptance, "formal_scene_structure", "formalSceneStructure", "scene_structure", "sceneStructure") === "screenshot" || field(preacceptance, "formal_scene_structure", "formalSceneStructure", "scene_structure", "sceneStructure") === "full-screen-image") errors.push(contractError(stage, contract, null, "禁止使用整屏截图作为正式 Scene 结构", { actual: "screenshot", returnStage: "V2/V3" }));
  const effectImage = isEffectImageContract(contract, options.manifest, options);
  const hasImageGeneration = Array.isArray(field(contract, "coverage_regions", "coverageRegions", "regions"))
    && field(contract, "coverage_regions", "coverageRegions", "regions").some((region) => field(region, "production_method", "productionMethod") === "image-generation" || field(region, "image_generation_required", "imageGenerationRequired") === true);
  if (effectImage || hasImageGeneration) {
    validateEffectImageCombinationFacts(contract, preacceptance, stage, errors, options.manifest);
  }
  if (effectImage) {
    let nodes = [];
    try {
      nodes = resolveSceneV2LayoutSource(contract, options).nodes;
    } catch (error) {
      errors.push(contractError(stage, contract, null, `V4 同屏组合无法解析唯一 V2 布局源：${error.message}`, { missing: "layout_source.nodes_file", returnStage: "V2/V3", rootCause: "方案缺失" }));
    }
    const nodeById = new Map(nodes.map((node) => [field(node, "layout_node_id", "layoutNodeId"), node]).filter(([id]) => nonEmptyString(id)));
    validateLayoutGeometryFacts(contract, preacceptance, stage, errors, { nodes, nodeById }, { visual_validation: { mode } });
  }
  return errors;
}

/** 校验 V4 正式 Scene 中的资源显示、组合和运行消费条件。 */
export function validateSceneAssetUsageContract(region, unit, stage = "V4") {
  // V3 不存在正式 Scene 消费事实；该合同只在 V4 实际运行验收时生效。
  if (String(stage).toUpperCase() !== "V4") return [];
  const errors = [];
  if (!isObject(region)) return errors;
  const usage = { ...(isObject(region.scene_asset_usage ?? region.sceneAssetUsage) ? (region.scene_asset_usage ?? region.sceneAssetUsage) : {}), ...(isObject(unit?.scene_asset_usage ?? unit?.sceneAssetUsage) ? (unit.scene_asset_usage ?? unit.sceneAssetUsage) : {}) };
  const labelRegion = { ...region, ...(unit ?? {}) };
  for (const [names, text] of [
    [["target_display_size", "targetDisplaySize", "display_size", "displaySize"], "target display size"],
    [["intended_scale_range", "intendedScaleRange", "scale_range", "scaleRange"], "intended scale range"],
    [["origin", "target_origin", "targetOrigin"], "origin"],
    [["anchor", "target_anchor", "targetAnchor"], "anchor"],
    [["nine_slice", "nineSlice", "nine_slice_policy", "nineSlicePolicy", "stretch_policy", "stretchPolicy"], "nine-slice/stretch policy"],
    [["material", "material_facts", "materialFacts", "expected_material", "expectedMaterial"], "material/color family"],
    [["composition_region", "compositionRegion", "target_composition_region", "targetCompositionRegion"], "target composition region"],
    [["required_neighbors", "requiredNeighbors", "neighbor_relationships", "neighborRelationships"], "neighbor relationships"],
    [["typography_ownership", "typographyOwnership"], "typography ownership"],
    [["runtime_foreground_ownership", "runtimeForegroundOwnership", "foreground_ownership", "foregroundOwnership"], "runtime foreground ownership"],
  ]) {
    const value = field(usage, ...names) ?? field(labelRegion, ...names);
    // 邻接关系可以明确声明为空数组，表示该资源在目标构图中没有必需邻居；未声明仍然失败。
    const valid = Array.isArray(value) ? (value.length > 0 || text === "neighbor relationships") : isObject(value) ? Object.keys(value).length > 0 : nonEmptyString(value) || typeof value === "number" || typeof value === "boolean";
    if (!valid) errors.push(contractError(stage, labelRegion, labelRegion, `V3 场景资源使用合同缺少 ${text}`, { missing: text, returnStage: "V2/V3" }));
  }
  const origin = field(usage, "origin", "target_origin", "targetOrigin") ?? field(labelRegion, "origin", "target_origin", "targetOrigin");
  if (origin !== undefined && (!isObject(origin) || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || origin.x < 0 || origin.x > 1 || origin.y < 0 || origin.y > 1)) {
    errors.push(contractError(stage, labelRegion, labelRegion, "V3 场景资源 origin 必须是 0..1 范围内的有限数值 x/y", { actual: origin, returnStage: "V2/V3" }));
  } else if (isObject(origin) && (origin.x !== 0.5 || origin.y !== 0.5)) {
    // 中心锚点是默认规则；非中心坐标必须同时解释例外原因和坐标换算方式，避免资产放置基准含糊。
    if (!nonEmptyString(field(usage, "origin_exception_reason", "originExceptionReason"))) {
      errors.push(contractError(stage, labelRegion, labelRegion, "V3 场景资源 origin 非中心值必须提供非空 origin_exception_reason", { missing: "origin_exception_reason", returnStage: "V2/V3" }));
    }
    if (!nonEmptyString(field(usage, "origin_coordinate_conversion", "originCoordinateConversion"))) {
      errors.push(contractError(stage, labelRegion, labelRegion, "V3 场景资源 origin 非中心值必须提供非空 origin_coordinate_conversion", { missing: "origin_coordinate_conversion", returnStage: "V2/V3" }));
    }
  }
  return errors;
}

/** 校验 V2/V3 冻结场景方案，正式运行证据只在 V4 执行。 */
export function validateSceneReconstructionContract(contract, manifest = null, options = {}) {
  const stage = options.stage ?? "V1";
  const errors = [];
  if (!isObject(contract)) {
    errors.push(contractError(stage, contract, null, "effect-image 工件缺少 scene_reconstruction_contract；旧独立资源工件不兼容", { missing: "scene_reconstruction_contract", returnStage: "V1/PROPOSAL" }));
    return errors;
  }
  const mode = resolveVisualValidationMode(options, manifest, contract);
  validateVisualValidationPolicy(errors, "visual_validation", options, manifest, contract);
  const version = contractVersion(contract);
  if (!nonEmptyString(version)) errors.push(contractError(stage, contract, null, "scene_reconstruction_contract 缺少版本", { missing: "contract_version", returnStage: "V1/PROPOSAL" }));
  const effectImage = isEffectImageContract(contract, manifest, options);
  // V1 先冻结冲突记录；V2 产物必须在 V2→V3 回对时完整绑定，不能用独立资源计划代替。
  validateReferenceTechnicalConflicts(contract, stage, errors);
  if (["V2", "V3", "V4"].includes(String(stage).toUpperCase())) {
    validateV2StageArtifacts(contract, stage, errors);
    if (String(stage).toUpperCase() !== "V2") errors.push(...validateVisualPostApprovalReviewFields(manifest ?? contract, { stage }));
  }
  const targetInfo = validateTargetConditions(contract, manifest, stage, errors, effectImage);
  const requireFinalLayout = options.requireFinalLayout ?? (String(stage).toUpperCase() === "V4" || (String(stage).toUpperCase() === "V2" && (manifest?.visualStageState === "v2-production-planning-complete" || manifest?.visual_stage_state === "v2-production-planning-complete")));
  // 场景只盘点自身常驻显示层；独立弹窗由调用方按 DISPLAY_LAYER 工作项作用域单独验收。
  const lifecycle = manifest?.effect_image_reconstruction?.lifecycle;
  const normalizedStage = String(stage).toUpperCase();
  const displayLayerStage = normalizedStage === "V4" ? "V4" : normalizedStage;
  errors.push(...validateDisplayLayerPlanning(field(contract, "display_layer_planning"), targetInfo, { stage: displayLayerStage, scope: options.displayLayerScope ?? "scene", visual_baseline: manifest?.visual_baseline, reference_target: manifest?.reference_target }));
  const toleranceBlock = field(contract, "predeclared_tolerances", "predeclaredTolerances", "tolerance_set", "toleranceSet", "tolerances");
  const toleranceIds = Array.isArray(toleranceBlock) ? new Set(toleranceBlock.map((item) => item?.id ?? item?.tolerance_id ?? item?.toleranceId).filter(nonEmptyString)) : new Set();
  const regions = field(contract, "coverage_regions", "coverageRegions", "regions");
  if (!Array.isArray(regions) || regions.length === 0) errors.push(contractError(stage, contract, null, "scene_reconstruction_contract.coverage_regions 必须为非空数组", { missing: "coverage_regions", returnStage: "V1/PROPOSAL" }));
  else {
    const ids = new Set();
    for (const region of regions) {
      validateCoverageRegion(region, contract, stage, toleranceIds, errors, effectImage, requireFinalLayout, mode);
      const regionId = field(region, "region_id", "regionId", "id");
      if (nonEmptyString(regionId) && ids.has(regionId)) errors.push(contractError(stage, contract, region, "coverage region_id 重复", { actual: regionId, returnStage: "V1/PROPOSAL" }));
      if (nonEmptyString(regionId)) ids.add(regionId);
    }
    const manifestRegions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : [];
    for (const manifestRegion of manifestRegions) {
      const id = manifestRegion?.id;
      if (nonEmptyString(id) && !ids.has(id)) errors.push(contractError(stage, contract, manifestRegion, "coverage region 缺少对应 scene reconstruction visual facts", { missing: id, returnStage: "V1/PROPOSAL" }));
    }
  }
  const layoutInfo = validateLayoutDecomposition(contract, targetInfo, stage, errors, effectImage, { ...options, requireLayout: requireFinalLayout });
  if (effectImage && ["V2", "V4"].includes(String(stage).toUpperCase())) validateV2LayoutStage(contract, targetInfo, stage, errors, requireFinalLayout, layoutInfo, options);
  validateLayoutRegionBindings(regions, layoutInfo, contract, stage, errors, effectImage);
  // effect-image 的文本必须先完成独立拆解；普通合同由模块内部直接跳过，不引入额外硬门。
  errors.push(...validateSceneTextDecomposition(contract, { stage, manifest, effectImage, regions, layoutInfo, toleranceDefinitions: toleranceBlock }));
  // effect-image 的每个视觉区域都必须先完成来源路线分析；普通游戏 UI 不受该忠实还原硬门影响。
  if (effectImage) errors.push(...validateSceneVisualRouteContract(contract, manifest, { ...options, stage, toleranceDefinitions: toleranceBlock }));
  validateCompositionAndResponsive(contract, targetInfo, stage, errors, effectImage, mode);
  const responsive = field(contract, "responsive_contract", "responsiveContract", "responsive");
  const responsiveBinding = field(responsive, "layout_contract_binding", "layoutContractBinding", "layout_contract", "layoutContract");
  validateLayoutBindingConsistency(responsiveBinding, layoutInfo.binding, contract, stage, errors, "responsive_contract layout binding", "layout_decomposition binding", effectImage);
  validateRootLayoutIdentity(contract, targetInfo, responsiveBinding, layoutInfo.binding, stage, errors, effectImage);
  if (["V3", "V4"].includes(String(stage).toUpperCase())) {
    const lifecycle = field(contract, "status", "lifecycle", "stage_status", "stageStatus");
    if (lifecycle === "proposal-missing" || lifecycle === "missing") errors.push(contractError(stage, contract, null, "还原方案缺失，不能进入生产", { actual: lifecycle, returnStage: "V1/PROPOSAL" }));
  }
  // 同屏运行组合属于正式验收；V3 只验收正式资源，V4 直接实施与验收正式场景。
  if (String(stage).toUpperCase() === "V4") errors.push(...validateSceneCombinationPreacceptance(contract, "V4", { ...options, effectImage, manifest, visual_validation: { mode } }));
  return errors;
}

/** 判断逐区域目标事实与候选事实是否存在可见差异；比较失败时不能靠 PASS 字符串掩盖。 */
function factsDiffer(targetValue, candidateValue) {
  if (targetValue === undefined || candidateValue === undefined) return false;
  try { return JSON.stringify(targetValue) !== JSON.stringify(candidateValue); } catch { return String(targetValue) !== String(candidateValue); }
}

/** 判断 delta 是否明确表示超出零差异的结果。 */
function nonZeroDelta(delta) {
  if (typeof delta === "number") return delta !== 0;
  if (isObject(delta)) return Object.values(delta).some((value) => typeof value === "number" && value !== 0);
  if (Array.isArray(delta)) return delta.length > 0;
  if (typeof delta === "string") return delta.trim().length > 0 && !["0", "0px", "none", "equal"].includes(delta.trim().toLowerCase());
  return false;
}

/** 判断差异证据是否有效；静态比较不适用时必须说明原因，null 不能绕过。 */
function validDifferenceEvidence(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0 && value.trim().toLowerCase() !== "not-applicable";
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => nonEmptyString(item) || (isObject(item) && Object.keys(item).length > 0));
  if (!isObject(value) || Object.keys(value).length === 0) return false;
  const status = String(value.status ?? value.applicability ?? "").toLowerCase();
  if (["not-applicable", "na", "n/a"].includes(status)) return nonEmptyString(value.reason ?? value.rationale ?? value.explanation);
  return nonEmptyString(value.path ?? value.file ?? value.evidence ?? value.evidence_path ?? value.evidencePath) || (Array.isArray(value.paths) && value.paths.length > 0);
}

/** 读取归一化后的 viewport、DPR 和逻辑坐标等价证明。 */
function validateNormalizationEquivalence(item, label, stage, errors, mode = "usability") {
  const exact = mode === "exact";
  const proof = field(item, "normalization_equivalence", "normalizationEquivalence", "condition_equivalence", "conditionEquivalence", "viewport_dpr_logical_equivalence", "viewportDprLogicalEquivalence");
  const direct = {
    viewport: field(item, "viewport_equivalence", "viewportEquivalence"),
    dpr: field(item, "dpr_equivalence", "dprEquivalence"),
    logical: field(item, "logical_coordinate_equivalence", "logicalCoordinateEquivalence", "logical_coordinates_equivalence", "logicalCoordinatesEquivalence"),
  };
  const source = isObject(proof) ? proof : direct;
  if (!isObject(source)) {
    if (exact) errors.push(contractError(stage, item, item, `${label} 缺少 viewport/DPR/逻辑坐标等价证明`, { missing: "normalization_equivalence", returnStage: "VALIDATING", rootCause: "验收问题" }));
    return;
  }
  for (const [key, names, text] of [
    ["viewport", ["viewport", "viewport_equivalence", "viewportEquivalence"], "viewport"],
    ["dpr", ["dpr", "dpr_equivalence", "dprEquivalence"], "DPR"],
    ["logical", ["logical_coordinates", "logical_coordinate_equivalence", "logicalCoordinates", "logicalCoordinateEquivalence", "logical_coordinate_space", "logicalCoordinateSpace"], "逻辑坐标"],
  ]) {
    const entry = field(source, ...names);
    if (!isObject(entry)) {
      if (exact) errors.push(contractError(stage, item, item, `${label} 缺少 ${text} 等价证明`, { missing: `normalization_equivalence.${key}`, returnStage: "VALIDATING", rootCause: "验收问题" }));
      continue;
    }
    const target = field(entry, "target", "reference", "target_viewport", "targetViewport", "reference_viewport", "referenceViewport", "target_dpr", "targetDpr", "target_coordinates", "targetCoordinates");
    const candidate = field(entry, "candidate", "actual", "candidate_viewport", "candidateViewport", "candidate_dpr", "candidateDpr", "candidate_coordinates", "candidateCoordinates");
    const equivalent = field(entry, "equivalent", "is_equivalent", "isEquivalent", "status");
    if (exact && (target === undefined || candidate === undefined || !(equivalent === true || ["equivalent", "equal", "same", "passed", "pass"].includes(String(equivalent).toLowerCase())))) errors.push(contractError(stage, item, item, `${label} ${text} 等价证明必须同时记录 target、candidate 和 equivalent`, { missing: `normalization_equivalence.${key}.target/candidate/equivalent`, actual: JSON.stringify(entry), returnStage: "VALIDATING", rootCause: "验收问题" }));
    // DPR 等价证明不要求设备都达到上限，但必须是有效值、两侧相等且由机器明确标记等价。
    if (exact && key === "dpr" && (!isWorkflowDpr(target) || !isWorkflowDpr(candidate) || target !== candidate || equivalent !== true)) errors.push(contractError(stage, item, item, `${label} DPR 等价证明必须使用有效 DPR、target 与 candidate 相等且 equivalent=true`, { expected: JSON.stringify({ target: "(0,2]", candidate: "与 target 相等", equivalent: true }), actual: JSON.stringify(entry), returnStage: "VALIDATING", rootCause: "验收问题" }));
  }
}

/** 提取预声明容差中的数值规则；不提供跨项目默认阈值。 */
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

/** 收集 delta 中的数值差异；对象字段可按区域声明的同一规则比较。 */
function numericDeltas(value, result = []) {
  if (typeof value === "number" && Number.isFinite(value)) result.push(Math.abs(value));
  else if (isObject(value)) for (const nested of Object.values(value)) numericDeltas(nested, result);
  else if (Array.isArray(value)) for (const nested of value) numericDeltas(nested, result);
  return result;
}

/** 从目标/候选测量本身推导数值差异，避免伪造 delta=0 绕过容差门。 */
function numericFactDeltas(targetValue, candidateValue, result = []) {
  if (typeof targetValue === "number" && typeof candidateValue === "number" && Number.isFinite(targetValue) && Number.isFinite(candidateValue)) result.push(Math.abs(candidateValue - targetValue));
  else if (Array.isArray(targetValue) && Array.isArray(candidateValue)) for (let index = 0; index < Math.max(targetValue.length, candidateValue.length); index += 1) numericFactDeltas(targetValue[index], candidateValue[index], result);
  else if (isObject(targetValue) && isObject(candidateValue)) for (const key of new Set([...Object.keys(targetValue), ...Object.keys(candidateValue)])) numericFactDeltas(targetValue[key], candidateValue[key], result);
  return result;
}

/** 统一摘要键名，确保 camelCase 与 snake_case 字段使用同一验收语义。 */
function normalizeDigestComparisonKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** 只识别独立摘要令牌；阴影、共享标识和其它业务事实继续参加比较。 */
function isDigestComparisonKey(key) {
  const normalized = normalizeDigestComparisonKey(key);
  return /(^|[_-])(sha(?:1|224|256|384|512)?|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/.test(normalized);
}

/** 仅识别非数值视觉事实差异；摘要元数据不参与比较，几何数值交由 tolerance 判定。 */
function nonNumericFactsDiffer(targetValue, candidateValue, key = "") {
  if (isDigestComparisonKey(key)) return false;
  if (typeof targetValue === "number" && typeof candidateValue === "number") return false;
  if (typeof targetValue === "number" || typeof candidateValue === "number") return typeof targetValue !== typeof candidateValue;
  if (Array.isArray(targetValue) && Array.isArray(candidateValue)) return targetValue.length !== candidateValue.length || targetValue.some((value, index) => nonNumericFactsDiffer(value, candidateValue[index], key));
  if (isObject(targetValue) && isObject(candidateValue)) {
    const keys = new Set([...Object.keys(targetValue), ...Object.keys(candidateValue)]);
    return [...keys].some((childKey) => nonNumericFactsDiffer(targetValue[childKey], candidateValue[childKey], childKey));
  }
  return JSON.stringify(targetValue) !== JSON.stringify(candidateValue);
}

/** 在 usability 模式下忽略几何、排版和证据元数据，保留其它视觉语义事实。 */
function usabilitySemanticFactsDiffer(targetValue, candidateValue, key = "") {
  const normalizedKey = normalizeDigestComparisonKey(key);
  if (isDigestComparisonKey(normalizedKey)) return false;
  const presentationKeys = new Set(["x", "y", "width", "height", "left", "right", "top", "bottom", "offset", "position", "bounds", "rect", "geometry", "size", "target_bounds", "candidate_bounds", "actual_bounds", "reference_bounds", "pixel_bounds", "logical_bounds", "spacing", "margin", "padding", "scale", "transform", "coordinate_space", "anchor", "reference", "alignment", "axis_alignment", "self_anchor", "reference_anchor", "line_break", "line_breaks", "wrap", "whitespace", "font", "font_family", "font_size", "font_weight", "font_style", "line_height", "letter_spacing", "baseline", "glyph_bounds", "text_align", "text_anchor"]);
  const metadataKeys = new Set(["evidence", "evidence_path", "evidence_paths", "target_sha", "target_sha256", "candidate_sha", "candidate_sha256", "sha", "sha1", "sha256", "hash", "checksum", "fingerprint", "diff_fingerprint", "identity", "source", "origin", "timestamp", "dpr", "viewport", "locale", "seed", "random_seed", "input_trace", "test_id", "planned_test_id"]);
  if (presentationKeys.has(normalizedKey) || metadataKeys.has(normalizedKey)) return false;
  if (Array.isArray(targetValue) && Array.isArray(candidateValue)) return targetValue.length !== candidateValue.length || targetValue.some((value, index) => usabilitySemanticFactsDiffer(value, candidateValue[index], key));
  if (Array.isArray(targetValue) || Array.isArray(candidateValue)) return true;
  if (isObject(targetValue) && isObject(candidateValue)) {
    const keys = new Set([...Object.keys(targetValue), ...Object.keys(candidateValue)]);
    return [...keys].some((childKey) => usabilitySemanticFactsDiffer(targetValue[childKey], candidateValue[childKey], childKey));
  }
  if (isObject(targetValue) || isObject(candidateValue)) return true;
  if (normalizedKey === "measurement" && (typeof targetValue === "number" || typeof candidateValue === "number")) return false;
  return JSON.stringify(targetValue) !== JSON.stringify(candidateValue);
}

/** 判断目标到候选是否出现已知的可用性负向变化，避免批准例外掩盖真实失败。 */
function usabilityNegativeFactsDiffer(targetValue, candidateValue, key = "") {
  const normalizedKey = normalizeDigestComparisonKey(key);
  if (isDigestComparisonKey(normalizedKey)) return false;
  const positiveKey = /(^|_)(visible|visibility|readable|readability|enabled|interactive|clickable|available|availability|usable|accessible|accessibility|present|active)($|_)/.test(normalizedKey);
  const negativeKey = /(^|_)(occluded|occlusion|unreadable|hidden|invisible|blocked|disabled|cropped|clipped|offscreen|out_of_viewport|overflowed|interaction_failed)($|_)/.test(normalizedKey);
  if (Array.isArray(targetValue) || Array.isArray(candidateValue)) {
    const targetArray = Array.isArray(targetValue) ? targetValue : [];
    const candidateArray = Array.isArray(candidateValue) ? candidateValue : [];
    return Array.from({ length: Math.max(targetArray.length, candidateArray.length) }, (_, index) => index).some((index) => usabilityNegativeFactsDiffer(targetArray[index], candidateArray[index], key));
  }
  if (isObject(targetValue) || isObject(candidateValue)) {
    const targetObject = isObject(targetValue) ? targetValue : {};
    const candidateObject = isObject(candidateValue) ? candidateValue : {};
    const keys = new Set([...Object.keys(targetObject), ...Object.keys(candidateObject)]);
    return [...keys].some((childKey) => usabilityNegativeFactsDiffer(targetObject[childKey], candidateObject[childKey], childKey));
  }
  const candidateToken = typeof candidateValue === "string" ? candidateValue.trim().toLowerCase().replace(/[_ -]+/g, "_") : "";
  const candidateNegative = (positiveKey && candidateValue === false)
    || (negativeKey && candidateValue === true)
    || /(^|_)(unreadable|hidden|invisible|occluded|blocked|disabled|cropped|clipped|offscreen|out_of_viewport|overflowed|interaction_failed|failed|fail|unusable|unavailable)($|_)/.test(candidateToken);
  return candidateNegative && JSON.stringify(targetValue) !== JSON.stringify(candidateValue);
}

/** 从候选事实提取矩形，兼容 bounds/rect 包装而不改变事实身份校验。 */
function factBounds(value) {
  if (!isObject(value)) return value;
  return isObject(value.bounds) ? value.bounds : isObject(value.rect) ? value.rect : value;
}

/** 校验 V4 结构化 fidelity case，禁止只凭资源加载或模糊 tolerance 放行。 */
export function validateStructuredFidelityCases(cases, manifest = null, options = {}) {
  const errors = [];
  const stage = options.stage ?? "V4";
  if (!(["V4", "VALIDATING"].includes(String(stage).toUpperCase()))) {
    return [contractError(stage, manifest?.scene_reconstruction_contract, null, "结构化 fidelity 运行验收只允许在 V4/VALIDATING", { returnStage: "V4", rootCause: "验收问题" })];
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    errors.push(contractError(stage, null, null, "fidelity_cases 必须是非空结构化数组", { missing: "fidelity_cases", returnStage: "VALIDATING" }));
    return errors;
  }
  const mode = resolveVisualValidationMode(options, manifest, manifest?.scene_reconstruction_contract, ...cases);
  const exact = mode === "exact";
  validateVisualValidationPolicy(errors, "visual_validation", options, manifest, manifest?.scene_reconstruction_contract, ...cases);
  const target = manifest?.reference_target ?? {};
  const targetPairs = new Set((target.scene_ids ?? []).flatMap((scene) => (target.state_ids ?? []).map((state) => `${scene}\0${state}`)));
  const coveredPairs = new Set();
  const manifestRegionIds = new Set((manifest?.coverage_audit?.regions ?? []).map((region) => region?.id).filter(nonEmptyString));
  const sceneContract = manifest?.scene_reconstruction_contract;
  const predeclared = field(sceneContract, "predeclared_tolerances", "predeclaredTolerances", "tolerance_set", "toleranceSet", "tolerances");
  const toleranceDefinitions = new Map((Array.isArray(predeclared) ? predeclared : []).filter(isObject).map((item) => [field(item, "id", "tolerance_id", "toleranceId"), item]).filter(([id]) => nonEmptyString(id)));
  const sceneRegions = new Map((field(sceneContract, "coverage_regions", "coverageRegions", "regions") ?? []).filter(isObject).map((region) => [field(region, "region_id", "regionId", "id"), region]).filter(([id]) => nonEmptyString(id)));
  for (const [index, item] of cases.entries()) {
    const label = `fidelity_cases[${index}]`;
    if (!isObject(item)) { errors.push(contractError(stage, null, null, `${label} 必须是对象`, { missing: label, returnStage: "VALIDATING" })); continue; }
    // fidelity case 属于 V4 机器验证事实；V2 拆解确认后不得再挂 human_review 或 reviewer。
    errors.push(...validateVisualPostApprovalReviewFields(item, { stage }));
    const targetIdentity = field(item, "target_identity", "targetIdentity") ?? {};
    const candidateIdentity = field(item, "candidate_identity", "candidateIdentity") ?? {};
    const sceneId = field(item, "scene_id", "sceneId"); const stateId = field(item, "state_id", "stateId");
    if (!nonEmptyString(sceneId) || !nonEmptyString(stateId)) errors.push(contractError(stage, item, null, `${label} 缺少 scene/state`, { missing: "scene_id/state_id", returnStage: "VALIDATING" }));
    if (targetPairs.size && targetPairs.has(`${sceneId}\0${stateId}`)) coveredPairs.add(`${sceneId}\0${stateId}`);
    const viewport = field(item, "viewport", "target_viewport", "targetViewport");
    if (!validViewport(viewport)) errors.push(contractError(stage, item, null, `${label} 缺少正数 viewport`, { missing: "viewport", returnStage: "VALIDATING" }));
    if (!isWorkflowDpr(item.dpr)) errors.push(contractError(stage, item, null, workflowDprError(`${label}.dpr`, item.dpr), { missing: "dpr", returnStage: "VALIDATING" }));
    for (const [names, text] of [[["locale", "language"], "locale"], [["input_trace", "inputTrace"], "input_trace"], [["stable_frame", "stableFrame", "animation_sample", "animationSample"], "stable frame/animation sample"], [["scene_id", "sceneId"], "scene_id"], [["state_id", "stateId"], "state_id"]]) requiredString(item, names, `${label}.${text}`, errors, { stage, contract: item, region: item, returnStage: "VALIDATING", rootCause: "验收问题", missing: `${label}.${text}` });
    const fidelitySeed = field(item, "random_seed", "randomSeed", "seed");
    if (!(Number.isInteger(fidelitySeed) || nonEmptyString(fidelitySeed))) errors.push(contractError(stage, item, null, `${label}.seed 缺少有效 random seed`, { missing: "seed", returnStage: "VALIDATING" }));
    const targetSize = field(item, "original_target_size", "originalTargetSize", "target_size", "targetSize", "target_identity");
    const candidateSize = field(item, "original_candidate_size", "originalCandidateSize", "candidate_size", "candidateSize", "candidate_identity");
    const normalizedTargetSize = targetSize?.original_size ?? targetSize?.original_pixel_size ?? targetSize;
    const normalizedCandidateSize = candidateSize?.original_size ?? candidateSize?.original_pixel_size ?? candidateSize;
    if (!validSize(normalizedTargetSize)) errors.push(contractError(stage, item, null, `${label} 缺少 target 原始尺寸`, { missing: "original_target_size", returnStage: "VALIDATING" }));
    if (!validSize(normalizedCandidateSize)) errors.push(contractError(stage, item, null, `${label} 缺少 candidate 原始尺寸`, { missing: "original_candidate_size", returnStage: "VALIDATING" }));
    const transform = field(item, "normalization_transform", "normalizationTransform", "deterministic_normalization_transform", "deterministicNormalizationTransform");
    if (!isObject(transform) || (!nonEmptyString(transform.type) && !nonEmptyString(transform.kind)) || (transform.scale_x === undefined && transform.scaleX === undefined && transform.matrix === undefined && transform.operations === undefined)) errors.push(contractError(stage, item, null, `${label} 缺少确定性归一化变换`, { missing: "normalization_transform", returnStage: "VALIDATING" }));
    validateNormalizationEquivalence(item, label, stage, errors, mode);
    const canvas = field(item, "normalized_comparison_canvas", "normalizedComparisonCanvas", "comparison_canvas", "comparisonCanvas");
    if (exact && !validSize(canvas)) errors.push(contractError(stage, item, null, `${label} 缺少 normalized comparison canvas`, { missing: "normalized_comparison_canvas", returnStage: "VALIDATING" }));
    for (const [names, text] of [[["full_viewport_reference", "fullViewportReference", "reference_full_viewport"], "完整参考画面"], [["full_viewport_candidate", "fullViewportCandidate", "candidate_full_viewport"], "完整候选画面"], [["side_by_side_evidence", "sideBySideEvidence"], "side-by-side evidence"], [["overlay_evidence", "overlayEvidence"], "overlay evidence"]]) {
      const value = field(item, ...names);
      // usability 只要求代表性参考/候选证据；side-by-side 与 overlay 属于可选的精确比对材料。
      if (exact && !(nonEmptyString(value) || (Array.isArray(value) && value.length > 0) || (isObject(value) && Object.keys(value).length > 0))) errors.push(contractError(stage, item, null, `${label} 缺少 ${text}`, { missing: text, returnStage: "VALIDATING" }));
      if (!exact && ["完整参考画面", "完整候选画面"].includes(text) && !(nonEmptyString(value) || (Array.isArray(value) && value.length > 0) || (isObject(value) && Object.keys(value).length > 0))) errors.push(contractError(stage, item, null, `${label} 缺少 ${text}`, { missing: text, returnStage: "VALIDATING" }));
    }
    const targetPixelSize = field(target, "original_pixel_size", "originalPixelSize", "original_size", "originalSize") ?? {};
    const targetWidth = targetPixelSize.width; const targetHeight = targetPixelSize.height;
    const candidateId = field(candidateIdentity, "candidate_id", "candidateId") ?? field(item, "candidate_id", "candidateId");
    const manifestCandidateId = field(manifest?.candidate_identity, "candidate_id", "candidateId") ?? field(manifest, "candidateId", "candidate_id");
    const candidateVersion = field(candidateIdentity, "candidate_version", "candidateVersion") ?? field(item, "candidate_version", "candidateVersion");
    const manifestCandidateVersion = field(manifest, "candidateVersion", "candidate_version");
    if (nonEmptyString(candidateId) && nonEmptyString(manifestCandidateId) && candidateId !== manifestCandidateId) errors.push(contractError(stage, item, item, `${label} candidate ID 与当前候选不一致`, { expected: manifestCandidateId, actual: candidateId, returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (nonEmptyString(candidateVersion) && nonEmptyString(manifestCandidateVersion) && candidateVersion !== manifestCandidateVersion) errors.push(contractError(stage, item, item, `${label} candidateVersion 与当前候选不一致`, { expected: manifestCandidateVersion, actual: candidateVersion, returnStage: "VALIDATING", rootCause: "验收问题" }));
    const targetFile = field(target, "original_file", "originalFile", "file", "path");
    const caseTargetFile = field(targetIdentity, "original_file", "originalFile", "file", "path") ?? field(item, "target_file", "targetFile");
    if (nonEmptyString(caseTargetFile) && nonEmptyString(targetFile) && caseTargetFile !== targetFile) errors.push(contractError(stage, item, item, `${label} 参考文件未绑定当前冻结目标`, { expected: targetFile, actual: caseTargetFile, returnStage: "VALIDATING", rootCause: "验收问题" }));
    if (targetWidth && normalizedTargetSize?.width && (normalizedTargetSize.width !== targetWidth || normalizedTargetSize.height !== targetHeight)) errors.push(contractError(stage, item, null, `${label} target 原始尺寸与冻结目标不一致`, { expected: `${targetWidth}x${targetHeight}`, actual: `${normalizedTargetSize.width}x${normalizedTargetSize.height}`, returnStage: "VALIDATING" }));
    const differenceEvidence = field(item, "difference_evidence", "differenceEvidence", "diff_evidence", "diffEvidence");
    if (exact && !validDifferenceEvidence(differenceEvidence)) errors.push(contractError(stage, item, item, `${label} difference evidence 无效；必须提供证据或 not-applicable+reason`, { missing: "difference_evidence", actual: differenceEvidence === null ? "null" : String(differenceEvidence ?? "missing"), returnStage: "VALIDATING", rootCause: "验收问题" }));
    const tolerance = field(item, "tolerance_set", "toleranceSet", "tolerance", "tolerances");
    if (exact && !isObject(tolerance) && !Array.isArray(tolerance)) errors.push(contractError(stage, item, item, `${label} tolerance 必须是结构化对象/集合，不能使用任意字符串`, { missing: "tolerance_set", returnStage: "VALIDATING", rootCause: "方案缺失" }));
    const regionResults = field(item, "per_region_results", "perRegionResults", "region_results", "regionResults");
    if (!Array.isArray(regionResults) || regionResults.length === 0) errors.push(contractError(stage, item, null, `${label} 缺少逐区域结果矩阵`, { missing: "per_region_results", returnStage: "VALIDATING" }));
    else {
      const seen = new Set();
      for (const [regionIndex, result] of regionResults.entries()) {
        const regionId = field(result, "region_id", "regionId", "id");
        const regionContract = sceneRegions.get(regionId) ?? manifest?.coverage_audit?.regions?.find((region) => region?.id === regionId);
        const region = { ...(regionContract ?? {}), ...(result ?? {}) };
        const required = [[["target_measurement", "targetMeasurement", "target_fact", "targetFact"], "target measurement/fact"], [["candidate_measurement", "candidateMeasurement", "candidate_fact", "candidateFact"], "candidate measurement/fact"], [["result", "status"], "result"], [["evidence", "evidence_paths", "evidencePaths"], "evidence"]];
        if (exact) required.splice(2, 0, [["delta", "delta_measurement", "deltaMeasurement"], "delta"]);
        for (const [names, text] of required) {
          const value = field(result, ...names);
          if (!(nonEmptyString(value) || typeof value === "number" || typeof value === "boolean" || (isObject(value) && Object.keys(value).length > 0) || (Array.isArray(value) && value.length > 0))) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 缺少 ${text}`, { missing: text, returnStage: "VALIDATING" }));
        }
        if (!nonEmptyString(regionId)) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 缺少 region_id`, { missing: "region_id", returnStage: "VALIDATING" }));
        if (nonEmptyString(regionId) && seen.has(regionId)) errors.push(contractError(stage, item, region, `${label}.per_region_results region_id 重复`, { actual: regionId, returnStage: "VALIDATING" }));
        if (nonEmptyString(regionId)) seen.add(regionId);
        const declaredToleranceId = field(regionContract, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
        const resultToleranceId = field(result, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
        if (exact && (!nonEmptyString(declaredToleranceId) || !toleranceDefinitions.has(declaredToleranceId))) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 未绑定 scene contract 预声明 tolerance ID`, { missing: "coverage_region.tolerance_reference", expected: [...toleranceDefinitions.keys()].join(",") || "scene_reconstruction_contract.predeclared_tolerances", returnStage: "VALIDATING", rootCause: "方案缺失" }));
        else if (exact && resultToleranceId !== declaredToleranceId) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] tolerance 必须引用 coverage region 的预声明 ID`, { expected: declaredToleranceId, actual: String(resultToleranceId ?? "missing"), returnStage: "VALIDATING", rootCause: "方案缺失" }));
        const toleranceDefinition = toleranceDefinitions.get(declaredToleranceId);
        const declaredLimit = toleranceLimit(toleranceDefinition);
        if (exact && declaredLimit === null) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 预声明 tolerance 缺少可执行数值规则`, { missing: `${declaredToleranceId}.rules.value`, returnStage: "VALIDATING", rootCause: "方案缺失" }));
        const resultValue = String(field(result, "result", "status") ?? "").toLowerCase();
        if (!["passed", "pass", "failed", "fail"].includes(resultValue)) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] result 不能为 unverified/unknown/missing`, { actual: resultValue || "missing", returnStage: "VALIDATING" }));
        const exception = field(result, "exception_id", "exceptionId", "exception_ids", "exceptionIds");
        const delta = field(result, "delta", "delta_measurement", "deltaMeasurement");
        const targetFact = field(result, "target_measurement", "targetMeasurement", "target_fact", "targetFact");
        const candidateFact = field(result, "candidate_measurement", "candidateMeasurement", "candidate_fact", "candidateFact");
        const exceptionIds = Array.isArray(exception) ? exception.filter(nonEmptyString) : nonEmptyString(exception) ? [exception] : [];
        const declaredExceptions = field(regionContract, "approved_exception_ids", "approvedExceptionIds", "exception_ids", "exceptionIds");
        const approvedExceptionIds = new Set((Array.isArray(declaredExceptions) ? declaredExceptions : nonEmptyString(declaredExceptions) ? [declaredExceptions] : []).filter(nonEmptyString));
        const hasApprovedException = exceptionIds.length > 0 && exceptionIds.every((id) => approvedExceptionIds.has(id));
        const hasUnapprovedException = exceptionIds.length > 0 && !hasApprovedException;
        // usability 的越界判断使用当前 fidelity case 视口；响应式代表视口可以与冻结目标不同。
        const targetViewport = viewport;
        const exceedsTolerance = visualGeometryDifferenceExceeds(targetFact, candidateFact, delta, { mode, declaredLimit });
        const visibilitySource = isObject(candidateFact) ? { ...candidateFact, ...result } : result;
        const candidateOutsideViewport = visualBoundsOutsideViewport(factBounds(candidateFact), targetViewport, visibilitySource, regionContract);
        const hasFactDifference = exact ? nonNumericFactsDiffer(targetFact, candidateFact) : usabilitySemanticFactsDiffer(targetFact, candidateFact, "measurement");
        const hasNegativeFactDifference = usabilityNegativeFactsDiffer(targetFact, candidateFact);
        const hasUnexplainedFactDifference = hasFactDifference && !exceedsTolerance && (!hasApprovedException || hasNegativeFactDifference);
        if (hasUnapprovedException) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] exception ID 未被合同显式批准`, { expected: [...approvedExceptionIds].join(",") || "approved_exception_ids", actual: exceptionIds.join(","), returnStage: "VALIDATING", rootCause: "方案缺失" }));
        if (candidateOutsideViewport) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] candidate bounds 超出目标 viewport，存在越界或裁切`, { expected: "candidate bounds 完全位于目标 viewport 内", actual: JSON.stringify(candidateFact), returnStage: "VALIDATING", rootCause: "验收问题" }));
        if (exceedsTolerance) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 存在未解释差异：数值 delta 超出预声明 tolerance`, { expected: `<=${declaredLimit}`, actual: JSON.stringify(delta), returnStage: "VALIDATING", rootCause: "验收问题" }));
        if (hasUnexplainedFactDifference) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] 存在未解释差异：${hasNegativeFactDifference ? "可用性负向事实不得由批准例外绕过" : "非数值视觉事实差异且缺精确批准例外 ID"}`, { missing: hasNegativeFactDifference ? "candidate 可用性事实" : "approved exception_id", returnStage: "VALIDATING", rootCause: "验收问题" }));
        if ((resultValue === "passed" || resultValue === "pass") && (candidateOutsideViewport || exceedsTolerance || hasUnexplainedFactDifference)) errors.push(contractError(stage, item, region, `${label}.per_region_results[${regionIndex}] PASS 不能掩盖越界、超容差或未批准的事实差异`, { expected: "候选可用性通过且精确模式下差异在预声明容差内", actual: JSON.stringify({ target: targetFact, candidate: candidateFact, delta }), returnStage: "VALIDATING", rootCause: "验收问题" }));
      }
      const failed = regionResults.filter((result) => ["failed", "fail", "unverified", "unknown", "missing"].includes(String(field(result, "result", "status") ?? "").toLowerCase()));
      if (failed.length && ["passed", "PASS"].includes(String(item.conclusion ?? ""))) errors.push(contractError(stage, item, null, `${label}.conclusion=PASS 与逐区域 FAIL/unverified/missing 冲突`, { actual: `${failed.length} 个区域未通过`, returnStage: "VALIDATING" }));
      if (exact && manifestRegionIds.size) for (const id of manifestRegionIds) if (!regionResults.some((result) => field(result, "region_id", "regionId", "id") === id)) errors.push(contractError(stage, item, { id }, `${label} 缺少 coverage region 结果`, { missing: id, returnStage: "VALIDATING" }));
    }
    if (isEffectImageContract(sceneContract, manifest, options)) validateEffectImageLayoutNodeFidelity(item, sceneContract, stage, errors, toleranceDefinitions, sceneRegions, { ...options, visual_validation: { mode } });
    if (!['passed', 'PASS', 'failed', 'FAIL'].includes(String(item.conclusion ?? ""))) errors.push(contractError(stage, item, null, `${label}.conclusion 必须为 passed 或 failed`, { actual: item.conclusion ?? "missing", returnStage: "VALIDATING" }));
  }
  if (exact && targetPairs.size) for (const pair of targetPairs) if (!coveredPairs.has(pair)) errors.push(contractError(stage, null, { scene_id: pair.split("\0")[0], state_id: pair.split("\0")[1] }, "fidelity_cases 缺少冻结 scene/state 组合", { missing: pair.replace("\0", "/"), returnStage: "VALIDATING" }));
  return errors;
}

/** 对 V4 必须具备的场景合同执行完整门，供 manifest 和实施包共同调用。 */
export function validateSceneReconstructionGate(manifest, options = {}) {
  const stage = options.stage ?? "V2";
  if (String(stage).toUpperCase() === "V3") return [];
  if (!["V2", "V3", "V4"].includes(String(stage).toUpperCase())) return [contractError(stage, null, null, "场景还原阶段只能为 V2、V3 或 V4", { returnStage: "V2" })];
  const mode = resolveVisualValidationMode(options, manifest, manifest?.scene_reconstruction_contract);
  const visualValidation = { visual_validation: { mode } };
  const errors = validateSceneReconstructionContract(manifest?.scene_reconstruction_contract, manifest, { ...options, ...visualValidation, stage });
  if (stage === "V4") errors.push(...validateStructuredFidelityCases(manifest?.fidelity_cases, manifest, { ...options, stage: "V4", ...visualValidation }));
  return errors;
}
