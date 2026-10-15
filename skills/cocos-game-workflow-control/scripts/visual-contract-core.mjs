#!/usr/bin/env node

/**
 * 视觉合同共享基础模块。
 *
 * 这里集中放置多个合同都会使用的纯函数、路径规范化和有限词汇表，
 * 避免不同入口各自复制一份谓词或处置推导，造成规则漂移。模块不读取
 * 项目文件，也不依赖任何具体合同，保持依赖方向单向且可安全复用。
 */
import { createHash } from "node:crypto";
import { schemaEnum } from "./runtime/schema-contract.mjs";

/** 标准 SHA-256 身份格式；只接受小写十六进制，保持文件身份可确定比较。 */
export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** 判断值是否为不含数组的普通对象。 */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断值是否为包含实际合同内容的非空字符串。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断值是否符合视觉合同约定的 SHA-256 身份。 */
export function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** 计算字节或字符串的 SHA-256 十六进制摘要。 */
export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** 计算带 sha256: 前缀的字节摘要，统一各合同的文件身份格式。 */
export function sha256Bytes(value) {
  return `sha256:${sha256Hex(value)}`;
}

/** 计算文本的带前缀 SHA-256，避免调用方重复处理编码和前缀。 */
export function sha256Text(value) {
  return sha256Bytes(Buffer.from(String(value ?? ""), "utf8"));
}

/** 按键排序递归序列化 JSON，使属性插入顺序不影响合同身份。 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 计算排除自引用字段后的规范化对象 SHA-256。 */
export function canonicalSha256(value, excludedField = "") {
  const payload = isPlainObject(value) ? { ...value } : value;
  if (isPlainObject(payload) && excludedField) delete payload[excludedField];
  return sha256Text(canonicalJson(payload));
}

/**
 * 规范化合同中的项目相对路径。
 *
 * secure=true 时执行 Windows/POSIX 越界、非法字符、设备名和短名检查；
 * secure=false 仅用于稳定身份比较，保留宽松合同字段的既有语义。默认
 * 返回小写路径，因为视觉合同的项目路径身份按常见文件系统不区分大小写。
 */
