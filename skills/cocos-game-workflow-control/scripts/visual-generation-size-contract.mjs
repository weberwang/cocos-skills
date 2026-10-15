#!/usr/bin/env node
/**
 * 图像生成 单图最小尺寸合同。
 *
 * 该模块只计算机器可确定的输出尺寸，不承载人工审阅字段；视觉方向
 * 只由 V2 唯一拆解确认冻结，V3/V4 继续执行机器证据门。尺寸按逻辑像素、最大运行缩放和
 * 图片生产基线 DPR 计算，并强制画布不额外添加 padding；运行时实际 DPR
 * 由设备动态解析，不能反向改变生产尺寸合同。
 */
import { normalizeComponentInventory } from "./visual-component-contract.mjs";
import { isNineSliceStretch, equalNineSliceContracts, validateNineSliceContract, validateNineSliceTargetBounds } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";
import { resolveOutputMetadata } from "./visual-raster-contract.mjs";
import { IMAGE_PRODUCTION_DPR, imageProductionDprError, isImageProductionDpr } from "./workflow-dpr-contract.mjs";

/** 判断值是否是普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断字符串是否包含有效合同内容。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 从 snake_case/camelCase 合同中读取首个已声明字段。 */
function field(value, ...names) {
  if (!isObject(value)) return undefined;
  for (const name of names) if (value[name] !== undefined) return value[name];
  return undefined;
}

/** 合并区域、场景还原区域和实施单元的场景使用合同。 */
function resolveSceneAssetUsage(region, unit, options = {}) {
  const values = [
    region?.scene_asset_usage,
    region?.sceneAssetUsage,
    region?.production_contract?.scene_asset_usage,
    region?.production_contract?.sceneAssetUsage,
    region?.productionContract?.scene_asset_usage,
    region?.productionContract?.sceneAssetUsage,
    unit?.scene_asset_usage,
    unit?.sceneAssetUsage,
    options.contract?.scene_asset_usage,
    options.contract?.sceneAssetUsage,
    options.sceneAssetUsage,
  ].filter(isObject);
  return Object.assign({}, ...values);
}

/** 构造包含 annotation/region/component/state/asset 的机器错误上下文。 */
function sizeError(context, message, details = {}) {
  const stage = context.stage ?? "V3";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "?";
  const region = context.region_id ?? context.regionId ?? "?";
  const component = details.component_id ?? context.component_id ?? context.componentId ?? "?";
  const state = details.state_id ?? context.state_id ?? context.stateId ?? "?";
  const asset = details.asset_id ?? context.asset_id ?? context.assetId ?? "?";
  const expected = details.expected === undefined ? "?" : JSON.stringify(details.expected);
  const actual = details.actual === undefined ? "?" : JSON.stringify(details.actual);
  const missing = details.missing ? ` 缺失=${details.missing}` : "";
  const returnStage = details.returnStage ?? (stage === "V1" || stage === "V2" ? "V1/PROPOSAL" : stage);
  return `[${stage}] annotation_number=${annotation} region_id=${region} component_id=${component} state_id=${state} asset_id=${asset} expected_method=image-generation observed_method=${context.observedMethod ?? "image-generation"} 根因=${details.rootCause ?? "图像生成 单图尺寸合同问题"} expected=${expected} actual=${actual}${missing} ${message} 应退回阶段=${returnStage}`;
}

/** 判断正数有限数，拒绝 NaN、Infinity 和隐式字符串。 */
function positiveNumber(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }

/** 判断 placement 是否包含逻辑像素矩形。 */
function validPlacementBounds(bounds) {
  return isObject(bounds)
    && ["x", "y", "width", "height"].every((key) => typeof bounds[key] === "number" && Number.isFinite(bounds[key]))
    && bounds.width > 0 && bounds.height > 0;
}

/** 取得区域或场景还原区域中的组件清单。 */
function resolveInventory(region, options = {}) {
  const raw = region?.component_inventory ?? region?.componentInventory
    ?? options.region?.component_inventory ?? options.region?.componentInventory;
  const normalized = normalizeComponentInventory(raw ?? {});
  const rawComponents = Array.isArray(raw?.components) ? raw.components : [];
  return {
    ...normalized,
    components: normalized.components.map((component) => {
      const source = rawComponents.find((item) => (item?.component_id ?? item?.componentId) === component.component_id);
      return source?.nine_slice === undefined ? component : { ...component, nine_slice: source.nine_slice };
    }),
  };
}

