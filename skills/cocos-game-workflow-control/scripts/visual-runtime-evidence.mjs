import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { deriveVisualReturnStage, deriveVisualRootCause, isPlainObject, nonEmptyString, VISUAL_ROOT_CAUSES } from './visual-contract-core.mjs';

/** 把运行和生产证据格式化为可定位的视觉合同错误。 */
export function productionContractError(context = {}, message, details = {}) {
  const stage = context.stage ?? 'V2';
  const annotation = context.annotation_number ?? context.annotationNumber ?? '?';
  const region = context.region_id ?? context.regionId ?? '?';
  const expected = details.expectedMethod ?? context.expectedMethod ?? '?';
  const observed = details.observedMethod ?? context.observedMethod ?? '?';
  const missing = details.missing ?? context.missing ?? '';
  const component = details.component_id ?? details.componentId ?? context.component_id ?? context.componentId;
  const state = details.state_id ?? details.stateId ?? context.state_id ?? context.stateId;
  const componentLabel = component !== undefined || state !== undefined ? ` component_id=${component ?? '?'} state_id=${state ?? '?'}` : '';
  const suffix = missing ? ` 缺失=${missing}` : '';
  const returnStage = details.returnStage ?? context.returnStage ?? deriveVisualReturnStage(stage, { validationStages: ['F2', 'F3', 'V4'] });
  const rootCause = details.rootCause ?? context.rootCause ?? deriveVisualRootCause(stage, returnStage, { acceptanceStages: ['F2', 'F3', 'V4'], defaultRootCause: VISUAL_ROOT_CAUSES.ACCEPTANCE });
  return `[${stage}] annotation_number=${annotation} region_id=${region}${componentLabel} expected_method=${expected} observed_method=${observed} 根因=${rootCause}${suffix} ${message} 应退回阶段=${returnStage}`;
}

/** 解析项目内普通文件并拒绝绝对路径、父目录跳转和项目根自身。 */
export function safeProjectPath(projectRoot, value) {
  if (!nonEmptyString(value)) return null;
  const candidate = resolve(projectRoot, value);
  const rel = relative(resolve(projectRoot), candidate);
  if (!rel || rel === '.' || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) return null;
  return candidate;
}

/** 校验证据来源文件和可用的显式版本身份；摘要只作为可选记录。 */
export function validateEvidenceIdentity(evidence, context, identity = {}, options = {}) {
  const errors = [];
  const error = (message, missing = '') => errors.push(productionContractError(context, message, { missing }));
  if (!isPlainObject(evidence)) { error('运行时证据对象缺失', 'evidence'); return errors; }
  if (!nonEmptyString(evidence.evidence)) error('运行时证据缺少来源文件', 'evidence');
  if (options.projectRoot && nonEmptyString(evidence.evidence)) {
    const path = safeProjectPath(options.projectRoot, evidence.evidence);
    if (!path || !existsSync(path) || !statSync(path).isFile()) error(`证据文件不存在：${evidence.evidence}`, 'evidence');
  }
  // 有显式 ID 时仍核对归属；摘要字段缺失、格式错误或过期不改变验收结果。
  for (const [field, expected] of [['workItemId', identity.workItemId], ['candidateId', identity.candidateId], ['candidateVersion', identity.candidateVersion], ['sceneId', identity.sceneId], ['stateId', identity.stateId]]) {
    const observed = evidence[field] ?? evidence[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    if (nonEmptyString(expected) && nonEmptyString(observed) && observed !== expected) error(`证据 ${field} 与当前工作身份不一致`, field);
  }
  return errors;
}

/** 从当前视觉 manifest 提取可稳定识别的工作项和候选身份。 */
export function manifestEvidenceIdentity(manifest) {
  return {
    workItemId: manifest?.workItemId ?? manifest?.work_item_id,
    candidateId: manifest?.candidateId ?? manifest?.candidate_id ?? manifest?.candidate_identity?.candidate_id ?? manifest?.candidate_identity?.candidateId,
    candidateVersion: manifest?.candidateVersion ?? manifest?.candidate_version,
    sceneId: manifest?.scene_id ?? manifest?.sceneId,
    stateId: manifest?.state_id ?? manifest?.stateId,
  };
}

/** 只在 V4 要求图像生成资源提交真实运行消费证据并核验其身份。 */
export function validateImageGenerationRuntimeConsumption(asset, context, options = {}) {
  if (options.requireRuntimeConsumption !== true) return [];
  const evidence = asset?.runtime_consumption;
  if (!isPlainObject(evidence) || !['passed', 'consumed', 'pass'].includes(String(evidence.status).toLowerCase())) {
    return [productionContractError(context, '缺少带身份绑定的运行时实际消费 evidence', { missing: 'runtime_consumption' })];
  }
  return validateEvidenceIdentity(evidence, context, options.identity ?? {}, { projectRoot: options.projectRoot });
}