export function normalizeContractPath(value, { secure = true, lowercase = true } = {}) {
  if (!nonEmptyString(value)) return "";
  const raw = String(value).replaceAll("\\", "/");
  if (!secure) {
    const normalized = raw.trim().replace(/\/{2,}/g, "/").replace(/^\.\//, "");
    return lowercase ? normalized.toLowerCase() : normalized;
  }
  // 同时覆盖 POSIX、Windows 盘符和 UNC 路径，避免平台差异造成越界旁路。
  if (raw.startsWith("/") || raw.startsWith("//") || /^[a-z]:\//i.test(raw)) return null;
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    // Windows 会折叠段尾的点/空格；先拒绝，避免两个合同映射到同一物理文件。
    if (part.endsWith(".") || part.endsWith(" ")) return null;
    // 拒绝控制符、Windows 非法字符和 ADS 冒号，斜杠已作为分隔符处理。
    if (/[\u0000-\u001f\u007f<>:"|?*]/u.test(part)) return null;
    // DOS 设备名即使带扩展名也不是普通项目路径。
    if (/^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(part)) return null;
    // 8.3 短名会让同一物理文件出现第二个身份，保守拒绝。
    if (/~\d+(?:\.|$)/.test(part)) return null;
    parts.push(part);
  }
  const normalized = parts.length ? parts.join("/") : null;
  return normalized && lowercase ? normalized.toLowerCase() : normalized;
}

/**
 * 从 Implementation Package Schema 读取生产合同词汇，避免运行时维护第二份 enum。
 * 视觉清单和实施包共享这些字段时，Schema 是唯一权威，新增词汇只需更新合同。
 */
export const VISUAL_PRODUCTION_ORIGINS = new Set(schemaEnum("implementation-package.schema.json", ["$defs", "visualProductionUnit", "properties", "production_origin"]));
export const VISUAL_PRODUCTION_METHODS = new Set(schemaEnum("implementation-package.schema.json", ["$defs", "visualProductionUnit", "properties", "production_method"]));
export const VISUAL_DELIVERY_KINDS = new Set(schemaEnum("implementation-package.schema.json", ["$defs", "visualProductionUnit", "properties", "delivery_kind"]));
export const VISUAL_SUBSTITUTION_POLICIES = new Set(schemaEnum("implementation-package.schema.json", ["$defs", "visualProductionUnit", "properties", "substitution_policy"]));
/** 固定视觉图片方法由生产方式词汇表派生，避免各门禁重新声明文字。 */
export const VISUAL_FIXED_IMAGE_METHODS = new Set(["image-generation", "authored-raster", "reuse"]);
/** 程序视觉方法由生产方式词汇表派生，专供非图片逻辑门禁使用。 */
export const VISUAL_PROGRAM_METHODS = new Set(["cocos-graphics", "runtime-program"]);

/** 视觉门使用的三类稳定根因标签。 */
export const VISUAL_ROOT_CAUSES = Object.freeze({
  PLAN_MISSING: "方案缺失",
  EXECUTION: "执行问题",
  ACCEPTANCE: "验收问题",
});

/** 视觉门使用的三类稳定处置值。 */
export const VISUAL_REMEDIATION = Object.freeze({
  REPAIR: "repair",
  REVALIDATE: "revalidate",
  RETURN: "return",
});

/** 面向机器的处置值与历史输出标签映射。 */
export const VISUAL_REMEDIATION_LABEL = Object.freeze({
  repair: "REPAIR_REQUIRED",
  revalidate: "REVALIDATION_REQUIRED",
  return: "RETURN_REQUIRED",
});

/** 处置值对应的唯一下一动作文本，保持所有视觉入口输出一致。 */
export const VISUAL_REMEDIATION_NEXT_ACTION = Object.freeze({
  repair: "原地修复当前记录、字段、路径或可补证据后，重新运行当前门；沿工作流继续推进，不回退阶段",
  revalidate: "候选与上游冻结身份未变（V2 拆解方案身份保持不变），仅重验当前门并生成新的机器证据；沿工作流继续推进，不回退阶段",
  return: "上游方案、拆解方案、基线、任务范围或冻结候选身份已失效；记录必要回退理由和受影响范围，再回退到最早受影响阶段",
});

/** 发生这些冻结身份变化时，视觉门必须升级为 RETURN。 */
export const VISUAL_RETURN_SNAPSHOT_KEYS = new Set([
  "workItemId", "unitResultId", "V2PlanTargetHash", "V2PlanCandidateHash", "V2PlanDiffFingerprint", "V2PlanBaselineHash",
  "V2DecompositionConfirmationId", "V2DecompositionConfirmationEvidenceHash",
]);

/** 机器证据变化的稳定识别模式；普通字段缺失仍只要求原地修复。 */
export const VISUAL_REVALIDATION_EVIDENCE_PATTERN = /(?:runtime\s+(?:replay|candidate|consumption)|fidelity|机器(?:验证|检查)|运行态|验证失败|过期|stale)/i;
/** 冻结身份不一致的稳定识别模式；命中时至少需要重新验证。 */
export const VISUAL_IDENTITY_MISMATCH_PATTERN = /(?:不一致|不匹配|漂移|旧候选|旧基线|冻结目标|冻结基线|diff identity)/i;

/**
 * 根据阶段推导默认退回点；调用方提供的显式 returnStage 始终优先。
 * validationStages 用于生产/尺寸门把失败交给 VALIDATING，而不改变门本身。
 */
export function deriveVisualReturnStage(stage, { validationStages = [] } = {}) {
  const value = String(stage ?? "");
  if (value === "V1" || value === "V2") return "V1/PROPOSAL";
  if (validationStages.includes(value)) return "VALIDATING";
  return value;
}

/** 根据阶段和退回点推导标准根因，允许少数合同传入领域默认值。 */
export function deriveVisualRootCause(stage, returnStage, { executionStages = ["V2", "V3"], acceptanceStages = ["F2", "F3", "V4", "VALIDATING"], defaultRootCause = VISUAL_ROOT_CAUSES.PLAN_MISSING } = {}) {
  if (returnStage === "V1/PROPOSAL") return VISUAL_ROOT_CAUSES.PLAN_MISSING;
  if (executionStages.includes(String(stage ?? ""))) return VISUAL_ROOT_CAUSES.EXECUTION;
  if (acceptanceStages.includes(String(stage ?? "")) || acceptanceStages.includes(returnStage)) return VISUAL_ROOT_CAUSES.ACCEPTANCE;
  return defaultRootCause;
}

/** 将快照差异与证据错误收敛为最小必要处置，不扩大回退范围。 */
export function deriveVisualDisposition({ changed = [], missingEvidence = [], identityChanges = [], machineFailure = false } = {}) {
  if (identityChanges.length > 0 || changed.some((key) => VISUAL_RETURN_SNAPSHOT_KEYS.has(key))) return VISUAL_REMEDIATION.RETURN;
  if (machineFailure) return VISUAL_REMEDIATION.REVALIDATE;
  if (missingEvidence.some((item) => VISUAL_IDENTITY_MISMATCH_PATTERN.test(String(item)))) return VISUAL_REMEDIATION.REVALIDATE;
  if (changed.length > 0 || missingEvidence.some((item) => VISUAL_REVALIDATION_EVIDENCE_PATTERN.test(String(item)))) return VISUAL_REMEDIATION.REVALIDATE;
  return VISUAL_REMEDIATION.REPAIR;
}

/** 从身份变化列表中取得最早受影响视觉阶段，避免默认整条链路重做。 */
export function earliestVisualReturnStage(changes, fallback = "V2") {
  for (const stage of ["V2", "V3", "V4"]) if ((changes ?? []).some((item) => String(item).startsWith(stage))) return stage;
  return fallback;
}
