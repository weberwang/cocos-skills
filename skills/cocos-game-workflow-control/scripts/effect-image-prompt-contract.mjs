/**
 * effect-image 图像生成的忠实重建提示词合同。
 *
 * 该模块集中保存唯一的提示词常量、资产提示词构建器和生成记录门禁，
 * 避免 SKILL、清单校验器与实际发送给生成器的文本各自漂移。
 */
import { buildSolidBackgroundPrompt, DEFAULT_SOURCE_BACKGROUND_COLOR, expressesDirectAlphaProduction, expressesSolidBackgroundProduction, TRANSPARENT_BACKGROUND_REMOVAL_PROMPT, normalizeSourceBackgroundColor } from "./visual-transparent-background-contract.mjs";
import { CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT, GLOBAL_VISUAL_CONSISTENCY_PROMPT, validateGlobalVisualGenerationRecord } from "./global-visual-consistency-contract.mjs";
import { TRANSPARENT_EDGE_PROFILES } from "./transparent-route-contract.mjs";
import { isNineSliceStretch, validateNineSliceContract } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";

/** effect-image 生成记录必须声明的重建模式。 */
export const EFFECT_IMAGE_RECONSTRUCTION_MODE = "reference-faithful";
/** effect-image 必须把完整冻结图作为主参考输入，而不是只传局部裁切。 */
export const EFFECT_IMAGE_REFERENCE_INPUT_MODE = "full-reference-guidance";
/** 允许重绘像素，但禁止复用参考图像素作为输出。 */
export const EFFECT_IMAGE_PIXEL_REUSE_POLICY = "forbid-output-reuse";
/** 仅硬边去背路线追加的纯色源图要求，不能代替其它透明路线。 */
export const EFFECT_IMAGE_BACKGROUND_REMOVAL_PROMPT = TRANSPARENT_BACKGROUND_REMOVAL_PROMPT;
/** effect-image 必须与全局视觉基线共同发送的 canonical 一致性段。 */
export const EFFECT_IMAGE_GLOBAL_VISUAL_CONSISTENCY_PROMPT = GLOBAL_VISUAL_CONSISTENCY_PROMPT;

/**
 * effect-image 的 canonical global_prompt_prefix。
 * 任何项目都只能在此基础上追加资产/状态段，不能把忠实重建改写成重新设计。
 */
export const EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX = [
  "任务类型：对冻结效果图执行“非像素复制的高保真忠实重建”，不是重新设计、概念探索或风格改编。",
  "",
  "提供的完整冻结效果图是唯一视觉真值，也是本次生成的实际参考输入。只重绘当前指定的 atomic component。严格保持该部件在参考图中的视觉类别、外轮廓、长宽比例、相对尺寸、朝向、透视、结构分区、颜色分布、材质、明暗关系、光源方向、能量辉光、线条粗细、装饰密度、透明边界及可见裁切关系。",
  "",
  "不得进行审美优化，不得补充参考图中不存在的结构，不得替换符号语义，不得改变角色姿态、镜头角度、框体轮廓、字体结构或图标含义。",
  "",
  "允许重新绘制全部像素，但禁止把参考图裁切、抠图或复制后直接作为交付结果。",
  "",
  "输出单个独立位图资产。背景按本次实际请求中的源图背景要求绘制；主体必须完整落入指定画布。不得生成组合图、atlas、sprite sheet、展示板、说明文字、无关 UI、数字、标签、水印或其他组件。",
].join("\n");

/** effect-image 的 canonical negative_prompt；该字段中的禁词不是正向改编指令。 */
export const EFFECT_IMAGE_NEGATIVE_PROMPT = "重新设计，二次创作，概念探索，风格迁移，风格改编，审美优化，专业修复，提升游戏感，自由发挥，改变轮廓，改变比例，改变朝向，改变透视，改变姿态，改变构图，替换符号语义，新增参考中不存在的结构，新增装甲，新增武器，新增翅膀，新增徽章，遗漏参考结构，通用科幻图标，过度发光，霓虹泛滥，卡通化，扁平化，低细节，模糊边缘，组图，atlas，sprite sheet，整屏 UI，设计展示板，说明文字，水印，棋盘格烘焙背景，直接裁切参考图，直接抠取参考图，直接复制参考像素。";

