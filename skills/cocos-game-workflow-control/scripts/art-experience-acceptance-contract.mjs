import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { GLOBAL_VISUAL_CANDIDATE_CHECKS } from './global-visual-art-quality-contract.mjs';
import { isPlainObject, nonEmptyString } from './visual-contract-core.mjs';

/** V4 持续游玩美术体验验收合同版本。 */
export const ART_EXPERIENCE_ACCEPTANCE_SCHEMA = 'cocos-art-experience-acceptance/1.0';

/** 完整运行体验验收必须覆盖的四类情境。 */
export const ART_EXPERIENCE_SCENARIOS = Object.freeze([
  'normal-play',
  'repeated-feedback',
  'event-peak',
  'overlap-peak',
]);

const CHECK_STATUSES = new Set(['passed', 'failed', 'unverified']);
const ACCEPTANCE_FIELDS = Object.freeze([
  'schemaVersion', 'workItemId', 'candidateId', 'sceneId', 'status',
  'confirmedAt', 'userOriginalText', 'viewingContext', 'checks', 'scenarios',
]);
const CHECK_FIELDS = Object.freeze(['status', 'reason']);
const SCENARIO_FIELDS = Object.freeze([
  'kind', 'applicability', 'reason', 'recordingFile', 'startSeconds', 'endSeconds',
  'triggerCount', 'peakConcurrent', 'observation',
]);

/** 判断普通文件路径是否位于项目根目录之内。 */
function isWithinProject(root, target) {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../') && !isAbsolute(path);
}

/** 验证录屏为仓库内可读的普通文件，不解码或推断其中的视觉内容。 */
function hasReadableProjectRecording(file, projectRoot) {
  if (!nonEmptyString(file) || !nonEmptyString(projectRoot) || file.includes('\0')) return false;
  const normalizedFile = file.trim().replaceAll('\\', '/');
  if (isAbsolute(normalizedFile) || normalizedFile.startsWith('//') || /^[a-z]:\//i.test(normalizedFile)) return false;
  let descriptor = null;
  try {
    const root = realpathSync(resolve(projectRoot));
    const candidate = resolve(root, normalizedFile);
    if (!isWithinProject(root, candidate)) return false;
    const actual = realpathSync(candidate);
    if (!isWithinProject(root, actual) || !statSync(actual).isFile()) return false;
    descriptor = openSync(actual, 'r');
    const fileInfo = fstatSync(descriptor);
    if (!fileInfo.isFile() || fileInfo.size <= 0) return false;
    // 只读取一个字节证明文件可读，避免把长录屏整体载入内存或分析画面。
    return readSync(descriptor, Buffer.alloc(1), 0, 1, 0) === 1;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* 已打开文件的关闭失败不改变校验结论。 */ }
    }
  }
}

/** 验证时间戳是带时区的 RFC 3339 日期时间。 */
function isValidTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0); const offsetMinute = Number(offsetMinuteText ?? 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

/** 比较对象是否恰好包含合同要求的字段，防止未知字段混入验收语义。 */
function hasExactFields(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.hasOwn(value, field))
    && Object.keys(value).every((field) => allowed.has(field));
}

/** 验证单项人工判断，只有明确通过并给出实际理由才算完成。 */
function validateCheck(check, label, errors) {
  if (!hasExactFields(check, CHECK_FIELDS)) {
    errors.push(`${label} 字段必须恰好包含 status、reason`);
    return false;
  }
  let passed = true;
  if (!CHECK_STATUSES.has(check.status)) {
    errors.push(`${label}.status 必须为 passed、failed 或 unverified`);
    passed = false;
  } else if (check.status !== 'passed') {
    errors.push(`${label}.status=${check.status}，美术体验验收未通过`);
    passed = false;
  }
  if (!nonEmptyString(check.reason)) {
    errors.push(`${label}.reason 必须记录人工判断依据`);
    passed = false;
  }
  return passed;
}

