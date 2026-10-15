/**
 * 图像生成 输出格式合同。
 *
 * authored-raster 仍可使用工作流支持的其他位图格式；只有 图像生成
 * 或 image_generation_required 区域才通过本模块收紧到 PNG/JPEG，避免
 * 通用 raster-image 判断意外放行 WebP、AVIF、GIF 或 BMP。
 */
/** 图像生成 正式允许的输出 MIME 集合，避免通用位图路线放宽本合同。 */
const IMAGEGEN_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
/** 图像生成 正式允许的源文件与运行时文件扩展名。 */
const IMAGEGEN_PATH_PATTERN = /\.(?:png|jpe?g)$/i;
/** 图像生成 各类路径字段的 snake/camel 同义别名；单文件与文件列表不是同一字段。 */
const IMAGEGEN_PATH_ALIASES = Object.freeze([
  ["source_file", ["source_file", "sourceFile"]],
  ["source_files", ["source_files", "sourceFiles"]],
  ["runtime_file", ["runtime_file", "runtimeFile"]],
  ["runtime_output_file", ["runtime_output_file", "runtimeOutputFile"]],
  ["runtime_outputs", ["runtime_outputs", "runtimeOutputs"]],
  ["output_file", ["output_file", "outputFile"]],
]);
/** required_file_fields 可接受的同类单文件/列表字段集合。 */
const IMAGEGEN_REQUIRED_PATH_GROUPS = Object.freeze({
  source_file: ["source_file", "sourceFile", "source_files", "sourceFiles"],
  source_files: ["source_file", "sourceFile", "source_files", "sourceFiles"],
  runtime_file: ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs"],
  runtime_output_file: ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs"],
  runtime_outputs: ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs"],
  output_file: ["output_file", "outputFile"],
});
/** output/output_metadata 中所有可能承载 图像生成 文件的字段。 */
const IMAGEGEN_NESTED_PATH_FIELDS = Object.freeze([
  "file", "path", "source_file", "sourceFile", "source_files", "sourceFiles",
  "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs",
  "output_file", "outputFile",
]);
/** 同一输出身份在记录顶层和嵌套输出对象中可出现的路径字段。 */
const IMAGEGEN_OUTPUT_PATH_FIELDS = Object.freeze([
  "file", "path", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile",
  "runtime_outputs", "runtimeOutputs", "output_file", "outputFile",
]);
/** 顶层与嵌套输出可声明的全部路径字段，供生成记录和运行时身份绑定复用。 */
const IMAGEGEN_ALL_PATH_FIELDS = Object.freeze([...new Set(["file", "path", ...IMAGEGEN_NESTED_PATH_FIELDS])]);

/** 将别名值规范化为可比较的标量/无序路径列表，避免只比较首个数组元素。 */
function normalizeAliasValue(value) {
  if (Array.isArray(value)) return value.map(normalizeAliasValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (typeof value === "string") return value.trim();
  return value;
}

/** 判断两个别名是否表示同一份路径或 MIME 声明。 */
function sameAliasValue(left, right) {
  return JSON.stringify(normalizeAliasValue(left)) === JSON.stringify(normalizeAliasValue(right));
}

/** 把单路径和路径数组统一为不区分大小写的输出身份集合。 */
function normalizeOutputIdentity(value, kind) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map((item) => {
    if (typeof item !== "string") return item;
    const normalized = item.trim();
    return kind === "mime" ? normalized.toLowerCase() : normalized.replaceAll("\\", "/").toLowerCase();
  });
  return [...new Set(normalized)].sort();
}

/** 比较顶层与嵌套输出的身份，允许单元素数组与对应标量表达同一值。 */
function sameOutputIdentity(left, right, kind) {
  return JSON.stringify(normalizeOutputIdentity(left, kind)) === JSON.stringify(normalizeOutputIdentity(right, kind));
}