/** 为调用方提供更明确的 canonical 别名，避免不同入口自行复制常量。 */
export const CANONICAL_EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX = EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX;
export const CANONICAL_EFFECT_IMAGE_NEGATIVE_PROMPT = EFFECT_IMAGE_NEGATIVE_PROMPT;

/** 资产提示词必须覆盖的冻结 region 视觉事实类别。 */
export const EFFECT_IMAGE_ASSET_PROMPT_FACTS = Object.freeze({
  visual_category: {
    label: "视觉类别",
    aliases: ["visual_category", "visualCategory", "visual_type", "visualType", "category", "role", "component_role", "componentRole", "asset_scope"],
  },
  graphic_semantics: {
    label: "图形语义",
    aliases: ["graphic_semantics", "graphicSemantics", "icon_semantics", "iconSemantics", "symbol_semantics", "symbolSemantics", "semantic", "meaning", "icon_meaning", "iconMeaning"],
  },
  contour_structure: {
    label: "外轮廓及关键内部结构",
    aliases: ["contour_structure", "contourStructure", "outline_facts", "outlineFacts", "external_contour", "externalContour", "silhouette", "shape_facts", "shapeFacts", "internal_structure", "internalStructure", "structure_facts", "structureFacts", "key_internal_structure", "keyInternalStructure"],
  },
  proportions: {
    label: "长宽比例和相对尺寸",
    aliases: ["aspect_ratio", "aspectRatio", "proportion", "proportions", "relative_size", "relativeSize", "relative_dimensions", "relativeDimensions", "size_strategy", "sizeStrategy", "target_bounds", "targetBounds", "bounds"],
  },
  orientation_perspective: {
    label: "朝向、视角和透视",
    aliases: ["orientation_perspective", "orientationPerspective", "orientation", "facing", "direction", "view", "viewpoint", "camera", "camera_angle", "cameraAngle", "perspective", "perspective_facts", "perspectiveFacts", "pose", "pose_facts", "poseFacts"],
  },
  color_material: {
    label: "颜色分布和材质",
    aliases: ["color_material", "colorMaterial", "color_facts", "colorFacts", "color", "material_texture_facts", "materialTextureFacts", "material_facts", "materialFacts", "material", "texture", "texture_facts", "textureFacts"],
  },
  lighting_glow: {
    label: "光源、高光、阴影及辉光",
    aliases: ["lighting_glow", "lightingGlow", "lighting_shadow_facts", "lightingShadowFacts", "lighting", "light_source", "lightSource", "highlight", "highlights", "shadow", "shadows", "glow", "energy_glow", "energyGlow", "emission"],
  },
  line_decoration_density: {
    label: "线条和装饰密度",
    aliases: ["line_decoration_density", "lineDecorationDensity", "line_weight", "lineWeight", "line_thickness", "lineThickness", "stroke", "stroke_facts", "strokeFacts", "decorative_density_facts", "decorativeDensityFacts", "decoration_density", "decorationDensity", "decoration", "ornament_density", "ornamentDensity"],
  },
  transparency_clipping_whitespace: {
    label: "透明区域、可见裁切及留白",
    aliases: ["transparency_clipping_whitespace", "transparencyClippingWhitespace", "transparent_boundary", "transparentBoundary", "transparency", "alpha", "clipping_cropping_facts", "clippingCroppingFacts", "clipping", "cropping", "visible_cropping", "visibleCropping", "whitespace", "spacing", "spacing_facts", "spacingFacts"],
  },
  excluded_objects: {
    label: "不应烘焙进该资产的其他对象",
    aliases: ["excluded_objects", "excludedObjects", "exclude_objects", "excludeObjects", "excluded", "exclusions", "not_in_asset", "notInAsset", "other_objects_excluded", "otherObjectsExcluded"],
  },
  runtime_ownership: {
    label: "文字、数值、热区等运行时所有权",
    aliases: ["runtime_ownership", "runtimeOwnership", "runtime_foreground_ownership", "runtimeForegroundOwnership", "foreground_ownership", "foregroundOwnership", "typography_ownership", "typographyOwnership", "text_ownership", "textOwnership", "runtime_text_ownership", "runtimeTextOwnership", "numeric_ownership", "numericOwnership", "hotspot_ownership", "hotspotOwnership", "interaction_hotspots", "interactionHotspots", "hotspots", "state_ownership", "stateOwnership"],
  },
});

