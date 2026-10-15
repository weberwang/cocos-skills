/**
 * 全局视觉一致性合同。
 *
 * 该模块只描述“生成前必须使用哪一份全局视觉真值”，不携带项目的具体
 * 美术风格。项目风格只能来自 visual_baseline.document 与 anchor_evidence；
 * 这样场景主图、显示层上下文图和原子资产会共享同一套身份，而不会各自
 * 创建新的状态机或局部风格真值。
 */

/** 全局静态基线唯一允许的冻结状态。它不是 V2 方向冻结状态。 */
export const GLOBAL_VISUAL_BASELINE_STATUS = "global-static-baseline-frozen";
/** 全局基线正文的不可变路径。阶段证据不能替代该正文。 */
export const GLOBAL_VISUAL_BASELINE_DOCUMENT = "docs/visual-baseline.md";
/** 生成器必须逐字收到的全局视觉一致性约束。 */
export const GLOBAL_VISUAL_CONSISTENCY_PROMPT = "保持当前项目全局视觉语言、颜色材质、光照、线条、装饰密度、UI形状与全局视觉锚点一致，禁止风格迁移、重设计、跨项目风格混用。";
/** 为调用方提供语义更明确的 canonical 别名，避免提示词在入口间漂移。 */
export const CANONICAL_GLOBAL_VISUAL_CONSISTENCY_PROMPT = GLOBAL_VISUAL_CONSISTENCY_PROMPT;
/** 生成记录只能禁止风格漂移，不能声明允许迁移或重新设计。 */
export const GLOBAL_VISUAL_STYLE_DRIFT_POLICY = "forbid";
/** 生成记录中 origin 的有限集合；provided 不得伪造生成记录。 */
export const GLOBAL_VISUAL_ORIGINS = new Set(["provided", "generated"]);

