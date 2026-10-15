import { closeSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { assertFormalExecutionAfterV3, assertHighFidelityPrerequisite, assertHighFidelityPrerequisites } from './high-fidelity-prerequisite.mjs';
import { loadImmutableVisualStageReference, validateVisualStagePrerequisites } from './visual-stage-prerequisites.mjs';
import { writeJson } from './runtime/io.mjs';
import { schemaEnum, schemaFields, schemaNode, schemaRequired } from './runtime/schema-contract.mjs';

const RESULT_FIELDS = schemaFields('execution-unit-result.schema.json');
const RESULT_REQUIRED_FIELDS = schemaRequired('execution-unit-result.schema.json');
const EXECUTION_STATE_FIELDS = schemaFields('execution-state.schema.json');
const EXECUTION_STATE_REQUIRED_FIELDS = schemaRequired('execution-state.schema.json');
const EXECUTION_UNIT_STATE_FIELDS = schemaFields('execution-state.schema.json', ['$defs', 'unitState']);
const EXECUTION_UNIT_STATE_REQUIRED_FIELDS = schemaRequired('execution-state.schema.json', ['$defs', 'unitState']);
const NEXT_TASK_FIELDS = schemaFields('execution-state.schema.json', ['$defs', 'nextTask']);
const LAST_TRANSITION_FIELDS = schemaFields('execution-state.schema.json', ['$defs', 'lastTransition']);
const EXECUTION_STATE_SCHEMA = schemaNode('execution-state.schema.json', ['properties', 'schemaVersion']).const;
const UNIT_STATES = new Set(schemaEnum('execution-state.schema.json', ['$defs', 'unitState', 'properties', 'state']));
const WORKFLOW_STATES = new Set(schemaEnum('execution-state.schema.json', ['properties', 'workflowState']));
const NEXT_TASK_KINDS = new Set(schemaEnum('execution-state.schema.json', ['$defs', 'nextTask', 'properties', 'kind']));
const NEXT_TASK_STATES = new Set(schemaEnum('execution-state.schema.json', ['$defs', 'nextTask', 'properties', 'state']));
const NEXT_TASK_GATE_STATUSES = new Set(schemaEnum('execution-state.schema.json', ['$defs', 'nextTask', 'properties', 'gateStatus']));
const LAST_TRANSITION_TYPES = new Set(schemaEnum('execution-state.schema.json', ['$defs', 'lastTransition', 'properties', 'type']));
const EXECUTION_STATE_LOCK_TIMEOUT_MS = 15_000;
const EXECUTION_STATE_LOCK_STALE_MS = 30_000;
const HELD_EXECUTION_STATE_LOCKS = new Set();

// process.exit 仍会执行 exit 监听器，兜底清理本进程持有的锁，避免失败路径遗留锁文件。
process.on('exit', () => {
  for (const lockPath of HELD_EXECUTION_STATE_LOCKS) {
    try { unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') { /* 退出阶段不能再抛出新错误。 */ } }
  }
});

/** 返回对象稳定 JSON，用于可复算指纹。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 计算指定实施单元路径内的当前 Git diff 指纹。 */
export function scopedDiffFingerprint(repo, baseline, ownedPaths, io) {
  const diff = io.git(repo, ['diff', '--binary', baseline, '--', ...ownedPaths]);
  const untracked = io.git(repo, ['ls-files', '--others', '--exclude-standard', '--', ...ownedPaths]).split(/\r?\n/).filter(Boolean).sort();
  const untrackedHashes = Object.fromEntries(untracked.map((path) => [path.replaceAll('\\', '/'), io.fileHash(io.resolve(repo, path))]));
  return io.hashText(stableJson({ diff, untrackedHashes }));
}

/** 校验 Unit Result 结构和当前候选绑定，失败时抛出可读错误。 */
export function validateUnitResult(result, resultPath, work, pkg, unit, repo, io) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Execution Unit Result 必须为对象');
  const keys = Object.keys(result);
  const missing = RESULT_REQUIRED_FIELDS.filter((field) => result[field] === undefined);
  const extra = keys.filter((field) => !RESULT_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Execution Unit Result 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!result.resultId || result.workItemId !== work.workItemId || result.packageId !== pkg.packageId || result.unitId !== unit.unitId) throw new Error(`Execution Unit Result 未绑定当前工作项、实施包或单元：${unit.unitId}`);
  if (result.verdict !== 'PASS') throw new Error(`Execution Unit Result 只有 PASS 可满足预设顺序前序门：${unit.unitId}`);
  if (Number.isNaN(Date.parse(result.completedAt))) throw new Error(`Execution Unit Result.completedAt 无效：${unit.unitId}`);
  const relativeResult = io.normalizeRepoPath(repo, resultPath);
  const unitRoot = `${work.evidenceRoot.replace(/\/$/, '')}/units`;
  if (!(relativeResult === unitRoot || relativeResult.startsWith(`${unitRoot}/`))) throw new Error('Execution Unit Result 必须位于 evidenceRoot/units');
  if (!Array.isArray(result.commands) || !result.commands.length || !Array.isArray(result.files) || !result.files.length || new Set(result.files).size !== result.files.length) throw new Error('Execution Unit Result 命令与证据文件不能为空且 files 不得重复');
  const actualCommands = result.commands.map((item) => item.command).sort();
  if (JSON.stringify(actualCommands) !== JSON.stringify([...unit.acceptanceCommands].sort())) throw new Error(`Execution Unit Result 验收命令与单元不一致：${unit.unitId}`);
  for (const command of result.commands) {
    if (!command || Object.keys(command).some((key) => !['command', 'exitCode', 'outputFile', 'outputHash'].includes(key)) || command.exitCode !== 0 || !command.outputFile) throw new Error(`Execution Unit Result 命令失败或字段无效：${unit.unitId}`);
    if (!result.files.includes(command.outputFile)) throw new Error(`Execution Unit Result 命令输出未列入证据文件：${unit.unitId}`);
  }
  for (const file of result.files) {
    const normalized = io.normalizeRepoPath(repo, file);
    if (!(normalized === work.evidenceRoot || normalized.startsWith(`${work.evidenceRoot.replace(/\/$/, '')}/`))) throw new Error(`Execution Unit Result 证据越出 evidenceRoot：${file}`);
    const target = io.resolve(repo, normalized);
    if (!io.existsSync(target)) throw new Error(`Execution Unit Result 证据文件不存在：${file}`);
    // 摘要只作记录；当前结果仍须引用 evidenceRoot 内真实可读取的文件。
    io.readFileSync(target);
  }
  return result;
}

/** 按 executionUnits 的预设位置计算目标单元需要等待的前序单元。 */
function precedingUnitsForReady(unit, pkg) {
  const units = pkg.executionUnits;
  const index = units.findIndex((item) => item.unitId === unit.unitId);
  if (index < 0) throw new Error(`实施单元不在当前 Implementation Package 的预设顺序中：${unit.unitId}`);
  if (unit.parallelMode !== 'PARALLEL') return units.slice(0, index);
  const groupStart = units.findIndex((item) => item.parallelMode === 'PARALLEL' && item.parallelGroup === unit.parallelGroup);
  if (groupStart < 0) throw new Error(`并行单元未找到预设顺序阶段：${unit.unitId}`);
  return units.slice(0, groupStart);
}

/** 在已完整校验的 Execution State 上复核 READY 和预设顺序前序，不触碰外部证据文件。 */
function assertUnitReadyFromState(unit, pkg, state) {
  const current = state.units.find((item) => item.unitId === unit.unitId);
  if (!current || current.state !== 'IN_PROGRESS') throw new Error(`实施单元尚未 READY，当前状态不是 IN_PROGRESS：${unit.unitId}`);
  for (const preceding of precedingUnitsForReady(unit, pkg)) {
    const precedingState = state.units.find((item) => item.unitId === preceding.unitId);
    if (!precedingState || precedingState.state !== 'COMPLETE') throw new Error(`实施单元尚未 READY，缺少预设顺序前序证据：${unit.unitId} <- ${preceding.unitId}`);
  }
  return current;
}

/** 只保留会影响执行顺序的计划字段，防止无关描述变化伪造或重排状态。 */
function executionPlanSnapshot(pkg) {
  return pkg.executionUnits.map((unit, order) => ({
    unitId: unit.unitId,
    order,
    parallelMode: unit.parallelMode,
    parallelGroup: unit.parallelGroup,
    owner: unit.owner,
    ownedPaths: [...unit.ownedPaths],
    stateOwnership: [...unit.stateOwnership],
    acceptanceCommands: [...unit.acceptanceCommands],
    highFidelityPrerequisite: unit.highFidelityPrerequisite,
  }));
}

/** 计算当前 Implementation Package 的不可变执行计划指纹。 */
export function executionPlanFingerprint(pkg, io) {
  return io.hashText(stableJson(executionPlanSnapshot(pkg)));
}

/** 返回唯一的执行状态路径；调用者不能通过参数把状态移到 evidenceRoot 之外。 */
export function executionStatePath(work) {
  return `${String(work.evidenceRoot).replace(/\/$/, '')}/execution-state.json`;
}

/** 返回阶段切换时保存旧执行状态的归档路径；归档只读保留，不参与当前放行。 */
export function executionStateArchivePath(work, packageId) {
  if (!packageId) throw new Error('Execution State 归档必须绑定旧 Implementation Package');
  return `${String(work.evidenceRoot).replace(/\/$/, '')}/execution-states/${encodeURIComponent(String(packageId))}.json`;
}

/**
 * 返回唯一状态文件锁路径；锁与状态文件同目录，不能被调用方移到 evidenceRoot 外。
 */
function executionStateLockPath(statePath) {
  const normalized = String(statePath).replaceAll('\\', '/');
  if (!normalized.endsWith('/execution-state.json') && normalized !== 'execution-state.json') throw new Error('Execution State 锁只能绑定 evidenceRoot/execution-state.json');
  return `${statePath}.lock`;
}

/**
 * 在同步 CLI 中短暂等待锁释放，避免轮询期间持续占用 CPU。
 */
function waitForExecutionStateLock(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, Math.min(milliseconds, 100));
}

