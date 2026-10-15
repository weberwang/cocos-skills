import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executionStatePath, loadExecutionState } from './execution-unit-control.mjs';
import { assertVisualStagePrerequisites, loadImmutableVisualStageReference, validateStandardV2ProductionPlan } from './visual-stage-prerequisites.mjs';

const VISUAL_STAGES = Object.freeze(['V0', 'V1', 'V2', 'V3', 'V4']);
const COMPLETION_STATE_FOR = Object.freeze({ V3: 'v3-formal-acceptance-complete', V4: 'v4-runtime-integration-candidate' });

/** 将视觉阶段转换为可比较的序号；未知值返回 null 并由入口拒绝。 */
export function visualStageOrder(value) {
  const stage = String(value ?? '').trim().toUpperCase();
  return VISUAL_STAGES.includes(stage) ? Number(stage.slice(1)) : null;
}

/** 读取同一 Work Item 的不可变阶段证据，拒绝仅写状态字段的伪完成。 */
function requireStageEvidence(work, stage, repo) {
  const reference = work.visualStageEvidenceRefs?.[stage];
  const loaded = loadImmutableVisualStageReference(reference, `${stage} stage evidence`, { projectRoot: repo });
  const value = loaded?.value;
  if (!value) throw new Error(`${stage} 阶段入口缺少当前 Work Item 的不可变证据`);
  if (stage === 'V2') {
    const result = validateStandardV2ProductionPlan(value, work, { projectRoot: repo });
    if (!result.ok) throw new Error(`V2 阶段入口的标准冻结拆解方案无效：${result.missingEvidence.join('、')}`);
  } else {
    const expectedType = stage === 'V3' ? 'v3-formal-acceptance' : 'v4-runtime-integration-candidate';
    if (value.evidenceType !== expectedType || value.status !== 'PASS' || value.workItemId !== work.workItemId) throw new Error(`${stage} 阶段入口缺少当前 Work Item 的 PASS 证据`);
  }
  return value;
}

/** 在旧阶段身份上验证当前执行包和状态，确保阶段入口不消费陈旧结果。 */
function loadPreviousStage(work, repo, validationContext, unitIo, { requireComplete = true } = {}) {
  const packagePath = work.implementationPackageRecord;
  const statePath = resolve(repo, executionStatePath(work));
  if (!existsSync(statePath)) return { package: packagePath ? validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work) : null, state: null };
  if (!packagePath) throw new Error('已有 Execution State 但 Work Item 缺少当前 Implementation Package 记录');
  const previousPackage = validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work);
  const state = loadExecutionState(work, previousPackage, repo, unitIo(repo)).state;
  if (requireComplete && (state.unitSequenceState !== 'COMPLETE' || state.workflowState !== 'COMPLETE' || state.nextTask.kind !== 'WORKFLOW_COMPLETE')) throw new Error('旧阶段实施序列尚未完成，不能进入下一视觉阶段');
  return { package: previousPackage, state };
}

/**
 * 构造同一场景 Work Item 的阶段入口副本。
 * 入口默认只把目标阶段置为 in-progress；阶段完成状态必须显式提供并绑定对应证据。
 */