/** 判断是否为普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断字符串是否具备合同内容。 */
export function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 规范化项目相对路径，只用于稳定身份比较，不替代文件门的真实读取。 */
export function normalizeGlobalVisualPath(value) {
  if (!nonEmptyString(value)) return "";
  return value.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** 读取带 path/file/evidence 字段的锚点或样式输入路径。 */
function readEvidencePath(value) {
  if (nonEmptyString(value)) return value.trim();
  if (!isObject(value)) return "";
  return value.path ?? value.file ?? value.evidence ?? value.evidence_path ?? "";
}

/**
 * 将 baseline.anchor_evidence 规范化为可比对的锚点身份。
 * 锚点按路径与顺序识别，最终人工验收负责确认文件的实际视觉内容。
 */
export function normalizeGlobalAnchorEvidence(baseline) {
  const values = Array.isArray(baseline?.anchor_evidence) ? baseline.anchor_evidence : [];
  return values.map((value, index) => ({
    index,
    path: readEvidencePath(value),
    raw: value,
  }));
}

/** 读取 style_reference_inputs 的稳定来源路径。 */
export function normalizeGlobalStyleReferenceInputs(inputs) {
  if (!Array.isArray(inputs)) return [];
  return inputs.map((value, index) => ({
    index,
    path: readEvidencePath(value),
    raw: value,
  }));
}

/** 返回当前基线要求的锚点路径序列，供生成器构造实际参考输入。 */
export function collectGlobalAnchorPaths(baseline) {
  return normalizeGlobalAnchorEvidence(baseline).map((item) => item.path).filter(nonEmptyString);
}

/** 返回全局基线的稳定身份，供生成记录和证据失效判断复用。 */
export function globalVisualBaselineIdentity(baseline) {
  if (!isObject(baseline)) return { id: "", version: "", style_fingerprint: "", document: "" };
  return {
    id: baseline.id ?? "",
    version: baseline.version ?? "",
    style_fingerprint: baseline.style_fingerprint ?? "",
    document: baseline.document ?? "",
  };
}

/**
 * 校验全局视觉基线本身；该函数不读取文件，正文和锚点由来源文件门读取。
 */
export function validateGlobalVisualBaseline(baseline, options = {}) {
  const errors = [];
  const label = options.label ?? "visual_baseline";
  if (!isObject(baseline)) return [`${label} 必须是对象`];
  for (const field of ["id", "version", "document"]) if (!nonEmptyString(baseline[field])) errors.push(`${label}.${field} 必须是非空字符串`);
  if (nonEmptyString(baseline.document) && baseline.document !== GLOBAL_VISUAL_BASELINE_DOCUMENT) errors.push(`${label}.document 必须为 ${GLOBAL_VISUAL_BASELINE_DOCUMENT}`);
  if (baseline.status !== GLOBAL_VISUAL_BASELINE_STATUS) errors.push(`${label}.status 必须为 ${GLOBAL_VISUAL_BASELINE_STATUS}；该状态不代表 V2`);
  const anchors = normalizeGlobalAnchorEvidence(baseline);
  if (anchors.length === 0 && options.requireAnchors !== false) errors.push(`${label}.anchor_evidence 必须声明全部全局视觉锚点`);
  const seen = new Set();
  for (const [index, anchor] of anchors.entries()) {
    const path = normalizeGlobalVisualPath(anchor.path);
    if (!nonEmptyString(anchor.path)) errors.push(`${label}.anchor_evidence[${index}] 必须包含非空路径`);
    if (seen.has(path)) errors.push(`${label}.anchor_evidence 不得重复同一锚点路径：${anchor.path}`);
    if (path) seen.add(path);
  }
  return [...new Set(errors)];
}

/** 从生成记录中取实际发送的完整提示词。 */
export function readActualFullPrompt(record) {
  if (!isObject(record)) return "";
  return record.full_prompt ?? record.actual_full_prompt ?? record.actual_prompt ?? record.sent_prompt ?? record.prompt_sent_text ?? "";
}

/** 判断生成器是否留下了“完整提示词确实已发送”的确定性事实。 */
function promptWasActuallySent(record, fullPrompt) {
  if (!isObject(record) || !nonEmptyString(fullPrompt)) return false;
  if (record.prompt_sent === true || record.prompt_status === "sent" || record.prompt_delivery_status === "sent") return true;
  return (nonEmptyString(record.actual_prompt) && record.actual_prompt === fullPrompt)
    || (nonEmptyString(record.sent_prompt) && record.sent_prompt === fullPrompt)
    || (nonEmptyString(record.actual_full_prompt) && record.actual_full_prompt === fullPrompt);
}

/** 将值转换为仅用于错误诊断的稳定字符串。 */
function displayValue(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * 校验生成记录是否精确继承当前基线的全部锚点。
 * 采用集合和顺序双重检查，避免漏传、重复传入或额外加入无法审计来源的锚点。
 */
export function validateGlobalStyleReferenceInputs(inputs, baseline, options = {}) {
  const errors = [];
  const label = options.label ?? "generation_record.style_reference_inputs";
  const expected = normalizeGlobalAnchorEvidence(baseline);
  const actual = normalizeGlobalStyleReferenceInputs(inputs);
  if (!Array.isArray(inputs) || inputs.length === 0) {
    errors.push(`${label} 必须完整传入 visual_baseline.anchor_evidence`);
    return errors;
  }
  if (actual.some((item) => !nonEmptyString(item.path))) errors.push(`${label} 每项必须包含非空 path`);
  if (actual.length !== expected.length) errors.push(`${label} 必须与全局锚点数量完全一致（预期 ${expected.length}，实际 ${actual.length}）`);
  const expectedPaths = expected.map((item) => normalizeGlobalVisualPath(item.path));
  const actualPaths = actual.map((item) => normalizeGlobalVisualPath(item.path));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) errors.push(`${label} 必须按 visual_baseline.anchor_evidence 原顺序逐项绑定，禁止遗漏或额外参考`);
  const seen = new Set();
  for (const item of actual) {
    if (seen.has(item.path)) errors.push(`${label} 不得重复锚点：${item.path}`);
    if (item.path) seen.add(item.path);
  }
  return [...new Set(errors)];
}

/**
 * 校验 generated effect image 的全局生成身份和实际发送的约束。
 */
export function validateGlobalVisualGenerationRecord(record, context = {}) {
  const errors = [];
  const label = context.label ?? "generated effect image";
  const baseline = context.visual_baseline ?? context.baseline;
  if (!isObject(record)) return [`${label} 缺少 generation_record`];
  if (record.origin !== "generated") errors.push(`${label}.generation_record.origin 必须为 generated`);
  errors.push(...validateGlobalVisualBaseline(baseline, { label: `${label}.visual_baseline` }).map((item) => `全局视觉基线：${item}`));
  const identity = globalVisualBaselineIdentity(baseline);
  for (const [field, expected] of [["visual_baseline_id", identity.id], ["visual_baseline_version", identity.version], ["baseline_document", GLOBAL_VISUAL_BASELINE_DOCUMENT]]) {
    if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 缺失`);
    else if (nonEmptyString(expected) && record[field] !== expected) errors.push(`${label}.generation_record.${field} 未绑定当前全局视觉基线`);
  }
  errors.push(...validateGlobalStyleReferenceInputs(record.style_reference_inputs, baseline, { label: `${label}.generation_record.style_reference_inputs` }));
  if (record.actual_style_reference_inputs !== undefined) {
    const expectedInputs = normalizeGlobalStyleReferenceInputs(record.style_reference_inputs).map((item) => normalizeGlobalVisualPath(item.path));
    const actualInputs = normalizeGlobalStyleReferenceInputs(record.actual_style_reference_inputs).map((item) => normalizeGlobalVisualPath(item.path));
    if (JSON.stringify(actualInputs) !== JSON.stringify(expectedInputs)) errors.push(`${label}.generation_record.actual_style_reference_inputs 必须与实际发送的全局锚点输入一致`);
  }
  if (record.global_visual_consistency_prompt !== GLOBAL_VISUAL_CONSISTENCY_PROMPT) errors.push(`${label}.generation_record.global_visual_consistency_prompt 必须使用 canonical 全局一致性提示词`);
  if (record.style_drift_policy !== GLOBAL_VISUAL_STYLE_DRIFT_POLICY) errors.push(`${label}.generation_record.style_drift_policy 必须为 forbid`);
  const fullPrompt = readActualFullPrompt(record);
  if (!nonEmptyString(fullPrompt)) errors.push(`${label}.generation_record.full_prompt 必须记录实际发送的完整提示词`);
  else {
    if (!fullPrompt.includes(GLOBAL_VISUAL_CONSISTENCY_PROMPT)) errors.push(`${label}.generation_record.full_prompt 缺少全局视觉一致性 canonical 段`);
    if (!promptWasActuallySent(record, fullPrompt)) errors.push(`${label}.generation_record 未证明完整提示词实际发送给生成器`);
  }
  if (record.consistency_status !== "passed") errors.push(`${label}.generation_record.consistency_status 必须为 passed`);
  const evidence = record.consistency_evidence;
  const evidencePath = readEvidencePath(evidence);
  if (!nonEmptyString(evidencePath)) errors.push(`${label}.generation_record.consistency_evidence 必须包含路径`);
  if (record.allow_style_transfer === true || record.allow_redesign === true || record.style_drift_policy !== GLOBAL_VISUAL_STYLE_DRIFT_POLICY) errors.push(`${label}.generation_record 不得允许风格迁移或重新设计`);
  return [...new Set(errors)];
}

/** 校验 provided/generated 身份，防止外部效果图伪造生成记录。 */
export function validateVisualEffectImageOrigin(value, context = {}) {
  const errors = [];
  const label = context.label ?? "effect image";
  if (!isObject(value)) return [`${label} 必须是对象`];
  if (!GLOBAL_VISUAL_ORIGINS.has(value.origin)) errors.push(`${label}.origin 必须为 provided 或 generated`);
  if (value.origin === "provided") {
    if (value.generation_record !== undefined) errors.push(`${label} origin=provided 不得携带伪生成记录`);
    // 原子资产可以保留普通的基线归属字段；只有生成器专属提示词/证据字段会构成伪生成记录。
    for (const field of ["global_visual_consistency_prompt", "style_reference_inputs", "consistency_status", "consistency_evidence"]) if (value[field] !== undefined) errors.push(`${label} origin=provided 不得声明 ${field}`);
  } else if (value.origin === "generated") {
    errors.push(...validateGlobalVisualGenerationRecord(value.generation_record, context));
  }
  return [...new Set(errors)];
}

/** 收集生成记录需要由文件门确认存在的全局锚点、一致性证据和输出文件。 */
export function collectGlobalVisualConsistencyEvidencePaths(record, label = "generation_record") {
  if (!isObject(record)) return [];
  const paths = [];
  for (const [index, item] of normalizeGlobalStyleReferenceInputs(record.style_reference_inputs).entries()) if (nonEmptyString(item.path)) paths.push({ field: `${label}.style_reference_inputs[${index}]`, path: item.path });
  const evidencePath = readEvidencePath(record.consistency_evidence);
  if (nonEmptyString(evidencePath)) paths.push({ field: `${label}.consistency_evidence`, path: evidencePath });
  const outputPath = readEvidencePath(record.output_file ?? record.output ?? record.actual_output);
  if (nonEmptyString(outputPath)) paths.push({ field: `${label}.output`, path: outputPath });
  return paths;
}

/** 组合通用效果图/显示层主图提示词，确保全局约束总在实际发送文本中。 */
export function buildGlobalVisualConsistencyPrompt(basePrompt = "") {
  return [basePrompt, GLOBAL_VISUAL_CONSISTENCY_PROMPT].filter(nonEmptyString).join("\n\n");
}