/**
 * 获取跨进程排他锁，并处理明确的超时与陈旧锁。
 *
 * 锁文件使用 wx 创建保证竞争下只有一个持有者；陈旧判断只作用于本状态文件旁的锁，
 * 避免把任意 evidenceRoot 文件当作锁删除。正常迁移远短于陈旧阈值，崩溃遗留锁可恢复。
 */
function acquireExecutionStateLock(statePath) {
  const lockPath = executionStateLockPath(statePath);
  const startedAt = Date.now();
  while (Date.now() - startedAt < EXECUTION_STATE_LOCK_TIMEOUT_MS) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), statePath }), 'utf8');
      } finally {
        closeSync(descriptor);
      }
      HELD_EXECUTION_STATE_LOCKS.add(lockPath);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        HELD_EXECUTION_STATE_LOCKS.delete(lockPath);
        try { unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error(`Execution State 锁创建失败：${error.message}`);
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > EXECUTION_STATE_LOCK_STALE_MS) unlinkSync(lockPath);
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw new Error(`Execution State 陈旧锁处理失败：${lockError.message}`);
      }
      waitForExecutionStateLock(25);
    }
  }
  throw new Error(`Execution State 锁获取超时：${lockPath}`);
}

/** 根据执行单元状态计算下一任务；数组位置是唯一权威，不重新推导依赖图。 */
function deriveNextTask(units) {
  const active = units.filter((unit) => unit.state === 'IN_PROGRESS');
  if (active.length) {
    const firstActiveIndex = units.findIndex((unit) => unit.state === 'IN_PROGRESS');
    const parallelGroup = active[0].parallelMode === 'PARALLEL' ? active[0].parallelGroup : null;
    if (active.some((unit) => (unit.parallelMode === 'PARALLEL' ? unit.parallelGroup : null) !== parallelGroup)) throw new Error('Execution State 同时激活了多个不相邻顺序阶段');
    if (units.slice(0, firstActiveIndex).some((unit) => unit.state !== 'COMPLETE')) throw new Error('Execution State 当前任务之前仍有未完成单元');
    if (parallelGroup === null) {
      if (active.length !== 1 || units.slice(firstActiveIndex + 1).some((unit) => unit.state !== 'PENDING')) throw new Error('Execution State 串行阶段必须且只能激活一个当前任务');
    } else {
      const groupUnits = units.filter((unit) => unit.parallelMode === 'PARALLEL' && unit.parallelGroup === parallelGroup);
      const groupEnd = units.lastIndexOf(groupUnits.at(-1));
      if (groupUnits.some((unit) => unit.state === 'PENDING') || units.slice(groupEnd + 1).some((unit) => unit.state !== 'PENDING')) throw new Error('Execution State 并行组必须整体激活，且后续阶段必须保持 PENDING');
    }
    return parallelGroup
      ? { kind: 'PARALLEL_GROUP', taskId: parallelGroup, state: 'IN_PROGRESS', unitIds: active.map((unit) => unit.unitId), parallelGroup, gate: 'UNIT_CHECK', gateStatus: 'NOT_REQUIRED', reason: '同一并行组必须全部完成后才能推进下一阶段' }
      : { kind: 'SERIAL_UNIT', taskId: active[0].unitId, state: 'IN_PROGRESS', unitIds: [active[0].unitId], parallelGroup: null, gate: 'UNIT_CHECK', gateStatus: 'NOT_REQUIRED', reason: '按 executionUnits 预设顺序执行当前串行单元' };
  }
  if (units.every((unit) => unit.state === 'COMPLETE')) {
    return { kind: 'WORKFLOW_COMPLETE', taskId: null, state: 'COMPLETE', unitIds: [], parallelGroup: null, gate: null, gateStatus: 'NOT_REQUIRED', reason: '全部 executionUnits 已完成，且没有下一任务' };
  }
  const firstPending = units.find((unit) => unit.state === 'PENDING');
  if (!firstPending) throw new Error('Execution State 没有可解释的下一任务');
  throw new Error(`Execution State 存在未激活的前置单元：${firstPending.unitId}`);
}

