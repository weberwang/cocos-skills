/**
 * Work Item 范围与副作用策略。
 *
 * 普通 A0-A3 操作直接使用 Work Item 范围；只有确定的外部、真机、发布或破坏性副作用
 * 才进入精确审批流程。将策略放在独立模块，避免控制 CLI 混入重复授权状态。
 */

/** 按确定性副作用规则判断动作是否需要显式批准。 */
export function requiresExplicitApproval(level, flags = {}) {
  // A4 只有在声明具体副作用（例如删除或外部写入）时才建立审批点；
  // 普通本地集成沿 Work Item 范围继续，避免仅因等级标签增加授权门。
  if (level === 'A5' || level === 'A6') return true;
  if (flags.external || flags.device || flags.release || flags.destructive) return true;
  return false;
}

/** 汇总 Work Item 与命令显式声明的副作用，避免预检和审计使用不同判定来源。 */
export function declaredOperationFlags(work = {}, args = {}) {
  const flag = (...keys) => keys.some((key) => args[key] === true);
  return {
    external: work.pendingApprovalExternalWrite === true || flag('external', 'external-write', 'externalWrite'),
    device: work.pendingApprovalPhysicalDevice === true || flag('device', 'physical-device', 'physicalDevice'),
    release: work.pendingApprovalRelease === true || flag('release'),
    destructive: work.pendingApprovalDestructive === true || flag('destructive'),
    allowDelete: work.pendingApprovalAllowDelete === true || flag('delete', 'allow-delete', 'allowDelete'),
  };
}

/** 读取命令本次实际声明的副作用；用于审批查询时拒绝省略已冻结的高风险声明。 */
export function requestedOperationFlags(args = {}) {
  const flag = (...keys) => keys.some((key) => args[key] === true);
  return {
    external: flag('external', 'external-write', 'externalWrite'),
    device: flag('device', 'physical-device', 'physicalDevice'),
    release: flag('release'),
    destructive: flag('destructive'),
    allowDelete: flag('delete', 'allow-delete', 'allowDelete'),
  };
}

/** 判断是否仍有必须由用户选择、但不属于操作审批的未决问题。 */
export function userInputRequired(work) {
  return work.substantiveTradeoffRequired === true || work.visualDecisionRequired === true;
}

/** 在执行受影响动作前阻断未决选择，要求回写 Work Item 或权威工件后继续。 */
export function requireResolvedUserInput(work, fail) {
  if (userInputRequired(work)) fail('USER_INPUT_REQUIRED：请先澄清用户选择，更新 Work Item 或权威工件并清除未决标志；不得写入 Approval Ledger');
}

/** 判断动作等级是否位于 Work Item 对应的自动或显式批准分区。 */
export function workAllowsLevel(work, level) {
  return ['A0', 'A1', 'A2', 'A3'].includes(level) ? work.allowedActionLevels.includes(level) : work.explicitApprovalActionLevels.includes(level);
}