/** 判断值是否为可递归读取的对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 将驼峰字段名转为可统一识别的蛇形形式，避免摘要别名参与业务事实比较。 */
function normalizeSummaryFieldName(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** 仅匹配独立摘要令牌，避免误删 shadow、share_id 等真实视觉或身份字段。 */
function isSummaryDigestField(value) {
  const normalized = normalizeSummaryFieldName(value);
  return /(^|[_-])(sha(?:1|224|256|384|512)?|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/.test(normalized);
}

/** 递归移除仅供追踪的摘要字段，保留输入路径、顺序、裁切与其余实际参数。 */
function withoutSummaryDigests(value) {
  if (Array.isArray(value)) return value.map(withoutSummaryDigests);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isSummaryDigestField(key))
    .map(([key, nested]) => [key, withoutSummaryDigests(nested)]));
}

/** 判断字符串是否具备合同内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 规范化路径，只用于身份比较，不把它当作文件系统读取结果。 */
function normalizePath(value) {
  if (!nonEmptyString(value)) return "";
  return value.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** 从对象及其常见别名中取第一个有值的事实。 */
function firstFact(value, aliases) {
  if (!isObject(value)) return undefined;
  for (const alias of aliases) if (Object.hasOwn(value, alias) && value[alias] !== undefined && value[alias] !== null && value[alias] !== "") return value[alias];
  return undefined;
}

/** 读取嵌套事实容器，兼容 scene reconstruction 的 snake/camel 别名。 */
function factContainers(region = {}) {
  const containers = [region];
  for (const key of ["visual_facts", "visualFacts", "fidelity_facts", "fidelityFacts", "fidelity_obligations", "fidelityObligations", "target_visual_facts", "targetVisualFacts", "component_facts", "componentFacts"]) if (isObject(region?.[key])) containers.push(region[key]);
  return containers;
}

/** 将 scene contract 中对应 region 与 coverage region 合并，后者覆盖同名旧摘要。 */
export function resolveEffectImagePromptRegion(region, sceneReconstructionContract = null) {
  const direct = isObject(region) ? region : {};
  const regions = sceneReconstructionContract?.coverage_regions ?? sceneReconstructionContract?.coverageRegions ?? [];
  const id = direct.region_id ?? direct.regionId ?? direct.id;
  const sceneRegion = Array.isArray(regions) ? regions.find((item) => {
    const candidateId = item?.region_id ?? item?.regionId ?? item?.id;
    return nonEmptyString(id) && candidateId === id;
  }) : null;
  return { ...(isObject(sceneRegion) ? sceneRegion : {}), ...direct };
}

/** 从 region 合同读取每个提示词事实及其原始值，避免凭资产名臆造语义。 */
export function collectEffectImagePromptFacts(region = {}, sceneReconstructionContract = null) {
  const resolved = resolveEffectImagePromptRegion(region, sceneReconstructionContract);
  const containers = factContainers(resolved);
  const facts = {};
  const missing = [];
  for (const [key, definition] of Object.entries(EFFECT_IMAGE_ASSET_PROMPT_FACTS)) {
    let value;
    for (const container of containers) {
      value = firstFact(container, definition.aliases);
      if (value !== undefined) break;
    }
    if (value === undefined) missing.push(key);
    else facts[key] = value;
  }
  // 这些身份字段不属于视觉事实，但它们让生成记录能够绑定具体 region/component/state。
  const identity = {
    annotation_number: resolved.annotation_number ?? resolved.annotationNumber,
    region_id: resolved.region_id ?? resolved.regionId ?? resolved.id,
    component_id: resolved.component_id ?? resolved.componentId,
    state_id: resolved.state_id ?? resolved.stateId,
  };
  return { region: resolved, facts, missing, identity };
}

/** 稳定序列化事实；字符串原样保留，数组/对象使用 JSON 便于机器复核。 */
function formatFact(value) {
  if (typeof value === "string") return value.trim();
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** 构建 effect-image 的资产段；没有冻结 region 事实时明确返回缺失，不做资产名推断。 */
export function buildEffectImageAssetPrompt({ region, sceneReconstructionContract, component, state, exclusions, runtimeOwnership } = {}) {
  const resolvedRegion = resolveEffectImagePromptRegion(region, sceneReconstructionContract);
  const collected = collectEffectImagePromptFacts(resolvedRegion);
  const facts = { ...collected.facts };
  if (exclusions !== undefined) facts.excluded_objects = exclusions;
  if (runtimeOwnership !== undefined) facts.runtime_ownership = runtimeOwnership;
  const missing = Object.keys(EFFECT_IMAGE_ASSET_PROMPT_FACTS).filter((key) => facts[key] === undefined);
  const identity = {
    annotation_number: resolvedRegion.annotation_number ?? resolvedRegion.annotationNumber,
    region_id: resolvedRegion.region_id ?? resolvedRegion.regionId ?? resolvedRegion.id,
    component_id: component?.component_id ?? component?.componentId ?? resolvedRegion.component_id ?? resolvedRegion.componentId,
    state_id: state?.state_id ?? state?.stateId ?? state ?? resolvedRegion.state_id ?? resolvedRegion.stateId,
  };
  const lines = [
    `冻结 region 身份：annotation_number=${identity.annotation_number ?? "?"}，region_id=${identity.region_id ?? "?"}，component_id=${identity.component_id ?? "?"}，state_id=${identity.state_id ?? "?"}`,
  ];
  for (const [key, definition] of Object.entries(EFFECT_IMAGE_ASSET_PROMPT_FACTS)) lines.push(`${definition.label}：${facts[key] === undefined ? "未在冻结 region 合同声明；不得自行推断" : formatFact(facts[key])}`);
  lines.push("只重绘上述当前 atomic component；不得把同屏其他对象、整屏背景或运行时层烘焙进该资产。");
  return { prompt: lines.join("\n"), facts, missing, identity, region: resolvedRegion };
}

/** 将 V2 已确认切片事实写入实际生产提示词，避免按整块显示尺寸生成大底板。 */
export function buildNineSliceProductionPrompt(decision) {
  if (decision === undefined) return "";
  const normalized = validateNineSliceContract(decision);
  if (!isNineSliceStretch(normalized)) return "";
  const { source_size: size, borders } = normalized;
  return `九宫格生产合同：最终未裁切源图 ${size.width}×${size.height}px；源帧切片边宽 left=${borders.left}px、right=${borders.right}px、top=${borders.top}px、bottom=${borders.bottom}px。四角固定，左右边仅纵向拉伸，上下边仅横向拉伸，中心双向拉伸。只生产已确认的底板皮肤，中心保持可拉伸；文字、图标与独立装饰另作节点。保留冻结参考的角边、材质和色彩，不按整块显示尺寸扩充源图，不裁掉边框、不新增外侧 padding。切片值以最终源图像素为准。`;
}

/** 组合实际发送给图像生成器的完整正向/负向提示词，供生成器与记录共用。 */
export function buildEffectImageFullPrompt({ assetPrompt, statePrompt = "", globalPromptPrefix = EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, globalConsistencyPrompt = GLOBAL_VISUAL_CONSISTENCY_PROMPT, negativePrompt = EFFECT_IMAGE_NEGATIVE_PROMPT, transparentBackground = false, expectedAlpha = false, expectedAsset = null, backgroundColor, transparencyStrategy, edgeProfile, colorSeparationVerified = false, capability } = {}) {
  const needsTransparency = transparentBackground === true || expectedAlpha === true || expectedAsset?.alpha === true;
  const strategy = transparencyStrategy ?? expectedAsset?.transparency_requirements?.strategy;
  const edge = edgeProfile ?? expectedAsset?.transparency_requirements?.edge_profile;
  let sourceBackgroundPrompt = "";
  if (needsTransparency) {
    // 透明需求不能推导生成能力，也不能自动选择会损伤复杂边缘的颜色去背。
    if (!TRANSPARENT_EDGE_PROFILES.includes(edge)) throw new TypeError("透明提示词必须使用已冻结的合法 edgeProfile");
    if (strategy === "background-removal") {
      if (edge !== "hard-edge" || colorSeparationVerified !== true) throw new TypeError("颜色去背提示词只允许已验证颜色区分的 hard-edge");
      sourceBackgroundPrompt = buildSolidBackgroundPrompt(backgroundColor ?? expectedAsset?.source_background_color ?? DEFAULT_SOURCE_BACKGROUND_COLOR);
    } else if (strategy === "direct-alpha") {
      if (capability?.supports_true_alpha !== true || !Array.isArray(capability.verified_edge_profiles) || !capability.verified_edge_profiles.includes(edge)) throw new TypeError("真实透明生成缺少当前边缘能力证明，应报告能力缺口");
      sourceBackgroundPrompt = "输出要求：使用工具真实透明输出能力保留原始 Alpha，包括半透明、辉光、柔和阴影和其他冻结边缘；禁止棋盘格、网格或烘焙底色。输出必须解码验证，提示词不能证明透明。";
    } else if (strategy === "mask-composition") {
      sourceBackgroundPrompt = "为已冻结的独立遮罩/人工 Alpha 创作路线生产原始主体，保留半透明、辉光、阴影、毛发或玻璃边缘；禁止颜色阈值硬抠、删除光效和烘焙棋盘格。独立遮罩与合成过程另行记录并验证。";
    } else throw new TypeError("透明资产必须显式选择已冻结的 transparencyStrategy 和 edgeProfile");
  }
  const nineSlicePrompt = buildNineSliceProductionPrompt(expectedAsset?.nine_slice);
  return [globalPromptPrefix, globalConsistencyPrompt, assetPrompt, statePrompt, nineSlicePrompt, sourceBackgroundPrompt, negativePrompt].filter(nonEmptyString).join("\n\n");
}

/** 判断一段文本是否确实包含忠实还原语义，而非只提到参考图。 */
export function expressesReferenceFaithfulReconstruction(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase();
  return /高保真忠实重建|忠实重建|忠实还原|非像素复制|reference[- ]faithful|faithful reconstruction|high[- ]fidelity reconstruction/.test(text);
}

/** 判断文本中的 redesign/reimagine/reinterpret 是否为正向改编命令。 */
export function containsPositiveRedesignInstruction(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase();
  // canonical global/negative 段落含有“不是/不得/禁止”否定语义，不能误报为正向命令。
  const negativeChinese = /(?:不得|禁止|不是|不要|请勿|无需|不应|不能|不可|严禁)\s*(?:进行|把|将)?\s*重新设计/;
  const negativeChineseEnglish = /(?:不得|禁止|不是|不要|请勿|无需|不应|不能|不可|严禁)\s*(?:进行|把|将)?\s*(?:redesign|reimagine|reinterpret)\b/;
  const positiveChinese = /(?:必须|请|需要|要求|将|把|请将)\s*(?:该|这个|此)?[^。；，,\n]{0,32}?重新设计|重新设计\s*(?:为|成|该|这个|此|当前|本次)/;
  const englishPositive = /\b(?:redesign|reimagine|reinterpret)\b/;
  const englishNegative = /\b(?:do\s+not|don't|must\s+not|no|without|prohibit(?:ed)?)\s+(?:redesign|reimagine|reinterpret)\b/;
  return (positiveChinese.test(text) && !negativeChinese.test(text)) || (englishPositive.test(text) && !englishNegative.test(text) && !negativeChineseEnglish.test(text));
}

/** 将值递归展开为可搜索 token，用于证明 asset_prompt 继承了 region 事实。 */
function factTokens(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value).trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(factTokens);
  if (isObject(value)) return Object.entries(value).flatMap(([key, item]) => [key, ...factTokens(item)]);
  return [String(value)];
}

/** 检查资产段是否绑定冻结 region 事实，而不是只有通用品类名称。 */
export function validateEffectImageAssetPrompt(assetPrompt, region, options = {}) {
  const errors = [];
  if (!nonEmptyString(assetPrompt)) return ["effect-image asset_prompt 必须是非空字符串"];
  const collected = collectEffectImagePromptFacts(region, options.sceneReconstructionContract);
  const text = assetPrompt.toLowerCase();
  const genericOnly = /^(?:科幻按钮|机甲角色|未来卡框|科幻图标|按钮|角色|卡框|sci[- ]?fi\s+(?:button|character|card frame)|generic\s+(?:icon|button|character))$/i.test(assetPrompt.trim());
  if (genericOnly) errors.push("effect-image asset_prompt 不能只有通用品类描述");
  if (collected.missing.length > 0 && options.requireCompleteFacts !== false) errors.push(`effect-image 冻结 region 缺少资产提示事实：${collected.missing.join(", ")}`);
  for (const [key, definition] of Object.entries(EFFECT_IMAGE_ASSET_PROMPT_FACTS)) {
    const value = collected.facts[key];
    if (value === undefined) continue;
    const tokens = factTokens(value).filter((token) => token.length >= 2);
    // 只写字段标签不能证明继承事实；至少要把 region 原值（或其结构化 token）写入实际提示词。
    if (tokens.length > 0 && !tokens.some((token) => text.includes(token.toLowerCase()))) errors.push(`effect-image asset_prompt 未继承冻结 region 的${definition.label}`);
  }
  if (!/冻结\s*region|region[_ -]?id|atomic\s*component|当前指定/.test(text)) errors.push("effect-image asset_prompt 缺少冻结 region/atomic component 绑定");
  return errors;
}

/** 从任意生成记录/资产对象收集用于输出身份比较的路径字段。 */
function collectOutputPaths(value) {
  if (!isObject(value)) return [];
  const result = [];
  const fields = ["source_file", "sourceFile", "source_files", "sourceFiles", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile", "actual_output_file", "actualOutputFile", "output", "actual_output", "actualOutput", "file", "path"];
  const visit = (object) => {
    for (const field of fields) {
      const value = object?.[field];
      if (Array.isArray(value)) result.push(...value.filter(nonEmptyString));
      else if (nonEmptyString(value)) result.push(value);
    }
    for (const key of ["output", "output_metadata", "actual_output", "actualOutput"]) if (isObject(object?.[key])) visit(object[key]);
  };
  visit(value);
  return result;
}

/** 判断路径是否等同于冻结效果图原图，兼容相对/绝对和大小写别名。 */
function samePath(left, right) {
  const a = normalizePath(left); const b = normalizePath(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** 判断输入列表是否包含完整冻结效果图；style_reference_inputs 不可代替它。 */
export function hasFullReferenceInput(referenceInputs, originalFile) {
  if (!Array.isArray(referenceInputs) || !nonEmptyString(originalFile)) return false;
  return referenceInputs.some((item) => {
    if (nonEmptyString(item)) return samePath(item, originalFile);
    if (!isObject(item)) return false;
    return [item.original_file, item.originalFile, item.file, item.path, item.source_file, item.sourceFile].some((value) => samePath(value, originalFile));
  });
}

/** 校验 effect-image 图像生成的结构化字段、提示词与真实输入绑定。 */
export function validateEffectImagePromptContract(asset, contract, generation, context = {}, options = {}) {
  const errors = [];
  const referenceTarget = context.reference_target ?? context.referenceTarget ?? contract?.reference_target ?? contract?.referenceTarget ?? {};
  const targetFile = options.referenceOriginalFile ?? options.reference_original_file ?? referenceTarget.original_file ?? referenceTarget.originalFile;
  const region = options.region ?? context.region ?? context.coverage_region ?? context.coverageRegion;
  const identity = collectEffectImagePromptFacts(region, options.sceneReconstructionContract).identity;
  const add = (message) => errors.push(message);
  if (!isObject(generation)) return ["effect-image generation_record 必须是对象"];
  try {
    const expectedAsset = options.expectedAsset ?? contract?.expected_assets?.find((item) => item.asset_id === (asset?.id ?? asset?.asset_id));
    const nineSlicePrompt = buildNineSliceProductionPrompt(expectedAsset?.nine_slice);
    const sentPrompt = ["full_prompt", "actual_prompt", "prompt_sent", "sent_prompt", "positive_prompt", "prompt"].map((key) => generation[key]).find(nonEmptyString);
    if (nineSlicePrompt && !sentPrompt?.includes(nineSlicePrompt)) add("九宫格生成记录的实际提示词必须包含已冻结的小图尺寸和切片生产段");
  } catch (error) { add(`九宫格生产提示词无效：${error.message}`); }
  for (const [field, expected] of [["reconstruction_mode", EFFECT_IMAGE_RECONSTRUCTION_MODE], ["reference_input_mode", EFFECT_IMAGE_REFERENCE_INPUT_MODE], ["pixel_reuse_policy", EFFECT_IMAGE_PIXEL_REUSE_POLICY]]) if (generation[field] !== expected) add(`effect-image generation_record.${field} 必须为 ${expected}`);
  if (!hasFullReferenceInput(generation.reference_inputs, targetFile)) add("effect-image generation_record.reference_inputs 必须包含完整冻结效果图 reference_target.original_file");
  if (generation.style_reference_inputs !== undefined && (!Array.isArray(generation.style_reference_inputs) || !generation.style_reference_inputs.every((item) => nonEmptyString(item) || isObject(item)))) add("effect-image style_reference_inputs 只能是补充参考列表");
  const prefix = generation.global_prompt_prefix;
  if (prefix !== EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX) add("effect-image global_prompt_prefix 必须使用 canonical 忠实重建提示词");
  if (!expressesReferenceFaithfulReconstruction(prefix)) add("effect-image global_prompt_prefix 必须表达忠实还原/高保真重建");
  if (containsPositiveRedesignInstruction(prefix) || containsPositiveRedesignInstruction(generation.asset_prompt) || containsPositiveRedesignInstruction(generation.state_prompt) || containsPositiveRedesignInstruction(generation.full_prompt ?? generation.actual_prompt ?? generation.prompt ?? generation.positive_prompt)) add("effect-image 正向提示词包含未经批准的重新设计/改编命令");
  if (generation.negative_prompt !== EFFECT_IMAGE_NEGATIVE_PROMPT) add("effect-image negative_prompt 必须使用 canonical 禁止项");
  for (const key of ["full_prompt", "actual_prompt", "prompt_sent", "sent_prompt", "positive_prompt", "prompt"]) {
    if (nonEmptyString(generation[key])) {
      const fullPrompt = generation[key];
      for (const part of [generation.global_prompt_prefix, generation.asset_prompt, generation.state_prompt, generation.negative_prompt]) if (nonEmptyString(part) && !fullPrompt.includes(part)) add(`effect-image generation_record.${key} 未记录实际发送的完整提示词段`);
      break;
    }
    if (key === "prompt") add("effect-image generation_record 缺少实际发送给生成器的完整提示词 full_prompt/actual_prompt");
  }
  if (generation.transparency_strategy === "background-removal" || generation.source_background_color !== undefined) {
    let backgroundColor = null;
    if (!/^#[0-9A-F]{6}$/i.test(generation.source_background_color ?? "")) {
      add("effect-image generation_record.source_background_color 必须是 #RRGGBB");
    } else {
      backgroundColor = normalizeSourceBackgroundColor(generation.source_background_color);
    }
    if (backgroundColor) {
      const promptEntries = [
        ["full_prompt", generation.full_prompt],
        ["actual_prompt", generation.actual_prompt],
        ["prompt_sent", generation.prompt_sent],
        ["sent_prompt", generation.sent_prompt],
        ["positive_prompt", generation.positive_prompt],
        ["prompt", generation.prompt],
      ].filter(([, value]) => nonEmptyString(value));
      for (const [field, prompt] of promptEntries) if (!expressesSolidBackgroundProduction(prompt, backgroundColor)) add(`effect-image generation_record.${field} 必须包含 ${backgroundColor}、不透明纯色背景和棋盘格禁用要求`);
    }
  }
  if (generation.transparency_strategy === "direct-alpha" && !expressesDirectAlphaProduction(generation.full_prompt)) add("direct-alpha 实际提示词必须请求真实 Alpha 并禁止烘焙棋盘格");
  errors.push(...validateEffectImageAssetPrompt(generation.asset_prompt, region, { sceneReconstructionContract: options.sceneReconstructionContract }));
  const paths = [...collectOutputPaths(asset), ...collectOutputPaths(generation)];
  if (targetFile && paths.some((path) => samePath(path, targetFile))) add("effect-image source_file/runtime_file/output 不得等于冻结效果图");
  // effect-image 的原子资产也必须继承根 visual_baseline 和全部全局锚点；局部冻结图不能替代全局真值。
  const globalBaseline = options.visual_baseline ?? context.visual_baseline ?? contract?.visual_baseline;
  errors.push(...validateGlobalVisualGenerationRecord(generation, {
    label: "effect-image generation_record",
    visual_baseline: globalBaseline,
  }));
  if (generation.global_visual_consistency_prompt !== CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT) add("effect-image generation_record.global_visual_consistency_prompt 必须使用 canonical 全局视觉一致性提示词");
  const fullPromptForGlobal = generation.full_prompt ?? generation.actual_full_prompt ?? generation.actual_prompt ?? generation.sent_prompt ?? generation.prompt_sent_text;
  if (nonEmptyString(fullPromptForGlobal) && !fullPromptForGlobal.includes(CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT)) add("effect-image 实际完整提示词缺少全局视觉一致性段");
  const operationValues = [generation.operation, generation.operations, generation.source_operation, generation.reference_operation, generation.reference_usage, generation.referenceUsage, generation.pixel_reuse_operation, generation.pixelReuseOperation, generation.postprocess, generation.post_processing, generation.postProcessing, generation.command_or_recipe, generation.actual_operation, generation.actualOperation, generation.output_operation, generation.outputOperation].flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => nonEmptyString(value) || isObject(value)).map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
  if (generation.crop_reference === true || generation.reference_crop === true || /crop[-_ ]?reference|裁切参考|裁剪参考|抠图参考|抠取参考|直接复制参考(?:图)?像素|copy(?:ing)?\s+(?:the\s+)?reference(?:\s+image)?\s+pixels|reuse(?:d)?[-_ ]?(?:reference|ref)[-_ ]?pixels/i.test(operationValues)) add("effect-image 禁止裁切、抠图或复用参考图像素作为输出");
  if (generation.actual_reference_inputs !== undefined
    && JSON.stringify(withoutSummaryDigests(generation.actual_reference_inputs)) !== JSON.stringify(withoutSummaryDigests(generation.reference_inputs))) {
    add("effect-image actual_reference_inputs 必须与真实发送的 reference_inputs 一致");
  }
  const actualRegionId = generation.region_id ?? generation.regionId;
  if (identity.region_id && actualRegionId !== identity.region_id) add("effect-image generation_record.region_id 未绑定当前冻结 region");
  const contractCandidateIdentity = contract?.candidate_identity ?? contract?.candidateIdentity ?? contract?.visual_decomposition_confirmation?.candidate_identity ?? contract?.visualDecompositionConfirmation?.candidateIdentity ?? {};
  const expectedCandidateVersion = options.candidateVersion ?? options.candidate_version ?? context.candidateVersion ?? context.candidate_version ?? contract?.candidate_version ?? contract?.candidateVersion;
  if (expectedCandidateVersion && generation.candidate_version !== expectedCandidateVersion && generation.candidateVersion !== expectedCandidateVersion) add("effect-image generation_record.candidate_version 未绑定当前候选版本");
  const expectedCandidateId = options.candidateId ?? options.candidate_id ?? contractCandidateIdentity.candidate_id ?? contractCandidateIdentity.candidateId ?? contract?.candidateId ?? contract?.candidate_id;
  const actualCandidateId = generation.candidate_id ?? generation.candidateId ?? generation.candidate_identity?.candidate_id ?? generation.candidateIdentity?.candidateId;
  if (nonEmptyString(expectedCandidateId) && nonEmptyString(actualCandidateId) && actualCandidateId !== expectedCandidateId) add("effect-image generation_record.candidate_id 未绑定当前候选");
  return [...new Set(errors)];
}

/** 判断当前调用是否是 effect-image 图像生成；普通 AI 路线不继承重建三字段。 */
export function isEffectImageGeneration({ asset, contract, context, options } = {}) {
  const values = [options, context, context?.region, context?.effect_image_reconstruction, context?.effectImageReconstruction, contract, contract?.effect_image_reconstruction, contract?.effectImageReconstruction, asset];
  return values.some((value) => isObject(value) && (
    value.effect_image === true || value.effectImage === true || value.applicability === "effect-image" || value.reconstruction_mode === EFFECT_IMAGE_RECONSTRUCTION_MODE || value.reconstructionMode === EFFECT_IMAGE_RECONSTRUCTION_MODE
  ));
}
