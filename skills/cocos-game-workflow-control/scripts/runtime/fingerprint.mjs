import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

// 仅忽略审计记录的明确时间字段，避免把 releaseDate、timeoutTime 等业务身份删掉。
const VOLATILE_KEY = /^(?:created|updated|authorized|approved|recorded|prepared|presented|completed|generated|resolved|started|finished|reviewed)(?:At|_at)$|^timestamp$/;
const PACKAGE_INPUT_FILE_FIELDS = new Set([
  'evidenceFile', 'source_manifest_file', 'compatibility_evidence_file', 'proposal_file',
  'annotation_file', 'decision_record_file', 'user_decision_receipt_file', 'ledger_file',
  'original_file', 'baseline_document',
]);
const PACKAGE_INPUT_LIST_FIELDS = new Set(['reference_inputs', 'style_reference_inputs', 'actual_reference_inputs']);

/** 递归规范化对象并排除时间字段；时间戳不得影响计划身份。 */
export function stableValue(value, key = '') {
  if (VOLATILE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((childKey) => {
    const child = stableValue(value[childKey], childKey);
    return child === undefined ? [] : [[childKey, child]];
  }));
}

/** 生成确定性 JSON 文本，所有对象键按字典序排列。 */
export function stableSerialize(value) {
  return JSON.stringify(stableValue(value));
}

/** 计算字节内容的 SHA-256。 */
export function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** 计算文件字节 SHA-256，供计划输入快照和控制面复核共用。 */
export function fileHash(path) {
  return hashBytes(readFileSync(path));
}

/** 计算文本 SHA-256，供执行状态和计划身份绑定使用。 */
export function hashText(value) {
  return hashBytes(value);
}

/** 计算无 Git diff 工件集合的追踪摘要；该值不参与验收放行。 */
export function artifactFingerprint(artifacts) {
  const hash = createHash('sha256');
  for (const item of [...artifacts].sort((a, b) => a.file.localeCompare(b.file))) hash.update(`${item.file}\0${item.hash}\n`);
  return `sha256:${hash.digest('hex')}`;
}

/** 规范化仓库内路径；仓库外路径不进入输入快照。 */
function relativePath(repo, path) {
  const candidate = relative(repo, resolve(repo, String(path))).split(sep).join('/');
  if (!candidate || candidate === '..' || candidate.startsWith('../')) return null;
  return candidate;
}

/** 收集单个显式文件，跳过会随运行环境变化的目录；范围目录不展开扫描。 */
function collectFiles(repo, path, output) {
  const absolute = resolve(repo, path);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isFile()) {
    const normalized = relativePath(repo, path);
    if (normalized) output.add(normalized);
    return;
  }
  // allowedPaths/fileOwnership 等范围声明不是输入；即使误传目录，也不得递归触发大量 I/O。
  if (stat.isDirectory()) return;
}

/** 递归提取实施包中真正作为绑定依据的文件字段，不采集输出路径或所有权范围。 */
function collectPackageInputFiles(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPackageInputFiles(item, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (PACKAGE_INPUT_FILE_FIELDS.has(key) && typeof child === 'string') output.push(child);
    if (PACKAGE_INPUT_LIST_FIELDS.has(key)) {
      if (Array.isArray(child)) child.forEach((item) => {
        if (typeof item === 'string') output.push(item);
        else if (item && typeof item === 'object' && typeof item.path === 'string') output.push(item.path);
      });
      continue;
    }
    collectPackageInputFiles(child, output);
  }
  return output;
}

/** 解析工作项和实施包声明的关键输入文件，并为缺失输入保留稳定标记。 */
export function collectPlanInputs(repo, work, implementationPackage = null, extraPaths = []) {
  const declared = [
    ...extraPaths,
    ...(work?.visualConfirmationPrerequisiteFiles ?? []),
    ...(work?.changeRequestFiles ?? []),
    ...(implementationPackage?.visualManifestFile ? [implementationPackage.visualManifestFile] : []),
    ...collectPackageInputFiles(implementationPackage),
  ];
  const paths = new Set();
  const missing = new Set();
  for (const declaredPath of declared) {
    const normalized = relativePath(repo, declaredPath);
    if (!normalized || normalized.includes('*') || normalized.includes('?')) {
      if (normalized) missing.add(normalized);
      continue;
    }
    if (!existsSync(resolve(repo, normalized))) {
      missing.add(normalized);
      continue;
    }
    collectFiles(repo, normalized, paths);
  }
  return [
    ...[...paths].sort().map((path) => ({ path, sha256: fileHash(resolve(repo, path)) })),
    ...[...missing].sort().map((path) => ({ path, sha256: 'MISSING' })),
  ];
}

/** 根据基线、工作项范围、当前状态、实施包和关键输入计算稳定计划指纹。 */
export function computePlanFingerprint({ work, implementationPackage = null, repo = process.cwd(), extraPaths = [] } = {}) {
  const payload = {
    contract: 'workflow-plan/1',
    baseline: {
      id: work?.baselineId ?? null,
      version: work?.baselineVersion ?? null,
      hash: work?.baselineHash ?? null,
    },
    // 范围直接属于 Work Item；计划指纹不再依赖可变的独立授权凭据。
    workScope: {
      workItemId: work?.workItemId ?? null,
      projectId: work?.projectId ?? null,
      moduleIds: work?.moduleIds ?? [],
      domain: work?.domain ?? null,
      stageId: work?.stageId ?? null,
      objective: work?.objective ?? null,
      inScope: work?.inScope ?? [],
      outOfScope: work?.outOfScope ?? [],
      approvedRequirements: work?.approvedRequirements ?? [],
      allowedActions: work?.allowedActions ?? [],
      allowedActionLevels: work?.allowedActionLevels ?? [],
      explicitApprovalActionLevels: work?.explicitApprovalActionLevels ?? [],
      prohibitedActions: work?.prohibitedActions ?? [],
      allowedPaths: work?.allowedPaths ?? [],
      forbiddenPaths: work?.forbiddenPaths ?? [],
      allowedExternalTargets: work?.allowedExternalTargets ?? [],
      protectedExternalTargets: work?.protectedExternalTargets ?? [],
      requiredGates: work?.requiredGates ?? [],
      visualConfirmationPrerequisiteFiles: work?.visualConfirmationPrerequisiteFiles ?? [],
      changeRequestFiles: work?.changeRequestFiles ?? [],
    },
    currentState: work?.globalState ?? null,
    stage: work?.stageId ?? null,
    implementationPackage: implementationPackage ?? null,
    keyInputFiles: collectPlanInputs(resolve(repo), work, implementationPackage, extraPaths),
  };
  return hashText(stableSerialize(payload));
}