/** 生成初始状态：首个串行单元或首个并行组立即标记 IN_PROGRESS。 */
export function createExecutionState(work, pkg, io, now = new Date().toISOString()) {
  // 创建正式执行状态前同时复核当前 V2 拆解、V3 资源和 V4 阶段状态。
  assertFormalExecutionAfterV3(work, pkg, io.repo ?? null, io);
  assertHighFidelityPrerequisites(pkg, work, io.repo ?? null, io);
  const firstUnit = pkg.executionUnits[0];
  const units = pkg.executionUnits.map((unit, order) => ({ unitId: unit.unitId, order, parallelMode: unit.parallelMode, parallelGroup: unit.parallelGroup, state: 'PENDING', resultId: null, resultPath: null, resultFingerprint: null, startedAt: null, completedAt: null }));
  const first = units[0];
  if (first.parallelMode === 'PARALLEL') for (const unit of units.filter((item) => item.parallelGroup === first.parallelGroup)) { unit.state = 'IN_PROGRESS'; unit.startedAt = now; }
  else { first.state = 'IN_PROGRESS'; first.startedAt = now; }
  const planFingerprint = executionPlanFingerprint(pkg, io);
  const state = {
    schemaVersion: EXECUTION_STATE_SCHEMA,
    stateId: `EXECUTION-${work.workItemId}-${pkg.packageId}`,
    workItemId: work.workItemId,
    packageId: pkg.packageId,
    baselineVersion: pkg.baselineVersion,
    baselineHash: work.baselineHash,
    stageId: work.stageId,
    visualStage: work.visualStage ?? null,
    visualStageState: work.visualStageState ?? null,
    executionUnitIds: pkg.executionUnits.map((unit) => unit.unitId),
    executionPlanFingerprint: planFingerprint,
    units,
    unitSequenceState: 'IN_PROGRESS',
    workflowState: 'IN_PROGRESS',
    nextTask: deriveNextTask(units),
    updatedAt: now,
    lastTransition: { type: 'INITIALIZE', unitId: null, resultId: null },
  };
  return state;
}