/** 计算组件所有 placements 的最大逻辑显示宽高。 */
export function calculateComponentDisplaySize(region, componentId, context = {}, options = {}) {
  const inventory = resolveInventory(region, options);
  const component = inventory.components.find((item) => item.component_id === componentId);
  const errors = [];
  if (!component) {
    errors.push(sizeError({ ...context, component_id: componentId }, "expected asset component_id 未映射 component_inventory", { component_id: componentId, missing: "component_inventory.components" }));
    return { errors, displaySize: null, inventory };
  }
  if (!Array.isArray(component.placements) || component.placements.length === 0) {
    errors.push(sizeError({ ...context, component_id: componentId }, "component placements 必须是非空列表", { component_id: componentId, missing: "component_inventory.components.placements" }));
    return { errors, displaySize: null, inventory };
  }
  let width = 0;
  let height = 0;
  for (const [index, placement] of component.placements.entries()) {
    const local = { ...context, component_id: componentId };
    if (!validPlacementBounds(placement?.bounds)) {
      errors.push(sizeError(local, `placement[${index}] bounds 必须是逻辑像素正矩形`, { component_id: componentId, missing: `placements[${index}].bounds` }));
      continue;
    }
    width = Math.max(width, placement.bounds.width);
    height = Math.max(height, placement.bounds.height);
  }
  if (!(width > 0 && height > 0)) return { errors, displaySize: null, inventory };
  return { errors, displaySize: { width, height }, inventory };
}

