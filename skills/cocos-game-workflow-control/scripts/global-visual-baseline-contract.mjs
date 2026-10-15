import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  areGlobalVisualCandidateAssessmentsEquivalent,
  validateGameArtBrief,
  validateGlobalVisualCandidateAssessments,
} from './global-visual-art-quality-contract.mjs';

/** 全局视觉基线选择证据的严格版本；该证据在冻结后只允许通过新版本替换。 */
export const GLOBAL_VISUAL_BASELINE_SELECTION_SCHEMA = 'cocos-global-visual-baseline-selection/1.1';
/** 候选生成记录的严格版本，记录冻结前的同条件生成事实。 */
export const GLOBAL_VISUAL_BASELINE_CANDIDATE_SCHEMA = 'cocos-global-visual-baseline-candidate-generation/1.0';
/** 人工选择记录的严格版本，禁止 AUTO 或 pending 记录进入冻结证据。 */
export const GLOBAL_VISUAL_BASELINE_DECISION_SCHEMA = 'cocos-global-visual-baseline-selection-decision/1.1';
/** 全局静态基线唯一允许的冻结状态。 */
export const GLOBAL_VISUAL_BASELINE_FROZEN_STATE = 'global-static-baseline-frozen';
/** 冻结正文的固定仓库路径，用于复核人工选择后的基线来源。 */
export const GLOBAL_VISUAL_BASELINE_DOCUMENT = 'docs/visual-baseline.md';
/** 选择证据只接受三张候选图，避免“多图任选”或少于三张的隐性流程。 */
export const GLOBAL_VISUAL_BASELINE_CANDIDATE_COUNT = 3;

const IMAGE_PATH = /\.(?:png|jpe?g)$/i;
const OPTIONAL_SNAPSHOT_FIELDS = new Set([
  'sha256', 'conditionsFingerprint', 'briefSha256', 'outputSha256', 'decisionSha256',
  'documentSha256', 'styleFingerprint', 'conditions_fingerprint', 'brief_sha256',
  'output_sha256', 'decision_sha256', 'document_sha256', 'style_fingerprint',
  'targetSha256', 'target_sha256', 'candidateSha256', 'candidate_sha256', 'candidate_sha',
  'baselineHash', 'baseline_hash', 'baselineSha256', 'baseline_sha256', 'contentHash', 'content_hash',
  'artifactHash', 'artifact_hash', 'dependencyHash', 'dependency_hash', 'diffFingerprint', 'diff_fingerprint', 'diffSha256', 'diff_sha256',
  'evidenceSha256', 'evidence_sha256', 'visualManifestSha256', 'visual_manifest_sha256',
  'referenceSha256', 'reference_sha256', 'annotationSha256', 'annotation_sha256', 'metadataSha256', 'metadata_sha256',
  'receiptSha256', 'receipt_sha256', 'proposalSha256', 'proposal_sha256', 'entry_sha256', 'ledger_sha256',
]);

const ROOT_FIELDS = Object.freeze([
  'schemaVersion', 'workItemId', 'selectionId', 'brief', 'generationBatchId',
  'candidates', 'humanSelection', 'baseline', 'frozenAt',
]);
const BRIEF_FIELDS = Object.freeze(['briefId', 'path']);
const CANDIDATE_FIELDS = Object.freeze(['candidateId', 'origin', 'status', 'image', 'generationRecord']);
const FILE_REF_FIELDS = Object.freeze(['path']);
const GENERATION_RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'workItemId', 'briefId', 'generationBatchId',
  'candidateId', 'origin', 'outputPath',
  'generatedAt', 'prompt',
]);
const HUMAN_SELECTION_FIELDS = Object.freeze([
  'reviewMode', 'status', 'selectedCandidateId', 'presentedCandidateIds',
  'candidateAssessments', 'decisionFile', 'confirmedAt', 'userOriginalText',
]);
const DECISION_FIELDS = Object.freeze([
  'schemaVersion', 'selectionId', 'workItemId', 'briefId',
  'generationBatchId', 'presentedCandidateIds',
  'reviewMode', 'status', 'selectedCandidateId', 'candidateAssessments', 'confirmedAt', 'userOriginalText',
]);
const BASELINE_FIELDS = Object.freeze([
  'id', 'version', 'status', 'document',
  'primaryAnchor', 'selectedCandidateId', 'selectedCandidate',
]);
// 引用属于消费者 Work Item；可选 workItemId 只记录生产者身份，不能改写成消费者身份。
const REFERENCE_FIELDS = Object.freeze(['path', 'workItemId']);

