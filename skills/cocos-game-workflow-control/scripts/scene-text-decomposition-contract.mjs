/**
 * 效果图还原中的文本拆解、实现路线和运行时测量合同。
 *
 * 文本既可能是 Cocos Text/BitmapText，也可能是固定图片字标；如果只把
 * 文本当成 coverage region 的附属事实，区域 bounds 通过仍然无法说明字形、
 * 基线和字体是否一致。本模块把可观察文本事实与 V3/V3/V4 的实现证据
 * 绑定在同一个 text_node 上，并只由 scene reconstruction 合同调用。
 */

import { isWorkflowDpr } from "./workflow-dpr-contract.mjs";

const TEXT_ROUTES = new Set(["cocos-text", "bitmap-text", "image-text", "hybrid"]);
const PASS_VALUES = new Set(["passed", "pass", "true"]);

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 读取 snake_case/camelCase 合同字段，权威输出仍由 snake_case Schema 定义。 */
function field(value, ...names) {
  for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name];
  return undefined;
}

/** 判断结构化值是否有可复核内容；false 也必须作为显式事实保留。 */
function hasStructuredValue(value) {
  return (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0)
    || nonEmptyString(value)
    || typeof value === "number" && Number.isFinite(value)
    || typeof value === "boolean";
}

/** 判断文本/运行时证据是否提供了路径或结构化身份。 */
function hasEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 判断有限正尺寸矩形；文本 bounds 与 glyph bounds 都不能用零尺寸占位。 */
function validBounds(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 判断两个 bounds 是否逐字段一致，防止文本绕过绑定使用另一套坐标。 */
function sameBounds(first, second) {
  return validBounds(first) && validBounds(second)
    && first.x === second.x
    && first.y === second.y
    && first.width === second.width
    && first.height === second.height;
}

/** 判断工作流允许的 DPR；文本字号必须绑定真实参考 DPR，不能把像素字号直接当逻辑字号。 */
function validDpr(value) {
  return isWorkflowDpr(value);
}

/** 判断允许的字号值；可接受带单位对象，但单位在上层单独检查。 */
function validPositiveMeasure(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (!isObject(value)) return false;
  const numeric = field(value, "value", "amount", "size");
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric > 0;
}

/** 判断可观测的 baseline/字距等标量或结构化事实。 */
function validFact(value) {
  return (typeof value === "number" && Number.isFinite(value)) || hasStructuredValue(value);
}

/** 生成与场景合同一致的错误，保留阶段、场景、区域和退回定位。 */
function contractError(stage, contract, node, message, details = {}) {
  const target = contract?.target_conditions ?? contract?.target ?? contract?.frozen_target ?? {};
  const scene = node?.scene_id ?? node?.sceneId ?? target.scene_id ?? target.sceneId ?? "?";
  const state = node?.state_id ?? node?.stateId ?? target.state_id ?? target.stateId ?? "?";
  const annotation = node?.annotation_number ?? node?.annotationNumber ?? "*";
  const regionId = node?.region_id ?? node?.regionId ?? node?.id ?? "*";
  const missing = details.missing ? ` 缺失视觉事实=${details.missing}` : "";
  const expected = details.expected ?? "完整文本拆解事实与运行时证据";
  const actual = details.actual ?? "missing";
  const returnStage = details.returnStage ?? (stage === "V1" || stage === "V2" ? "V1/PROPOSAL" : stage);
  const rootCause = details.rootCause ?? (returnStage === "V1/PROPOSAL" ? "方案缺失" : stage === "V3" ? "执行问题" : stage === "V4" || stage === "VALIDATING" ? "验收问题" : "方案缺失");
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${regionId} 根因=${rootCause} ${message}${missing} 预期证据=${expected} 实际证据=${actual} 应退回阶段=${returnStage}`;
}

/** 记录规划阶段错误；V3 路线缺失也必须回到可修复的方案边界。 */
function pushPlanError(errors, stage, contract, node, message, details = {}) {
  errors.push(contractError(stage, contract, node, message, {
    ...details,
    returnStage: details.returnStage ?? "V1/PROPOSAL",
    rootCause: details.rootCause ?? "方案缺失",
  }));
}

/** 记录 V3/V4 运行时错误，避免把执行或验收问题错误退回素材规划。 */
function pushRuntimeError(errors, stage, contract, node, message, details = {}) {
  errors.push(contractError(stage, contract, node, message, {
    ...details,
    returnStage: details.returnStage ?? (stage === "V4" || stage === "VALIDATING" ? "VALIDATING" : "V3/V4"),
    rootCause: details.rootCause ?? (stage === "V4" || stage === "VALIDATING" ? "验收问题" : "执行问题"),
  }));
}

/** 统一读取文本节点的 typography 事实；旧 camelCase 只作为输入别名。 */
function typographyOf(node) {
  return field(node, "typography_target", "typographyTarget", "target_typography", "targetTypography", "typography") ?? {};
}

/** 统一读取目标字体身份，禁止 unresolved 状态伪造一个看似确定的字体名。 */
function fontIdentityOf(typography, node) {
  return field(typography, "font_identity", "fontIdentity", "font")
    ?? field(node, "font_identity", "fontIdentity", "font")
    ?? {};
}

/** 统一读取目标字段；允许少量顶层别名，但不降低 canonical 合同的字段要求。 */
function textFact(node, typography, names) {
  return field(typography, ...names) ?? field(node, ...names);
}

/** 读取主场景校验已从唯一布局源构造的节点映射，不再回读场景合同副本。 */
function layoutIndex(layoutInfo) {
  if (layoutInfo?.nodeById instanceof Map) return layoutInfo.nodeById;
  return new Map();
}

/** 读取 coverage region 映射，检查 text_node 与现有 coverage 的双向归属。 */
function regionIndex(contract, regions) {
  const source = Array.isArray(regions) ? regions : field(contract, "coverage_regions", "coverageRegions", "regions");
  const result = new Map();
  if (Array.isArray(source)) for (const region of source) {
    const id = field(region, "region_id", "regionId", "id");
    if (nonEmptyString(id) && !result.has(id)) result.set(id, region);
  }
  return result;
}

/** 读取预声明容差定义，V4 不允许文本节点自行发明数值阈值。 */
function toleranceIndex(contract, definitions) {
  if (definitions instanceof Map) return definitions;
  const source = definitions ?? field(contract, "predeclared_tolerances", "predeclaredTolerances", "tolerance_set", "toleranceSet", "tolerances");
  const result = new Map();
  if (Array.isArray(source)) for (const item of source) {
    const id = field(item, "id", "tolerance_id", "toleranceId");
    if (nonEmptyString(id) && !result.has(id)) result.set(id, item);
  }
  return result;
}

/** 从预声明容差中提取可执行的最大数值规则。 */
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
  return values.length > 0 ? Math.max(...values) : null;
}

/** 递归收集数值差异；数字使用绝对值后再和项目容差比较。 */
function numericDeltas(value, result = []) {
  if (typeof value === "number" && Number.isFinite(value)) result.push(Math.abs(value));
  else if (Array.isArray(value)) for (const nested of value) numericDeltas(nested, result);
  else if (isObject(value)) for (const nested of Object.values(value)) numericDeltas(nested, result);
  return result;
}

/** 根据 target/candidate 事实推导差异，防止伪造 delta=0 隐藏真实字形偏移。 */
function numericFactDeltas(target, candidate, result = []) {
  if (typeof target === "number" && typeof candidate === "number" && Number.isFinite(target) && Number.isFinite(candidate)) result.push(Math.abs(candidate - target));
  else if (Array.isArray(target) && Array.isArray(candidate)) for (let index = 0; index < Math.max(target.length, candidate.length); index += 1) numericFactDeltas(target[index], candidate[index], result);
  else if (isObject(target) && isObject(candidate)) for (const key of new Set([...Object.keys(target), ...Object.keys(candidate)])) numericFactDeltas(target[key], candidate[key], result);
  return result;
}

/** 只识别非数值事实差异；数值差异由预声明 tolerance 处理。 */
function nonNumericFactsDiffer(target, candidate) {
  if (typeof target === "number" && typeof candidate === "number") return false;
  if (typeof target === "number" || typeof candidate === "number") return typeof target !== typeof candidate;
  if (Array.isArray(target) && Array.isArray(candidate)) return target.length !== candidate.length || target.some((value, index) => nonNumericFactsDiffer(value, candidate[index]));
  if (isObject(target) && isObject(candidate)) return [...new Set([...Object.keys(target), ...Object.keys(candidate)])].some((key) => nonNumericFactsDiffer(target[key], candidate[key]));
  return JSON.stringify(target) !== JSON.stringify(candidate);
}

/** 读取资源对象中统一的 kind/path 视图；内容摘要只作可选追踪信息。 */
function resourceFact(resource) {
  if (!isObject(resource)) return { kind: "", path: undefined };
  return {
    kind: String(field(resource, "kind", "resource_type", "resourceType", "role", "purpose", "type", "asset_type", "assetType") ?? "").toLowerCase(),
    path: field(resource, "path", "file", "asset", "asset_path", "assetPath", "source_file", "sourceFile"),
  };
}

/** 判断资源是否绑定了实际路径；摘要存在与否不改变资源映射结论。 */
function validResource(resource) {
  const { path } = resourceFact(resource);
  return nonEmptyString(path);
}

/** 将直接资产字段纳入路线检查，canonical 路径仍建议使用 required_resources。 */
function directResource(node, names) {
  const value = field(node, ...names);
  return isObject(value) ? value : null;
}

/** 用稳定 kind 判断文本实现路线所需资源，避免只凭文件后缀推断。 */
function resourceMatches(resource, matcher) {
  const fact = resourceFact(resource);
  return validResource(resource) && matcher(fact.kind, resource);
}

/** 判断资源 kind 是否是可被 Cocos Text 消费的字体资产。 */
function isFontResource(resource) {
  return resourceMatches(resource, (kind) => ["font", "font-file", "font_asset", "font-asset", "typeface"].includes(kind));
}

/** 判断资源 kind 是否是 BitmapText 描述文件。 */
function isBitmapDescriptor(resource) {
  return resourceMatches(resource, (kind) => ["bitmap-font-descriptor", "bitmap_descriptor", "bitmap-font-data", "font-descriptor", "fnt"].includes(kind));
}

/** 判断资源 kind 是否是 BitmapText 纹理。 */
function isBitmapTexture(resource) {
  return resourceMatches(resource, (kind) => ["bitmap-font-texture", "bitmap_texture", "font-texture", "texture"].includes(kind));
}

/** 判断资源 kind 是否是固定图片文字或混合路线视觉效果。 */
function isImageResource(resource) {
  return resourceMatches(resource, (kind) => ["image", "image-text", "raster-image", "sprite", "visual-effect", "effect"].includes(kind));
}

/** 读取运行时验证对象，支持 measurement 嵌套但不允许缺少核心证据。 */
function runtimeView(raw) {
  const nested = field(raw, "measurement", "runtime_measurement", "runtimeMeasurement");
  const read = (...names) => field(raw, ...names) ?? (nested && nested !== raw ? field(nested, ...names) : undefined);
  return { raw, nested: nested ?? raw, read };
}

/** 将 renderer 统一成小写字符串集合；hybrid 可以提交多个实际 renderer。 */
function rendererValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (isObject(item)) return [
      field(item, "route", "type", "renderer"),
      field(item, "text_renderer", "textRenderer", "runtime_renderer", "runtimeRenderer"),
      field(item, "visual_renderer", "visualRenderer", "effect_renderer", "effectRenderer"),
    ];
    return [item];
  }).filter(nonEmptyString).map((item) => item.trim().toLowerCase());
}

/** 检查 renderer 是否与合同路线一致，禁止用另一种渲染器伪造通过。 */
function rendererMatches(route, renderer) {
  const values = rendererValues(renderer);
  if (route === "hybrid") {
    const text = new Set(["cocos-text", "text", "cocos.gameobjects.text", "gameobjects.text", "bitmap-text", "bitmaptext", "cocos.bitmaptext", "cocos.gameobjects.bitmaptext"]);
    const visual = new Set(["image-text", "image", "sprite", "cocos.image", "cocos.gameobjects.image", "visual-effect", "effect", "shader"]);
    return values.includes("hybrid") || (values.some((value) => text.has(value)) && values.some((value) => visual.has(value)));
  }
  const accepts = {
    "cocos-text": new Set(["cocos-text", "text", "cocos.gameobjects.text", "gameobjects.text"]),
    "bitmap-text": new Set(["bitmap-text", "bitmaptext", "cocos.bitmaptext", "cocos.gameobjects.bitmaptext"]),
    "image-text": new Set(["image-text", "image", "sprite", "cocos.image", "cocos.gameobjects.image"]),
  }[route];
  return Boolean(accepts && values.length > 0 && values.every((value) => accepts.has(value)));
}

/** 验证冻结的目标字体身份和可观察文字事实。 */
function validateTypography(node, contract, stage, errors) {
  const typography = typographyOf(node);
  if (!isObject(typography)) {
    pushPlanError(errors, stage, contract, node, "text_node 缺少 typography_target", { missing: "typography_target" });
    return { typography: {}, fontIdentity: {} };
  }

  const fontIdentity = fontIdentityOf(typography, node);
  if (!isObject(fontIdentity)) pushPlanError(errors, stage, contract, node, "text_node.font_identity 必须是对象", { missing: "font_identity" });
  const identityStatus = String(field(fontIdentity, "status", "identity_status", "identityStatus") ?? "").trim().toLowerCase();
  if (!["resolved", "unresolved"].includes(identityStatus)) pushPlanError(errors, stage, contract, node, "text_node.font_identity 必须声明 resolved 或 unresolved", { missing: "typography_target.font_identity.status", actual: identityStatus || "missing" });
  const confidence = field(fontIdentity, "confidence", "confidence_level", "confidenceLevel");
  if (!nonEmptyString(confidence) && !(typeof confidence === "number" && Number.isFinite(confidence))) pushPlanError(errors, stage, contract, node, "text_node.font_identity 缺少置信状态", { missing: "typography_target.font_identity.confidence" });
  const family = field(fontIdentity, "family", "font_family", "fontFamily", "name", "font_name", "fontName");
  const observableFacts = field(fontIdentity, "observable_facts", "observableFacts", "visual_facts", "visualFacts");
  if (identityStatus === "resolved") {
    if (!nonEmptyString(family)) pushPlanError(errors, stage, contract, node, "resolved 字体身份必须提供字体名", { missing: "typography_target.font_identity.family" });
  } else if (identityStatus === "unresolved") {
    // 原字体未知时保留字宽、轮廓等可观察事实；拒绝写入猜测的字体名，避免后续误用。
    if (nonEmptyString(family)) pushPlanError(errors, stage, contract, node, "unresolved 字体身份不得伪造 family/name", { actual: family });
    if (!isObject(observableFacts) || Object.keys(observableFacts).length === 0) pushPlanError(errors, stage, contract, node, "unresolved 字体身份必须保存 observable_facts", { missing: "typography_target.font_identity.observable_facts" });
  }

  const required = [
    [["font_size", "fontSize", "font_size_logical", "fontSizeLogical"], "font_size"],
    [["font_weight", "fontWeight", "weight"], "font_weight"],
    [["font_style", "fontStyle", "style"], "font_style"],
    [["line_height", "lineHeight"], "line_height"],
    [["letter_spacing", "letterSpacing", "tracking"], "letter_spacing"],
    [["alignment", "text_alignment", "textAlignment"], "alignment"],
    [["baseline", "baseline_mode", "baselineMode"], "baseline"],
    [["fill", "fill_color", "fillColor", "color"], "fill"],
    [["stroke", "stroke_style", "strokeStyle"], "stroke"],
    [["shadow", "shadow_style", "shadowStyle"], "shadow"],
    [["wrap", "wrap_policy", "wrapPolicy"], "wrap"],
    [["expected_line_count", "expectedLineCount", "line_count", "lineCount"], "expected_line_count"],
    [["reference_pixel_bounds", "referencePixelBounds", "pixel_bounds", "pixelBounds"], "reference_pixel_bounds"],
    [["target_glyph_bounds", "targetGlyphBounds", "glyph_bounds", "glyphBounds"], "target_glyph_bounds"],
    [["reference_dpr", "referenceDpr", "dpr"], "reference_dpr"],
    [["logical_coordinate_space", "logicalCoordinateSpace", "coordinate_space", "coordinateSpace"], "logical_coordinate_space"],
  ];
  for (const [names, label] of required) {
    const value = textFact(node, typography, names);
    let valid = hasStructuredValue(value);
    if (["font_size", "line_height"].includes(label)) valid = validPositiveMeasure(value);
    if (label === "expected_line_count") valid = Number.isInteger(value) && value > 0;
    if (["reference_pixel_bounds", "target_glyph_bounds"].includes(label)) valid = validBounds(value);
    if (label === "reference_dpr") valid = validDpr(value);
    if (!valid) pushPlanError(errors, stage, contract, node, `text_node typography 缺少或无效 ${label}`, { missing: `typography_target.${label}`, actual: JSON.stringify(value ?? "missing") });
  }
  const fontSizeUnit = textFact(node, typography, ["font_size_unit", "fontSizeUnit", "size_unit", "sizeUnit"])
    ?? (isObject(textFact(node, typography, ["font_size", "fontSize"])) ? field(textFact(node, typography, ["font_size", "fontSize"]), "unit") : undefined);
  if (!nonEmptyString(fontSizeUnit) || !["logical-px", "logical", "game-px"].includes(fontSizeUnit.trim().toLowerCase())) pushPlanError(errors, stage, contract, node, "text_node font_size 必须明确使用逻辑坐标单位", { missing: "typography_target.font_size_unit=logical-px", actual: String(fontSizeUnit ?? "missing") });
  return { typography, fontIdentity };
}

/** 验证 V3 路线、资源、所有权和 unresolved 字体的替代方案。 */
function validateImplementationRoute(node, contract, stage, errors, { typography, fontIdentity }) {
  const route = String(field(node, "implementation_route", "implementationRoute", "route") ?? "").trim().toLowerCase();
  if (!TEXT_ROUTES.has(route)) {
    pushPlanError(errors, stage, contract, node, "text_node 必须显式选择 implementation_route", { missing: "implementation_route", actual: route || "missing" });
    return;
  }
  const routeReason = field(node, "route_reason", "routeReason", "implementation_reason", "implementationReason");
  if (!nonEmptyString(routeReason)) pushPlanError(errors, stage, contract, node, "text_node 缺少 route_reason", { missing: "route_reason" });
  const ownership = field(node, "ownership", "text_ownership", "textOwnership", "owner");
  if (!hasStructuredValue(ownership)) pushPlanError(errors, stage, contract, node, "text_node 缺少实现所有权", { missing: "ownership" });
  if (route === "hybrid") {
    const runtimeOwner = isObject(ownership) ? field(ownership, "runtime_text", "runtimeText", "runtime_text_owner", "runtimeTextOwner", "text") : undefined;
    const effectOwner = isObject(ownership) ? field(ownership, "visual_effects", "visualEffects", "visual_effect_owner", "visualEffectOwner", "effects", "image") : undefined;
    if (!nonEmptyString(runtimeOwner)) pushPlanError(errors, stage, contract, node, "hybrid 必须说明运行时文字所有权", { missing: "ownership.runtime_text" });
    if (!nonEmptyString(effectOwner)) pushPlanError(errors, stage, contract, node, "hybrid 必须说明视觉效果所有权", { missing: "ownership.visual_effects" });
  }

  const rawResources = field(node, "required_resources", "requiredResources", "resources");
  const resources = Array.isArray(rawResources) ? rawResources : [];
  if (!Array.isArray(rawResources) || resources.length === 0) pushPlanError(errors, stage, contract, node, "text_node 缺少非空 required_resources", { missing: "required_resources" });
  for (const [index, resource] of resources.entries()) if (!validResource(resource)) pushPlanError(errors, stage, contract, node, `required_resources[${index}] 必须包含资源路径`, { missing: `required_resources[${index}].path`, actual: JSON.stringify(resource) });

  const directFont = directResource(node, ["font_asset", "fontAsset", "font_resource", "fontResource"]);
  const directDescriptor = directResource(node, ["bitmap_font_descriptor", "bitmapFontDescriptor", "descriptor_resource", "descriptorResource"]);
  const directTexture = directResource(node, ["bitmap_font_texture", "bitmapFontTexture", "texture_resource", "textureResource"]);
  const directImage = directResource(node, ["image_asset", "imageAsset", "image_resource", "imageResource"]);
  const hasFont = Boolean(directFont && validResource(directFont)) || resources.some(isFontResource);
  const hasDescriptor = Boolean(directDescriptor && validResource(directDescriptor)) || resources.some(isBitmapDescriptor);
  const hasTexture = Boolean(directTexture && validResource(directTexture)) || resources.some(isBitmapTexture);
  const hasImage = Boolean(directImage && validResource(directImage)) || resources.some(isImageResource);

  if (route === "cocos-text" && !hasFont) pushPlanError(errors, stage, contract, node, "cocos-text 必须绑定字体资产路径", { missing: "required_resources[kind=font].path" });
  if (route === "bitmap-text" && (!hasDescriptor || !hasTexture)) pushPlanError(errors, stage, contract, node, "bitmap-text 必须同时绑定描述文件和字体纹理路径", { missing: "bitmap-font-descriptor/bitmap-font-texture resources" });
  if (route === "image-text") {
    if (!hasImage) pushPlanError(errors, stage, contract, node, "image-text 必须绑定图片资产路径", { missing: "required_resources[kind=image].path" });
    const accessible = field(node, "accessible_semantic", "accessibleSemantic", "accessibility", "semantic_text", "semanticText");
    if (!hasStructuredValue(accessible)) pushPlanError(errors, stage, contract, node, "image-text 必须保留可访问语义", { missing: "accessible_semantic" });
  }
  if (route === "hybrid" && (!hasImage || (!hasFont && !(hasDescriptor && hasTexture)))) pushPlanError(errors, stage, contract, node, "hybrid 必须同时绑定运行时文字资源和视觉效果资源", { missing: "required_resources[text+visual-effect]" });

  const dynamic = field(node, "dynamic");
  const localizable = field(node, "localizable", "localizable_text", "localizableText");
  if ((dynamic === true || localizable === true) && route === "image-text") pushPlanError(errors, stage, contract, node, "动态或本地化文本禁止使用 image-text", { actual: JSON.stringify({ dynamic, localizable }), expected: "cocos-text、bitmap-text 或 hybrid" });

  const identityStatus = String(field(fontIdentity, "status", "identity_status", "identityStatus") ?? "").trim().toLowerCase();
  if (identityStatus === "unresolved") {
    const resolution = field(node, "font_resolution", "fontResolution", "font_substitution", "fontSubstitution", "substitution_plan", "substitutionPlan");
    const strategy = isObject(resolution) ? field(resolution, "strategy", "mode", "route", "plan") : undefined;
    if (!hasStructuredValue(resolution)) pushPlanError(errors, stage, contract, node, "unresolved 字体必须声明明确的替代字体或位图方案", { missing: "font_resolution.strategy" });
    if (!nonEmptyString(strategy)) pushPlanError(errors, stage, contract, node, "字体替代方案必须声明 strategy", { missing: "font_resolution.strategy" });
  }
  return route;
}

/** 验证 V3/V4 的实际 renderer、字体加载、bounds、基线、测试 ID 和证据。 */
function validateRuntimeVerification(node, contract, stage, errors, route, region, toleranceDefinitions, isV4Runtime) {
  const raw = field(node, "runtime_verification", "runtimeVerification", "runtime_measurement", "runtimeMeasurement", "measurement");
  if (!isObject(raw)) {
    pushRuntimeError(errors, stage, contract, node, "text_node 缺少 runtime_verification/measurement", { missing: "runtime_verification" });
    return;
  }
  const { read } = runtimeView(raw);
  const renderer = read("renderer", "render_engine", "renderEngine");
  if (!rendererMatches(route, renderer)) pushRuntimeError(errors, stage, contract, node, "文本 renderer 与 implementation_route 不一致", { expected: route, actual: JSON.stringify(renderer), missing: "runtime_verification.renderer" });

  if (route !== "image-text") {
    if (read("font_loaded", "fontLoaded") !== true) pushRuntimeError(errors, stage, contract, node, "非图片文字必须证明 font_loaded=true", { missing: "runtime_verification.font_loaded=true", actual: String(read("font_loaded", "fontLoaded") ?? "missing") });
    if (read("fallback_detected", "fallbackDetected") !== false) pushRuntimeError(errors, stage, contract, node, "非图片文字必须证明 fallback_detected=false", { missing: "runtime_verification.fallback_detected=false", actual: String(read("fallback_detected", "fallbackDetected") ?? "missing") });
  }
  const actualBounds = read("actual_bounds", "actualBounds", "runtime_bounds", "runtimeBounds", "bounds");
  const actualGlyphBounds = read("glyph_bounds", "glyphBounds", "actual_glyph_bounds", "actualGlyphBounds");
  const actualBaseline = read("baseline", "actual_baseline", "actualBaseline");
  if (!validBounds(actualBounds)) pushRuntimeError(errors, stage, contract, node, "runtime_verification 缺少有效 actual_bounds", { missing: "runtime_verification.actual_bounds" });
  if (!validBounds(actualGlyphBounds)) pushRuntimeError(errors, stage, contract, node, "runtime_verification 缺少有效 glyph_bounds", { missing: "runtime_verification.glyph_bounds" });
  if (!validFact(actualBaseline)) pushRuntimeError(errors, stage, contract, node, "runtime_verification 缺少有效 baseline", { missing: "runtime_verification.baseline" });
  const plannedTestId = field(node, "planned_test_id", "plannedTestId");
  const actualTestId = read("actual_test_id", "actualTestId", "test_id", "testId");
  if (!nonEmptyString(actualTestId)) pushRuntimeError(errors, stage, contract, node, "runtime_verification 缺少 actual_test_id", { missing: "runtime_verification.actual_test_id" });
  else if (actualTestId !== plannedTestId) pushRuntimeError(errors, stage, contract, node, "actual_test_id 必须等于 planned_test_id", { expected: plannedTestId, actual: actualTestId });
  if (!hasEvidence(read("evidence", "runtime_evidence", "runtimeEvidence", "evidence_paths", "evidencePaths"))) pushRuntimeError(errors, stage, contract, node, "runtime_verification 缺少运行证据", { missing: "runtime_verification.evidence" });
  const passed = read("passed") === true || PASS_VALUES.has(String(read("result", "status", "verdict", "conclusion") ?? "").trim().toLowerCase());
  if (!passed) pushRuntimeError(errors, stage, contract, node, "runtime_verification 必须明确 passed", { missing: "runtime_verification.passed=true", actual: JSON.stringify(read("passed", "result", "status")) });

  if (route === "image-text") {
    if (read("asset_consumed", "assetConsumed", "image_consumed", "imageConsumed") !== true) pushRuntimeError(errors, stage, contract, node, "image-text 必须证明图片资产已被正式 Scene 消费", { missing: "runtime_verification.asset_consumed=true" });
    if (!hasEvidence(read("semantic_evidence", "semanticEvidence", "accessible_semantic_evidence", "accessibleSemanticEvidence"))) pushRuntimeError(errors, stage, contract, node, "image-text 必须提供可访问语义证据", { missing: "runtime_verification.semantic_evidence" });
  }

  if (!isV4Runtime) return;
  const comparison = field(raw, "comparison", "fidelity", "fidelity_measurement", "fidelityMeasurement") ?? {};
  const compare = (...names) => read(...names) ?? field(comparison, ...names);
  const targetBounds = compare("target_bounds", "targetBounds");
  const candidateBounds = compare("candidate_bounds", "candidateBounds");
  const delta = compare("delta", "delta_measurement", "deltaMeasurement");
  const nodeTolerance = field(node, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId")
    ?? field(region, "tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId");
  const toleranceReference = compare("tolerance_reference", "toleranceReference", "tolerance_id", "toleranceId") ?? nodeTolerance;
  if (!validBounds(targetBounds)) pushRuntimeError(errors, stage, contract, node, "V4 文本验证缺少 target_bounds", { missing: "runtime_verification.target_bounds" });
  if (!validBounds(candidateBounds)) pushRuntimeError(errors, stage, contract, node, "V4 文本验证缺少 candidate_bounds", { missing: "runtime_verification.candidate_bounds" });
  const frozenBounds = field(node, "target_bounds", "targetBounds", "bounds");
  if (validBounds(targetBounds) && !sameBounds(targetBounds, frozenBounds)) pushRuntimeError(errors, stage, contract, node, "V4 文本 target_bounds 未绑定冻结节点", { expected: JSON.stringify(frozenBounds), actual: JSON.stringify(targetBounds) });
  if (validBounds(candidateBounds) && validBounds(actualBounds) && !sameBounds(candidateBounds, actualBounds)) pushRuntimeError(errors, stage, contract, node, "V4 文本 candidate_bounds 与 actual_bounds 不一致", { expected: JSON.stringify(actualBounds), actual: JSON.stringify(candidateBounds) });
  if (!hasStructuredValue(delta)) pushRuntimeError(errors, stage, contract, node, "V4 文本验证缺少 delta", { missing: "runtime_verification.delta" });
  if (!nonEmptyString(toleranceReference) || !toleranceDefinitions.has(toleranceReference)) pushRuntimeError(errors, stage, contract, node, "V4 文本验证必须引用预声明 tolerance", { missing: "runtime_verification.tolerance_reference", actual: String(toleranceReference ?? "missing") });

  const typography = typographyOf(node);
  const targetGlyphBounds = compare("target_glyph_bounds", "targetGlyphBounds") ?? textFact(node, typography, ["target_glyph_bounds", "targetGlyphBounds", "glyph_bounds", "glyphBounds"]);
  const candidateGlyphBounds = compare("candidate_glyph_bounds", "candidateGlyphBounds") ?? actualGlyphBounds;
  const targetBaseline = compare("target_baseline", "targetBaseline") ?? textFact(node, typography, ["baseline", "baseline_mode", "baselineMode"]);
  const candidateBaseline = compare("candidate_baseline", "candidateBaseline") ?? actualBaseline;
  const targetFacts = compare("target_measurement", "targetMeasurement", "target_fact", "targetFact") ?? { bounds: targetBounds, glyph_bounds: targetGlyphBounds, baseline: targetBaseline };
  const candidateFacts = compare("candidate_measurement", "candidateMeasurement", "candidate_fact", "candidateFact") ?? { bounds: candidateBounds, glyph_bounds: candidateGlyphBounds, baseline: candidateBaseline };
  const limit = toleranceLimit(toleranceDefinitions.get(toleranceReference));
  if (limit === null) pushPlanError(errors, stage, contract, node, "V4 文本验证引用的 tolerance 缺少可执行数值规则", { missing: `${toleranceReference}.rules.value` });
  const declaredDelta = numericDeltas(delta);
  const computedDelta = numericFactDeltas(targetFacts, candidateFacts);
  const exceeds = limit !== null && [...declaredDelta, ...computedDelta].some((value) => value > limit);
  const factsDiffer = nonNumericFactsDiffer(targetFacts, candidateFacts);
  const exceptionValue = compare("exception_ids", "exceptionIds", "approved_exception_ids", "approvedExceptionIds");
  const exceptionIds = Array.isArray(exceptionValue) ? exceptionValue.filter(nonEmptyString) : nonEmptyString(exceptionValue) ? [exceptionValue] : [];
  const regionExceptions = field(region, "approved_exception_ids", "approvedExceptionIds", "exception_ids", "exceptionIds");
  const nodeExceptions = field(node, "approved_exception_ids", "approvedExceptionIds", "exception_ids", "exceptionIds");
  const approved = new Set([
    ...(Array.isArray(regionExceptions) ? regionExceptions : nonEmptyString(regionExceptions) ? [regionExceptions] : []),
    ...(Array.isArray(nodeExceptions) ? nodeExceptions : nonEmptyString(nodeExceptions) ? [nodeExceptions] : []),
  ].filter(nonEmptyString));
  if (exceptionIds.some((id) => !approved.has(id))) pushRuntimeError(errors, stage, contract, node, "V4 文本验证 exception ID 未被合同批准", { expected: [...approved].join(",") || "approved_exception_ids", actual: exceptionIds.join(",") });
  const hasApprovedException = exceptionIds.length > 0 && exceptionIds.every((id) => approved.has(id));
  if (exceeds && !hasApprovedException) pushRuntimeError(errors, stage, contract, node, "V4 文本 target/candidate 差异超出预声明 tolerance", { expected: `<=${limit}`, actual: JSON.stringify({ delta, computedDelta }) });
  if (factsDiffer && !hasApprovedException) pushRuntimeError(errors, stage, contract, node, "V4 文本存在未解释的非数值事实差异", { missing: "approved exception_id" });
  if (passed && (exceeds || factsDiffer) && !hasApprovedException) pushRuntimeError(errors, stage, contract, node, "V4 文本 PASS 不能掩盖超容差或未批准差异", { expected: "差异在 tolerance 内或有精确批准例外" });
}

/** 验证单个 text_node 的稳定身份、目标事实、引用完整性和 V3/V3/V4 规则。 */
export function validateTextNode(node, context = {}) {
  const { contract, stage = "V1", regions, layoutInfo, toleranceDefinitions, isV4Runtime = false } = context;
  const errors = [];
  const regionMap = regionIndex(contract, regions);
  const layoutMap = layoutIndex(layoutInfo);
  const toleranceMap = toleranceIndex(contract, toleranceDefinitions);
  const stageName = String(stage).toUpperCase();
  const routeRequired = ["V3", "V4", "VALIDATING"].includes(stageName);
  if (!isObject(node)) {
    pushPlanError(errors, stage, contract, node, "text_node 必须是对象", { missing: "text_nodes[]" });
    return errors;
  }
  const textNodeId = field(node, "text_node_id", "textNodeId", "id");
  if (!nonEmptyString(textNodeId)) pushPlanError(errors, stage, contract, node, "text_node 缺少稳定 text_node_id", { missing: "text_node_id" });
  const regionId = field(node, "region_id", "regionId");
  const region = regionMap.get(regionId);
  if (!nonEmptyString(regionId) || !region) pushPlanError(errors, stage, contract, node, "text_node.region_id 必须引用现有 coverage region", { missing: "region_id", actual: String(regionId ?? "missing") });
  const layoutNodeId = field(node, "layout_node_id", "layoutNodeId");
  const layoutNode = layoutMap.get(layoutNodeId);
  if (!nonEmptyString(layoutNodeId) || !layoutNode) pushPlanError(errors, stage, contract, node, "text_node.layout_node_id 必须引用现有 layout node", { missing: "layout_node_id", actual: String(layoutNodeId ?? "missing") });
  if (region && layoutNode) {
    const layoutRegionId = field(layoutNode, "region_id", "regionId");
    if (layoutRegionId !== regionId) pushPlanError(errors, stage, contract, node, "text_node 的 region 与 layout node 所属 region 不一致", { expected: regionId, actual: layoutRegionId });
    const regionLayoutIds = field(region, "layout_node_ids", "layoutNodeIds");
    if (Array.isArray(regionLayoutIds) && !regionLayoutIds.includes(layoutNodeId)) pushPlanError(errors, stage, contract, node, "text_node.layout_node_id 未被 coverage region 反向声明", { missing: layoutNodeId });
  }
  const targetBounds = field(node, "target_bounds", "targetBounds", "bounds");
  if (!validBounds(targetBounds)) pushPlanError(errors, stage, contract, node, "text_node 缺少有效 target_bounds", { missing: "target_bounds.x/y/width/height" });
  if (layoutNode) {
    const layoutBounds = field(layoutNode, "target_bounds", "targetBounds", "bounds");
    if (!sameBounds(targetBounds, layoutBounds)) pushPlanError(errors, stage, contract, node, "text_node.target_bounds 必须与绑定 layout node 一致", { expected: JSON.stringify(layoutBounds), actual: JSON.stringify(targetBounds) });
    const nodeParent = field(node, "parent_layout_node_id", "parentLayoutNodeId");
    const layoutParent = field(layoutNode, "parent_layout_node_id", "parentLayoutNodeId");
    if (nodeParent !== undefined && layoutParent !== undefined && nodeParent !== layoutParent) pushPlanError(errors, stage, contract, node, "text_node parent layout 关系与绑定 layout node 不一致", { expected: layoutParent, actual: nodeParent });
  }

  const content = field(node, "content", "text", "display_text", "displayText");
  const contentSource = field(node, "content_source", "contentSource", "source", "i18n_key", "i18nKey");
  if (!nonEmptyString(content) && !hasStructuredValue(contentSource)) pushPlanError(errors, stage, contract, node, "text_node 必须冻结 content 或 content_source", { missing: "content|content_source" });
  if (nonEmptyString(textNodeId) && nonEmptyString(content) && textNodeId.trim().toLowerCase() === content.trim().toLowerCase()) pushPlanError(errors, stage, contract, node, "text_node_id 不能复用运行时显示文字", { expected: "稳定语义 ID", actual: textNodeId });
  for (const [names, label] of [[ ["semantic_role"], "semantic_role" ], [["dynamic"], "dynamic"], [["localizable", "localizable_text", "localizableText"], "localizable"], [["planned_test_id", "plannedTestId"], "planned_test_id"]]) {
    const value = field(node, ...names);
    const valid = ["dynamic", "localizable"].includes(label) ? typeof value === "boolean" : nonEmptyString(value);
    if (!valid) pushPlanError(errors, stage, contract, node, `text_node 缺少或无效 ${label}`, { missing: label, actual: String(value ?? "missing") });
  }

  const typographyResult = validateTypography(node, contract, stage, errors);
  let route;
  if (routeRequired) route = validateImplementationRoute(node, contract, stage, errors, typographyResult);
  if (["V4", "VALIDATING"].includes(stageName)) {
    // 显式 V4 也必须执行 target/candidate/tolerance 比较，不能只在 VALIDATING 别名下开启验收分支。
    validateRuntimeVerification(node, contract, stage, errors, route, region, toleranceMap, isV4Runtime || stageName === "V4" || stageName === "VALIDATING");
  }
  return errors;
}

/** 判断合同是否为效果图还原；普通非 effect-image 合同不受文本拆解硬门约束。 */
function effectImageContract(contract, manifest, options) {
  return options.effectImage === true
    || options.effect_image === true
    || manifest?.effect_image_reconstruction?.applicability === "effect-image"
    || manifest?.effectImageReconstruction?.applicability === "effect-image"
    || contract?.effect_image_reconstruction?.applicability === "effect-image"
    || contract?.effectImageReconstruction?.applicability === "effect-image";
}

/** 验证场景级 text_decomposition；这是 effect-image 合同的唯一文本入口。 */
export function validateSceneTextDecomposition(contract, options = {}) {
  const stage = options.stage ?? "V1";
  const manifest = options.manifest ?? null;
  if (!effectImageContract(contract, manifest, options)) return [];
  const errors = [];
  const decomposition = field(contract, "text_decomposition", "textDecomposition");
  if (!isObject(decomposition)) {
    errors.push(contractError(stage, contract, null, "effect-image 缺少 text_decomposition", { missing: "text_decomposition", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return errors;
  }
  const applicability = String(field(decomposition, "applicability") ?? "").trim().toLowerCase();
  if (applicability === "not-applicable") {
    if (!nonEmptyString(field(decomposition, "reason", "rationale", "explanation"))) errors.push(contractError(stage, contract, decomposition, "text_decomposition.not-applicable 必须提供 reason", { missing: "text_decomposition.reason", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    const nodes = field(decomposition, "text_nodes", "textNodes");
    if (nodes !== undefined && (!Array.isArray(nodes) || nodes.length > 0)) errors.push(contractError(stage, contract, decomposition, "text_decomposition.not-applicable 的 text_nodes 必须为空数组", { actual: JSON.stringify(nodes), returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return errors;
  }
  if (applicability !== "has-text") {
    errors.push(contractError(stage, contract, decomposition, "text_decomposition.applicability 必须为 has-text 或 not-applicable", { missing: "text_decomposition.applicability", actual: applicability || "missing", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return errors;
  }
  const nodes = field(decomposition, "text_nodes", "textNodes");
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push(contractError(stage, contract, decomposition, "text_decomposition.has-text 必须提供非空 text_nodes", { missing: "text_nodes", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
    return errors;
  }
  const ids = new Set();
  const context = { ...options, contract, regions: options.regions, layoutInfo: options.layoutInfo, toleranceDefinitions: options.toleranceDefinitions };
  for (const [index, node] of nodes.entries()) {
    const nodeErrors = validateTextNode(node, context);
    errors.push(...nodeErrors);
    const id = field(node, "text_node_id", "textNodeId", "id");
    if (nonEmptyString(id)) {
      if (ids.has(id)) errors.push(contractError(stage, contract, node, "text_node_id 重复", { actual: id, returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
      ids.add(id);
    }
    if (isObject(node) && node.index !== undefined) errors.push(contractError(stage, contract, node, `text_nodes[${index}] 不得用运行时 index 作为稳定身份`, { actual: String(node.index), returnStage: "V1/PROPOSAL", rootCause: "方案缺失" }));
  }
  return errors;
}

/** 简短别名，供合同脚本和外部定向校验按既有命名风格调用。 */
export const validateTextDecomposition = validateSceneTextDecomposition;