/** 检查对象中一组 snake/camel 别名的原始值，防止折叠时吞掉非法旁路。 */
function collectAliasGroupViolations(value, fields, label) {
  const present = fields.filter((field) => Object.hasOwn(value, field));
  if (present.length < 2) return [];
  const first = value[present[0]];
  return present.slice(1).filter((field) => !sameAliasValue(first, value[field])).map((field) => ({
    field: present.join("/"),
    message: `${label}别名取值冲突：${present.join("、")}`,
  }));
}

/** 返回嵌套输出对象，统一检查 output 与 output_metadata 而不采用二选一折叠。 */
function nestedImageGenerationOutputs(value) {
  return ["output", "output_metadata"].filter((field) => isObjectLike(value[field])).map((field) => [field, value[field]]);
}

/** 检查 output 与 output_metadata 对同一语义字段的重复声明，避免一层合法值掩盖另一层漂移。 */
function collectNestedOutputConflicts(outputs) {
  const violations = [];
  const groups = [
    ["mime_type", ["mime_type", "mimeType"]],
    ["file/path", ["file", "path"]],
    ...IMAGEGEN_PATH_ALIASES,
  ];
  for (const [canonical, fields] of groups) {
    const declarations = outputs.map(([container, output]) => {
      const field = fields.find((candidate) => Object.hasOwn(output, candidate));
      return field ? { container, field, value: output[field] } : null;
    }).filter(Boolean);
    if (declarations.length > 1 && declarations.slice(1).some((item) => !sameAliasValue(declarations[0].value, item.value))) violations.push({ field: `output/output_metadata.${canonical}`, message: `output 与 output_metadata 的 ${canonical} 别名取值冲突` });
  }
  return violations;
}

/** 检查同一记录的顶层、output、output_metadata 是否声明了冲突的输出身份。 */
function collectUnifiedOutputIdentityConflicts(value, outputs) {
  const layers = [["top-level", value], ...outputs];
  const groups = [
    ["MIME", ["mime_type", "mimeType"], "mime"],
    ["路径", IMAGEGEN_OUTPUT_PATH_FIELDS, "path"],
  ];
  const violations = [];
  for (const [label, fields, kind] of groups) {
    const declarations = layers.map(([container, item]) => {
      const values = fields.filter((field) => Object.hasOwn(item, field)).flatMap((field) => Array.isArray(item[field]) ? item[field] : [item[field]]);
      return values.length ? { container, values } : null;
    }).filter(Boolean);
    if (declarations.length > 1) {
      const first = declarations[0].values;
      if (declarations.slice(1).some((item) => !sameOutputIdentity(first, item.values, kind))) violations.push({ field: `top-level/output/output_metadata.${kind}`, message: `统一输出身份${label}在 ${declarations.map((item) => item.container).join("、")} 之间取值冲突` });
    }
  }
  return violations;
}