/** Implementation Package 规划阶段只复核当前 Work Item 的 V2 结果，避免控制 CLI 重复实现视觉门逻辑。 */
export function assertImplementationPackagePlanningPrerequisites(pkg, work, repo, io) {
  return assertHighFidelityPrerequisites(pkg, work, repo, io);
}

/** 复核当前计划与单元证据；任务内路径和验收命令调整只影响相关单元。 */
export function validateExecutionState(state, statePath, work, pkg, repo, io) {
  // 状态文件每次读取都重新检查 V2/V3 来源和 V4 状态，防止过期证据继续放行。
  assertFormalExecutionAfterV3(work, pkg, repo, io);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Execution State 必须为对象');
  const missing = EXECUTION_STATE_REQUIRED_FIELDS.filter((field) => state[field] === undefined);
  const extra = Object.keys(state).filter((field) => !EXECUTION_STATE_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Execution State 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (state.schemaVersion !== EXECUTION_STATE_SCHEMA || !state.stateId || Number.isNaN(Date.parse(state.updatedAt))) throw new Error('Execution State 版本、状态 ID 或更新时间无效');
  if (state.workItemId !== work.workItemId || state.packageId !== pkg.packageId || state.baselineVersion !== pkg.baselineVersion || state.stageId !== work.stageId || (state.visualStage ?? null) !== (work.visualStage ?? null) || (state.visualStageState ?? null) !== (work.visualStageState ?? null)) throw new Error('Execution State 未绑定当前 Work Item、实施包版本或阶段');
  const expectedPath = executionStatePath(work);
  const actualPath = io.normalizeRepoPath(repo, statePath);
  if (actualPath !== expectedPath) throw new Error(`Execution State 必须位于 ${expectedPath}`);
  const expectedIds = pkg.executionUnits.map((unit) => unit.unitId);
  if (JSON.stringify(state.executionUnitIds) !== JSON.stringify(expectedIds)) throw new Error('Execution State.executionUnitIds 与当前 executionUnits 预设顺序不一致');
  // 计划摘要供展示使用；验收直接核对单元 ID、数组位置和并行关系，避免摘要漂移使状态失效。
  state = { ...state, executionPlanFingerprint: executionPlanFingerprint(pkg, io) };
  if (!Array.isArray(state.units) || state.units.length !== pkg.executionUnits.length) throw new Error('Execution State.units 未覆盖全部 executionUnits');
  for (const [order, item] of state.units.entries()) {
    const unit = pkg.executionUnits[order];
    const itemMissing = EXECUTION_UNIT_STATE_REQUIRED_FIELDS.filter((field) => item?.[field] === undefined);
    const itemExtra = item && typeof item === 'object' ? Object.keys(item).filter((field) => !EXECUTION_UNIT_STATE_FIELDS.includes(field)) : [];
    if (itemMissing.length || itemExtra.length) throw new Error(`Execution State 单元字段不严格：${unit?.unitId ?? order}`);
    if (item.unitId !== unit.unitId || item.order !== order || item.parallelMode !== unit.parallelMode || item.parallelGroup !== unit.parallelGroup || !UNIT_STATES.has(item.state)) throw new Error(`Execution State 单元顺序或模式不一致：${item.unitId ?? order}`);
    for (const field of ['startedAt', 'completedAt']) if (item[field] !== null && Number.isNaN(Date.parse(item[field]))) throw new Error(`Execution State 单元时间无效：${item.unitId}`);
    if (item.state === 'PENDING' || item.state === 'IN_PROGRESS') {
      if (item.state === 'IN_PROGRESS' && (unit.unitType === 'SCENE' || unit.unitType === 'DISPLAY_LAYER')) assertHighFidelityPrerequisite(unit, work, pkg, repo, io);
      if (item.resultId !== null || item.resultPath !== null || item.completedAt !== null) throw new Error(`未完成单元不得携带完成结果：${item.unitId}`);
      if (item.state === 'IN_PROGRESS' && !item.startedAt) throw new Error(`IN_PROGRESS 单元缺少 startedAt：${item.unitId}`);
    } else {
      if (!item.resultId || !item.resultPath || !item.completedAt) throw new Error(`COMPLETE 单元缺少结果绑定：${item.unitId}`);
      const resultRelative = io.normalizeRepoPath(repo, item.resultPath);
      const unitRoot = `${String(work.evidenceRoot).replace(/\/$/, '')}/units`;
      if (!(resultRelative === unitRoot || resultRelative.startsWith(`${unitRoot}/`))) throw new Error(`Execution State 结果必须位于 evidenceRoot/units：${item.unitId}`);
      const resultPath = io.resolve(repo, item.resultPath);
      if (!io.existsSync(resultPath)) throw new Error(`Execution State 结果文件不存在，预设顺序前序证据不可用：${item.unitId}`);
      let result;
      try { result = JSON.parse(io.readFileSync(resultPath, 'utf8')); } catch { throw new Error(`Execution State 结果文件不是有效 JSON：${item.unitId}`); }
      if (result.resultId !== item.resultId) throw new Error(`Execution State 结果 ID 与文件内容不一致：${item.unitId}`);
      validateUnitResult(result, resultPath, work, pkg, unit, repo, io);
    }
  }
  const allComplete = state.units.every((unit) => unit.state === 'COMPLETE');
  const expectedUnitSequenceState = allComplete ? 'COMPLETE' : 'IN_PROGRESS';
  if (state.unitSequenceState !== expectedUnitSequenceState) throw new Error('Execution State.unitSequenceState 与单元状态不一致');
  const expectedTask = deriveNextTask(state.units);
  const taskMissing = NEXT_TASK_FIELDS.filter((field) => state.nextTask?.[field] === undefined);
  const taskExtra = state.nextTask && typeof state.nextTask === 'object' ? Object.keys(state.nextTask).filter((field) => !NEXT_TASK_FIELDS.includes(field)) : [];
  if (taskMissing.length || taskExtra.length || !NEXT_TASK_KINDS.has(state.nextTask?.kind) || !NEXT_TASK_STATES.has(state.nextTask?.state) || !NEXT_TASK_GATE_STATUSES.has(state.nextTask?.gateStatus) || !Array.isArray(state.nextTask?.unitIds)) throw new Error('Execution State.nextTask 字段或枚举无效');
  if (state.nextTask.unitIds.some((unitId) => !expectedIds.includes(unitId)) || new Set(state.nextTask.unitIds).size !== state.nextTask.unitIds.length) throw new Error('Execution State.nextTask.unitIds 未绑定当前 executionUnits');
  if (state.nextTask.kind === 'WORKFLOW_COMPLETE' && (state.nextTask.taskId !== null || state.nextTask.unitIds.length || state.nextTask.state !== 'COMPLETE')) throw new Error('工作流完成状态不得携带下一单元');
  if (JSON.stringify(state.nextTask) !== JSON.stringify(expectedTask)) throw new Error('Execution State.nextTask 与当前单元状态不一致');
  const expectedWorkflowState = expectedTask.kind === 'WORKFLOW_COMPLETE' ? 'COMPLETE' : expectedTask.state === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
  if (state.workflowState !== expectedWorkflowState || !WORKFLOW_STATES.has(state.workflowState)) throw new Error('Execution State.workflowState 与下一任务不一致');
  const transitionMissing = LAST_TRANSITION_FIELDS.filter((field) => state.lastTransition?.[field] === undefined);
  const transitionExtra = state.lastTransition && typeof state.lastTransition === 'object' ? Object.keys(state.lastTransition).filter((field) => !LAST_TRANSITION_FIELDS.includes(field)) : [];
  if (transitionMissing.length || transitionExtra.length || !LAST_TRANSITION_TYPES.has(state.lastTransition?.type)) throw new Error('Execution State.lastTransition 无效');
  return state;
}

/** 读取并校验唯一执行状态；所有后续放行命令都必须经过此函数。 */
export function loadExecutionState(work, pkg, repo, io) {
  const statePath = io.resolve(repo, executionStatePath(work));
  if (!io.existsSync(statePath)) throw new Error(`缺少当前 Execution State：${executionStatePath(work)}；不能绕过任务状态更新`);
  let state;
  try { state = JSON.parse(io.readFileSync(statePath, 'utf8')); } catch { throw new Error('Execution State 文件不是有效 JSON'); }
  return { state: validateExecutionState(state, statePath, work, pkg, repo, io), statePath };
}

/** 在进入 IMPLEMENTING 时创建当前阶段状态；同一包已有状态必须精确复核，禁止重复初始化。 */
export function initializeExecutionState(work, pkg, repo, io, options = {}) {
  const statePath = io.resolve(repo, executionStatePath(work));
  if (io.existsSync(statePath) && !options.replaceExisting) return loadExecutionState(work, pkg, repo, io);
  let previous = null;
  if (io.existsSync(statePath)) {
    try { previous = JSON.parse(io.readFileSync(statePath, 'utf8')); } catch { throw new Error('已有 Execution State 文件不是有效 JSON，拒绝覆盖并要求先修复'); }
    if (previous.packageId === pkg.packageId) return loadExecutionState(work, pkg, repo, io);
    if (!options.previousWork || !options.previousPackage) throw new Error('阶段切换必须提供旧阶段 Work Item 与 Implementation Package 以复核 Execution State');
    // 旧阶段必须按其原绑定包重新校验每个 Result，不能只相信状态文件中的 COMPLETE 标记。
    const previousLoaded = loadExecutionState(options.previousWork, options.previousPackage, repo, io);
    previous = previousLoaded.state;
    if (previous.unitSequenceState !== 'COMPLETE' || previous.workflowState !== 'COMPLETE') throw new Error('旧实施序列未完成，不能替换当前阶段实施包');
    // 基线 ID 可能是 Git commit 摘要；阶段间以 Work Item 与原包归属确认身份，摘要不作放行比较。
    if (previous.packageId !== options.previousPackage.packageId || previous.workItemId !== work.workItemId) throw new Error('旧阶段 Execution State 未绑定当前 Work Item 或实施包');
  }
  const state = createExecutionState(work, pkg, io);
  // 先完整校验新阶段状态，再归档旧状态和替换当前指针；新包失败时当前状态保持原样。
  const validated = validateExecutionState(state, statePath, work, pkg, repo, io);
  if (previous) {
    const archivePath = io.resolve(repo, executionStateArchivePath(work, previous.packageId));
    if (io.existsSync(archivePath)) throw new Error(`旧 Implementation Package 的 Execution State 归档已存在，拒绝覆盖：${executionStateArchivePath(work, previous.packageId)}`);
    // 阶段切换保留旧状态作为只读审计历史，新阶段只消费下面重新生成的状态文件。
    if (typeof io.writeJson !== 'function') throw new Error('阶段切换缺少 Execution State 归档写入能力');
    io.writeJson(archivePath, previous);
  }
  (io.writeJson ?? writeJson)(statePath, state);
  return { state: validated, statePath };
}

/** unit-check 通过后的唯一状态迁移：当前单元 COMPLETE，并按预设顺序激活下一单元/并行组。 */
export function completeExecutionUnit(work, pkg, unit, result, resultPath, repo, io) {
  if (work.globalState !== 'IMPLEMENTING') throw new Error(`A3 unit-check 仅允许 IMPLEMENTING 状态，当前为 ${work.globalState}`);
  const statePath = io.resolve(repo, executionStatePath(work));
  const releaseLock = acquireExecutionStateLock(statePath);
  try {
    // 必须在持锁后重新读取并校验，避免两个并行 unit-check 基于同一旧快照互相覆盖。
    const loaded = loadExecutionState(work, pkg, repo, io);
    const state = loaded.state;
    validateUnitResult(result, resultPath, work, pkg, unit, repo, io);
    const item = assertUnitReadyFromState(unit, pkg, state);
    const normalizedResultPath = io.normalizeRepoPath(repo, resultPath);
    if (normalizedResultPath === executionStatePath(work)) throw new Error('Unit Result 不能覆盖 Execution State');
    item.state = 'COMPLETE'; item.resultId = result.resultId; item.resultPath = normalizedResultPath; item.resultFingerprint = io.hashText(stableJson(result)); item.completedAt = result.completedAt;
    // 并行组仍有其他 IN_PROGRESS 成员时绝不激活后续数组位置，避免组内首个完成误推进阶段。
    const nextPending = state.units.find((entry) => entry.state === 'PENDING');
    const hasActivePeer = state.units.some((entry) => entry.state === 'IN_PROGRESS');
    if (nextPending && !hasActivePeer) {
      const activatingStates = nextPending.parallelMode === 'PARALLEL' ? state.units.filter((entry) => entry.parallelGroup === nextPending.parallelGroup) : [nextPending];
      // 并行阶段激活前逐项复核，防止同组第二个场景或显示层绕过已漂移的高保真证据。
      for (const activatingState of activatingStates) {
        const nextUnit = pkg.executionUnits.find((candidate) => candidate.unitId === activatingState.unitId);
        if (nextUnit.unitType === 'SCENE' || nextUnit.unitType === 'DISPLAY_LAYER') assertHighFidelityPrerequisite(nextUnit, work, pkg, repo, io);
      }
      if (nextPending.parallelMode === 'PARALLEL') {
        for (const entry of state.units.filter((candidate) => candidate.parallelGroup === nextPending.parallelGroup)) { entry.state = 'IN_PROGRESS'; entry.startedAt = new Date().toISOString(); }
      } else { nextPending.state = 'IN_PROGRESS'; nextPending.startedAt = new Date().toISOString(); }
    }
    const allComplete = state.units.every((entry) => entry.state === 'COMPLETE');
    state.unitSequenceState = allComplete ? 'COMPLETE' : 'IN_PROGRESS';
    state.nextTask = deriveNextTask(state.units);
    state.workflowState = state.nextTask.kind === 'WORKFLOW_COMPLETE' ? 'COMPLETE' : state.nextTask.state === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
    state.updatedAt = new Date().toISOString();
    state.lastTransition = { type: state.workflowState === 'COMPLETE' ? 'WORKFLOW_COMPLETE' : 'UNIT_COMPLETE', unitId: unit.unitId, resultId: result.resultId };
    validateExecutionState(state, loaded.statePath, work, pkg, repo, io);
    writeJson(loaded.statePath, state);
    return { state, statePath: loaded.statePath };
  } finally {
    releaseLock();
  }
}

/** 在持锁完成迁移中校验当前 Result 和 READY 状态，供 CLI 保持单一硬门入口。 */
export function validateAndCompleteExecutionUnit(result, resultPath, work, pkg, unit, repo, io) {
  return completeExecutionUnit(work, pkg, unit, result, resultPath, repo, io);
}

/** 生成命令行稳定输出，确保 unit-check 与 status 对下一任务使用同一字段集合。 */
export function executionStateSummary(work, state) {
  return { stateId: state.stateId, path: executionStatePath(work), workflowState: state.workflowState, unitSequenceState: state.unitSequenceState, completedUnitIds: state.units.filter((item) => item.state === 'COMPLETE').map((item) => item.unitId), currentUnitIds: state.units.filter((item) => item.state === 'IN_PROGRESS').map((item) => item.unitId), nextTask: state.nextTask };
}

/** 要求当前实施包的执行序列完成；这只代表阶段实施完成，不代表场景 Work Item 已完成。 */
export function assertExecutionWorkflowComplete(work, pkg, repo, io) {
  const { state } = loadExecutionState(work, pkg, repo, io);
  if (state.workflowState !== 'COMPLETE' || state.unitSequenceState !== 'COMPLETE' || state.nextTask.kind !== 'WORKFLOW_COMPLETE') throw new Error(`Execution State 尚未完成当前阶段实施序列，当前下一任务：${state.nextTask.taskId ?? state.nextTask.kind}`);
  return state;
}

/** 更新同一 Work Item 阶段入口对应的状态元数据，保留已完成单元结果并重新校验绑定。 */
export function updateExecutionStateStage(work, nextWork, pkg, repo, io) {
  const loaded = loadExecutionState(work, pkg, repo, io);
  const state = { ...loaded.state, stageId: nextWork.stageId, visualStage: nextWork.visualStage ?? null, visualStageState: nextWork.visualStageState ?? null, updatedAt: new Date().toISOString(), lastTransition: { type: 'STAGE_ADVANCE', unitId: null, resultId: null } };
  const validated = validateExecutionState(state, loaded.statePath, nextWork, pkg, repo, io);
  (io.writeJson ?? writeJson)(loaded.statePath, validated);
  return { state: validated, statePath: loaded.statePath };
}

/** 校验场景 Work Item 的最终 V4 运行证据，避免把正式代码序列完成误报为场景完成。 */
export function assertSceneWorkItemComplete(work, pkg, repo, evidence = null) {
  const hasSceneUnit = pkg?.executionUnits?.some((unit) => ['SCENE', 'DISPLAY_LAYER'].includes(unit.unitType));
  // V2/V3 仍属于场景生命周期；V4 只有真实运行验收后才能关闭工作项。
  if (!hasSceneUnit && !['V2', 'V3', 'V4'].includes(work.visualStage)) return true;
  if (String(work.visualStage ?? '').toUpperCase() !== 'V4' || work.visualStageState !== 'v4-runtime-integration-candidate') throw new Error('场景 Work Item 只有 V4 正式还原与运行验收完成后才能 COMPLETE；当前正式代码序列已完成但场景仍未完成');
  const visualResult = validateVisualStagePrerequisites({ ...work, visualIntegration: { ...(work.visualIntegration ?? {}), declaresVisualComplete: true } }, { projectRoot: repo, implementationPackage: pkg, evidence });
  if (!visualResult.ok) throw new Error(`场景 Work Item V4 运行态联合验收未闭合：${visualResult.errors?.[0]?.message ?? visualResult.missingEvidence?.[0] ?? '缺少完整视觉阶段证据'}`);
  const reference = work.visualStageEvidenceRefs?.V4;
  const loaded = loadImmutableVisualStageReference(reference, 'V4 runtime candidate', { projectRoot: repo });
  const value = loaded?.value;
  const status = String(value?.status ?? value?.verdict ?? value?.result ?? '').trim().toUpperCase();
  if (!value || value.evidenceType !== 'v4-runtime-integration-candidate' || status !== 'PASS' || value.workItemId !== work.workItemId) throw new Error('场景 Work Item COMPLETE 缺少当前 Work Item 的 V4 runtime integration candidate 证据');
  return true;
}

/** 只按预设数组位置和当前有效 PASS Result 判定 READY，不推导依赖图。 */
export function assertUnitReady(unit, work, pkg, repo, io) {
  if (work.globalState !== 'IMPLEMENTING') throw new Error(`A3 unit-check 仅允许 IMPLEMENTING 状态，当前为 ${work.globalState}`);
  const { state } = loadExecutionState(work, pkg, repo, io);
  assertUnitReadyFromState(unit, pkg, state);
  if (unit.unitType === 'SCENE' || unit.unitType === 'DISPLAY_LAYER') assertHighFidelityPrerequisite(unit, work, pkg, repo, io);
}

/** 复核全局证据声明的完成单元全部具有当前有效 Result。 */
export function assertCompletedUnits(evidence, work, pkg, repo, io) {
  assertExecutionWorkflowComplete(work, pkg, repo, io);
  const expected = pkg.executionUnits.map((unit) => unit.unitId).sort();
  const actual = [...evidence.completedUnitIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Evidence.completedUnitIds 未覆盖全部 executionUnits');
  // loadExecutionState 已逐项复核 COMPLETE Result，这里只比对声明集合，避免再次扫描 units 目录。
}
