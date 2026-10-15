/**
 * 校验动作等级、工作项状态和副作用声明之间的约束。
 * 该函数不读取或写入文件，调用方通过 fail 注入统一的控制面异常。
 */
export function validateActionState(work, level, flags, fail) {
  if (['BLOCKED', 'COMPLETE', 'RETURN'].includes(work.globalState) && level !== 'A0') fail(`${work.globalState} 状态禁止动作`);
  if (level === 'A1' && !['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW'].includes(work.globalState)) fail('A1 仅用于 Work Item 范围内的文档和候选阶段');
  if (level === 'A2' && !['REVIEW', 'IMPLEMENTING'].includes(work.globalState)) fail('A2 仅用于 Work Item 范围内的隔离原型沙盒阶段');
  if (level === 'A3' && work.globalState !== 'IMPLEMENTING') fail('A3 生产实现只能在 IMPLEMENTING');
  if (level === 'A4' && work.globalState !== 'INTEGRATING') fail('A4 集成与迁移只能在 INTEGRATING');
  if (level === 'A5' && !flags.external) fail('A5 必须是具有精确外部目标的外部状态操作');
  if (level === 'A6' && !(flags.external || flags.device || flags.destructive || flags.release || flags.allowDelete)) fail('A6 必须声明真机、破坏、发布、删除或外部写入副作用');
  if (flags.external && !['A5', 'A6'].includes(level)) fail('外部状态写入至少为 A5');
  if ((flags.device || flags.release) && level !== 'A6') fail('真机或发布动作必须为 A6');
  if (flags.destructive && !['A4', 'A6'].includes(level)) fail('破坏性动作必须为 A4/A6');
  if (flags.allowDelete && !['A4', 'A6'].includes(level)) fail('删除旧实现只允许 A4/A6');
}

/**
 * 校验当前工作项关联的 Change Request；已接受的请求必须推动新基线并使旧审批失效。
 * 变更请求本身不是审批记录，只在需要读取审批账本时检查其失效绑定。
 */
export function validateChangeRequests(work, repo, level, ledger, pkg, deps, fail) {
  if (!['A3', 'A4'].includes(level)) return;
  const relevantModules = new Set([...work.moduleIds, ...(pkg?.executionUnits.map((unit) => unit.moduleId) ?? [])]);
  for (const path of work.changeRequestFiles) {
    const change = deps.validateChangeRequest(deps.readJson(deps.resolve(repo, path), 'Change Request'), work);
    if (!change.affectedModules.some((moduleId) => relevantModules.has(moduleId))) continue;
    if (change.status !== 'ACCEPTED') fail(`Change Request ${change.changeRequestId} 尚未形成 ACCEPTED 用户决定`);
    if (ledger && (!change.invalidatedApprovalIds.length || change.invalidatedApprovalIds.some((id) => !ledger.approvals.some((approval) => approval.approvalId === id && approval.invalidatedAt)))) {
      fail(`Change Request ${change.changeRequestId} 未使旧审批失效`);
    }
  }
}
