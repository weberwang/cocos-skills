/** 游戏美术 brief 的严格版本，描述项目目标与视觉刺激预算，不替代人工审美判断。 */
export const GAME_ART_BRIEF_SCHEMA = 'cocos-game-art-brief/1.0';

/** 候选图必须逐项人工评估的固定维度。 */
export const GLOBAL_VISUAL_CANDIDATE_CHECKS = Object.freeze([
  'themeFit',
  'audienceFit',
  'readability',
  'comfort',
  'craft',
]);

const GAME_ART_BRIEF_FIELDS = Object.freeze([
  'schemaVersion', 'workItemId', 'briefId', 'theme', 'audience', 'coreLoop',
  'experienceGoals', 'viewingContext', 'visualHierarchy', 'stimulusBudget',
]);
const STIMULUS_BUDGET_FIELDS = Object.freeze(['baseline', 'interaction', 'peak', 'measurementMethod']);
const STIMULUS_LAYER_FIELDS = Object.freeze([
  'brightnessContrast', 'screenCoverage', 'duration', 'triggerFrequency',
  'maxConcurrent', 'recovery', 'blendPolicy',
]);
const ASSESSMENT_FIELDS = Object.freeze(['candidateId', 'checks']);
const CHECK_FIELDS = Object.freeze(['status', 'reason']);
const CHECK_STATUSES = new Set(['passed', 'failed', 'unverified']);

/** 判断值是否为普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 判断字符串去除首尾空白后是否仍有实际内容。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 校验合同对象必须恰好包含指定字段，并返回其对象形状是否完整。 */
function validateExactObject(value, fields, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} 必须为对象`);
    return false;
  }
  const missing = fields.filter((field) => value[field] === undefined);
  const extra = Object.keys(value).filter((field) => !fields.includes(field));
  if (missing.length || extra.length) {
    errors.push(`${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  }
  return missing.length === 0 && extra.length === 0;
}

/** 校验刺激预算层的描述完整性；预算值由项目定义，不套用虚构的行业阈值。 */
function validateStimulusLayer(value, label, errors) {
  const shapeValid = validateExactObject(value, STIMULUS_LAYER_FIELDS, label, errors);
  if (!isRecord(value)) return;
  for (const field of STIMULUS_LAYER_FIELDS) {
    if (field === 'maxConcurrent') {
      if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`${label}.${field} 必须为非负整数`);
    } else if (!isNonEmptyString(value[field])) {
      errors.push(`${label}.${field} 必须为非空字符串`);
    }
  }
  return shapeValid;
}

/** 校验美术 brief 的合同形状、项目身份和观看情境，不评价其内容审美优劣。 */
export function validateGameArtBrief(value, options = {}) {
  const errors = [];
  const settings = isRecord(options) ? options : {};
  const label = settings.label ?? '游戏美术 brief';
  validateExactObject(value, GAME_ART_BRIEF_FIELDS, label, errors);
  if (!isRecord(value)) return [...new Set(errors)];

  if (value.schemaVersion !== GAME_ART_BRIEF_SCHEMA) errors.push(`${label}.schemaVersion 必须为 ${GAME_ART_BRIEF_SCHEMA}`);
  for (const field of ['workItemId', 'briefId', 'theme', 'audience', 'coreLoop', 'viewingContext', 'visualHierarchy']) {
    if (!isNonEmptyString(value[field])) errors.push(`${label}.${field} 必须为非空字符串`);
  }
  if (isNonEmptyString(settings.workItemId) && value.workItemId !== settings.workItemId) errors.push(`${label}.workItemId 必须与全局基线生产者一致`);
  if (isNonEmptyString(settings.briefId) && value.briefId !== settings.briefId) errors.push(`${label}.briefId 必须与全局基线 brief 引用一致`);

  if (!Array.isArray(value.experienceGoals) || value.experienceGoals.length === 0) {
    errors.push(`${label}.experienceGoals 必须为非空且不重复的字符串数组`);
  } else {
    const normalizedGoals = [];
    value.experienceGoals.forEach((goal, index) => {
      if (!isNonEmptyString(goal)) errors.push(`${label}.experienceGoals[${index}] 必须为非空字符串`);
      else normalizedGoals.push(goal.trim());
    });
    if (normalizedGoals.length !== new Set(normalizedGoals).size) errors.push(`${label}.experienceGoals 不得包含重复目标`);
  }

  const budget = value.stimulusBudget;
  validateExactObject(budget, STIMULUS_BUDGET_FIELDS, `${label}.stimulusBudget`, errors);
  if (isRecord(budget)) {
    for (const layer of ['baseline', 'interaction', 'peak']) validateStimulusLayer(budget[layer], `${label}.stimulusBudget.${layer}`, errors);
    if (!isNonEmptyString(budget.measurementMethod)) errors.push(`${label}.stimulusBudget.measurementMethod 必须为非空字符串`);
  }
  return [...new Set(errors)];
}

