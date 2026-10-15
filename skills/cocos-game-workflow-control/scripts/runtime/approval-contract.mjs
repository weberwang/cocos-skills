/** 审批快照字段映射；它是 Work Item pending 与 Ledger 历史之间唯一投影。 */
const SNAPSHOT_FIELDS = Object.freeze([
  ['promptContextId', 'pendingApprovalId'], ['pendingState', 'pendingApprovalState'], ['pendingContext', 'pendingApprovalContext'],
  ['workItemId', 'workItemId'], ['explicitObject', 'pendingApprovalObject'], ['stageId', 'pendingApprovalStage'],
  ['moduleIds', 'moduleIds'], ['baselineVersion', 'baselineVersion'],
  ['actionType', 'pendingApprovalActionType'], ['actionLevel', 'pendingApprovalActionLevel'], ['impactSummary', 'pendingApprovalImpactSummary'],
  ['fileScope', 'pendingApprovalFileScope'], ['services', 'pendingApprovalServices'], ['externalTargets', 'pendingApprovalExternalTargets'],
  ['allowServiceStart', 'pendingApprovalAllowServiceStart'], ['allowDelete', 'pendingApprovalAllowDelete'],
  ['externalWrite', 'pendingApprovalExternalWrite'], ['destructive', 'pendingApprovalDestructive'],
  ['physicalDevice', 'pendingApprovalPhysicalDevice'], ['release', 'pendingApprovalRelease'], ['gate', 'pendingApprovalGate'],
]);

/** 从当前 Work Item 生成不可变审批投影；外部目标缺失时统一视为空数组。 */
export function approvalSnapshotFromWork(work) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(([approvalField, workField]) => [approvalField, cloneSnapshotValue(work?.[workField], approvalField === 'externalTargets' ? [] : undefined)]));
}

/** 从 Ledger 记录提取与 pending 对比所需的规范投影。 */
function approvalProjection(approval) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(([approvalField]) => [approvalField, cloneSnapshotValue(approval?.[approvalField], approvalField === 'externalTargets' ? [] : undefined)]));
}

/** 判断审批是否精确绑定当前 pending 与当前 Work Item 快照。 */
export function approvalMatchesPending(approval, work) {
  if (!approval || !work || approval.legacyReadOnly || approval.invalidatedAt) return false;
  const expected = approvalSnapshotFromWork(work);
  const actual = approvalProjection(approval);
  return Object.keys(expected).every((field) => sameValue(actual[field], expected[field]))
    && approval.gate === work.nextGate;
}

/**
 * 在 pending 精确绑定之上匹配一次动作查询。
 * paths/targets 和布尔副作用均采用精确约束，防止省略参数消费更宽的审批。
 */
export function approvalMatchesQuery(approval, work, options = {}, pathMatches = () => false) {
  if (!approvalMatchesPending(approval, work)) return false;
  if (options.gate !== undefined && approval.gate !== options.gate) return false;
  if (options.object !== undefined && approval.explicitObject !== options.object) return false;
  if (options.level !== undefined && approval.actionLevel !== options.level) return false;
  if (options.approvalId && approval.approvalId !== options.approvalId) return false;
  if (options.actionType && approval.actionType !== options.actionType) return false;
  for (const [option, field] of [['external', 'externalWrite'], ['device', 'physicalDevice'], ['release', 'release'], ['destructive', 'destructive'], ['allowDelete', 'allowDelete'], ['serviceStart', 'allowServiceStart']]) if (options[option] !== undefined && approval[field] !== options[option]) return false;
  if (options.serviceStart && !approval.services.includes(options.serviceType)) return false;
  if (options.paths?.some((path) => !approval.fileScope.some((pattern) => pathMatches(path, pattern)))) return false;
  if (options.targets?.some((target) => !approval.externalTargets.includes(target))) return false;
  return true;
}

/** 深拷贝快照值，避免调用方修改投影后影响后续审批匹配。 */
function cloneSnapshotValue(value, fallback) {
  const source = value === undefined && fallback !== undefined ? fallback : value;
  return Array.isArray(source) ? [...source] : source;
}

/** 对数组和原始快照值做严格比较；审批历史不允许隐式排序或类型转换。 */
function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
