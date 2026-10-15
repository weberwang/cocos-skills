#!/usr/bin/env node
/**
 * 视觉生产合同共享校验模块。
 * 该模块只负责把视觉清单、实施包和门禁证据中的生产事实收敛为一套
 * 机器可读语义。它不调用 图像生成，也不根据文件后缀或效果图来源猜测
 * 生产方式；所有生产方式都必须在合同中显式声明。
 */
import { readFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { atomicImageRequirementsEqual, canonicalStateId, deriveAtomicImageRequirements, hasRuntimeImplementationField, normalizeAtomicImageRequirements, normalizeProjectRelativePath, validateComponentAuditEvidence, validateVisualComponentContract, normalizeComponentExpectedAsset, visualComponentContractDifferences } from "./visual-component-contract.mjs";
import { normalizeProductionExpectedAssets as normalizeExpectedAssets } from "./visual-atomic-contract.mjs";
import { isPngOrJpegMagic, isRasterDelivery, resolveOutputMetadata } from "./visual-raster-contract.mjs";
import { collectImageGenerationPathValues, collectImageGenerationRasterViolations } from "./visual-imagegen-format.mjs";
import { decodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { componentAssetKey, declaredPathEntry, hasShareAliasConflict, pathCoveredBy, registerCrossUnitPath, reportExpectedAssetShareAliasConflicts, validateUnitPathDeclarations } from "./visual-package-paths.mjs";
import { productionFileGateError } from "./visual-file-gate.mjs";
import { validateFixedVisualProductionMethod, validateVisualDecompositionConfirmationBinding, validateVisualProductionUnitConfirmation, manualDecompositionRegions } from "./visual-decomposition-confirmation.mjs";
import { validateProductionMethodChangeRequest, validateReuseProductionGate, validateVisualConfirmationGate } from "./visual-confirmation-reuse-gates.mjs";
import { getVisualRegionDefinitionAliasConflicts, normalizeVisualRegionDefinition } from "../../cocos-game-asset-integration/scripts/effect_image_annotation_core.mjs";
import { validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { validateImageGenerationSizeContract } from "./visual-generation-size-contract.mjs";
import { validateVisualPostApprovalReviewFields } from "./visual-human-review-contract.mjs";
import { isEffectImageGeneration, validateEffectImagePromptContract } from "./effect-image-prompt-contract.mjs"; import { validateTransparentBackgroundContract, validateTransparentExpectedAssetContract } from "./visual-transparent-background-contract.mjs"; import { validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";
import { isPlainObject as isObject, isSha256, nonEmptyString, VISUAL_DELIVERY_KINDS as DELIVERY_KINDS, VISUAL_PRODUCTION_METHODS as PRODUCTION_METHODS, VISUAL_PRODUCTION_ORIGINS as PRODUCTION_ORIGINS, VISUAL_SUBSTITUTION_POLICIES as SUBSTITUTION_POLICIES } from "./visual-contract-core.mjs";
import { resolveVisualValidationMode, validateVisualValidationPolicy } from "./visual-validation-policy.mjs";
import { manifestEvidenceIdentity, productionContractError, safeProjectPath, validateEvidenceIdentity, validateImageGenerationRuntimeConsumption } from "./visual-runtime-evidence.mjs";
export { manifestEvidenceIdentity, productionContractError, validateEvidenceIdentity } from "./visual-runtime-evidence.mjs";
export { atomicImageRequirementsEqual, canonicalStateId, deriveAtomicImageRequirements, hasRuntimeImplementationField, normalizeAtomicImageRequirements, normalizeProjectRelativePath, validateComponentAuditEvidence, validateVisualComponentContract, normalizeComponentExpectedAsset, visualComponentContractDifferences } from "./visual-component-contract.mjs";
export { FIXED_VISUAL_IMAGE_METHODS, PROGRAM_VISUAL_METHODS, manualDecompositionRegions, requiresManualVisualDecomposition, validateFixedVisualProductionMethod, validateVisualDecompositionConfirmationBinding, validateVisualDecompositionConfirmationRecord, validateVisualDecompositionConfirmations, validateVisualProductionUnitConfirmation } from "./visual-decomposition-confirmation.mjs";
export { REUSE_SCHEMA, validateProductionMethodChangeRequest, validateReuseProductionGate, validateVisualConfirmationGate } from "./visual-confirmation-reuse-gates.mjs";
export { normalizeProductionExpectedAssets as normalizeExpectedAssets } from "./visual-atomic-contract.mjs";
export { isPngOrJpegMagic, isRasterDelivery, resolveOutputMetadata } from "./visual-raster-contract.mjs";
export { CANONICAL_EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, CANONICAL_EFFECT_IMAGE_NEGATIVE_PROMPT, EFFECT_IMAGE_ASSET_PROMPT_FACTS, EFFECT_IMAGE_BACKGROUND_REMOVAL_PROMPT, EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, EFFECT_IMAGE_GLOBAL_VISUAL_CONSISTENCY_PROMPT, EFFECT_IMAGE_NEGATIVE_PROMPT, EFFECT_IMAGE_PIXEL_REUSE_POLICY, EFFECT_IMAGE_RECONSTRUCTION_MODE, EFFECT_IMAGE_REFERENCE_INPUT_MODE, buildEffectImageAssetPrompt, buildEffectImageFullPrompt, containsPositiveRedesignInstruction, hasFullReferenceInput, isEffectImageGeneration, validateEffectImageAssetPrompt, validateEffectImagePromptContract } from "./effect-image-prompt-contract.mjs"; export { BACKGROUND_REMOVAL_OPERATION, TRANSPARENT_BACKGROUND_REMOVAL_PROMPT, TRANSPARENT_BACKGROUND_STRATEGIES, TRANSPARENT_BACKGROUND_STRATEGY, TRANSPARENT_FINAL_BACKGROUND_MODE, TRANSPARENT_SOURCE_BACKGROUND_MODES, expressesBackgroundRemovalProduction, isBackgroundRemovalProduction, requiresTransparentBackgroundProduction, validateTransparentBackgroundContract, validateTransparentBackgroundProductionRecord, validateTransparentExpectedAssetContract, validateTransparentOutputMetadata } from "./visual-transparent-background-contract.mjs"; export { IMAGE_NORMALIZATION_OPERATIONS, IMAGE_NORMALIZATION_SCHEMA, IMAGE_NORMALIZATION_STATUS, getImageNormalizationRecord, getImageNormalizationRecords, sameImageAspectRatio, validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";
export { CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT, GLOBAL_VISUAL_BASELINE_DOCUMENT, GLOBAL_VISUAL_BASELINE_STATUS, GLOBAL_VISUAL_CONSISTENCY_PROMPT, GLOBAL_VISUAL_ORIGINS, GLOBAL_VISUAL_STYLE_DRIFT_POLICY, buildGlobalVisualConsistencyPrompt, collectGlobalAnchorPaths, collectGlobalVisualConsistencyEvidencePaths, globalVisualBaselineIdentity, normalizeGlobalAnchorEvidence, normalizeGlobalStyleReferenceInputs, normalizeGlobalVisualPath, validateGlobalStyleReferenceInputs, validateGlobalVisualBaseline, validateGlobalVisualGenerationRecord, validateVisualEffectImageOrigin } from "./global-visual-consistency-contract.mjs";
/** 视觉生产合同允许的固定来源。来源不决定生产方法。 */
export { validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
export { PRODUCTION_ORIGINS };
/** 视觉验收模式和几何偏差策略由所有 manifest/V4 入口共享。 */
export { isExactVisualValidation, resolveVisualValidationMode, validateVisualValidationPolicy } from "./visual-validation-policy.mjs";
/** 视觉生产合同允许的显式生产方式。新增方式必须先更新合同和验收器。 */
export { PRODUCTION_METHODS };
/** 交付类型决定实际消费的文件或运行时输出形式。 */
export { DELIVERY_KINDS };
/** 资源替换只能使用显式策略，默认禁止静默替换。 */
export { SUBSTITUTION_POLICIES };
/** 图像生成 的生成记录必须具备的提示词和工具身份字段。 */
export const IMAGEGEN_TEXT_FIELDS = ["global_prompt_prefix", "asset_prompt", "state_prompt", "negative_prompt", "model", "model_version"];
/** 对外保留通用谓词名称，实际实现由共享核心单一维护。 */
export { isObject, nonEmptyString, isSha256 };
/**
 * 校验视觉 F2 只消费确定性机器事实。
 * V2 拆解确认冻结方案后，F2 仍需验证身份和状态，但不能再要求 reviewer
 * 或任何重复复核工件；非视觉 F2 的通用 reviewer 语义由 workflow-control 保留。
 */
export function validateVisualF2MachineGate(gate, context = {}, options = {}) {
  const errors = [];
  const stage = context.stage ?? "F2";
  const error = (message, missing = "") => errors.push(productionContractError({ stage, annotation_number: context.annotation_number ?? "*", region_id: context.region_id ?? "*", expectedMethod: "machine-validation", observedMethod: "machine-validation" }, message, { missing, returnStage: "VALIDATING" }));
  if (!isObject(gate)) {
    error("视觉 F2 必须提供确定性机器验证 gate", "gateResults.F2");
    return errors;
  }
  const mode = gate.validationMode ?? gate.validation_mode;
  if (mode !== "MACHINE") error("视觉 F2 validationMode 必须为 MACHINE；人工确认后只允许确定性机器验证", "validationMode=MACHINE");
  if (!["passed", "PASS"].includes(String(gate.status))) error("视觉 F2 机器验证 status 必须为 passed", "status=passed");
  const identity = options.identity ?? {};
  // 摘要只可用于诊断；机器门保留状态、模式和真实运行事实校验。
  void identity;
  errors.push(...validateVisualPostApprovalReviewFields(gate, { stage }));
  return errors;
}
/** 判断 Work Item 是否进入 V2+视觉/资源生产阶段；普通代码包不受视觉合同门影响。 */
export function isVisualProductionWork(work = {}) {
  const identity = `${work.domain ?? ""} ${work.stageId ?? ""}`.toLowerCase();
  // V2-V4 覆盖拆解、资源生产和正式运行验收，不能用自由文本绕过视觉合同门。
  return /(^|[^a-z])v[2-4]([^0-9]|$)/i.test(String(work.stageId ?? "")) || /视觉|visual|asset|resource|effect|reconstruct|还原|资源/.test(identity) && /(^|[^a-z])v[2-4]([^0-9]|$)/i.test(String(work.stageId ?? ""));
}
/** 创建带区域身份的校验上下文，避免门禁错误失去定位信息。 */
export function contractContext(region = {}, stage = "V2", extra = {}) {
  const contract = resolveProductionContract(region);
  return {
    stage,
    annotation_number: region.annotation_number ?? region.annotationNumber,
    region_id: region.id ?? region.region_id,
    expectedMethod: contract.production_method,
    observedMethod: extra.observedMethod ?? region.observed_method,
    ...extra,
  };
}
/** 取出合同字段，允许区域直接声明或使用 production_contract 对象，但不允许两套值冲突。 */
export function resolveProductionContract(value = {}) {
  const canonical = normalizeVisualRegionDefinition(value);
  const fields = ["owner_type", "production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "asset_id", "asset_ids", "expected_assets", "atomic_image_requirements", "runtime_implementation", "component_inventory"];
  const result = Object.fromEntries(fields.filter((field) => canonical[field] !== null).map((field) => [field, canonical[field]]));
  const conflicts = getVisualRegionDefinitionAliasConflicts(value).filter((item) => fields.includes(item.field));
  if (conflicts.length) result.__conflicts = conflicts.map((item) => item.field);
  return result;
}
/** 按实际资源合同读取生产方式，未声明时保留未知而不猜测工具。 */
export function observedProductionMethod(value = {}) {
  const contract = resolveProductionContract(value);
  return contract.production_method ?? value.method ?? "unspecified";
}
/** 校验单个区域/资源的显式生产合同。 */
export function validateProductionContract(contract, context = {}, options = {}) {
  const errors = [];
  const current = resolveProductionContract(contract);
  // 先审查区域是否为真实图片交付，再审查通用生产字段，避免程序绘制伪装成视觉资产。
  errors.push(...validateFixedVisualProductionMethod(contract, context));
  errors.push(...validateReuseProductionGate(contract, context, options));
  const label = contractContext(contract, context.stage ?? "V3", { ...context, observedMethod: current.production_method ?? "unspecified" });
  const error = (message, details = {}) => errors.push(productionContractError(label, message, {
    expectedMethod: details.expectedMethod ?? current.production_method ?? "explicit-production-method",
    observedMethod: details.observedMethod ?? current.production_method ?? "unspecified",
    missing: details.missing,
  }));
  if (current.__conflicts?.length) error(`production_contract 字段重复且取值冲突：${current.__conflicts.join(", ")}`);
  for (const field of ["production_origin", "production_method", "delivery_kind", "substitution_policy"]) {
    if (!nonEmptyString(current[field])) error(`缺少 ${field}`, { missing: field });
  }
  if (nonEmptyString(current.production_origin) && !PRODUCTION_ORIGINS.has(current.production_origin)) error(`production_origin 无效：${current.production_origin}`);
  if (nonEmptyString(current.production_method) && !PRODUCTION_METHODS.has(current.production_method)) error(`production_method 无效：${current.production_method}`);
  if (nonEmptyString(current.delivery_kind) && !DELIVERY_KINDS.has(current.delivery_kind)) error(`delivery_kind 无效：${current.delivery_kind}`);
  if (nonEmptyString(current.substitution_policy) && !SUBSTITUTION_POLICIES.has(current.substitution_policy)) error(`substitution_policy 无效：${current.substitution_policy}`);
  if (typeof current.image_generation_required !== "boolean") error("image_generation_required 必须显式为布尔值", { missing: "image_generation_required" });
  if (typeof current.generation_record_required !== "boolean") error("generation_record_required 必须显式为布尔值", { missing: "generation_record_required" });
  const runtimeLogic = ["runtime-data", "runtime-rendered"].includes(current.owner_type);
  if (!runtimeLogic && (!Array.isArray(current.expected_assets) || current.expected_assets.length === 0)) error("expected_assets 必须是非空数组", { missing: "expected_assets" });
  else normalizeExpectedAssets(current.expected_assets).forEach((item, index) => {
    if (!nonEmptyString(item.asset_id)) error(`expected_assets[${index}] 缺少 asset_id`, { missing: `expected_assets[${index}].asset_id` });
    if (item.delivery_kind && !DELIVERY_KINDS.has(item.delivery_kind)) error(`expected_assets[${index}].delivery_kind 无效：${item.delivery_kind}`);
    if (item.mime_type && !/^[-\w.+]+\/[-\w.+]+$/.test(item.mime_type)) error(`expected_assets[${index}].mime_type 格式无效`);
  });
  reportExpectedAssetShareAliasConflicts(contract, error);
  const rawExpectedAssets = Array.isArray(contract?.expected_assets) ? contract.expected_assets : (isObject(contract?.production_contract) ? contract.production_contract.expected_assets : current.expected_assets);
  if ((current.production_method === "image-generation" || current.image_generation_required === true) && Array.isArray(rawExpectedAssets)) rawExpectedAssets.forEach((rawItem, index) => { const item = normalizeExpectedAssets([rawItem])[0] ?? {}; for (const field of ["source_file", "runtime_file"]) if (!nonEmptyString(item[field])) error(`expected_assets[${index}] 缺少 图像生成 ${field}`, { missing: `expected_assets[${index}].${field}` }); for (const violation of collectImageGenerationRasterViolations(rawItem, { requiredMime: true, requiredFileFields: ["source_file", "runtime_file"], fileFields: ["source_file", "runtime_file"] })) error(`expected_assets[${index}].${violation.field} ${violation.message}`, { missing: `expected_assets[${index}].${violation.field}` }); for (const violation of validateTransparentExpectedAssetContract(item, current)) error(`expected_assets[${index}] ${violation}`); });
  if (current.image_generation_required === true) {
    if (current.production_method !== "image-generation") error("image_generation_required=true 强制 production_method=image-generation", { expectedMethod: "image-generation", observedMethod: current.production_method ?? "unspecified" });
    if (!isRasterDelivery(current.delivery_kind, contract.mime_type ?? contract.mimeType)) error("image_generation_required=true 强制 delivery_kind=raster-image，SVG/Graphics/CanvasTexture/runtime drawing 不能等价完成", { expectedMethod: "image-generation", observedMethod: current.production_method ?? "unspecified" });
    if (current.generation_record_required !== true) error("image_generation_required=true 必须同时 generation_record_required=true", { missing: "generation_record_required" }); const inventory = current.component_inventory; if (isObject(inventory) && (inventory.delivery_mode !== "individual" || inventory.atlas_allowed !== false)) error("图像生成 只能使用 individual 且 atlas_allowed=false，禁止组图/atlas");
  }
  const expectedDelivery = new Map([
    ["image-generation", "raster-image"], ["authored-raster", "raster-image"], ["authored-svg", "vector-image"],
    ["cocos-graphics", "runtime-drawing"], ["runtime-program", "runtime-program"], ["reuse", "existing-asset"],
  ]).get(current.production_method);
  if (expectedDelivery && current.delivery_kind !== expectedDelivery) error(`${current.production_method} 必须使用 delivery_kind=${expectedDelivery}`, { expectedMethod: current.production_method, observedMethod: current.production_method });
  if (current.production_method === "image-generation" && current.image_generation_required !== true) error("production_method=image-generation 不得将 image_generation_required 声明为 false");
  if (current.image_generation_required === true && current.substitution_policy !== "user-change-request-only") error("图像生成 必须使用 substitution_policy=user-change-request-only", { missing: "substitution_policy=user-change-request-only" });
  if (current.production_method !== "image-generation" && current.image_generation_required === true) error("非 image-generation 方法不得声明 image_generation_required=true", { observedMethod: current.production_method });
  const fileProductionMethods = ["image-generation", "authored-raster", "authored-svg", "reuse"];
  if (fileProductionMethods.includes(current.production_method) && hasRuntimeImplementationField(contract)) error(`${current.production_method} 文件交付不得携带 runtime_implementation`, { missing: "runtime_implementation" });
  if (["cocos-graphics", "runtime-program"].includes(current.production_method)) {
    const implementation = current.runtime_implementation;
    if (!isObject(implementation)) error(`${current.production_method} 必须且只能使用 runtime_implementation`, { missing: "runtime_implementation" });
    else {
      const files = Array.isArray(implementation.integration_files) ? implementation.integration_files : [];
      if (implementation.kind !== current.production_method || files.length === 0 || !files.every(nonEmptyString)) error(`runtime_implementation 必须匹配 ${current.production_method} 且提供 integration_files`, { missing: "runtime_implementation.kind/integration_files" });
      const seenFiles = new Set();
      for (const file of files) {
        const normalizedFile = normalizeProjectRelativePath(file);
        if (!normalizedFile) error("runtime_implementation.integration_files 必须是项目内相对路径，不能使用绝对路径或路径逃逸", { missing: file });
        else if (seenFiles.has(normalizedFile)) error("runtime_implementation.integration_files 不得重复同一物理路径", { missing: normalizedFile });
        else seenFiles.add(normalizedFile);
      }
    }
  }
  if (options.requireComplete && current.production_origin === undefined) error("视觉生产合同未完整声明来源、方法和交付类型", { missing: "production_origin" });
  return errors;
}
/** 校验图像生成记录、独立源文件和正式资源输出元数据。 */
export function validateImageGenerationContract(asset, contract, context = {}, options = {}) {
  const errors = [];
  const label = contractContext(context.region ?? context, context.stage ?? "V3", context);
  const effectImage = isEffectImageGeneration({ asset, contract, context, options });
  const error = (message, details = {}) => errors.push(productionContractError(label, message, {
    expectedMethod: "image-generation",
    observedMethod: observedProductionMethod(contract),
    missing: details.missing,
    rootCause: effectImage ? "执行问题" : details.rootCause,
    returnStage: effectImage ? "V3/V4" : details.returnStage,
  }));
  const rawGeneration = asset?.generation_record;
  const expectedComponent = options.expectedAsset ? normalizeComponentExpectedAsset(options.expectedAsset) : null;
  let generation = rawGeneration;
  // component_records 允许共享公共提示词，但身份和输出路径必须来自当前 component×state 的独立记录。
  let componentGenerationRecord = rawGeneration;
  // 多部件 图像生成 必须逐 component×state 使用独立文件和独立生成身份；component_records 只能共享公共提示词元数据，不能共享输出或图集。
  if (isObject(rawGeneration) && expectedComponent && Array.isArray(rawGeneration.component_records ?? rawGeneration.componentRecords)) {
    const records = rawGeneration.component_records ?? rawGeneration.componentRecords;
    const expectedState = expectedComponent.canonical_state_id || canonicalStateId(expectedComponent.state_id);
    const selected = records.find((record) => record?.annotation_number === context.annotation_number
      && (record?.region_id ?? record?.regionId) === context.region_id
      && (record?.component_id ?? record?.componentId) === expectedComponent.component_id
      && canonicalStateId(record?.state_id ?? record?.stateId) === expectedState
      && (record?.asset_id ?? record?.assetId) === expectedComponent.asset_id);
    if (!selected) error("generation_record.component_records 缺少当前 component×state×asset 记录", { missing: "generation_record.component_records" });
    componentGenerationRecord = selected;
    generation = { ...rawGeneration, ...(selected ?? {}) };
  }
  const expectedOutput = normalizeExpectedAssets(options.expectedAsset ? [options.expectedAsset] : contract.expected_assets).find((item) => item.mime_type || item.width || item.height || item.alpha !== undefined);
  const metadata = { ...expectedOutput, ...resolveOutputMetadata(asset) };
  if (!isObject(generation)) { error("缺少 generation_record，无法证明 图像生成 生成身份", { missing: "generation_record" }); return errors; }
  for (const field of ["record_id", "generator", "generator_version", "created_at", "command_or_recipe"]) if (!nonEmptyString(generation[field])) error(`generation_record.${field} 缺失`, { missing: `generation_record.${field}` });
  // 每个 expected asset 必须拥有唯一生成记录，避免多个部件复用同一 record_id 伪装独立生产。
  if (options.recordIdRegistry instanceof Map && nonEmptyString(generation.record_id)) { const previous = options.recordIdRegistry.get(generation.record_id); if (previous) error(`generation_record.record_id=${generation.record_id} 在区域/清单内重复`, { missing: `${previous.component_id ?? "?"}/${previous.state_id ?? "?"}` }); else options.recordIdRegistry.set(generation.record_id, { component_id: expectedComponent?.component_id, state_id: expectedComponent?.canonical_state_id || canonicalStateId(expectedComponent?.state_id) }); }
  if (nonEmptyString(generation.created_at) && Number.isNaN(Date.parse(generation.created_at))) error("generation_record.created_at 不是有效时间");
  // generator 记录本次实际选择的工具身份；生产分类不限制供应商，完整性由上面的必填字段校验保证。
  for (const field of IMAGEGEN_TEXT_FIELDS) if (!nonEmptyString(generation[field]) && !nonEmptyString(generation.prompt)) error(`generation_record.${field} 缺失，必须保留提示词合同`, { missing: `generation_record.${field}` });
  if (!(Number.isInteger(generation.seed) || nonEmptyString(generation.seed))) error("generation_record.seed 缺失", { missing: "generation_record.seed" });
  const referenceInputValid = effectImage ? (item) => nonEmptyString(item) || isObject(item) : nonEmptyString;
  if (!Array.isArray(generation.reference_inputs) || generation.reference_inputs.length === 0 || !generation.reference_inputs.every(referenceInputValid)) error("generation_record.reference_inputs 必须是非空来源列表", { missing: "generation_record.reference_inputs" });
  if (!Array.isArray(generation.postprocess) || !generation.postprocess.every(nonEmptyString)) error("generation_record.postprocess 必须是字符串处理记录数组（可为空）", { missing: "generation_record.postprocess" });
  const generationOperation = JSON.stringify({ operation: generation.operation, source_operation: generation.source_operation, reference_operation: generation.reference_operation, crop_reference: generation.crop_reference, reference_crop: generation.reference_crop, postprocess: generation.postprocess });
  if (generation.crop_reference === true || generation.reference_crop === true || /crop[-_ ]?reference|裁切参考|裁剪参考/i.test(generationOperation)) error("禁止裁切参考图，图像生成 只能把参考图作为输入约束");
  const referenceTarget = options.referenceOriginalFile;
  if (effectImage) errors.push(...validateEffectImagePromptContract(asset, contract, generation, { ...context, visual_baseline: options.visual_baseline ?? context.visual_baseline }, { ...options, referenceOriginalFile: referenceTarget, visual_baseline: options.visual_baseline ?? context.visual_baseline, region: options.region ?? context.region }).map((message) => productionContractError(label, message, { expectedMethod: "image-generation", observedMethod: observedProductionMethod(contract), rootCause: "执行问题", returnStage: "V3/V4" })));
  const sources = [...collectImageGenerationPathValues(asset), ...collectImageGenerationPathValues(generation)].filter(nonEmptyString);
  if (sources.length === 0) error("缺少独立生成源文件或输出文件", { missing: "source_file" });
  if (expectedComponent) {
    const identityFields = [
      ["annotation_number", context.annotation_number],
      ["region_id", context.region_id],
      ["component_id", expectedComponent.component_id],
      ["state_id", expectedComponent.canonical_state_id || canonicalStateId(expectedComponent.state_id)],
      ["asset_id", expectedComponent.asset_id],
    ];
    for (const [field, expectedValue] of identityFields) {
      const camelField = { annotation_number: "annotationNumber", region_id: "regionId", component_id: "componentId", asset_id: "assetId" }[field];
      const identityRecord = componentGenerationRecord ?? generation;
      const observedValue = field === "state_id" ? canonicalStateId(identityRecord.state_id ?? identityRecord.stateId) : identityRecord[field] ?? identityRecord[camelField];
      if (!nonEmptyString(String(expectedValue ?? "")) || !nonEmptyString(String(observedValue ?? ""))) error(`generation_record.${field} 缺少当前部件身份`, { missing: `generation_record.${field}` });
      else if (String(observedValue) !== String(expectedValue)) error(`generation_record.${field} 与当前部件合同不一致`);
    }
    const sourceFields = ["source_file", "sourceFile", "source_files", "sourceFiles"];
    const generationSources = collectImageGenerationPathValues(componentGenerationRecord, sourceFields).filter(nonEmptyString).map(normalizeProjectRelativePath).filter(Boolean);
    const assetSources = collectImageGenerationPathValues(asset, sourceFields).filter(nonEmptyString).map(normalizeProjectRelativePath).filter(Boolean);
    const expectedSource = normalizeProjectRelativePath(expectedComponent.source_file);
    if (expectedSource && !generationSources.includes(expectedSource)) error("generation_record/source_file 未匹配 expected_assets.source_file", { missing: expectedComponent.source_file });
    if (expectedSource && !assetSources.includes(expectedSource)) error("manifest asset source_file 未匹配 expected_assets.source_file", { missing: expectedComponent.source_file });
    const runtimeFields = ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile", "file", "path"];
    const runtimeRecord = collectImageGenerationPathValues(componentGenerationRecord, runtimeFields).filter(nonEmptyString);
    const assetRuntimeOutputs = collectImageGenerationPathValues(asset, runtimeFields).filter(nonEmptyString).map(normalizeProjectRelativePath).filter(Boolean);
    const expectedRuntime = normalizeProjectRelativePath(expectedComponent.runtime_file);
    if (expectedRuntime && !runtimeRecord.map(normalizeProjectRelativePath).includes(expectedRuntime)) error("generation_record/runtime_file 未匹配 expected_assets.runtime_file", { missing: expectedComponent.runtime_file });
    if (expectedRuntime && !assetRuntimeOutputs.includes(expectedRuntime)) error("manifest asset runtime_outputs 未匹配 expected_assets.runtime_file", { missing: expectedComponent.runtime_file });
  }
  if (!nonEmptyString(metadata.mime_type)) error("缺少输出 MIME", { missing: "mime_type" });
  else if (!isRasterDelivery(contract.delivery_kind, metadata.mime_type)) error("输出 MIME 与 raster-image 不匹配，SVG/Graphics 不得冒充 图像生成 位图");
  for (const value of [
    options.expectedAsset,
    expectedComponent,
    { ...asset, mime_type: asset?.mime_type ?? metadata.mime_type },
    { ...generation, mime_type: generation?.mime_type ?? metadata.mime_type, output_file: generation?.output_file ?? generation?.output?.file },
    { mime_type: metadata.mime_type, runtime_file: metadata.file },
  ].filter(isObject)) for (const violation of collectImageGenerationRasterViolations(value, { requiredMime: true, fileFields: ["source_file", "runtime_file", "output_file", "runtime_outputs"] })) error(`${violation.field} ${violation.message}`);
  for (const field of ["width", "height"]) if (!Number.isInteger(metadata[field]) || metadata[field] <= 0) error(`缺少有效输出 ${field}`, { missing: field });
  if (typeof metadata.alpha !== "boolean") error("缺少输出 alpha 声明", { missing: "alpha" });
  const runtimeOutputs = collectImageGenerationPathValues(asset, ["runtime_outputs", "runtimeOutputs", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile"]);
  if (!Array.isArray(runtimeOutputs) || runtimeOutputs.length === 0 || !runtimeOutputs.every(nonEmptyString)) error("缺少运行时实际消费输出 runtime_outputs", { missing: "runtime_outputs" });
  // V3 冻结资源输出；真实 Scene 消费证据由独立 V4 证据合同校验。
  errors.push(...validateImageGenerationRuntimeConsumption(asset, label, options));
  if (context.region?.scene_asset_usage || context.region?.sceneAssetUsage || contract?.scene_asset_usage || contract?.sceneAssetUsage || options.sceneAssetUsage) errors.push(...validateImageGenerationSizeContract(asset, contract, context, { ...options, expectedAsset: expectedComponent ?? options.expectedAsset, contract })); errors.push(...validateTransparentBackgroundContract({ asset, contract, generation, expectedAsset: expectedComponent ?? options.expectedAsset ?? expectedOutput, metadata, options: { ...options, stage: label.stage } }).map((message) => productionContractError(label, message, { expectedMethod: "image-generation", observedMethod: observedProductionMethod(contract), rootCause: effectImage ? "执行问题" : undefined, returnStage: effectImage ? "V3/V4" : undefined }))); errors.push(...validateImageNormalizationContract({ asset, contract, generation, expectedAsset: expectedComponent ?? options.expectedAsset ?? expectedOutput, metadata, options }).map((message) => productionContractError(label, message, { expectedMethod: "image-generation", observedMethod: observedProductionMethod(contract), rootCause: effectImage ? "执行问题" : undefined, returnStage: effectImage ? "V3/V4" : undefined })));
  return errors;
}
/** 校验效果图 coverage 的逐 annotation_number 生产合同。 */
export function validateVisualProductionCoverage(manifest, options = {}) {
  const errors = [];
  const stage = options.stage ?? "V3";
  const regions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : [];
  const effectImage = manifest?.effect_image_reconstruction?.applicability === "effect-image";
  const reconstructionRegions = new Map((manifest?.scene_reconstruction_contract?.coverage_regions ?? manifest?.scene_reconstruction_contract?.coverageRegions ?? []).filter(isObject).flatMap((region) => [region.id, region.region_id, region.regionId].filter(nonEmptyString).map((id) => [id, region])));
  // 默认把人工确认作为 V3 coverage 硬门；只有明确声明结构扫描才允许暂不消费确认。
  if (options.requireManualConfirmation !== false) errors.push(...validateVisualConfirmationGate(manifest, { ...options, stage, requireManualConfirmation: true }));
  const assets = new Map((Array.isArray(manifest?.assets) ? manifest.assets : []).filter(isObject).map((asset) => [asset.id, asset]));
  const requests = [
    ...(Array.isArray(manifest?.change_requests) ? manifest.change_requests : []),
    ...(Array.isArray(manifest?.production_method_change_requests) ? manifest.production_method_change_requests : []),
    ...(isObject(manifest?.production_method_change_request) ? [manifest.production_method_change_request] : []),
  ];
  const requestById = new Map(requests.filter(isObject).map((request) => [request.changeRequestId ?? request.change_request_id ?? request.id, request])); const generationRecordIds = new Map();
  for (const region of regions) {
    if (!isObject(region)) continue;
    const regionContract = resolveProductionContract(region);
    const context = contractContext(region, stage, { observedMethod: regionContract.production_method ?? "unspecified" });
    if (["runtime-data", "runtime-rendered"].includes(regionContract.owner_type)) {
      // 非图片逻辑仍需经过显式合同和人工确认，但不得进入图片资产/生成记录分支。
       errors.push(...validateProductionContract(region, context, { ...options, requireComplete: true }));
      continue;
    }
    if (regionContract.owner_type !== "fixed-production-visual") continue;
    // 多组件区域只登记 atomic asset_ids；不能再取一个 region asset_id 作为组合图代表。
    const regionAssetIds = Array.isArray(regionContract.asset_ids)
      ? [...new Set(regionContract.asset_ids.filter(nonEmptyString))]
      : (nonEmptyString(regionContract.asset_id) ? [regionContract.asset_id] : []);
    const asset = assets.get(regionAssetIds[0]);
    const contract = { ...(asset ?? {}), ...region, ...resolveProductionContract(asset ?? {}), ...regionContract };
    errors.push(...validateProductionContract(contract, context, { ...options, requireComplete: true }));
    // 状态分析必须先于组件拆解，且每个 required 状态都要落到原子资产或合法图集切片。
    // 组件校验保留 coverage 原对象，确保 camel/nested 别名和热区的越权字段不会在合并合同前被抹掉。
    errors.push(...validateVisualComponentContract(region, context, { requireImageAssets: true }));
    if (contract.production_origin !== regionContract.production_origin) errors.push(productionContractError(context, "production_origin 与 coverage 区域声明不一致"));
    const contractAssets = regionAssetIds.map((assetId) => assets.get(assetId)).filter(isObject);
    if (!asset && regionAssetIds.length === 0) errors.push(productionContractError(context, "缺少区域原子资产身份，必须声明 asset_ids 或单组件 asset_id", { missing: "asset_ids" }));
    for (const registeredAsset of contractAssets) {
      const assetContract = resolveProductionContract(registeredAsset);
      for (const field of ["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy"]) {
        if (assetContract[field] !== undefined && JSON.stringify(assetContract[field]) !== JSON.stringify(contract[field])) errors.push(productionContractError(context, `资产 ${field} 与区域合同不一致`, { observedMethod: assetContract.production_method ?? "unspecified" }));
      }
      if (Array.isArray(contract.expected_assets) && Array.isArray(assetContract.expected_assets) && JSON.stringify(normalizeExpectedAssets(contract.expected_assets)) !== JSON.stringify(normalizeExpectedAssets(assetContract.expected_assets))) errors.push(productionContractError(context, "资产 expected_assets 与区域合同不一致"));
    }
    if (regionAssetIds.length > 0 && contractAssets.length !== regionAssetIds.length) {
      for (const assetId of regionAssetIds) if (!assets.has(assetId)) errors.push(productionContractError(context, "区域原子资产缺少对应 manifest asset", { missing: `assets.${assetId}` }));
    }
    if (contract.image_generation_required === true) {
      const expectedComponents = Array.isArray(contract.expected_assets) ? contract.expected_assets.map(normalizeComponentExpectedAsset) : [];
      for (const expectedComponent of expectedComponents) {
        const componentContext = { ...context, region, component_id: expectedComponent.component_id, state_id: expectedComponent.canonical_state_id || canonicalStateId(expectedComponent.state_id) };
        const componentAsset = assets.get(expectedComponent.asset_id);
        if (!componentAsset) {
          errors.push(productionContractError(componentContext, "图像生成 expected asset 缺少对应 manifest asset", { missing: `assets.${expectedComponent.asset_id}` }));
          continue;
        }
        const regionId = region.id ?? region.region_id ?? region.regionId;
        errors.push(...validateImageGenerationContract(componentAsset, { ...contract, expected_assets: [expectedComponent] }, { ...componentContext, visual_baseline: manifest?.visual_baseline, region: { ...region, ...(reconstructionRegions.get(regionId) ?? {}) } }, { expectedAsset: expectedComponent, recordIdRegistry: generationRecordIds, effectImage, referenceOriginalFile: manifest?.reference_target?.original_file, visual_baseline: manifest?.visual_baseline, identity: manifestEvidenceIdentity(manifest), candidateVersion: manifest?.candidateVersion, projectRoot: options.projectRoot, checkFiles: options.checkFiles }));
      }
    } else if (contract.generation_record_required === true) {
      for (const registeredAsset of contractAssets) if (!isObject(registeredAsset.generation_record)) errors.push(productionContractError(context, "合同要求 generation_record，但原子资产缺少生成记录", { missing: `assets.${registeredAsset.id}.generation_record` }));
    }
    const changeRequestId = region.production_method_change_request_id ?? region.productionMethodChangeRequestId ?? region.change_request_id ?? region.changeRequestId;
    const methodChanged = region.production_method_changed === true || region.productionMethodChanged === true || nonEmptyString(changeRequestId);
    if (methodChanged) {
      const request = nonEmptyString(changeRequestId) ? requestById.get(changeRequestId) : null;
      if (!request) {
        errors.push(productionContractError({ ...context, expectedMethod: contract.production_method, observedMethod: contract.production_method }, "production_method 变更必须绑定 ACCEPTED Change Request", { missing: "change_request_id" }));
      } else {
        errors.push(...validateProductionMethodChangeRequest(request, {
          workItemId: manifest.workItemId,
          candidateVersion: manifest.candidateVersion,
          candidateSha256: manifestEvidenceIdentity(manifest).candidate,
          targetSha256: manifestEvidenceIdentity(manifest).target,
          baselineSha256: manifestEvidenceIdentity(manifest).baseline,
          diffFingerprint: manifestEvidenceIdentity(manifest).diff,
          annotation_number: region.annotation_number,
          region_id: region.id,
          previousMethod: region.previous_production_method ?? region.previousProductionMethod ?? resolveProductionContract(asset ?? {}).production_method,
          proposedMethod: contract.production_method,
        }));
        const changes = Array.isArray(request.production_method_changes) ? request.production_method_changes : (Array.isArray(request.productionMethodChanges) ? request.productionMethodChanges : []);
        const match = changes.find((item) => item?.annotation_number === region.annotation_number && (item?.region_id ?? item?.regionId) === region.id);
        if (!match) errors.push(productionContractError(context, "Change Request 未逐区域绑定 production_method 变更", { missing: "production_method_changes.annotation_number/region_id" }));
        else if ((match.proposed_method ?? match.proposedMethod) !== contract.production_method) errors.push(productionContractError(context, "Change Request proposed_method 与当前 production_method 不一致", { expectedMethod: match.proposed_method ?? match.proposedMethod, observedMethod: contract.production_method }));
      }
    }
  }
  return errors;
}
/** 读取实施包绑定的冻结 visual manifest；返回错误而不是接受调用方自带的伪造对象。 */
export function loadVisualManifestSnapshot(pkg, projectRoot = process.cwd()) {
  const errors = [];
  const file = pkg?.visualManifestFile;
  const path = safeProjectPath(projectRoot, file);
  if (!path) errors.push("visualManifestFile 必须位于项目根目录内");
  else if (!existsSync(path) || !statSync(path).isFile()) errors.push(`visualManifestFile 文件不存在：${file}`);
  if (errors.length) return { manifest: null, errors };
  let bytes;
  try { bytes = readFileSync(path); } catch (caught) { return { manifest: null, errors: [`visualManifestFile 无法读取：${caught.message}`] }; }
  try { return { manifest: JSON.parse(bytes.toString("utf8")), errors: [], path }; }
  catch (caught) { return { manifest: null, errors: [`visualManifestFile 不是合法 JSON：${caught.message}`] }; }
}
/** 从文件魔数读取位图的 MIME、尺寸和 alpha，拒绝只改扩展名的伪 raster 输出。 */
function decodeRasterBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.subarray(0, 8).equals(png) && bytes.length >= 26) {
    // V4 魔数与像素指纹必须共享严格 PNG 解码器，不能一边接受残缺 chunk 一边静默跳过指纹。
    try { const decoded = decodePngRgba(bytes); let alpha = false; for (let index = 3; index < decoded.pixels.length; index += 4) if (decoded.pixels[index] !== 255) { alpha = true; break; } return { mime_type: "image/png", width: decoded.width, height: decoded.height, alpha }; } catch { return null; }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if ([0xd8, 0xd9].includes(marker)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (length >= 7 && offset + length <= bytes.length) return { mime_type: "image/jpeg", width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), alpha: false };
        break;
      }
      offset += length;
    }
    return null;
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30) return { mime_type: "image/webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), alpha: (bytes[20] & 0x10) !== 0 };
    if (chunk === "VP8 " && bytes.length >= 30) {
      const start = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
      if (start >= 0 && start + 7 <= bytes.length) return { mime_type: "image/webp", width: bytes.readUInt16LE(start + 3) & 0x3fff, height: bytes.readUInt16LE(start + 5) & 0x3fff, alpha: false };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      // VP8L 的宽高是紧凑位字段；无损 WebP 可能含透明通道，按最保守 alpha=true 处理。
      const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
      const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
      return { mime_type: "image/webp", width, height, alpha: true };
    }
  }
  return null;
}
/** 校验 V4 production_contract_audit 与逐区域合同、输出和运行消费一致。 */
export function auditProductionContract(manifest, options = {}) {
  const fileGateError = productionFileGateError(manifest, options, "V4");
  if (fileGateError) return [fileGateError];
  const errors = [];
  errors.push(...validateVisualConfirmationGate(manifest, { ...options, stage: "V4", requireManualConfirmation: true }));
  const audit = manifest?.production_contract_audit;
  if (!isObject(audit)) return ["[V4] production_contract_audit 缺失"];
  const regions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions.filter((item) => isObject(item) && normalizeVisualRegionDefinition(item).owner_type === "fixed-production-visual") : [];
  const units = Array.isArray(audit.units) ? audit.units : (Array.isArray(audit.regions) ? audit.regions : []);
  const assets = new Map((Array.isArray(manifest?.assets) ? manifest.assets : []).filter(isObject).map((asset) => [asset.id, asset]));
  const requests = [...(Array.isArray(manifest?.change_requests) ? manifest.change_requests : []), ...(Array.isArray(manifest?.production_method_change_requests) ? manifest.production_method_change_requests : []), ...(isObject(manifest?.production_method_change_request) ? [manifest.production_method_change_request] : [])];
  const requestById = new Map(requests.filter(isObject).map((request) => [request.changeRequestId ?? request.change_request_id ?? request.id, request]));
  const reconstructionRegions = new Map((manifest?.scene_reconstruction_contract?.coverage_regions ?? manifest?.scene_reconstruction_contract?.coverageRegions ?? []).filter(isObject).map((region) => [region.region_id ?? region.regionId ?? region.id, region]));
  const effectImage = manifest?.effect_image_reconstruction?.applicability === "effect-image";
  const identity = manifestEvidenceIdentity(manifest); const generationRecordIds = new Map();
  if (!nonEmptyString(manifest?.workItemId)) errors.push("[V4] effect-image 清单缺少根 workItemId，无法绑定当前 Work Item");
  if (!nonEmptyString(manifest?.candidateVersion)) errors.push("[V4] effect-image 清单缺少根 candidateVersion，无法绑定当前候选版本");
  if (audit.status !== "passed" && audit.status !== "PASS") errors.push("[V4] production_contract_audit status 必须为 passed");
  if (!nonEmptyString(audit.candidate_version)) errors.push("[V4] production_contract_audit 缺少 candidate_version");
  if (nonEmptyString(manifest?.candidateVersion) && audit.candidate_version !== manifest.candidateVersion) errors.push("[V4] production_contract_audit candidate_version 未绑定当前 candidateVersion");
  if (Object.hasOwn(audit, "reviewed_at") || Object.hasOwn(audit, "reviewedAt")) errors.push("[V4] production_contract_audit 禁止使用 reviewed_at；这是人工复核字段，机器审计请使用 audited_at");
  if (!nonEmptyString(audit.audited_at) || Number.isNaN(Date.parse(audit.audited_at))) errors.push("[V4] production_contract_audit.audited_at 必须是有效时间");
  if (!units.length) errors.push("[V4] production_contract_audit.units 必须是非空数组");
  if (units.length !== regions.length) errors.push("[V4] production_contract_audit.units 数量必须与 coverage 固定视觉区域一致");
  const byRegion = new Map(units.map((unit) => [`${unit.annotation_number}\0${unit.region_id}`, unit]));
  for (const unit of units) if (!regions.some((region) => region.annotation_number === unit?.annotation_number && region.id === unit?.region_id)) errors.push(`[V4] annotation_number=${unit?.annotation_number ?? "?"} region_id=${unit?.region_id ?? "?"} expected_method=visual-production observed_method=${unit?.observed_method ?? "missing"} 未映射到 coverage 固定视觉区域`);
  for (const region of regions) {
    const key = `${region.annotation_number}\0${region.id}`;
    const unit = byRegion.get(key);
    const context = contractContext(region, "V4", { observedMethod: unit?.observed_method ?? unit?.production_method ?? "missing" }); const fixedVisual = normalizeVisualRegionDefinition(region).owner_type === "fixed-production-visual";
    if (fixedVisual && (options.checkFiles !== true || !options.projectRoot)) errors.push(productionContractError(context, "V4 fixed-production-visual actual/runtime 必须通过 check-files/project-root PNG/JPEG 魔数核验", { missing: "checkFiles=true,projectRoot" }));
    if (!unit) { errors.push(productionContractError(context, "production_contract_audit 缺少逐区域记录", { missing: "production_contract_audit.units" })); continue; }
    const expected = resolveProductionContract(region);
    errors.push(...validateReuseProductionGate(region, context, options));
    errors.push(...validateVisualComponentContract(region, context, { requireImageAssets: true }));
    // 新版场景合同启用后，V4 还要验证资源放进目标 Scene 后的显示、材质和邻接关系；
    // 没有合同的旧夹具由上游场景合同门统一报“方案缺失”，不在工程审计重复造错。
    if (manifest?.scene_reconstruction_contract) errors.push(...validateSceneAssetUsageContract({ ...region, ...(reconstructionRegions.get(region.id) ?? {}) }, unit, "V4"));
    errors.push(...validateComponentAuditEvidence(region, unit, context, { manifestAssets: assets }));
    if (expected.image_generation_required === true) {
      const expectedComponents = Array.isArray(expected.expected_assets) ? expected.expected_assets.map(normalizeComponentExpectedAsset) : [];
      for (const expectedComponent of expectedComponents) {
        const componentContext = { ...context, region, component_id: expectedComponent.component_id, state_id: expectedComponent.canonical_state_id || canonicalStateId(expectedComponent.state_id) };
        const componentAsset = assets.get(expectedComponent.asset_id);
        if (!componentAsset) errors.push(productionContractError(componentContext, "V4 图像生成 expected asset 缺少对应 manifest asset", { missing: `assets.${expectedComponent.asset_id}` }));
        else errors.push(...validateImageGenerationContract(componentAsset, { ...expected, expected_assets: [expectedComponent] }, { ...componentContext, visual_baseline: manifest?.visual_baseline, region: { ...region, ...(reconstructionRegions.get(region.id) ?? {}) } }, { expectedAsset: expectedComponent, recordIdRegistry: generationRecordIds, effectImage, referenceOriginalFile: manifest?.reference_target?.original_file, visual_baseline: manifest?.visual_baseline, identity, candidateVersion: manifest?.candidateVersion, projectRoot: options.projectRoot, checkFiles: options.checkFiles, requireRuntimeConsumption: true }));
      }
    }
    const observed = unit.observed_method ?? unit.production_method;
    if (observed !== expected.production_method) errors.push(productionContractError(context, "V4 实际生产方式与 V3 合同不一致", { expectedMethod: expected.production_method, observedMethod: observed ?? "missing" }));
    if ((unit.observed_delivery_kind ?? unit.delivery_kind) !== expected.delivery_kind) errors.push(productionContractError(context, "V4 实际交付类型与 V3 合同不一致"));
    if (unit.status !== "passed" && unit.status !== "PASS") errors.push(productionContractError(context, "V4 区域生产合同未通过"));
    if (!Array.isArray(unit.expected_assets) || unit.expected_assets.length === 0) errors.push(productionContractError(context, "V4 区域缺少 expected_assets 记录", { missing: "expected_assets" }));
    if (!Array.isArray(unit.actual_assets) || unit.actual_assets.length === 0) errors.push(productionContractError(context, "V4 区域缺少实际输出 actual_assets", { missing: "actual_assets" }));
    const componentExpectedAssets = Array.isArray(expected.expected_assets) ? expected.expected_assets.map(normalizeComponentExpectedAsset) : []; const expectedAssets = normalizeExpectedAssets(expected.expected_assets);
    const unitExpectedAssets = normalizeExpectedAssets(unit.expected_assets);
    if (unitExpectedAssets.length !== expectedAssets.length) errors.push(productionContractError(context, "V4 expected_assets 数量与 V3 不一致", { missing: "expected_assets" }));
    unitExpectedAssets.forEach((item, index) => { if (expectedAssets[index] && item.asset_id !== expectedAssets[index].asset_id) errors.push(productionContractError(context, `V4 expected_assets[${index}] 未绑定 V3 资产`, { missing: `expected_assets[${index}].asset_id` })); });
    const actualAssets = Array.isArray(unit.actual_assets) ? unit.actual_assets : [];
    if (actualAssets.length !== expectedAssets.length) errors.push(productionContractError(context, "V4 actual_assets 数量必须与 V3 expected_assets 一一对应", { missing: "actual_assets" }));
    actualAssets.forEach((item, index) => {
      const actual = isObject(item) ? item : null;
      const expectedItem = expectedAssets[index] ?? {};
      const expectedComponent = componentExpectedAssets[index] ?? {}; const actualContext = { ...context, component_id: expectedComponent.component_id, state_id: expectedComponent.canonical_state_id || canonicalStateId(expectedComponent.state_id) };
      const manifestAsset = assets.get(expectedItem.asset_id);
      if (!manifestAsset) errors.push(productionContractError(context, `V4 actual_assets[${index}] 未绑定 V3 正式资源`, { missing: `assets.${expectedItem.asset_id}` }));
      const metadata = resolveOutputMetadata(manifestAsset ?? {});
      const allowedPaths = [...(Array.isArray(manifestAsset?.runtime_outputs) ? manifestAsset.runtime_outputs : []), metadata.file, expectedComponent.runtime_file].filter(nonEmptyString).map((value) => normalizeProjectRelativePath(value)).filter(Boolean);
      if (!actual) { errors.push(productionContractError(context, `V4 actual_assets[${index}] 必须是带完整身份的对象`, { missing: `actual_assets[${index}]` })); return; }
      const actualPath = actual.file ?? actual.path ?? actual.output_file ?? actual.runtime_file ?? actual.runtimeFile;
      if (!nonEmptyString(actualPath)) { errors.push(productionContractError(context, `V4 actual_assets[${index}] 缺少文件路径`, { missing: `actual_assets[${index}].file` })); return; }
      const normalizedActualPath = normalizeProjectRelativePath(actualPath);
      const normalizedExpectedRuntime = normalizeProjectRelativePath(expectedComponent.runtime_file);
      if (!normalizedExpectedRuntime || normalizedActualPath !== normalizedExpectedRuntime) errors.push(productionContractError(actualContext, `V4 actual_assets[${index}] 必须使用 V3 expected runtime_file，不能使用 source_file`, { missing: expectedComponent.runtime_file || "expected_assets.runtime_file" }));
      else if (!allowedPaths.length || !allowedPaths.includes(normalizedActualPath)) errors.push(productionContractError(actualContext, `V4 actual_assets[${index}] 未绑定 V3 runtime 输出路径`, { missing: actualPath }));
      const declaredMime = actual.mime_type ?? actual.mimeType;
      if (!nonEmptyString(declaredMime)) errors.push(productionContractError(context, `V4 actual_assets[${index}] 缺少 MIME`, { missing: `actual_assets[${index}].mime_type` }));
      if (expected.production_method === "image-generation" || expected.image_generation_required === true) for (const violation of collectImageGenerationRasterViolations(actual, { requiredMime: true, fileFields: ["file", "path", "runtime_file", "output_file"] })) errors.push(productionContractError(actualContext, `V4 actual_assets[${index}].${violation.field} ${violation.message}`));
      if (expectedItem.mime_type && declaredMime && expectedItem.mime_type !== declaredMime) errors.push(productionContractError(context, `V4 actual_assets[${index}] MIME 与 V3 不一致`));
      for (const [field, expectedValue] of [["mime_type", expectedItem.mime_type], ["width", expectedItem.width], ["height", expectedItem.height], ["alpha", expectedItem.alpha]]) {
        if (expectedValue !== undefined && expectedValue !== "" && actual[field] !== undefined && actual[field] !== expectedValue) errors.push(productionContractError(context, `V4 actual_assets[${index}] ${field} 与 V3 expected_assets 不一致`));
      }
      for (const [field, expectedValue] of [["mime_type", metadata.mime_type], ["width", metadata.width], ["height", metadata.height], ["alpha", metadata.alpha]]) {
        if (expectedValue !== undefined && expectedValue !== "" && actual[field] !== undefined && actual[field] !== expectedValue) errors.push(productionContractError(context, `V4 actual_assets[${index}] ${field} 与 V3 资产输出不一致`));
      }
      if (expected.delivery_kind === "raster-image") {
        if (!Number.isInteger(actual.width) || actual.width <= 0) errors.push(productionContractError(context, `V4 actual_assets[${index}] raster-image 缺少 width`, { missing: `actual_assets[${index}].width` }));
        if (!Number.isInteger(actual.height) || actual.height <= 0) errors.push(productionContractError(context, `V4 actual_assets[${index}] raster-image 缺少 height`, { missing: `actual_assets[${index}].height` }));
        if (typeof actual.alpha !== "boolean") errors.push(productionContractError(context, `V4 actual_assets[${index}] raster-image 缺少 alpha`, { missing: `actual_assets[${index}].alpha` }));
        if (!isRasterDelivery(expected.delivery_kind, declaredMime)) errors.push(productionContractError(context, `V4 actual_assets[${index}] MIME 不能交付 raster-image`));
      }
      if (options.checkFiles !== false && options.projectRoot) {
        const path = safeProjectPath(options.projectRoot, actualPath);
        if (!path || !existsSync(path) || !statSync(path).isFile()) { errors.push(productionContractError(context, `V4 实际输出文件不存在：${actualPath}`, { missing: actualPath })); return; }
        const bytes = readFileSync(path); if (fixedVisual && !isPngOrJpegMagic(bytes)) errors.push(productionContractError(actualContext, `V4 actual_assets[${index}] 固定视觉文件必须是 PNG/JPEG 魔数，不能依赖自报 delivery_kind`, { missing: "raster-magic" }));
        if (expected.delivery_kind === "raster-image") {
          const decoded = decodeRasterBytes(bytes);
          if (!decoded) errors.push(productionContractError(context, `V4 actual_assets[${index}] 不是可解码 PNG/JPEG/WebP 位图`, { missing: "raster-magic" }));
          else {
            if (declaredMime && decoded.mime_type !== declaredMime && !(decoded.mime_type === "image/jpeg" && declaredMime === "image/jpg")) errors.push(productionContractError(context, `V4 actual_assets[${index}] MIME 与文件魔数不一致`));
            for (const field of ["width", "height", "alpha"]) if (actual[field] !== undefined && actual[field] !== decoded[field]) errors.push(productionContractError(context, `V4 actual_assets[${index}] ${field} 与文件不一致`));
            if (expectedItem.width !== undefined && expectedItem.width !== decoded.width || expectedItem.height !== undefined && expectedItem.height !== decoded.height || expectedItem.alpha !== undefined && expectedItem.alpha !== decoded.alpha) errors.push(productionContractError(context, `V4 actual_assets[${index}] 尺寸/alpha 与 V3 不一致`));
          }
        }
      } else if (expected.delivery_kind === "raster-image" && declaredMime && !isRasterDelivery(expected.delivery_kind, declaredMime)) errors.push(productionContractError(context, `V4 actual_assets[${index}] MIME 不能交付 raster-image`));
    });
    errors.push(...validateEvidenceIdentity(unit.runtime_consumption, context, identity, { projectRoot: options.checkFiles !== false ? options.projectRoot : null }));
    if (unit.substitution?.status === "substituted") {
      if (expected.substitution_policy === "forbid") errors.push(productionContractError(context, "substitution_policy=forbid 不允许任何 substituted 输出"));
      const requestId = unit.substitution.change_request_id ?? unit.substitution.changeRequestId;
      const request = requestById.get(requestId);
      if (!request) errors.push(productionContractError(context, "替换未绑定 ACCEPTED Change Request", { missing: "change_request_id" }));
      else errors.push(...validateProductionMethodChangeRequest(request, { workItemId: manifest.workItemId, candidateVersion: manifest.candidateVersion, candidateSha256: identity.candidate, targetSha256: identity.target, baselineSha256: identity.baseline, diffFingerprint: identity.diff, annotation_number: region.annotation_number, region_id: region.id, previousMethod: region.previous_production_method ?? region.previousProductionMethod ?? assets.get(expectedAssets[0]?.asset_id)?.production_method, proposedMethod: unit.observed_method ?? unit.production_method }));
    }
  }
  return errors;
}
/** 在不读取文件时校验 V4 production_contract_audit 的结构和区域身份。 */
export function validateProductionAuditShape(manifest, options = {}) {
  const errors = [];
  const audit = manifest?.production_contract_audit;
  if (!isObject(audit)) return ["[V4] production_contract_audit 缺失"];
  const identity = manifestEvidenceIdentity(manifest);
  if (!nonEmptyString(manifest?.workItemId)) errors.push("[V4] effect-image 清单缺少根 workItemId，无法绑定当前 Work Item");
  if (!nonEmptyString(manifest?.candidateVersion)) errors.push("[V4] effect-image 清单缺少根 candidateVersion，无法绑定当前候选版本");
  const requests = [...(Array.isArray(manifest?.change_requests) ? manifest.change_requests : []), ...(Array.isArray(manifest?.production_method_change_requests) ? manifest.production_method_change_requests : []), ...(isObject(manifest?.production_method_change_request) ? [manifest.production_method_change_request] : [])];
  const requestById = new Map(requests.filter(isObject).map((request) => [request.changeRequestId ?? request.change_request_id ?? request.id, request]));
  const assets = new Map((Array.isArray(manifest?.assets) ? manifest.assets : []).filter(isObject).map((asset) => [asset.id, asset]));
  const units = Array.isArray(audit.units) ? audit.units : (Array.isArray(audit.regions) ? audit.regions : []);
  if (audit.status !== "passed" && audit.status !== "PASS") errors.push("[V4] production_contract_audit status 必须为 passed");
  if (!nonEmptyString(audit.candidate_version)) errors.push("[V4] production_contract_audit 缺少 candidate_version");
  if (nonEmptyString(manifest?.candidateVersion) && audit.candidate_version !== manifest.candidateVersion) errors.push("[V4] production_contract_audit candidate_version 未绑定当前 candidateVersion");
  if (Object.hasOwn(audit, "reviewed_at") || Object.hasOwn(audit, "reviewedAt")) errors.push("[V4] production_contract_audit 禁止使用 reviewed_at；这是人工复核字段，机器审计请使用 audited_at");
  if (!nonEmptyString(audit.audited_at) || Number.isNaN(Date.parse(audit.audited_at))) errors.push("[V4] production_contract_audit.audited_at 必须是有效时间");
  if (!units.length) errors.push("[V4] production_contract_audit.units 必须是非空数组");
  const regions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions.filter((item) => isObject(item) && normalizeVisualRegionDefinition(item).owner_type === "fixed-production-visual") : [];
  const keys = new Set();
  for (const [index, unit] of units.entries()) {
    const stage = options.stage ?? "V3";
    const context = contractContext(unit ?? {}, stage, { annotation_number: unit?.annotation_number ?? "?", region_id: unit?.region_id ?? "?", observedMethod: unit?.observed_method ?? unit?.production_method ?? "missing" });
    const error = (message, missing = "") => errors.push(productionContractError(context, `production_contract_audit.units[${index}] ${message}`, { missing }));
    if (!Number.isInteger(unit?.annotation_number) || unit.annotation_number <= 0) error("annotation_number 必须为正整数", "annotation_number");
    if (!nonEmptyString(unit?.region_id)) error("缺少 region_id", "region_id");
    const key = `${unit?.annotation_number}\0${unit?.region_id}`;
    if (keys.has(key)) error("annotation_number/region_id 重复");
    keys.add(key);
    if (!nonEmptyString(unit?.observed_method ?? unit?.production_method)) error("缺少 observed_method", "observed_method");
    if (!nonEmptyString(unit?.observed_delivery_kind ?? unit?.delivery_kind)) error("缺少 observed_delivery_kind", "observed_delivery_kind");
    const region = regions.find((item) => item.annotation_number === unit?.annotation_number && item.id === unit?.region_id);
    if (region) {
      errors.push(...validateReuseProductionGate(region, context, options));
      errors.push(...validateVisualComponentContract(region, context, { requireImageAssets: true }));
      errors.push(...validateComponentAuditEvidence(region, unit, context, { manifestAssets: assets }));
    }
    const expectedAssets = normalizeExpectedAssets(resolveProductionContract(region ?? {}).expected_assets);
    const unitExpectedAssets = normalizeExpectedAssets(unit?.expected_assets);
    if (!unitExpectedAssets.length || unitExpectedAssets.length !== expectedAssets.length) error("expected_assets 数量必须与 V3 一致", "expected_assets");
    unitExpectedAssets.forEach((item, itemIndex) => { if (expectedAssets[itemIndex] && item.asset_id !== expectedAssets[itemIndex].asset_id) error(`expected_assets[${itemIndex}] 未绑定 V3 资产`, `expected_assets[${itemIndex}].asset_id`); });
    const expectedComponentAssets = Array.isArray(resolveProductionContract(region ?? {}).expected_assets) ? resolveProductionContract(region ?? {}).expected_assets.map(normalizeComponentExpectedAsset) : [];
    const unitComponentAssets = Array.isArray(resolveProductionContract(unit ?? {}).expected_assets) ? resolveProductionContract(unit ?? {}).expected_assets.map(normalizeComponentExpectedAsset) : [];
    // 摘要字段允许作为追踪元数据存在，但不得参与跨阶段资产身份比较。
    const withoutDigest = (assets) => assets.map(({ sha256: _sha256, ...asset }) => asset);
    if (JSON.stringify(withoutDigest(unitComponentAssets)) !== JSON.stringify(withoutDigest(expectedComponentAssets))) error("expected_assets 必须逐字段绑定 V3 原子资产（component/state/asset/path）", "expected_assets");
    if (!atomicImageRequirementsEqual(unit?.atomic_image_requirements, deriveAtomicImageRequirements(region ?? {}))) error("atomic_image_requirements 必须与 V3 派生结果一致", "atomic_image_requirements");
    if (!Array.isArray(unit?.actual_assets) || unit.actual_assets.length === 0) error("缺少 actual_assets", "actual_assets");
    else unit.actual_assets.forEach((item, itemIndex) => {
      if (!isObject(item) || !nonEmptyString(item.file ?? item.path ?? item.output_file)) error(`actual_assets[${itemIndex}] 必须是带 file 的对象`, `actual_assets[${itemIndex}].file`);
      else {
        if (resolveProductionContract(region ?? {}).production_method === "image-generation" || resolveProductionContract(region ?? {}).image_generation_required === true) for (const violation of collectImageGenerationRasterViolations(item, { requiredMime: true, fileFields: ["file", "path", "runtime_file", "output_file"] })) error(`actual_assets[${itemIndex}].${violation.field} ${violation.message}`, `actual_assets[${itemIndex}].${violation.field}`);
        if (!nonEmptyString(item.mime_type)) error(`actual_assets[${itemIndex}] 缺少 mime_type`, `actual_assets[${itemIndex}].mime_type`);
        if (resolveProductionContract(region ?? {}).delivery_kind === "raster-image" && (!Number.isInteger(item.width) || !Number.isInteger(item.height) || typeof item.alpha !== "boolean")) error(`actual_assets[${itemIndex}] raster-image 必须记录 width、height、alpha`, `actual_assets[${itemIndex}].metadata`);
        const asset = assets.get(expectedAssets[itemIndex]?.asset_id);
        const metadata = resolveOutputMetadata(asset ?? {});
        const allowedPaths = [asset?.source_file, ...(Array.isArray(asset?.source_files) ? asset.source_files : []), ...(Array.isArray(asset?.runtime_outputs) ? asset.runtime_outputs : []), metadata.file, expectedAssets[itemIndex]?.file].filter(nonEmptyString).map(normalizeProjectRelativePath).filter(Boolean);
        if (!allowedPaths.includes(normalizeProjectRelativePath(item.file ?? item.path ?? item.output_file))) error(`actual_assets[${itemIndex}] 未绑定 V3 source/runtime 输出路径`, `actual_assets[${itemIndex}].file`);
      }
    });
    if (Array.isArray(unit?.actual_assets) && unit.actual_assets.length !== expectedAssets.length) error("actual_assets 数量必须与 V3 expected_assets 一一对应", "actual_assets");
    if (options.stage === "V4") errors.push(...validateEvidenceIdentity(unit?.runtime_consumption, context, identity));
    if (unit?.substitution?.status === "substituted") {
      const region = regions.find((item) => item.annotation_number === unit.annotation_number && item.id === unit.region_id);
      if (region && resolveProductionContract(region).substitution_policy === "forbid") error("substitution_policy=forbid 不允许 substituted", "substitution");
      const requestId = unit.substitution.change_request_id ?? unit.substitution.changeRequestId;
      const request = requestById.get(requestId);
      if (!request) error("替换未绑定 ACCEPTED Change Request", "change_request_id");
      else errors.push(...validateProductionMethodChangeRequest(request, { workItemId: manifest.workItemId, candidateVersion: manifest.candidateVersion, candidateSha256: identity.candidate, targetSha256: identity.target, baselineSha256: identity.baseline, diffFingerprint: identity.diff, annotation_number: unit.annotation_number, region_id: unit.region_id, previousMethod: region?.previous_production_method ?? region?.previousProductionMethod ?? assets.get(expectedAssets[0]?.asset_id)?.production_method, proposedMethod: unit.observed_method ?? unit.production_method }));
    }
    if (regions.length && !regions.some((region) => region.annotation_number === unit.annotation_number && region.id === unit.region_id)) error("未映射到 coverage 固定视觉区域");
  }
  if (regions.some((region) => !keys.has(`${region.annotation_number}\0${region.id}`))) errors.push("[V4] annotation_number=* region_id=* expected_method=visual-production observed_method=missing 缺失=production_contract_audit.units：未覆盖全部固定视觉区域");
  return errors;
}
/** 校验 V4 运行态硬门，要求审计、F2 机器事实、重放、freshness 和实际消费全部存在。 */
export function validateV4ProductionGate(manifest, options = {}) {
  const errors = [];
  const visualValidationMode = resolveVisualValidationMode(options, manifest, manifest?.scene_reconstruction_contract);
  validateVisualValidationPolicy(errors, "visual_validation", options, manifest, manifest?.scene_reconstruction_contract);
  errors.push(...validateVisualConfirmationGate(manifest, { ...options, stage: "V4", requireManualConfirmation: true }));
  const gate = manifest?.visual_production_gate;
  const context = { stage: "V4", annotation_number: "*", region_id: "*", expectedMethod: "production-contract", observedMethod: "missing" };
  const error = (message, missing = "") => errors.push(productionContractError(context, message, { missing }));
  if (!isObject(gate)) { error("V4 production gate 缺失", "visual_production_gate"); return errors; }
  if (!["passed", "PASS"].includes(String(gate.status))) error("V4 production gate status 必须为 passed");
  const audit = manifest?.production_contract_audit ?? gate.production_contract_audit;
  if (!isObject(audit) || !["passed", "PASS"].includes(String(audit.status))) error("V4 缺少通过的 production_contract_audit", "production_contract_audit");
  for (const [field, label] of [["v2_status", "V2"], ["implementation_package_status", "Implementation Package"], ["v3_status", "V3 production_contract_audit"], ["v4_status", "V4 runtime integration"], ["f2_status", "F2 机器验证"], ["f3_status", "F3 runtime replay"]]) if (!["passed", "PASS"].includes(String(gate[field]))) error(`${label} 未通过`, field);
  const f2MachineGate = gate.f2_machine_validation ?? gate.f2MachineValidation ?? gate.f2_gate ?? gate.f2GateResult ?? gate.f2_validation;
  if (f2MachineGate) errors.push(...validateVisualF2MachineGate(f2MachineGate, { stage: "F2" }, { identity: options.identity ?? manifestEvidenceIdentity(manifest) }));
  else if (gate.f2_status) error("V4 缺少 F2 validationMode=MACHINE 机器验证事实", "f2_machine_validation");
  errors.push(...validateVisualPostApprovalReviewFields(manifest, { stage: "V4" }));
  const replay = gate.runtime_replay ?? gate.f3_runtime_replay;
  if (!isObject(replay) || !["passed", "PASS"].includes(String(replay.status))) error("缺少通过的 F3 runtime replay", "runtime_replay");
  else if (!nonEmptyString(replay.evidence)) error("F3 runtime replay 缺少 evidence", "runtime_replay.evidence");
  else if (options.requireEvidenceIdentity) errors.push(...validateEvidenceIdentity(replay, context, options.identity ?? manifestEvidenceIdentity(manifest), options));
  const cases = gate.fidelity_cases ?? manifest?.fidelity_cases;
  if (!Array.isArray(cases) || cases.length === 0) error("缺少非空 freshness-bound fidelity cases", "fidelity_cases");
  else cases.forEach((item, index) => {
    if (!isObject(item) || !nonEmptyString(item.created_at ?? item.checked_at)) error(`fidelity_cases[${index}] 缺少新鲜时间`, `fidelity_cases[${index}]`);
    if (item?.freshness_bound !== true && !nonEmptyString(item?.freshness_bound_to)) error(`fidelity_cases[${index}] 缺少 freshness_bound`, `fidelity_cases[${index}].freshness_bound`);
    if (options.requireEvidenceIdentity) {
      if (!nonEmptyString(item?.evidence)) error(`fidelity_cases[${index}] 缺少 evidence`, `fidelity_cases[${index}].evidence`);
      else errors.push(...validateEvidenceIdentity(item, { ...context, annotation_number: index + 1, region_id: `fidelity-case-${index + 1}` }, options.identity ?? manifestEvidenceIdentity(manifest), options));
    }
  });
  if (options.requireSceneReconstruction === true) {
    errors.push(...validateSceneReconstructionGate(manifest, { stage: "V4", displayLayerScope: options.displayLayerScope, visual_validation: { mode: visualValidationMode } }));
  }
  const runtimeConsumption = gate.runtime_consumption;
  if (!isObject(runtimeConsumption) || !["passed", "consumed", "PASS"].includes(String(runtimeConsumption.status).toLowerCase())) error("V4 缺少带身份绑定的运行时实际消费 evidence", "runtime_consumption");
  else if (options.requireEvidenceIdentity) errors.push(...validateEvidenceIdentity(runtimeConsumption, context, options.identity ?? manifestEvidenceIdentity(manifest), options));
  if (gate.unapproved_substitution === true || gate.unapproved_substitutions === true || gate.substitution_status === "unapproved") error("V4 存在未批准替换");
  // V4 候选由工作项、版本和实际运行证据绑定；摘要字段仅供人工追溯。
  return errors;
}
/** V4 总入口：把 V2 coverage、V3 审计、F2 机器事实和 V4 运行态门收敛为一个不可绕过的结果。 */
export async function validateV4VisualManifest(manifest, options = {}) {
  const fileGateError = productionFileGateError(manifest, options, "V4");
  if (fileGateError) return [fileGateError];
  const identity = manifestEvidenceIdentity(manifest);
  const evidenceOptions = { requireEvidenceIdentity: options.requireEvidenceIdentity !== false, identity, projectRoot: options.projectRoot, checkFiles: options.checkFiles === true, targetFrozenAt: manifest?.reference_target?.frozen_at, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority: options.authority };
  const errors = [
    ...validateSceneReconstructionGate(manifest, { stage: "V4", displayLayerScope: options.displayLayerScope }),
    ...validateVisualProductionCoverage(manifest, { stage: "V2", requireManualConfirmation: true, projectRoot: options.projectRoot, checkFiles: options.checkFiles === true, targetSha: identity.target, targetFrozenAt: manifest?.reference_target?.frozen_at, candidateSha: identity.candidate, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority: options.authority }),
    ...validateProductionAuditShape(manifest, { ...options, stage: "V4", authority: options.authority }),
    ...validateV4ProductionGate(manifest, { ...options, ...evidenceOptions, requireSceneReconstruction: true }),
  ];
  // 总门始终复核 V3 的方法/交付一致性；只有传入项目根目录时才额外检查实际文件、路径与位图结构。
  errors.push(...await auditProductionContract(manifest, { projectRoot: options.projectRoot, checkFiles: options.checkFiles === true, targetSha: identity.target, targetFrozenAt: manifest?.reference_target?.frozen_at, candidateSha: identity.candidate, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority: options.authority }));
  return [...new Set(errors)];
}

/** 根据实施包的正式执行单元确定显示层验收作用域，避免由 manifest 自行声明并绕过场景边界。 */
function displayLayerScopeFromPackage(pkg) {
  const unitTypes = new Set((pkg?.executionUnits ?? []).map((unit) => unit?.unitType));
  return unitTypes.has("DISPLAY_LAYER") && !unitTypes.has("SCENE") ? "display-layer" : "scene";
}
/** 校验实施包与 coverage 的部件资产一一绑定，并覆盖每个预期源/运行输出。 */
function validateVisualUnitAssetBindings(unit, region, context, errors, options = {}) {
  if (!isObject(region)) return;
  const runtimeLogic = ["runtime-data", "runtime-rendered"].includes(normalizeVisualRegionDefinition(region).owner_type);
  let expected = [];
  if (runtimeLogic) {
    // 运行时逻辑只登记代码集成路径；禁止借空图片数组或伪造 asset 身份进入图片合同。
    const runtimeImplementation = resolveProductionContract(unit).runtime_implementation;
    const integrationFiles = isObject(runtimeImplementation) ? runtimeImplementation.integration_files : [];
    if (!Array.isArray(integrationFiles) || integrationFiles.length === 0) errors.push(productionContractError(context, "runtime 逻辑必须登记 runtime_implementation.integration_files", { missing: "runtime_implementation.integration_files" }));
  } else {
  const regionAtomicRequirements = deriveAtomicImageRequirements(region);
  const unitAtomicRequirements = unit?.atomic_image_requirements ?? unit?.atomicImageRequirements;
  if (!Array.isArray(unitAtomicRequirements)) errors.push(productionContractError(context, "Implementation Package 缺少 atomic_image_requirements", { missing: "atomic_image_requirements" }));
  else if (!atomicImageRequirementsEqual(unitAtomicRequirements, regionAtomicRequirements)) errors.push(productionContractError(context, "Implementation Package atomic_image_requirements 与 coverage 派生需求不一致", { missing: "atomic_image_requirements" }));
  const nestedRegion = region.production_contract ?? region.productionContract;
  const rawExpected = region.expected_assets ?? region.expectedAssets ?? nestedRegion?.expected_assets ?? nestedRegion?.expectedAssets;
  const rawObserved = unit?.expected_assets ?? unit?.expectedAssets;
  const imageGenContract = resolveProductionContract(region).production_method === "image-generation" || resolveProductionContract(region).image_generation_required === true;
  for (const [label, values] of [["coverage.expected_assets", rawExpected], ["Implementation Package expected_assets", rawObserved]]) {
    if (Array.isArray(values)) values.forEach((value, index) => { if (hasShareAliasConflict(value)) errors.push(productionContractError(context, `${label}[${index}] share_id 与 shareId 不得同时声明`, { missing: `${label}[${index}].share_id` })); if (imageGenContract) for (const violation of collectImageGenerationRasterViolations(value, { requiredMime: true, requiredFileFields: ["source_file", "runtime_file"], fileFields: ["source_file", "runtime_file"] })) errors.push(productionContractError(context, `${label}[${index}].${violation.field} ${violation.message}`, { missing: `${label}[${index}].${violation.field}` })); });
  }
  expected = Array.isArray(resolveProductionContract(region).expected_assets) ? resolveProductionContract(region).expected_assets.map(normalizeComponentExpectedAsset) : [];
  const observed = Array.isArray(unit?.expected_assets) ? unit.expected_assets.map(normalizeComponentExpectedAsset) : [];
  const expectedByKey = new Map(expected.map((asset) => [componentAssetKey(asset), asset]));
  const observedByKey = new Map(observed.map((asset) => [componentAssetKey(asset), asset]));
  const expectedKeyCounts = new Map(); const observedKeyCounts = new Map();
  expected.forEach((asset) => expectedKeyCounts.set(componentAssetKey(asset), (expectedKeyCounts.get(componentAssetKey(asset)) ?? 0) + 1));
  observed.forEach((asset) => observedKeyCounts.set(componentAssetKey(asset), (observedKeyCounts.get(componentAssetKey(asset)) ?? 0) + 1));
  for (const [key, count] of expectedKeyCounts) if (count !== 1) errors.push(productionContractError(context, "coverage expected_assets 的 component×state 映射不唯一", { missing: key }));
  for (const [key, count] of observedKeyCounts) if (count !== 1) errors.push(productionContractError(context, "Implementation Package expected_assets 的 component×state 映射不唯一", { missing: key }));
  for (const [key, expectedAsset] of expectedByKey) {
    const observedAsset = observedByKey.get(key);
    const local = { ...context, component_id: expectedAsset.component_id, state_id: expectedAsset.canonical_state_id || canonicalStateId(expectedAsset.state_id) };
    const fail = (message, missing = "") => errors.push(productionContractError(local, message, { missing }));
    if (!observedAsset) { fail("Implementation Package 缺少 coverage expected asset 部件映射", `expected_assets.${expectedAsset.component_id}.${expectedAsset.state_id}`); continue; }
    if (observedAsset.asset_id !== expectedAsset.asset_id) fail("Implementation Package asset_id 与 coverage 不一致", expectedAsset.asset_id);
    const expectedSource = normalizeProjectRelativePath(expectedAsset.source_file);
    const observedSource = normalizeProjectRelativePath(observedAsset.source_file);
    const expectedRuntime = normalizeProjectRelativePath(expectedAsset.runtime_file);
    const observedRuntime = normalizeProjectRelativePath(observedAsset.runtime_file);
    // runtime-program/cocos-graphics 的交付物是代码实现，不得为了满足旧字段伪造图片路径。
    if (expectedSource || expectedRuntime) {
      if (!expectedSource || !observedSource || observedSource !== expectedSource) fail("Implementation Package source_file 与 coverage 不一致或路径不安全", expectedAsset.source_file || "source_file");
      if (!expectedRuntime || !observedRuntime || observedRuntime !== expectedRuntime) fail("Implementation Package runtime_file 与 coverage 不一致或路径不安全", expectedAsset.runtime_file || "runtime_file");
    } else if (observedSource || observedRuntime) {
      fail("runtime-program/cocos-graphics 不得伪造 source_file/runtime_file 图片输出", "runtime_implementation");
    }
    if (JSON.stringify(observedAsset.atlas_slice) !== JSON.stringify(expectedAsset.atlas_slice)) fail("Implementation Package atlas_slice 与 coverage 不一致", "atlas_slice"); for (const field of ["asset_kind", "asset_scope", "atomic_visual_key", "mime_type", "width", "height", "alpha", "share_id"]) if (JSON.stringify(observedAsset[field]) !== JSON.stringify(expectedAsset[field])) fail(`Implementation Package ${field} 与 coverage 不一致`, field);
  }
  for (const [key, observedAsset] of observedByKey) if (!expectedByKey.has(key)) {
    const local = { ...context, component_id: observedAsset.component_id, state_id: observedAsset.canonical_state_id || canonicalStateId(observedAsset.state_id) };
    errors.push(productionContractError(local, "Implementation Package 包含 coverage 未声明的部件状态", { missing: "coverage.expected_assets" }));
  }
  }
  const ownedPaths = unit?.ownedPaths;
  const outputPaths = unit?.outputPaths;
  const reportPathError = (message, details = {}) => errors.push(productionContractError(context, message, details));
  const normalizedOwnedPaths = validateUnitPathDeclarations(ownedPaths, "ownedPaths", options, reportPathError);
  const normalizedOutputPaths = validateUnitPathDeclarations(outputPaths, "outputPaths", options, reportPathError);
  const runtimeImplementation = resolveProductionContract(unit).runtime_implementation;
  const integrationFiles = isObject(runtimeImplementation) ? runtimeImplementation.integration_files : [];
  const normalizedIntegrationFiles = validateUnitPathDeclarations(integrationFiles, "runtime_implementation.integration_files", options, reportPathError);
  for (const file of normalizedIntegrationFiles) if (!pathCoveredBy(file, normalizedOwnedPaths)) errors.push(productionContractError(context, "ownedPaths 未覆盖 runtime_implementation.integration_files", { missing: `ownedPaths:${file}` }));
  for (const asset of expected) {
    const local = { ...context, component_id: asset.component_id, state_id: asset.canonical_state_id || canonicalStateId(asset.state_id) };
    // 源文件归 owner 管辖，运行时文件归 output 声明；两者分别覆盖，避免用一条目录声明混淆生产与交付。
    if (nonEmptyString(asset.source_file) && !pathCoveredBy(asset.source_file, normalizedOwnedPaths)) errors.push(productionContractError(local, "ownedPaths 未覆盖 expected asset source_file", { missing: `ownedPaths:${asset.source_file}` }));
    if (nonEmptyString(asset.runtime_file) && !pathCoveredBy(asset.runtime_file, normalizedOutputPaths)) errors.push(productionContractError(local, "outputPaths 未覆盖 expected asset runtime_file", { missing: `outputPaths:${asset.runtime_file}` }));
  }
}
/** 校验 Implementation Package 的视觉实施单元与 coverage 一一映射。 */
export function validateVisualProductionUnits(pkg, manifest = null, options = {}) {
  const errors = [];
  const units = pkg?.visualProductionUnits;
  if (units === undefined) return errors;
  if (!Array.isArray(units) || units.length === 0) return ["[V3] annotation_number=* region_id=* expected_method=visual-production observed_method=missing 缺失=visualProductionUnits：必须是非空数组"];
  const regions = manualDecompositionRegions(manifest);
  const regionByKey = new Map(regions.map((region) => [`${region.annotation_number}\0${region.id}`, region]));
  const effectImage = manifest?.effect_image_reconstruction?.applicability === "effect-image";
  const reconstructionRegions = new Map((manifest?.scene_reconstruction_contract?.coverage_regions ?? manifest?.scene_reconstruction_contract?.coverageRegions ?? []).filter(isObject).flatMap((item) => [item.id, item.region_id, item.regionId].filter(nonEmptyString).map((id) => [id, item])));
  const seen = new Set(); const seenAnnotations = new Set(); const outputs = new Map(); const crossUnitPaths = new Map(); const generationRecordIds = new Map();
  for (const [index, unit] of units.entries()) {
    const context = contractContext(unit ?? {}, "V3", { annotation_number: unit?.annotation_number ?? "?", region_id: unit?.region_id ?? "?", observedMethod: unit?.production_method ?? "missing" });
    const error = (message, details = {}) => errors.push(productionContractError(context, `visualProductionUnits[${index}] ${message}`, details));
    errors.push(...validateProductionContract(unit ?? {}, context, { ...options, requireComplete: true }));
    const key = `${unit?.annotation_number}\0${unit?.region_id}`;
    const region = regionByKey.get(key);
    // 实施包必须镜像 coverage 的 owner；运行时逻辑不能被强制伪装成固定图片组件。
    errors.push(...validateVisualComponentContract({ ...(region ?? {}), ...(unit ?? {}), owner_type: unit?.owner_type ?? region?.owner_type ?? "fixed-production-visual", bounds: region?.bounds ?? unit?.bounds }, context, { requireImageAssets: true }));
    if (!nonEmptyString(unit?.unitId)) error("缺少 unitId", { missing: "unitId" });
    if (!Number.isInteger(unit?.annotation_number) || unit.annotation_number <= 0) error("annotation_number 必须为正整数", { missing: "annotation_number" });
    if (!nonEmptyString(unit?.region_id)) error("缺少 region_id", { missing: "region_id" });
    if (seen.has(key)) error("annotation_number/region_id 重复"); else seen.add(key);
    const annotationKey = `${unit?.scene_id ?? "*"}\0${unit?.state_id ?? "*"}\0${unit?.annotation_number}`;
    if (seenAnnotations.has(annotationKey)) error("annotation_number 在同一 scene/state 内重复"); else seenAnnotations.add(annotationKey);
    errors.push(...validateVisualProductionUnitConfirmation(unit ?? {}, region, pkg, context));
    if (manifest && !region) error("未映射到 coverage_audit 固定视觉区域");
    if (unit?.owner_type === "fixed-production-visual" && !Array.isArray(unit?.interaction_hotspots ?? unit?.interactionHotspots)) error("Implementation Package 必须显式镜像 interaction_hotspots 数组", { missing: "interaction_hotspots" });
    if (region) {
      const regionContract = resolveProductionContract(region);
      const unitContract = resolveProductionContract(unit);
      if (unitContract.production_method !== regionContract.production_method) error("production_method 与 coverage 不一致", { expectedMethod: regionContract.production_method });
      if (unitContract.delivery_kind !== regionContract.delivery_kind) error("delivery_kind 与 coverage 不一致");
      const normalizedRegionAssetIds = Array.isArray(regionContract.asset_ids) ? regionContract.asset_ids.slice().sort() : null;
      const normalizedUnitAssetIds = Array.isArray(unitContract.asset_ids) ? unitContract.asset_ids.slice().sort() : null;
      if (JSON.stringify(unitContract.asset_id ?? null) !== JSON.stringify(regionContract.asset_id ?? null)) error("asset_id 与 coverage 不一致", { missing: "asset_id" });
      if (JSON.stringify(normalizedUnitAssetIds) !== JSON.stringify(normalizedRegionAssetIds)) error("asset_ids 与 coverage 不一致", { missing: "asset_ids" });
      // 实施包不得只复用方法字段；这些布尔和替换策略决定了后续门禁是否必须产图、留记录和禁止静默替换。
      for (const field of ["production_origin", "image_generation_required", "generation_record_required", "substitution_policy"]) {
        if (JSON.stringify(unitContract[field]) !== JSON.stringify(regionContract[field])) error(`${field} 与 coverage 不一致`, { missing: field });
      }
      for (const field of visualComponentContractDifferences(unit, region)) error(`${field} 必须与 coverage 区域语义一致，数组顺序不影响比较`);
      validateVisualUnitAssetBindings(unit, region, context, errors, options);
      if (unit.image_generation_required === true) {
        const unitAssets = Array.isArray(unit.expected_assets) ? unit.expected_assets.map(normalizeComponentExpectedAsset) : [];
        const manifestAssets = new Map((Array.isArray(manifest.assets) ? manifest.assets : []).filter(isObject).map((asset) => [asset.id, asset]));
        for (const expectedAsset of unitAssets) {
          const manifestAsset = manifestAssets.get(expectedAsset.asset_id);
          const componentContext = { ...context, component_id: expectedAsset.component_id, state_id: expectedAsset.canonical_state_id || canonicalStateId(expectedAsset.state_id) };
          if (!manifestAsset) errors.push(productionContractError(componentContext, "Implementation Package 图像生成 部件缺少 manifest asset", { missing: `assets.${expectedAsset.asset_id}` }));
          else {
            const regionId = region.id ?? region.region_id ?? region.regionId;
            errors.push(...validateImageGenerationContract(manifestAsset, { ...unit, expected_assets: [expectedAsset] }, { ...componentContext, visual_baseline: manifest?.visual_baseline, region: { ...region, ...(reconstructionRegions.get(regionId) ?? {}) } }, { expectedAsset, recordIdRegistry: generationRecordIds, effectImage, referenceOriginalFile: manifest.reference_target?.original_file, visual_baseline: manifest?.visual_baseline, identity: manifestEvidenceIdentity(manifest), candidateVersion: manifest?.candidateVersion, projectRoot: options.projectRoot, checkFiles: options.checkFiles }));
          }
        }
      }
    }
    if (!nonEmptyString(unit?.owner)) error("缺少 owner", { missing: "owner" });
    const ownedPaths = unit?.ownedPaths;
    if (!Array.isArray(ownedPaths) || ownedPaths.length === 0 || !ownedPaths.every(nonEmptyString)) error("缺少非空 ownedPaths", { missing: "ownedPaths" });
    const outputPaths = unit?.outputPaths;
    if (!Array.isArray(outputPaths) || outputPaths.length === 0 || !outputPaths.every((item) => { const declared = declaredPathEntry(item); return declared.valid && nonEmptyString(declared.path); })) error("缺少非空输出路径或存在歧义路径对象", { missing: "outputPaths" });
    for (const output of outputPaths ?? []) {
      const declaredOutput = declaredPathEntry(output);
      if (!declaredOutput.valid) { error(`outputPaths ${declaredOutput.reason}`, { missing: "outputPaths" }); continue; }
      const path = declaredOutput.path;
      const normalizedPath = normalizeProjectRelativePath(path);
      const shareId = declaredOutput.shareId;
      if (!normalizedPath) { error(`输出路径必须是项目内相对路径：${path}`, { missing: "outputPaths" }); continue; }
      const previous = outputs.get(normalizedPath);
      if (previous && (!shareId || previous.shareId !== shareId || previous.owner !== unit.owner)) error(`输出路径与其他单元冲突：${path}`);
      outputs.set(normalizedPath, { shareId, owner: unit.owner });
      registerCrossUnitPath(crossUnitPaths, normalizedPath, "outputPaths", unit, shareId, error);
      if (options.allowedPaths && !options.allowedPaths.some((pattern) => options.pathMatches?.(normalizedPath, normalizeProjectRelativePath(pattern)))) error(`输出路径超出 allowedPaths：${path}`);
    }
    const unitExpectedAssets = Array.isArray(resolveProductionContract(unit).expected_assets) ? resolveProductionContract(unit).expected_assets.map(normalizeComponentExpectedAsset) : [];
    for (const asset of unitExpectedAssets) {
      registerCrossUnitPath(crossUnitPaths, asset.source_file, "source_file", unit, asset.share_id, error);
      registerCrossUnitPath(crossUnitPaths, asset.runtime_file, "runtime_file", unit, asset.share_id, error);
    }
    if (!nonEmptyString(unit?.format ?? unit?.delivery_kind)) error("缺少输出格式", { missing: "format" });
    if (unit?.image_generation_required === true && unit?.production_method !== "image-generation") error("图像生成 单元格式/方法不一致", { expectedMethod: "image-generation" });
  }
  if (manifest && regions.some((region) => !seen.has(`${region.annotation_number}\0${region.id}`))) errors.push("[V3] annotation_number=* region_id=* expected_method=visual-production observed_method=missing 缺失=visualProductionUnits：未覆盖全部编号区域");
  return errors;
}
/** 读取并绑定当前 visual-assets 快照，阻止实施包只凭自身编号伪造 coverage 映射。 */
export function validateVisualImplementationPackageBinding(pkg, options = {}) {
  const units = pkg?.visualProductionUnits;
  if (units === undefined && options.requireVisual !== true) return [];
  const errors = [];
  const manifestFile = pkg?.visualManifestFile;
  const requestedStage = options.current_stage ?? options.currentStage ?? pkg?.current_stage ?? pkg?.currentStage;
  const stage = requestedStage === undefined || requestedStage === null ? "V3" : String(requestedStage).toUpperCase();
  const context = { stage, annotation_number: "*", region_id: "*", expectedMethod: "visual-production", observedMethod: "missing" };
  const error = (message, missing = "") => errors.push(productionContractError(context, message, { missing }));
  if (!["V2", "V3", "V4"].includes(stage)) {
    error(`current_stage 未知：${String(requestedStage)}；禁止静默回落到 V2`, "current_stage");
    return errors;
  } if (stage === "V4" && options.checkFiles !== true) error("current_stage=V4 必须显式 checkFiles=true；未执行真实文件门，V4 FAIL", "checkFiles=true");
  if (units === undefined) error("视觉实施包缺少 visualProductionUnits，不能绕过 coverage 映射", "visualProductionUnits");
  if (!nonEmptyString(manifestFile)) { error("Implementation Package 缺少 visualManifestFile", "visualManifestFile"); return errors; }
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const path = safeProjectPath(projectRoot, manifestFile);
  if (!path) { error("visualManifestFile 必须位于项目根目录内", "visualManifestFile"); return errors; }
  if (Array.isArray(options.allowedPaths) && options.allowedPaths.length && typeof options.pathMatches === "function" && !options.allowedPaths.some((pattern) => options.pathMatches(manifestFile, pattern))) error(`visualManifestFile 超出 allowedPaths：${manifestFile}`);
  if (!existsSync(path) || !statSync(path).isFile()) { error(`visualManifestFile 文件不存在：${manifestFile}`, manifestFile); return errors; }
  let bytes;
  try { bytes = readFileSync(path); } catch (caught) { error(`visualManifestFile 无法读取：${caught.message}`, manifestFile); return errors; }
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch (caught) { error(`visualManifestFile 不是合法 JSON：${caught.message}`, manifestFile); return errors; }
  if (manifest?.schema_version !== "1.5") error("visual manifest 必须使用 schema 1.5", "schema_version");
  if (manifest?.effect_image_reconstruction?.applicability !== "effect-image") error("visual manifest 必须是 effect-image 清单", "effect_image_reconstruction.applicability");
  if (!nonEmptyString(pkg?.candidateVersion)) error("视觉 Implementation Package 缺少 candidateVersion", "candidateVersion");
  if (manifest?.workItemId !== pkg?.workItemId) error("visual manifest.workItemId 未绑定当前 Implementation Package workItemId", "workItemId");
  if (manifest?.candidateVersion !== pkg?.candidateVersion) error("visual manifest.candidateVersion 未绑定当前 Implementation Package candidateVersion", "candidateVersion");
  const authority = options.authority;
  const displayLayerScope = displayLayerScopeFromPackage(pkg);
  // current_stage 由实施包显式决定；远程场景合同门与本地用户拆解确认门必须同时通过。
  if (stage === "V2" || stage === "V4") errors.push(...validateSceneReconstructionGate(manifest, { stage, displayLayerScope }));
  errors.push(...validateVisualDecompositionConfirmationBinding(pkg, manifest, { stage: "V2", projectRoot, targetSha: manifest?.reference_target?.target_sha256, candidateSha: manifest?.candidate_identity?.sha256, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority }));
  errors.push(...validateVisualProductionCoverage(manifest, { stage, requireManualConfirmation: true, checkFiles: options.checkFiles === true || stage === "V2", projectRoot, targetSha: manifest?.reference_target?.target_sha256, targetFrozenAt: manifest?.reference_target?.frozen_at, candidateSha: manifest?.candidate_identity?.sha256, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority }));
  errors.push(...validateVisualProductionUnits(pkg, manifest, options));
  if (stage === "V3" || stage === "V4") {
    // V3 核验资源与部件事实；运行消费和同屏 Scene 组合仅在 V4 执行。
    errors.push(...validateProductionAuditShape(manifest, { stage }));
    if (stage === "V4") errors.push(...auditProductionContract(manifest, { projectRoot, checkFiles: options.checkFiles === true }));
  }
  if (stage === "V4") {
    const identity = manifestEvidenceIdentity(manifest);
    errors.push(...validateVisualPostApprovalReviewFields(manifest, { stage: "V4" }));
    errors.push(...validateV4ProductionGate(manifest, { requireEvidenceIdentity: true, identity, projectRoot, requireSceneReconstruction: true, displayLayerScope }));
  }
  return errors;
}
/** 校验视觉实施单元被委派给正确的代理，并继承其输出所有权。 */
export function validateVisualDelegationBinding(delegation, pkg) {
  const errors = []; const units = pkg?.visualProductionUnits ?? [];
  if (!Array.isArray(units) || units.length === 0) return errors;
  const delegatedIds = new Set(delegation?.executionUnitIds ?? []); const ownership = delegation.ownership ?? [];
  for (const unit of units.filter((item) => delegatedIds.has(item.unitId))) { const context = contractContext(unit, "V3", { annotation_number: unit.annotation_number, region_id: unit.region_id, observedMethod: unit.production_method ?? "missing" }); if (unit.owner !== delegation.assignedAgent) errors.push(productionContractError(context, "视觉实施单元 owner 与委派代理不一致", { missing: "owner" })); for (const path of unit.ownedPaths ?? []) if (!ownership.some((pattern) => pattern === path || path.startsWith(`${pattern}/`) || path.startsWith(`${pattern}\\`))) errors.push(productionContractError(context, `视觉实施单元路径未被委派 ownership 覆盖：${path}`, { missing: "ownership" })); }
  return errors;
}
/** 提供 workflow-control 使用的实施包单入口，避免总控文件堆叠视觉合同分支。 */
export function validateVisualImplementationPackage(pkg, options = {}) {
  if (options.requireVisual === true && pkg?.visualProductionUnits === undefined) return ["[V2] annotation_number=* region_id=* expected_method=visual-production observed_method=missing 缺失=visualProductionUnits：视觉实施包必须逐区域覆盖"];
  const errors = validateVisualProductionUnits(pkg, null, options); const units = pkg?.visualProductionUnits;
  if (units !== undefined) { const context = { stage: "V2", annotation_number: "*", region_id: "*", expectedMethod: "visual-production", observedMethod: "missing" }; if (!nonEmptyString(pkg?.candidateVersion)) errors.push(productionContractError(context, "视觉 Implementation Package 缺少 candidateVersion", { missing: "candidateVersion" })); if (!nonEmptyString(pkg?.visualManifestFile)) errors.push(productionContractError(context, "Implementation Package 缺少 visualManifestFile", { missing: "visualManifestFile" })); if (units.some((unit) => Number.isInteger(unit?.annotation_number)) && (!Array.isArray(pkg?.visualDecompositionConfirmations) || pkg.visualDecompositionConfirmations.length === 0)) errors.push(productionContractError(context, "视觉 Implementation Package 缺少按 scene/state 分组的人工拆解确认身份", { missing: "visualDecompositionConfirmations" })); }
  return errors;
}
/** 视觉变更沿用统一生产路线校验，避免形成第二套放行条件。 */
export function validateVisualChangeRequest(change, context = {}) { return validateProductionMethodChangeRequest(change, context); }
/** 校验工作流 Evidence Manifest 中视觉证据，并绑定实施包读取的当前清单。 */
export function validateVisualEvidence(evidence, pkg, options = {}) {
  const fileGateError = productionFileGateError(options.manifest, options, "V4");
  if (fileGateError) return [fileGateError]; if (pkg?.visualProductionUnits === undefined) return [];
  const errors = []; const manifest = options.manifest;
  if (!isObject(manifest)) return ["[V4] annotation_number=* region_id=* expected_method=production-contract observed_method=missing 缺失=visualManifestSnapshot：Evidence 必须绑定实施包对应的当前清单"];
  const baseIdentity = manifestEvidenceIdentity(manifest); const identity = { ...baseIdentity, diff: options.diffFingerprint ?? baseIdentity.diff };
  const authority = options.authority;
  const displayLayerScope = displayLayerScopeFromPackage(pkg);
  // Evidence/COMPLETE 必须消费当前工作项的完整合同；弹窗合同不再进入宿主场景验收。
  errors.push(...validateSceneReconstructionGate(manifest, { stage: "V4", displayLayerScope }));
  errors.push(...validateProductionAuditShape(manifest, { stage: "V4", authority, projectRoot: options.projectRoot, checkFiles: Boolean(options.projectRoot) }));
  errors.push(...auditProductionContract(manifest, { projectRoot: options.projectRoot, checkFiles: Boolean(options.projectRoot), targetSha: identity.target, targetFrozenAt: manifest?.reference_target?.frozen_at, candidateSha: identity.candidate, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority }));
  const evidenceOptions = { requireEvidenceIdentity: true, identity, projectRoot: options.projectRoot, checkFiles: Boolean(options.projectRoot), targetFrozenAt: manifest?.reference_target?.frozen_at, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion, authority };
  // Evidence Manifest 本身也属于 V2-V4 视觉证据，不能只扫描 manifest 而漏掉顶层 reviewer。
  errors.push(...validateVisualPostApprovalReviewFields(evidence, { stage: "V4" }));
  errors.push(...validateVisualPostApprovalReviewFields(manifest, { stage: "V4" }));
  errors.push(...validateVisualF2MachineGate(evidence?.gateResults?.F2, { stage: "F2" }, evidenceOptions));
  const replay = evidence?.gateResults?.F3?.runtime_replay ?? evidence?.runtime_replay;
  if (!isObject(replay) || !["passed", "PASS"].includes(String(replay.status)) || !nonEmptyString(replay.evidence)) errors.push("[F3] annotation_number=* region_id=* expected_method=runtime-replay observed_method=missing 缺失=runtime_replay：视觉候选必须绑定通过的 runtime replay"); else errors.push(...validateEvidenceIdentity(replay, { stage: "F3", annotation_number: "*", region_id: "runtime-replay" }, identity, evidenceOptions));
  const gate = evidence?.visual_production_gate; if (!gate) errors.push("[V4] annotation_number=* region_id=* expected_method=production-contract observed_method=missing 缺失=visual_production_gate：视觉候选缺少 V4 生产合同门"); else errors.push(...validateV4ProductionGate({ ...manifest, visual_production_gate: gate }, { ...evidenceOptions, displayLayerScope, candidateSha256: identity.candidate, targetSha256: identity.target, targetFrozenAt: manifest?.reference_target?.frozen_at, workItemId: manifest?.workItemId, candidateVersion: manifest?.candidateVersion }));
  return errors;
} export async function productionContractAuditResult(manifest, options = {}) { const errors = await auditProductionContract(manifest, options); return { status: errors.length ? "failed" : "passed", errors }; }