/** 校验单个 图像生成 expected asset 的精确最小尺寸和无留白政策。 */
export function validateImageGenerationSizeContract(asset, contract, context = {}, options = {}) {
  const method = contract?.production_method ?? contract?.productionMethod;
  const required = contract?.image_generation_required ?? contract?.imageGenerationRequired;
  if (method !== "image-generation" && required !== true) return [];
  const expectedAsset = options.expectedAsset ?? contract?.expected_assets?.[0] ?? contract?.expectedAssets?.[0] ?? {};
  const region = context.region ?? options.region ?? contract?.region;
  const usage = resolveSceneAssetUsage(region, options.unit, options);
  const componentId = expectedAsset.component_id ?? expectedAsset.componentId ?? context.component_id ?? context.componentId;
  const stateId = expectedAsset.state_id ?? expectedAsset.stateId ?? context.state_id ?? context.stateId;
  const assetId = expectedAsset.asset_id ?? expectedAsset.assetId ?? context.asset_id ?? context.assetId;
  const local = { ...context, component_id: componentId, state_id: stateId, asset_id: assetId, observedMethod: "image-generation" };
  const errors = [];

  const displaySizeValue = field(usage, "target_display_size", "targetDisplaySize");
  if (!isObject(displaySizeValue) || !positiveNumber(displaySizeValue.width) || !positiveNumber(displaySizeValue.height)) {
    errors.push(sizeError(local, "scene_asset_usage.target_display_size 必须声明正数逻辑像素宽高", { missing: "scene_asset_usage.target_display_size" }));
  }
  const scale = field(usage, "intended_scale_range", "intendedScaleRange");
  if (!isObject(scale) || !positiveNumber(scale.min) || !positiveNumber(scale.max) || scale.max < scale.min) {
    errors.push(sizeError(local, "intended_scale_range 必须包含正数 min/max 且 max>=min", { missing: "scene_asset_usage.intended_scale_range" }));
  }
  const maxDpr = field(usage, "max_dpr", "maxDpr");
  if (!isImageProductionDpr(maxDpr)) errors.push(sizeError(local, imageProductionDprError("max_dpr", maxDpr), { missing: "scene_asset_usage.max_dpr", expected: IMAGE_PRODUCTION_DPR }));
  const paddingPolicy = field(usage, "padding_policy", "paddingPolicy");
  if (paddingPolicy !== "none") errors.push(sizeError(local, "图像生成 individual 必须使用 padding_policy=none，禁止画布额外留白", { expected: "none", actual: paddingPolicy, missing: "scene_asset_usage.padding_policy" }));

  const display = calculateComponentDisplaySize(region ?? options.region, componentId, local, options);
  errors.push(...display.errors);
  if (!display.displaySize || !isObject(scale) || !positiveNumber(scale.max) || !isImageProductionDpr(maxDpr)) return errors;

  const component = display.inventory.components.find((item) => item.component_id === componentId);
  let nineSlice;
  try {
    nineSlice = expectedAsset.nine_slice === undefined ? undefined : validateNineSliceContract(expectedAsset.nine_slice, "expected_assets.nine_slice");
  } catch (error) {
    errors.push(sizeError(local, `expected_assets.nine_slice 无效：${error.message}`, { missing: "expected_assets.nine_slice" }));
  }
  let componentNineSlice;
  try {
    componentNineSlice = component?.nine_slice === undefined ? undefined : validateNineSliceContract(component.nine_slice, `component ${componentId}.nine_slice`);
  } catch (error) {
    errors.push(sizeError(local, `component_inventory.nine_slice 无效：${error.message}`, { component_id: componentId }));
  }
  if (!equalNineSliceContracts(componentNineSlice, nineSlice)) {
    errors.push(sizeError(local, "component_inventory 与 expected_assets 的 nine_slice 决策必须完全一致"));
  }
  if (isNineSliceStretch(nineSlice)) {
    for (const [index, placement] of (component?.placements ?? []).entries()) {
      try {
        validateNineSliceTargetBounds(nineSlice, placement.bounds, `component ${componentId}.placements[${index}].bounds`);
      } catch (error) {
        errors.push(sizeError(local, `九宫格 placement[${index}] 尺寸无效：${error.message}`, { component_id: componentId }));
      }
    }
    // 裁切会改变冻结的角边内容；尺寸相同也不能把裁角结果当作完整九宫格源帧。
    for (const [label, candidate] of [["asset", asset], ["actual_assets", options.actualAsset]]) {
      if (candidate?.normalization_record?.operation === "crop-and-resize-to-contract") {
        errors.push(sizeError(local, `${label} normalization_record.operation 不得为 crop-and-resize-to-contract；九宫格必须保留完整源帧`, { component_id: componentId }));
      }
    }
  }

  const singleComponent = display.inventory.components.length === 1;
  if (singleComponent && isObject(displaySizeValue) && (displaySizeValue.width !== display.displaySize.width || displaySizeValue.height !== display.displaySize.height)) {
    errors.push(sizeError(local, "单组件场景 target_display_size 必须与 placement 最大逻辑尺寸一致", { expected: display.displaySize, actual: displaySizeValue }));
  }
  // 生产位图以 1:1 覆盖最大约定显示尺寸，只计业务缩放，不再叠加设备 DPR 的倍率。
  // 九宫格源图就是逻辑像素切片基线；仅中心区域伸缩，边角保持本地尺寸，不叠加最大业务缩放。
  const minimum = isNineSliceStretch(nineSlice)
    ? { ...nineSlice.source_size }
    : { width: Math.ceil(display.displaySize.width * scale.max * IMAGE_PRODUCTION_DPR), height: Math.ceil(display.displaySize.height * scale.max * IMAGE_PRODUCTION_DPR) };
  const expectedSize = { width: expectedAsset.width, height: expectedAsset.height };
  if (expectedAsset.width !== minimum.width || expectedAsset.height !== minimum.height) {
    errors.push(sizeError(local, `expected_assets 必须精确使用机器计算的最小尺寸（按逻辑像素×最大缩放×图片生产基线 ${IMAGE_PRODUCTION_DPR} 向上取整）`, { expected: minimum, actual: expectedSize }));
  }
  const metadata = resolveOutputMetadata(asset ?? {});
  if (asset && (metadata.width !== minimum.width || metadata.height !== minimum.height)) {
    errors.push(sizeError(local, "图像生成 实际输出尺寸必须精确等于最小尺寸", { expected: minimum, actual: { width: metadata.width, height: metadata.height } }));
  }
  if (options.actualAsset) {
    const actual = resolveOutputMetadata(options.actualAsset);
    if (actual.width !== minimum.width || actual.height !== minimum.height) errors.push(sizeError(local, "V3 actual_assets 实际输出尺寸漂移，必须精确等于最小尺寸", { expected: minimum, actual: { width: actual.width, height: actual.height } }));
  }
  return errors;
}