/** 校验候选评估完整绑定三张候选，并保证最终所选候选的五项均由人工判为通过。 */
export function validateGlobalVisualCandidateAssessments(assessments, candidateIds, selectedCandidateId, label = '候选人工评估') {
  const errors = [];
  if (!Array.isArray(assessments)) {
    errors.push(`${label} 必须完整包含三张候选图的人工评估`);
    return errors;
  }
  if (!Array.isArray(candidateIds) || assessments.length !== candidateIds.length) errors.push(`${label} 必须与三张候选按 candidateId 一一绑定`);

  const assessmentIds = [];
  const byCandidateId = new Map();
  assessments.forEach((assessment, index) => {
    const itemLabel = `${label}[${index}]`;
    validateExactObject(assessment, ASSESSMENT_FIELDS, itemLabel, errors);
    if (!isRecord(assessment)) return;
    if (!isNonEmptyString(assessment.candidateId)) errors.push(`${itemLabel}.candidateId 必须为非空字符串`);
    else {
      assessmentIds.push(assessment.candidateId);
      byCandidateId.set(assessment.candidateId, assessment);
    }

    const checks = assessment.checks;
    validateExactObject(checks, GLOBAL_VISUAL_CANDIDATE_CHECKS, `${itemLabel}.checks`, errors);
    if (!isRecord(checks)) return;
    for (const dimension of GLOBAL_VISUAL_CANDIDATE_CHECKS) {
      const checkLabel = `${itemLabel}.checks.${dimension}`;
      validateExactObject(checks[dimension], CHECK_FIELDS, checkLabel, errors);
      const check = checks[dimension];
      if (!isRecord(check)) continue;
      if (!CHECK_STATUSES.has(check.status)) errors.push(`${checkLabel}.status 必须为 passed、failed 或 unverified`);
      if (!isNonEmptyString(check.reason)) errors.push(`${checkLabel}.reason 必须为非空人工理由`);
      if (assessment.candidateId === selectedCandidateId && check.status !== 'passed') {
        errors.push(`${checkLabel}.status：所选候选的全部维度必须为 passed 才能冻结`);
      }
    }
  });

  if (assessmentIds.length !== new Set(assessmentIds).size) errors.push(`${label}.candidateId 不得重复`);
  if (Array.isArray(candidateIds)) {
    const expectedIds = new Set(candidateIds);
    for (const candidateId of candidateIds) if (!byCandidateId.has(candidateId)) errors.push(`${label} 缺少候选 ${candidateId} 的评估`);
    for (const candidateId of assessmentIds) if (!expectedIds.has(candidateId)) errors.push(`${label} 包含未知候选 ${candidateId}`);
  }

  // 所选候选全通过是冻结前提；即使其他候选不合格，也允许用户选择合格项继续。
  const selected = byCandidateId.get(selectedCandidateId);
  if (selected && isRecord(selected.checks) && GLOBAL_VISUAL_CANDIDATE_CHECKS.every((dimension) => selected.checks[dimension]?.status === 'passed')) {
    return [...new Set(errors)];
  }
  if (selectedCandidateId && byCandidateId.has(selectedCandidateId) && !errors.some((error) => error.includes('所选候选的全部维度'))) {
    errors.push(`${label}：所选候选未通过全部美术质量维度，不能冻结`);
  }
  return [...new Set(errors)];
}

/** 按候选 ID 和五个固定维度比较评估语义，忽略 JSON 对象键序与数组排列。 */
export function areGlobalVisualCandidateAssessmentsEquivalent(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  // 建立候选 ID 索引以比较两份决定副本，避免数组顺序影响人工评估的一致性。
  const toMap = (items) => {
    const map = new Map();
    for (const item of items) {
      if (!isRecord(item) || !isNonEmptyString(item.candidateId) || map.has(item.candidateId)) return null;
      map.set(item.candidateId, item);
    }
    return map;
  };
  const leftById = toMap(left);
  const rightById = toMap(right);
  if (!leftById || !rightById || leftById.size !== rightById.size) return false;
  for (const [candidateId, leftItem] of leftById) {
    const rightItem = rightById.get(candidateId);
    if (!rightItem || !isRecord(leftItem.checks) || !isRecord(rightItem.checks)) return false;
    for (const dimension of GLOBAL_VISUAL_CANDIDATE_CHECKS) {
      const leftCheck = leftItem.checks[dimension];
      const rightCheck = rightItem.checks[dimension];
      if (!isRecord(leftCheck) || !isRecord(rightCheck)) return false;
      if (leftCheck.status !== rightCheck.status || leftCheck.reason !== rightCheck.reason) return false;
    }
  }
  return true;
}