/** 仅判断对象形态，避免格式模块依赖主合同的内部工具。 */
function isObjectLike(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 收集对象及其 output/output_metadata 中的全部路径值，不让折叠优先级漏掉一层声明。 */
export function collectImageGenerationPathValues(value = {}, fields = IMAGEGEN_ALL_PATH_FIELDS) {
  const source = isObjectLike(value) ? value : {};
  const objects = [source, ...nestedImageGenerationOutputs(source).map(([, output]) => output)];
  return objects.flatMap((item) => fields.flatMap((field) => {
    if (!Object.hasOwn(item, field)) return [];
    return Array.isArray(item[field]) ? item[field] : [item[field]];
  }));
}

/** 判断 图像生成 合同允许的标准位图 MIME。 */
export function isImageGenerationRasterMime(value) {
  return typeof value === "string" && IMAGEGEN_MIME_TYPES.has(value.trim().toLowerCase());
}

/** 判断 图像生成 合同允许的源文件/运行时文件后缀。 */
export function isImageGenerationRasterPath(value) {
  return typeof value === "string" && IMAGEGEN_PATH_PATTERN.test(value.trim());
}

/**
 * 在字段折叠前拒绝 图像生成 的 snake/camel 和多路径别名，避免合法 PNG
 * 优先取值而吞掉同一对象里混入的 WebP 等非法声明。
 */
export function collectImageGenerationAliasViolations(value = {}) {
  const violations = [];
  if (!isObjectLike(value)) return violations;
  for (const [canonical, aliases] of IMAGEGEN_PATH_ALIASES) {
    violations.push(...collectAliasGroupViolations(value, aliases, `图像生成 ${canonical} `));
  }
  violations.push(...collectAliasGroupViolations(value, ["mime_type", "mimeType"], "图像生成 MIME "));
  violations.push(...collectAliasGroupViolations(value, ["file", "path"], "V3 actual_assets file/path "));
  const outputs = nestedImageGenerationOutputs(value);
  for (const [container, output] of outputs) {
    for (const [canonical, aliases] of IMAGEGEN_PATH_ALIASES) violations.push(...collectAliasGroupViolations(output, aliases, `${container}.${canonical} `));
    violations.push(...collectAliasGroupViolations(output, ["file", "path"], `${container}.file/path `));
    violations.push(...collectAliasGroupViolations(output, ["mime_type", "mimeType"], `${container}.mime_type `));
  }
  violations.push(...collectNestedOutputConflicts(outputs));
  violations.push(...collectUnifiedOutputIdentityConflicts(value, outputs));
  return violations;
}

/**
 * 收集 图像生成 资产中的格式违规，调用方负责把字段绑定到阶段和区域上下文。
 * 这里只检查已声明值；requiredMime 用于 expected/actual 这类必须登记 MIME 的入口。
 */
export function collectImageGenerationRasterViolations(value = {}, options = {}) {
  const source = isObjectLike(value) ? value : {};
  const violations = collectImageGenerationAliasViolations(source);
  const mimeValues = ["mime_type", "mimeType"].filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]);
  if (options.requiredMime === true && mimeValues.length === 0) mimeValues.push([options.mimeField ?? "mime_type", undefined]);
  for (const [field, mime] of mimeValues) if (!isImageGenerationRasterMime(mime)) violations.push({ field, message: "图像生成 仅允许 image/png 或 image/jpeg" });
  for (const field of options.requiredFileFields ?? []) {
    const candidates = IMAGEGEN_REQUIRED_PATH_GROUPS[field] ?? [field];
    if (!candidates.some((candidate) => Object.hasOwn(source, candidate))) violations.push({ field, message: "图像生成 必须登记 .png、.jpg 或 .jpeg 源文件/运行时文件" });
  }
  const requestedFields = new Set(options.fileFields ?? []);
  // source_file/runtime_file 需要同时覆盖对应的列表字段，不能让 source_files
  // 或 runtimeOutputs 在规范化时被静默遗漏。
  // 图像生成 的格式门扫描对象中所有已声明路径，而不是只扫描调用方预期字段。
  for (const [, aliases] of IMAGEGEN_PATH_ALIASES) for (const field of aliases) requestedFields.add(field);
  requestedFields.add("file"); requestedFields.add("path");
  for (const field of requestedFields) {
    const values = Array.isArray(source[field]) ? source[field] : [source[field]];
    for (const file of values) if (file !== undefined && file !== null && !isImageGenerationRasterPath(file)) violations.push({ field, value: file, message: "图像生成 源文件和运行时文件扩展名仅允许 .png、.jpg 或 .jpeg" });
  }
  for (const [container, output] of nestedImageGenerationOutputs(source)) {
    for (const field of IMAGEGEN_NESTED_PATH_FIELDS) if (Object.hasOwn(output, field)) {
      const values = Array.isArray(output[field]) ? output[field] : [output[field]];
      for (const file of values) if (file !== undefined && file !== null && !isImageGenerationRasterPath(file)) violations.push({ field: `${container}.${field}`, value: file, message: "图像生成 输出扩展名仅允许 .png、.jpg 或 .jpeg" });
    }
    for (const field of ["mime_type", "mimeType"]) if (Object.hasOwn(output, field) && !isImageGenerationRasterMime(output[field])) violations.push({ field: `${container}.${field}`, message: "图像生成 仅允许 image/png 或 image/jpeg" });
  }
  return violations;
}