export function prepareSceneStageTransition({ work, target, args, repo, validationContext, unitIo, validateWorkItem }) {
  if (!['A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel)) throw new Error('场景内部阶段入口只允许 Work Item 范围内的 A1–A3，不能替代集成或发布批准');
  const currentStage = visualStageOrder(work.visualStage);
  const requestedStage = visualStageOrder(args['visual-stage']);
  const currentStageName = VISUAL_STAGES.find((stage) => visualStageOrder(stage) === currentStage);
  const requestedStageName = VISUAL_STAGES.find((stage) => visualStageOrder(stage) === requestedStage);
  if (currentStage === null || requestedStage === null || !['V3', 'V4'].includes(requestedStageName)) throw new Error('未知视觉阶段；场景阶段只能从 V2 进入 V3，再由 V3 进入 V4');
  const reviewState = ['REVIEW', 'PASSED'].includes(work.globalState);
  const stageEntry = currentStageName === 'V2' && requestedStageName === 'V3' && target === 'REVIEW' && reviewState;
  const formalEntry = currentStageName === 'V3' && requestedStageName === 'V4' && target === 'IMPLEMENTING' && reviewState
    && work.visualStageState === COMPLETION_STATE_FOR.V3;
  const sameStageEntry = currentStageName === requestedStageName && ((requestedStageName === 'V3' && target === 'REVIEW' && reviewState)
    || (requestedStageName === 'V4' && target === 'IMPLEMENTING' && work.globalState === 'IMPLEMENTING'));
  if (!stageEntry && !formalEntry && !sameStageEntry) throw new Error('场景阶段入口只能沿 V2→V3→V4 前进；V3 PASS 后须经 A3 激活新包进入 V4/IMPLEMENTING');
  const adjacent = (currentStageName === 'V2' && requestedStageName === 'V3') || (currentStageName === 'V3' && requestedStageName === 'V4');
  const sameStageCompletion = requestedStageName === currentStageName && ['V3', 'V4'].includes(requestedStageName);
  if (!adjacent && !sameStageCompletion) throw new Error('场景视觉阶段只能由 V2→V3→V4 推进，或在 V3/V4 显式提交当前阶段完成证据');
  const requestedState = String(args['visual-stage-state'] ?? 'in-progress').trim();
  const completionState = COMPLETION_STATE_FOR[requestedStageName];
  const isCompletion = requestedState === completionState;
  // V4 正式实施必须先激活新包并进入进行态，随后再提交真实运行验收证据。
  if (formalEntry && isCompletion) throw new Error('V3→V4 必须先通过 A3 激活新正式包进入进行态，再单独提交 V4 运行验收证据');
  if (sameStageCompletion && !isCompletion) throw new Error('同阶段入口只能提交完成证据；上游失效必须使用明确的返工路径');
  if (!isCompletion && !['in-progress', 'pending', 'failed', 'stale', 'invalid'].includes(requestedState)) throw new Error(`阶段 ${requestedStageName} 的 visualStageState 无效`);
  if (isCompletion) requireStageEvidence(work, requestedStageName, repo);
  if (requestedStageName === 'V3' && adjacent) requireStageEvidence(work, 'V2', repo);
  if (formalEntry) {
    requireStageEvidence(work, 'V2', repo);
    requireStageEvidence(work, 'V3', repo);
  }
  // 已有执行态必须先闭环；没有执行态的新场景仍可由 V3 PASS 直接进入正式实施。
  const previous = loadPreviousStage(work, repo, validationContext, unitIo);
  const nextWork = structuredClone(work);
  nextWork.pendingApprovalState = target;
  nextWork.visualStage = requestedStageName;
  nextWork.visualStageState = requestedState;
  if (args['stage-id'] !== undefined) {
    const requestedStageId = String(args['stage-id']).trim();
    const requestedStageIdOrder = visualStageOrder(requestedStageId);
    // 保留任意业务 stageId，但拒绝把已删除或未知的 V 编号伪装成业务标签。
    if (!requestedStageId || (/^V\d+$/i.test(requestedStageId) && (requestedStageIdOrder === null || requestedStageIdOrder !== requestedStage))) throw new Error('阶段入口 --stage-id 若使用视觉阶段编号，必须是已知阶段且与 --visual-stage 一致');
    nextWork.stageId = requestedStageId;
  } else if (visualStageOrder(work.stageId) !== null) nextWork.stageId = requestedStageName;
  nextWork.pendingApprovalStage = nextWork.stageId;
  // 阶段身份改变后，旧候选审计和验证批次不能继续证明新阶段。
  delete nextWork.diffAuditRecord;
  delete nextWork.diffAuditLedgerRecord;
  delete nextWork.pendingVisualPrerequisiteSnapshot;
  nextWork.validationBatchId = `BATCH-${nextWork.workItemId}-${randomUUID()}`;
  validateWorkItem(nextWork);
  return { nextWork, previousWork: work, previousPackage: previous.package, previousState: previous.state, updateExecutionState: Boolean(previous.state), reuseExecutionState: Boolean(previous.state), formalEntry };
}

/** 准备 V4 正式包激活，要求当前 V3 PASS 资源证据并使用全新正式实施包。 */
export function prepareImplementationPackageActivation({ work, pkg, packagePath, repo, validationContext, unitIo, validateWorkItem }) {
  if (!['REVIEW', 'PASSED'].includes(work.globalState) || work.visualStage !== 'V3' || work.visualStageState !== COMPLETION_STATE_FOR.V3) throw new Error('正式 Implementation Package 只能在同一 Work Item 的 V3 正式资源 PASS 后进入 V4/IMPLEMENTING');
  requireStageEvidence(work, 'V2', repo);
  requireStageEvidence(work, 'V3', repo);
  // 包激活前复用阶段硬门，确保 V2/V3 文件来源、候选归属和实际资源仍然有效。
  // A3 激活会废弃上一阶段 pending 快照；只清除旧快照比较，不放宽当前 V2/V3 的真实来源读取。
  assertVisualStagePrerequisites({ ...work, visibleVisualProductionIntegration: true, pendingVisualPrerequisiteSnapshot: undefined, pending_visual_prerequisite_snapshot: undefined }, { projectRoot: repo, implementationPackage: pkg });
  const nextPath = resolve(repo, packagePath);
  // 正式包替换必须先关闭旧执行序列，避免旧状态绑定到新的正式实施计划。
  const previous = loadPreviousStage(work, repo, validationContext, unitIo);
  if (previous.package && previous.package.packageId === pkg.packageId) throw new Error('正式 Implementation Package 必须使用新的 packageId，禁止复用旧冻结包');
  const nextWork = structuredClone(work);
  nextWork.visualStage = 'V4';
  nextWork.visualStageState = 'in-progress';
  if (visualStageOrder(work.stageId) !== null) nextWork.stageId = 'V4';
  delete nextWork.diffAuditRecord;
  delete nextWork.diffAuditLedgerRecord;
  nextWork.validationBatchId = `BATCH-${nextWork.workItemId}-${pkg.packageId}`;
  validateWorkItem(nextWork);
  const nextPackage = validationContext.validateImplementationPackage(pkg, nextWork);
  return { nextWork, package: nextPackage, packagePath: nextPath, previousWork: previous.state ? work : null, previousPackage: previous.package, previousState: previous.state, replaceExisting: Boolean(previous.state) };
}
