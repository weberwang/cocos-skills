const DEFAULT_DISPOSITION = 'repair';

/** 按固定顺序创建控制面稳定结果字段，避免不同命令输出漂移。 */
export function resultRecord({ status = 'READY', stage = 'unknown', changed = [], blocking = [], next = '', metadata = {} } = {}) {
  const record = {
    status: String(status),
    stage: String(stage ?? 'unknown'),
    changed: normalizeList(changed),
    blocking: normalizeList(blocking),
    next: String(next ?? ''),
  };
  const normalizedMetadata = normalizeMetadata(metadata);
  if (Object.keys(normalizedMetadata).length) record.metadata = normalizedMetadata;
  return record;
}

/** 规范化列表并去除重复项，保证相同输入产生相同文本与 JSON。 */
function normalizeList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

/** 递归规范化元数据，保留数组顺序但固定对象键顺序。 */
function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeMetadataValue(value[key])]));
}

/** 规范化元数据值，防止诊断对象把不可稳定字段带入默认输出。 */
function normalizeMetadataValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeMetadataValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeMetadataValue(value[key])]));
  return value;
}

/** 输出稳定 JSON；--json 是自动化入口，始终只输出单个对象和换行。 */
export function writeResult(record, options = {}) {
  if (options.json === true || options.json === 'true') {
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  process.stdout.write(renderResult(record));
}

/** 将稳定结果压缩为不超过约二十行的中文摘要。 */
export function renderResult(record) {
  const workflowView = record.metadata?.workflowView;
  const phaseText = workflowView?.phaseLabel
    ? workflowView.sceneStepLabel ? `${workflowView.phaseLabel} · ${workflowView.sceneStepLabel}` : workflowView.phaseLabel
    : record.stage;
  const lines = [`状态：${record.status}`, `阶段：${phaseText}`];
  // unknown 不能伪装成正常阶段；默认文本补充内部标识，方便继续诊断。
  if (workflowView?.phaseId === 'unknown' && record.stage && record.stage !== 'unknown') lines.push(`内部阶段：${record.stage}`);
  if (record.changed.length) lines.push(`变化：${record.changed.join('；')}`);
  if (record.blocking.length) lines.push(`阻断：${record.blocking[0]}`);
  const disposition = record.metadata?.disposition;
  if (disposition) lines.push(`处置：${disposition}`);
  if (record.next) lines.push(`下一步：${record.next}`);
  const fingerprint = record.metadata?.planFingerprint;
  if (fingerprint) lines.push(`计划指纹：${shortFingerprint(fingerprint)}`);
  return `${lines.join('\n')}\n`;
}

/** 将完整指纹压缩为默认文本中的短标识，JSON 仍保留全值。 */
function shortFingerprint(value) {
  const text = String(value);
  return text.length > 19 ? `${text.slice(0, 19)}…` : text;
}

/** 把门禁异常转换为统一的唯一根因、处置和下一动作结果。 */
export function failureRecord(error, stage = 'unknown') {
  const details = error?.result ? error.result : error?.details;
  const primary = details?.errors?.[0] ?? details;
  const disposition = details?.disposition ?? primary?.disposition ?? error?.disposition ?? DEFAULT_DISPOSITION;
  const message = primary?.message ?? error?.message ?? '控制面检查失败';
  const next = details?.nextAction ?? primary?.nextAction ?? remediationNextAction(disposition);
  const metadata = { disposition };
  const errorCode = details?.errorCode ?? primary?.errorCode ?? error?.errorCode;
  if (errorCode) metadata.errorCode = errorCode;
  return resultRecord({ status: 'BLOCKED', stage, blocking: [message], next, metadata });
}

/** 为结构化门禁失败提供一致的处置建议。 */
function remediationNextAction(disposition) {
  if (disposition === 'revalidate') return '保持当前候选身份不变，重新验证当前门';
  if (disposition === 'return') return '按最小受影响范围回到最早失效阶段';
  return '原地修复当前根因后重新运行 check';
}