/** 判断值是否为不带数组的普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 判断字符串是否为非空文本。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 摘要是可选追踪元数据，不允许它们成为严格对象形状的必填验收条件。 */
function isOptionalSnapshotField(field) {
  const normalized = String(field).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return OPTIONAL_SNAPSHOT_FIELDS.has(field)
    || /(^|[_-])(sha(?:1|256)?|hash|checksum|fingerprint|digest|diff_identity)([_-]|$)/.test(normalized);
}

/** 判断时间字段是否可被机器解析，拒绝空值和自由文本。 */
function isDateTime(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

/** 将路径统一成仓库内身份比较格式，不承担真实文件安全校验。 */
function normalizePath(value) {
  return isNonEmptyString(value) ? value.trim().replaceAll('\\', '/').replace(/^\.\//, '') : '';
}

/** 判断路径是否为不含绝对路径、空字节和穿越段的仓库内相对路径。 */
function isRepositoryRelativePath(value) {
  const path = normalizePath(value);
  return Boolean(path)
    && !isAbsolute(path)
    && !path.startsWith('/')
    && !/^[A-Za-z]:\//.test(path)
    && !path.includes('\0')
    && !path.split('/').includes('..');
}

/** 对严格对象报告缺失和多余字段，防止通过未知别名绕过合同。 */
function validateStrictObject(value, fields, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} 必须为对象`);
    return false;
  }
  const missing = fields.filter((field) => value[field] === undefined);
  const extra = Object.keys(value).filter((field) => !fields.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) errors.push(`${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  return missing.length === 0 && extra.length === 0;
}

/** 校验仓库内来源文件引用的字段形状；真实存在性由文件门读取。 */
function validateFileRefShape(value, label, errors, fields = FILE_REF_FIELDS) {
  const valid = validateStrictObject(value, fields, label, errors);
  if (!valid) return false;
  if (!isRepositoryRelativePath(value.path)) {
    errors.push(`${label} 必须包含仓库内相对来源 path`);
    return false;
  }
  return true;
}

/**
 * 校验消费者对全局选择根证据的引用形状。
 * 根证据的 workItemId 是生产者身份；消费者通过来源路径读取并校验根证据，
 * 因此这里不把可选的生产者标识与当前消费者 Work Item 比较。
 */
export function validateGlobalVisualBaselineSelectionReferenceShape(reference) {
  const errors = [];
  if (!isRecord(reference)) {
    errors.push('globalVisualBaselineSelectionRef 必须是仓库内来源路径对象；必须完成 3 张候选图 + 人工确认');
    return errors;
  }
  const missing = ['path'].filter((field) => reference[field] === undefined);
  const extra = Object.keys(reference).filter((field) => !REFERENCE_FIELDS.includes(field) && !isOptionalSnapshotField(field));
  if (missing.length || extra.length) errors.push(`globalVisualBaselineSelectionRef 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!isRepositoryRelativePath(reference.path)) errors.push('globalVisualBaselineSelectionRef 必须包含仓库内相对来源 path');
  if (reference.workItemId !== undefined && !isNonEmptyString(reference.workItemId)) errors.push('globalVisualBaselineSelectionRef.workItemId 若提供必须为非空的生产者 Work Item 身份');
  return [...new Set(errors)];
}

/** 校验候选图片路径的最小可审计约束，避免把任意 JSON 或文本冒充效果图。 */
function validateImageRefShape(value, label, errors) {
  const valid = validateFileRefShape(value, label, errors);
  if (valid && !IMAGE_PATH.test(value.path)) errors.push(`${label}.path 必须指向 PNG/JPEG 效果图`);
  return valid;
}

/**
 * 校验全局基线选择证据的结构、候选数量、唯一人工决定与冻结身份。
 * value.workItemId 始终是生成这份冻结根证据的生产者 Work Item，不接受消费者身份覆盖。
 */
export function validateGlobalVisualBaselineSelection(value, options = {}) {
  const errors = [];
  const settings = isRecord(options) ? options : {};
  const label = settings.label ?? '全局视觉基线选择证据';
  const rootValid = validateStrictObject(value, ROOT_FIELDS, label, errors);
  if (!rootValid) return [...new Set(errors)];
  if (value.schemaVersion !== GLOBAL_VISUAL_BASELINE_SELECTION_SCHEMA) errors.push(`${label}.schemaVersion 必须为 ${GLOBAL_VISUAL_BASELINE_SELECTION_SCHEMA}`);
  if (!isNonEmptyString(value.workItemId)) errors.push(`${label}.workItemId 必须为非空字符串`);
  if (!isNonEmptyString(value.selectionId)) errors.push(`${label}.selectionId 必须为非空字符串`);
  if (!isNonEmptyString(value.generationBatchId)) errors.push(`${label}.generationBatchId 必须为非空字符串`);
  if (!isDateTime(value.frozenAt)) errors.push(`${label}.frozenAt 必须为有效时间`);

  const brief = value.brief;
  const briefValid = validateStrictObject(brief, BRIEF_FIELDS, `${label}.brief`, errors);
  if (briefValid) {
    if (!isNonEmptyString(brief.briefId)) errors.push(`${label}.brief.briefId 必须为非空字符串`);
    if (!isRepositoryRelativePath(brief.path)) errors.push(`${label}.brief.path 必须为仓库内相对路径`);
    if (isNonEmptyString(brief.path) && !/\.json$/i.test(brief.path)) errors.push(`${label}.brief.path 必须指向游戏美术 brief JSON 文件`);
  }

  const candidates = value.candidates;
  const candidateIds = [];
  const candidateImageRefs = [];
  const candidateGenerationRefs = [];
  if (!Array.isArray(candidates) || candidates.length !== GLOBAL_VISUAL_BASELINE_CANDIDATE_COUNT) {
    errors.push(`${label}.candidates 必须恰好包含 3 张候选效果图；当前流程需要 3 张候选图 + 人工确认`);
  } else {
    for (const [index, candidate] of candidates.entries()) {
      const candidateLabel = `${label}.candidates[${index}]`;
      const valid = validateStrictObject(candidate, CANDIDATE_FIELDS, candidateLabel, errors);
      if (!valid) continue;
      if (!isNonEmptyString(candidate.candidateId)) errors.push(`${candidateLabel}.candidateId 必须为非空字符串`);
      else candidateIds.push(candidate.candidateId);
      if (candidate.origin !== 'generated' || candidate.status !== 'GENERATED') errors.push(`${candidateLabel} 必须是 origin=generated 且 status=GENERATED 的效果图`);
      validateImageRefShape(candidate.image, `${candidateLabel}.image`, errors);
      validateFileRefShape(candidate.generationRecord, `${candidateLabel}.generationRecord`, errors);
      if (isRecord(candidate.image)) candidateImageRefs.push(normalizePath(candidate.image.path));
      if (isRecord(candidate.generationRecord)) candidateGenerationRefs.push(normalizePath(candidate.generationRecord.path));
    }
    if (candidateIds.length !== new Set(candidateIds).size) errors.push(`${label}.candidates.candidateId 必须唯一`);
    if (candidateImageRefs.length !== new Set(candidateImageRefs).size) errors.push(`${label}.candidates.image 必须分别绑定三张不同的候选效果图`);
    if (candidateGenerationRefs.length !== new Set(candidateGenerationRefs).size) errors.push(`${label}.candidates.generationRecord 必须分别绑定三份不同的生成记录`);
  }

  const human = value.humanSelection;
  const humanValid = validateStrictObject(human, HUMAN_SELECTION_FIELDS, `${label}.humanSelection`, errors);
  if (humanValid) {
    if (human.reviewMode !== 'SINGLE_HUMAN' || human.status !== 'CONFIRMED') errors.push(`${label}.humanSelection 必须是唯一的 SINGLE_HUMAN、CONFIRMED 选择；禁止 AUTO/pending`);
    if (!isNonEmptyString(human.selectedCandidateId)) errors.push(`${label}.humanSelection.selectedCandidateId 必须为非空字符串`);
    if (!Array.isArray(human.presentedCandidateIds) || JSON.stringify(human.presentedCandidateIds) !== JSON.stringify(candidateIds)) errors.push(`${label}.humanSelection.presentedCandidateIds 必须按原顺序完整呈现三张候选图`);
    if (!isNonEmptyString(human.decisionFile) || !isRepositoryRelativePath(human.decisionFile)) errors.push(`${label}.humanSelection 必须绑定仓库内人工决定记录文件`);
    if (!isDateTime(human.confirmedAt)) errors.push(`${label}.humanSelection.confirmedAt 必须为有效确认时间`);
    if (!isNonEmptyString(human.userOriginalText)) errors.push(`${label}.humanSelection.userOriginalText 必须保留人工原文`);
    if (candidateIds.length && !candidateIds.includes(human.selectedCandidateId)) errors.push(`${label}.humanSelection.selectedCandidateId 必须属于三张候选图`);
    // 机器只核对人工传入的五维结论和候选绑定，不读取或推断图像审美质量。
    errors.push(...validateGlobalVisualCandidateAssessments(
      human.candidateAssessments,
      candidateIds,
      human.selectedCandidateId,
      `${label}.humanSelection.candidateAssessments`,
    ));
    if (isDateTime(human.confirmedAt) && isDateTime(value.frozenAt) && Date.parse(human.confirmedAt) > Date.parse(value.frozenAt)) errors.push(`${label}.frozenAt 不得早于人工确认时间`);
  }

  const baseline = value.baseline;
  const baselineValid = validateStrictObject(baseline, BASELINE_FIELDS, `${label}.baseline`, errors);
  if (baselineValid) {
    for (const field of ['id', 'version']) if (!isNonEmptyString(baseline[field])) errors.push(`${label}.baseline.${field} 必须为非空字符串`);
    if (baseline.status !== GLOBAL_VISUAL_BASELINE_FROZEN_STATE) errors.push(`${label}.baseline.status 必须为 ${GLOBAL_VISUAL_BASELINE_FROZEN_STATE}`);
    if (baseline.document !== GLOBAL_VISUAL_BASELINE_DOCUMENT) errors.push(`${label}.baseline.document 必须为 ${GLOBAL_VISUAL_BASELINE_DOCUMENT}`);
    validateImageRefShape(baseline.primaryAnchor, `${label}.baseline.primaryAnchor`, errors);
    validateImageRefShape(baseline.selectedCandidate, `${label}.baseline.selectedCandidate`, errors);
    if (!isNonEmptyString(baseline.selectedCandidateId)) errors.push(`${label}.baseline.selectedCandidateId 必须为非空字符串`);
    if (humanValid && baseline.selectedCandidateId !== human.selectedCandidateId) errors.push(`${label}.baseline.selectedCandidateId 必须绑定人工选中的候选`);
    if (isRecord(baseline.primaryAnchor) && isRecord(baseline.selectedCandidate) && normalizePath(baseline.primaryAnchor.path) !== normalizePath(baseline.selectedCandidate.path)) errors.push(`${label}.baseline.primaryAnchor 必须绑定 selectedCandidate`);
    if (candidateIds.length && baseline.selectedCandidateId && !candidateIds.includes(baseline.selectedCandidateId)) errors.push(`${label}.baseline.selectedCandidateId 必须属于三张候选图`);
    if (Array.isArray(candidates) && isNonEmptyString(baseline.selectedCandidateId)) {
      const selected = candidates.find((candidate) => candidate?.candidateId === baseline.selectedCandidateId);
      if (selected && normalizePath(baseline.selectedCandidate?.path) !== normalizePath(selected.image?.path)) errors.push(`${label}.baseline.selectedCandidate 未绑定所选候选图片`);
    }
  }

  if (settings.checkFiles) errors.push(...validateGlobalVisualBaselineSelectionFiles(value, settings));
  return [...new Set(errors)];
}

/** 取得文件门使用的只读 I/O，允许工作流测试注入确定性实现。 */
function resolveIo(options = {}) {
  const settings = isRecord(options) ? options : {};
  const io = settings.io ?? settings;
  return {
    resolve: typeof io.resolve === 'function' ? io.resolve : resolve,
    existsSync: typeof io.existsSync === 'function' ? io.existsSync : existsSync,
    readFileSync: typeof io.readFileSync === 'function' ? io.readFileSync : readFileSync,
    realpathSync: typeof io.realpathSync === 'function' ? io.realpathSync : realpathSync,
  };
}

/** 解析仓库内相对文件，拒绝绝对路径、路径穿越和仓库根目录本身。 */
function resolveRepoFile(repo, file, io, label, errors) {
  if (!isNonEmptyString(file) || isAbsolute(String(file)) || String(file).includes('\0')) {
    errors.push(`${label} 必须是仓库内相对路径`);
    return null;
  }
  const root = io.resolve(repo);
  const target = io.resolve(repo, file);
  const relativePath = relative(root, target).replaceAll('\\', '/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
    errors.push(`${label} 越出仓库：${file}`);
    return null;
  }
  if (!io.existsSync(target)) {
    errors.push(`${label} 文件不存在：${file}`);
    return null;
  }
  try {
    // 真实路径也必须留在仓库内，防止通过仓库内 symlink 把外部文件伪装成冻结证据。
    const realRoot = io.realpathSync(root);
    const realTarget = io.realpathSync(target);
    const realRelativePath = relative(realRoot, realTarget).replaceAll('\\', '/');
    if (!realRelativePath || realRelativePath === '..' || realRelativePath.startsWith('../') || isAbsolute(realRelativePath)) {
      errors.push(`${label} 真实位置越出仓库：${file}`);
      return null;
    }
  } catch {
    errors.push(`${label} 真实位置无法确认：${file}`);
    return null;
  }
  return target;
}

/** 读取并解析仓库内 JSON 文件，返回 null 并保留可解释错误。 */
function readJsonFile(target, io, label, errors) {
  try {
    const content = io.readFileSync(target, 'utf8');
    return JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : String(content));
  } catch (error) {
    errors.push(`${label} 不是有效 JSON：${error.message}`);
    return null;
  }
}

/** 校验来源文件路径并返回仓库内目标路径，保留路径越界与缺文件阻断。 */
function validateSourceFile(reference, repo, io, label, errors) {
  const target = resolveRepoFile(repo, reference?.path, io, `${label}.path`, errors);
  return target;
}

/** 校验候选图片的真实文件魔数，拒绝仅靠 .png/.jpg 后缀伪装的文本或 JSON。 */
function validateImageFileMagic(reference, target, io, label, errors) {
  if (!target || !isRecord(reference)) return;
  let content;
  try {
    content = io.readFileSync(target);
  } catch {
    errors.push(`${label} 图片文件无法读取`);
    return;
  }
  let bytes;
  try {
    bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  } catch {
    errors.push(`${label} 图片文件内容不是可读取的字节序列`);
    return;
  }
  const path = normalizePath(reference.path).toLowerCase();
  const png = path.endsWith('.png')
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = /\.(?:jpg|jpeg)$/.test(path)
    && bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) errors.push(`${label} 必须是真实 PNG/JPEG 图片文件，不能仅使用图片扩展名`);
}

/** 复核候选生成记录文件，并确保其输出仍是同一张候选图。 */
function validateCandidateGenerationRecord(candidate, root, candidateIndex, repo, io, errors) {
  const label = `全局视觉基线选择证据.candidates[${candidateIndex}]`;
  const target = validateSourceFile(candidate?.generationRecord, repo, io, `${label}.generationRecord`, errors);
  if (!target) return;
  const record = readJsonFile(target, io, `${label}.generationRecord`, errors);
  const valid = validateStrictObject(record, GENERATION_RECORD_FIELDS, `${label}.generationRecord.content`, errors);
  if (!valid) return;
  const expected = {
    schemaVersion: GLOBAL_VISUAL_BASELINE_CANDIDATE_SCHEMA,
    workItemId: root.workItemId,
    briefId: root.brief?.briefId,
    generationBatchId: root.generationBatchId,
    candidateId: candidate?.candidateId,
    origin: 'generated',
    outputPath: candidate?.image?.path,
  };
  for (const [field, value] of Object.entries(expected)) if (record[field] !== value) errors.push(`${label}.generationRecord.content.${field} 未绑定当前三候选生成合同`);
  if (!isDateTime(record.generatedAt)) errors.push(`${label}.generationRecord.content.generatedAt 必须为有效时间`);
  if (isDateTime(record.generatedAt) && isDateTime(root.humanSelection?.confirmedAt) && Date.parse(record.generatedAt) > Date.parse(root.humanSelection.confirmedAt)) errors.push(`${label}.generationRecord.content.generatedAt 不得晚于人工确认时间`);
  if (isDateTime(record.generatedAt) && isDateTime(root.frozenAt) && Date.parse(record.generatedAt) > Date.parse(root.frozenAt)) errors.push(`${label}.generationRecord.content.generatedAt 不得晚于全局基线冻结时间`);
  if (!isNonEmptyString(record.prompt)) errors.push(`${label}.generationRecord.content.prompt 必须保留实际生成提示词`);
  const imageTarget = validateSourceFile(candidate?.image, repo, io, `${label}.image`, errors);
  validateImageFileMagic(candidate?.image, imageTarget, io, `${label}.image`, errors);
}

/** 复核人工决定文件，确保唯一 SINGLE_HUMAN、CONFIRMED 记录没有被替换或降级。 */
function validateHumanDecisionFile(root, repo, io, errors) {
  const human = root.humanSelection;
  const target = validateSourceFile({ path: human?.decisionFile }, repo, io, '全局视觉基线选择证据.humanSelection.decisionFile', errors);
  if (!target) return;
  const record = readJsonFile(target, io, '全局视觉基线选择证据.humanSelection.decisionFile', errors);
  const valid = validateStrictObject(record, DECISION_FIELDS, '全局视觉基线选择证据.humanSelection.decisionFile.content', errors);
  if (!valid) return;
  const expected = {
    schemaVersion: GLOBAL_VISUAL_BASELINE_DECISION_SCHEMA,
    selectionId: root.selectionId,
    workItemId: root.workItemId,
    briefId: root.brief?.briefId,
    generationBatchId: root.generationBatchId,
    presentedCandidateIds: Array.isArray(root.candidates) ? root.candidates.map((candidate) => candidate?.candidateId) : undefined,
    reviewMode: 'SINGLE_HUMAN',
    status: 'CONFIRMED',
    selectedCandidateId: human?.selectedCandidateId,
    confirmedAt: human?.confirmedAt,
    userOriginalText: human?.userOriginalText,
  };
  for (const [field, value] of Object.entries(expected)) if (JSON.stringify(record[field]) !== JSON.stringify(value)) errors.push(`全局视觉基线选择证据.humanSelection.decisionFile.content.${field} 未绑定唯一人工确认`);
  const candidateIds = Array.isArray(root.candidates) ? root.candidates.map((candidate) => candidate?.candidateId) : [];
  // 决定文件重复记录评估结果，语义比较按 candidateId 完成，允许 JSON 键序与评估数组次序变化。
  errors.push(...validateGlobalVisualCandidateAssessments(
    record.candidateAssessments,
    candidateIds,
    record.selectedCandidateId,
    '全局视觉基线选择证据.humanSelection.decisionFile.content.candidateAssessments',
  ));
  if (!areGlobalVisualCandidateAssessmentsEquivalent(record.candidateAssessments, human?.candidateAssessments)) {
    errors.push('全局视觉基线选择证据.humanSelection.decisionFile.content.candidateAssessments 必须与根证据人工评估语义一致');
  }
}

/** 复核 brief、三张候选图、人工决定与冻结正文的来源内容。 */
function validateGlobalVisualBaselineSelectionFiles(root, options) {
  const errors = [];
  const repo = options.projectRoot ?? options.repo;
  if (!isNonEmptyString(repo)) {
    errors.push('全局视觉基线选择证据文件门缺少 projectRoot；必须完成 3 张候选图 + 人工确认');
    return errors;
  }
  const io = resolveIo(options);
  // brief 是冻结前的项目定义来源，必须读取并校验真实 JSON 内容和生产者身份。
  const briefTarget = validateSourceFile(root.brief, repo, io, '全局视觉基线选择证据.brief', errors);
  if (briefTarget) {
    const brief = readJsonFile(briefTarget, io, '全局视觉基线选择证据.brief', errors);
    errors.push(...validateGameArtBrief(brief, {
      workItemId: root.workItemId,
      briefId: root.brief?.briefId,
      label: '全局视觉基线选择证据.brief.content',
    }));
  }
  if (Array.isArray(root.candidates)) root.candidates.forEach((candidate, index) => validateCandidateGenerationRecord(candidate, root, index, repo, io, errors));
  validateHumanDecisionFile(root, repo, io, errors);
  const baseline = root.baseline;
  if (isRecord(baseline)) {
    const documentTarget = resolveRepoFile(repo, baseline.document, io, '全局视觉基线选择证据.baseline.document', errors);
    if (documentTarget) {
      try {
        const document = io.readFileSync(documentTarget, 'utf8');
        if (!String(document).trim()) errors.push('全局视觉基线选择证据.baseline 文档内容不能为空');
      } catch {
        errors.push('全局视觉基线选择证据.baseline 文档无法读取');
      }
    }
    validateSourceFile(baseline.primaryAnchor, repo, io, '全局视觉基线选择证据.baseline.primaryAnchor', errors);
    validateSourceFile(baseline.selectedCandidate, repo, io, '全局视觉基线选择证据.baseline.selectedCandidate', errors);
  }
  return errors;
}

/**
 * 读取并完整验证消费者引用的不可变全局基线选择证据。
 * 文件本身仍按生产者 Work Item 校验候选与人工决定链，消费者身份由调用方自己的场景证据门负责。
 */
export function loadGlobalVisualBaselineSelectionReference(reference, options = {}) {
  const settings = isRecord(options) ? options : {};
  // loader 默认保留 null 兼容；assert 路径打开 throwOnError 后保留第一条具体失败原因。
  const fail = (errors) => {
    const first = errors.find((error) => isNonEmptyString(error));
    if (settings.throwOnError && first) throw new Error(first);
    return null;
  };
  const shapeErrors = validateGlobalVisualBaselineSelectionReferenceShape(reference);
  if (shapeErrors.length) return fail(shapeErrors);
  const repo = settings.projectRoot ?? settings.repo;
  if (!isNonEmptyString(repo)) return fail(['全局视觉基线选择证据文件门缺少 projectRoot；必须完成 3 张候选图 + 人工确认']);
  const io = resolveIo(settings);
  const errors = [];
  const target = validateSourceFile(reference, repo, io, 'globalVisualBaselineSelectionRef', errors);
  if (!target) return fail(errors);
  const value = readJsonFile(target, io, 'globalVisualBaselineSelectionRef', errors);
  if (value === null) return fail(errors);
  // 可选引用身份若存在，只能复述根证据生产者；禁止把消费者 Work Item 冒充为根所有者。
  if (reference.workItemId !== undefined && reference.workItemId !== value.workItemId) errors.push('globalVisualBaselineSelectionRef.workItemId 必须与根证据生产者 Work Item 一致');
  errors.push(...validateGlobalVisualBaselineSelection(value, {
    label: '全局视觉基线选择证据',
    checkFiles: true,
    projectRoot: repo,
    io,
  }));
  if (errors.length) return fail(errors);
  return { value, file: reference.path };
}

/** 复核冻结 Work Item 的三候选人工选择证据，否则规划和执行门都必须失败。 */
export function assertGlobalVisualBaselineSelection(work, repo, io) {
  if (work?.globalStaticBaselineState !== GLOBAL_VISUAL_BASELINE_FROZEN_STATE) {
    throw new Error(`全局视觉基线尚未冻结；必须先完成 3 张候选图 + 人工确认，再写入 ${GLOBAL_VISUAL_BASELINE_FROZEN_STATE}`);
  }
  const reference = work?.globalVisualBaselineSelectionRef;
  const shapeErrors = validateGlobalVisualBaselineSelectionReferenceShape(reference);
  if (shapeErrors.length) throw new Error(`全局视觉基线选择证据门拒绝：${shapeErrors[0]}；必须完成 3 张候选图 + 人工确认`);
  const loaded = loadGlobalVisualBaselineSelectionReference(reference, { projectRoot: repo, io, throwOnError: true });
  if (!loaded) throw new Error('全局视觉基线选择证据门拒绝：三张候选图、唯一人工确认或冻结来源文件无效；必须完成 3 张候选图 + 人工确认后才能正式冻结');
  if (loaded.value.baseline?.status !== GLOBAL_VISUAL_BASELINE_FROZEN_STATE) throw new Error('全局视觉基线选择证据门拒绝：冻结身份状态无效；必须完成 3 张候选图 + 人工确认');
  return loaded.value;
}
