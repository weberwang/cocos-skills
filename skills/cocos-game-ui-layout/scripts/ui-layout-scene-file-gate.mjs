import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { validateEvidenceIdentity } from "../../cocos-game-workflow-control/scripts/visual-runtime-evidence.mjs";

/** 判断普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 解析 evidence/file/path 容器；未知对象报错，且不扫描其任意描述字段。 */
function evidenceRecords(value, label, errors, records = [], inheritedIdentity = {}) {
  if (typeof value === "string") {
    if (value.trim()) records.push({ label, evidence: { ...inheritedIdentity, evidence: value } });
    else errors.push(`${label} evidence 路径不能为空`);
  } else if (Array.isArray(value)) {
    if (value.length === 0) errors.push(`${label} evidence 数组不能为空`);
    value.forEach((item, index) => evidenceRecords(item, `${label}[${index}]`, errors, records, inheritedIdentity));
  } else if (isObject(value)) {
    const pathFields = ["evidence", "file", "path"].filter((field) => Object.hasOwn(value, field));
    if (pathFields.length === 0) {
      errors.push(`${label} evidence 对象无法解析；必须包含 evidence、file 或 path 路径字段`);
    } else {
      const identity = { ...inheritedIdentity };
      for (const [key, item] of Object.entries(value)) if (!["evidence", "file", "path"].includes(key)) identity[key] = item;
      for (const field of pathFields) evidenceRecords(value[field], `${label}.${field}`, errors, records, identity);
    }
  } else {
    errors.push(`${label} evidence 必须是路径字符串、数组或包含 evidence/file/path 的对象`);
  }
  return records;
}

/** 校验已存在文件的 realpath 仍在项目根目录内，阻断符号链接越界。 */
async function validateRealProjectPath(projectRoot, value, label) {
  if (typeof value !== "string" || value.trim().length === 0) return `${label} evidence 路径必须是非空字符串`;
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(value) || win32.isAbsolute(value) || normalized.startsWith("//") || normalized.split("/").includes("..")) {
    return `${label} 路径必须是安全的项目相对路径：${value}`;
  }

  const root = resolve(projectRoot);
  const file = resolve(root, value);
  const lexical = relative(root, file);
  if (!lexical || lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    return `${label} 路径越界：${value}`;
  }

  try {
    const realRoot = await realpath(root);
    const realFile = await realpath(file);
    const actual = relative(realRoot, realFile);
    if (!actual || actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) return `${label} 真实路径越界：${value}`;
    if (!(await stat(realFile)).isFile()) return `${label} 必须指向文件：${value}`;
  } catch {
    // 文件存在性由官方 evidence identity 校验器给出统一诊断。
  }
  return null;
}

/** 复用官方 evidence file gate 检查场景内 V4 组合与节点测量工件。 */
export async function validateSceneRuntimeEvidenceFiles(scene, projectRoot) {
  const preacceptance = scene?.combination_preacceptance ?? scene?.combinationPreacceptance;
  const geometry = preacceptance?.layout_geometry ?? preacceptance?.layoutGeometry;
  const errors = [];
  const evidenceRefs = evidenceRecords(preacceptance?.evidence, "scene_reconstruction_contract.combination_preacceptance.evidence", errors);
  const measurements = geometry?.node_measurements ?? geometry?.nodeMeasurements;
  if (Array.isArray(measurements)) measurements.forEach((measurement, index) => {
    evidenceRecords(
      measurement?.evidence ?? measurement?.evidence_paths ?? measurement?.evidencePaths,
      `scene_reconstruction_contract.combination_preacceptance.layout_geometry.node_measurements[${index}].evidence`,
      errors,
      evidenceRefs,
    );
  });
  const conditions = scene?.target_conditions ?? scene?.targetConditions ?? {};
  const identity = { sceneId: conditions.scene_id ?? conditions.sceneId, stateId: conditions.state_id ?? conditions.stateId };

  for (const { label, evidence } of evidenceRefs) {
    errors.push(...validateEvidenceIdentity(evidence, { stage: "V4", annotation_number: "*", region_id: label }, identity, { projectRoot }));
    const realPathError = await validateRealProjectPath(projectRoot, evidence.evidence, label);
    if (realPathError) errors.push(realPathError);
  }
  return errors;
}