/** 读取清单中指定 region 的场景使用合同，并覆盖场景还原区域/实施单元的来源。 */
function sceneUsageForRegion(manifest, region, unit) {
  const reconstructionContract = manifest?.scene_reconstruction_contract ?? manifest?.sceneReconstructionContract;
  const reconstruction = reconstructionContract?.coverage_regions ?? reconstructionContract?.coverageRegions;
  const reconstructionRegion = Array.isArray(reconstruction)
    ? reconstruction.find((item) => (item?.region_id ?? item?.regionId ?? item?.id) === region.id)
    : null;
  return { region: { ...region, ...(reconstructionRegion ?? {}) }, unit, sceneAssetUsage: unit?.scene_asset_usage ?? unit?.sceneAssetUsage };
}

/** 对完整 visual manifest 执行 V2 expected、V3 actual 的 图像生成 尺寸门。 */
export function validateImageGenerationSizeManifest(manifest, options = {}) {
  const errors = [];
  const regions = Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : [];
  const assets = new Map((Array.isArray(manifest?.assets) ? manifest.assets : []).filter(isObject).map((item) => [item.id ?? item.asset_id ?? item.assetId, item]));
  const audit = manifest?.production_contract_audit ?? manifest?.productionContractAudit;
  const units = Array.isArray(audit?.units) ? audit.units : [];
  for (const region of regions) {
    const regionContract = region?.production_contract ?? region?.productionContract;
    if (!isObject(region) || (region.owner_type ?? region.ownerType) !== "fixed-production-visual") continue;
    const method = region.production_method ?? region.productionMethod
      ?? regionContract?.production_method ?? regionContract?.productionMethod;
    const required = region.image_generation_required ?? region.imageGenerationRequired
      ?? regionContract?.image_generation_required ?? regionContract?.imageGenerationRequired;
    if (method !== "image-generation" && required !== true) continue;
    const unit = units.find((item) => (item?.annotation_number ?? item?.annotationNumber) === (region.annotation_number ?? region.annotationNumber)
      && (item?.region_id ?? item?.regionId) === (region.id ?? region.region_id ?? region.regionId));
    const expectedAssets = Array.isArray(region.expected_assets)
      ? region.expected_assets
      : (Array.isArray(region.expectedAssets)
        ? region.expectedAssets
        : (Array.isArray(regionContract?.expected_assets)
          ? regionContract.expected_assets
          : (Array.isArray(regionContract?.expectedAssets)
            ? regionContract.expectedAssets
            : (Array.isArray(unit?.expected_assets) ? unit.expected_assets : (Array.isArray(unit?.expectedAssets) ? unit.expectedAssets : [])))));
    const resolved = sceneUsageForRegion(manifest, region, unit);
    for (const expected of expectedAssets) {
      const expectedAssetId = expected?.asset_id ?? expected?.assetId;
      const local = { stage: options.stage ?? "V3", annotation_number: region.annotation_number ?? region.annotationNumber, region_id: region.id ?? region.region_id ?? region.regionId, component_id: expected?.component_id ?? expected?.componentId, state_id: expected?.state_id ?? expected?.stateId, asset_id: expectedAssetId, observedMethod: method };
      const asset = assets.get(expectedAssetId);
      errors.push(...validateImageGenerationSizeContract(asset, region, local, { expectedAsset: expected, ...resolved }));
      if (unit && Array.isArray(unit.actual_assets)) {
        const actual = unit.actual_assets.find((item) => (item?.asset_id ?? item?.assetId) === expectedAssetId);
        if (actual) errors.push(...validateImageGenerationSizeContract(null, region, local, { expectedAsset: expected, ...resolved, actualAsset: actual }));
      }
    }
  }
  return errors;
}