/** 校验 required 场景录屏和人工观察，或 not-applicable 的明确豁免声明。 */
function validateScenario(scenario, index, projectRoot, errors) {
  const label = `scenarios[${index}]`;
  if (!hasExactFields(scenario, SCENARIO_FIELDS)) {
    errors.push(`${label} 字段不完整或包含未知字段`);
    return;
  }
  if (!ART_EXPERIENCE_SCENARIOS.includes(scenario.kind)) errors.push(`${label}.kind 不是受支持的情境`);
  if (!['required', 'not-applicable'].includes(scenario.applicability)) {
    errors.push(`${label}.applicability 必须为 required 或 not-applicable`);
    return;
  }
  if (!nonEmptyString(scenario.reason)) errors.push(`${label}.reason 必须说明适用性判断`);
  if (scenario.applicability === 'not-applicable') {
    const unusedFields = ['recordingFile', 'startSeconds', 'endSeconds', 'triggerCount', 'peakConcurrent'];
    if (unusedFields.some((field) => scenario[field] !== null) || scenario.observation !== null) {
      errors.push(`${label} 不适用时录屏、时段、计数和 observation 必须为 null，不能声明已查看`);
    }
    return;
  }
  if (!nonEmptyString(scenario.recordingFile) || !hasReadableProjectRecording(scenario.recordingFile, projectRoot)) {
    errors.push(`${label}.recordingFile 必须指向仓库内可读的非空普通文件`);
  }
  if (!Number.isFinite(scenario.startSeconds) || scenario.startSeconds < 0
    || !Number.isFinite(scenario.endSeconds) || scenario.endSeconds <= scenario.startSeconds) {
    errors.push(`${label} 必须提供有效的 0 <= startSeconds < endSeconds`);
  }
  for (const field of ['triggerCount', 'peakConcurrent']) {
    if (!Number.isInteger(scenario[field]) || scenario[field] < 0) errors.push(`${label}.${field} 必须为非负整数`);
  }
  if (!nonEmptyString(scenario.observation)) errors.push(`${label}.observation 必须记录实际人工观看意见`);
}

/** 校验完整人工验收对象与当前 V4 运行候选身份及项目录屏资源。 */
export function validateArtExperienceAcceptance(acceptance, expected, options = {}) {
  const errors = [];
  if (!hasExactFields(acceptance, ACCEPTANCE_FIELDS)) {
    errors.push('对象字段不完整或包含未知字段');
    return errors;
  }
  if (acceptance.schemaVersion !== ART_EXPERIENCE_ACCEPTANCE_SCHEMA) errors.push(`schemaVersion 必须为 ${ART_EXPERIENCE_ACCEPTANCE_SCHEMA}`);
  for (const field of ['workItemId', 'candidateId', 'sceneId']) {
    if (!nonEmptyString(expected[field]) || acceptance[field] !== expected[field]) errors.push(`${field} 未绑定当前 V4 候选/场景`);
  }
  if (!['passed', 'failed', 'unverified'].includes(acceptance.status)) errors.push('status 必须为 passed、failed 或 unverified');
  else if (acceptance.status !== 'passed') errors.push(`status=${acceptance.status}，V4 人工验收未通过`);
  if (!isValidTimestamp(acceptance.confirmedAt)) errors.push('confirmedAt 必须是有效且带时区的 RFC 3339 时间');
  if (!nonEmptyString(acceptance.userOriginalText)) errors.push('userOriginalText 必须保留用户原始验收意见');
  if (!nonEmptyString(acceptance.viewingContext)) errors.push('viewingContext 必须记录实际项目游玩情境');

  const checks = acceptance.checks;
  if (!hasExactFields(checks, GLOBAL_VISUAL_CANDIDATE_CHECKS)) {
    errors.push(`checks 必须恰好覆盖 ${GLOBAL_VISUAL_CANDIDATE_CHECKS.join('、')}`);
  } else {
    for (const dimension of GLOBAL_VISUAL_CANDIDATE_CHECKS) validateCheck(checks[dimension], `checks.${dimension}`, errors);
  }

  if (!Array.isArray(acceptance.scenarios) || acceptance.scenarios.length !== ART_EXPERIENCE_SCENARIOS.length) {
    errors.push(`scenarios 必须恰好覆盖 ${ART_EXPERIENCE_SCENARIOS.join('、')}`);
  } else {
    const kinds = new Set();
    acceptance.scenarios.forEach((scenario, index) => {
      if (isPlainObject(scenario) && typeof scenario.kind === 'string') {
        if (kinds.has(scenario.kind)) errors.push(`scenarios.kind 重复：${scenario.kind}`);
        kinds.add(scenario.kind);
      }
      validateScenario(scenario, index, options.projectRoot, errors);
    });
    for (const kind of ART_EXPERIENCE_SCENARIOS) if (!kinds.has(kind)) errors.push(`scenarios 缺少 ${kind}`);
    const normalPlay = acceptance.scenarios.find((item) => isPlainObject(item) && item.kind === 'normal-play');
    if (normalPlay?.applicability !== 'required') errors.push('normal-play 必须标记为 required');
  }
  return errors;
}
