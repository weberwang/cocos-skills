import { resolve } from 'node:path';
import { list } from './io.mjs';
import { resultRecord, writeResult } from './output.mjs';
import { createValidationContext } from './validation-context.mjs';
import { projectWorkflowView, workflowViewMetadata } from './workflow-view.mjs';

const MAX_SAFE_RUN_STEPS = 16;
const VISUAL_STAGE_NEXT = Object.freeze({ V2: 'V3', V3: 'V4' });
const SAFE_RUN_TARGETS = new Set(['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'COMPLETE']);

/** 创建 run/check/status 三个代理入口，所有依赖通过注入复用既有硬门。 */
export function createStableCommands(deps) {
  const inspect = (args, command, validationContext = null) => inspectWorkflow(args, command, deps, validationContext);

  /** 只读取并推导当前任务，不执行业务、测试、发布或外部动作。 */
  function run(args) {
    let inspection = inspect(args, 'run');
    const changed = [];
    const visited = new Set();
    let steps = 0;
    if (hasVisualStageArgs(args)) {
      return emitRunStop(inspection, args, changed, '视觉阶段迁移必须使用 transition 的显式阶段参数', '使用 transition 显式指定相邻视觉阶段后再运行 check', 'VISUAL_STAGE_EXPLICIT_REQUIRED');
    }
    while (steps < MAX_SAFE_RUN_STEPS) {
      const stateKey = runStateKey(inspection);
      if (visited.has(stateKey)) {
        return emitRunStop(inspection, args, changed, 'run 检测到重复控制面状态，已停止自动推进以避免循环', '检查当前 Work Item 与状态迁移结果', 'SAFE_RUN_LOOP_DETECTED');
      }
      visited.add(stateKey);
      const target = safeTransitionTarget(inspection, deps);
      if (!target) return emitInspection(inspection, args, changed);
      // transition 只写控制面状态；silent 防止底层 JSON 与紧凑结果重复输出。
      // 迁移底层仍按进程目录解析路径，必须传入 inspect 已规范化的参数，避免跨 cwd 写错 Work Item。
      const from = inspection.work.globalState;
      deps.transition({ ...inspection.args, to: target, silent: true, object: inspection.work.pendingApprovalObject, 'action-type': inspection.work.pendingApprovalActionType, 'external-target': inspection.work.pendingApprovalExternalTargets, validationContext: inspection.validationContext });
      steps += 1;
      // 每次成功迁移都丢弃旧缓存；阶段、包和执行状态必须由新的校验上下文重新读取。
      inspection = inspect(args, 'run', createValidationContext(inspection.repo, deps));
      if (inspection.work.globalState !== target) {
        return emitRunStop(inspection, args, changed, `run 迁移后状态未达到目标：期望 ${target}，实际 ${inspection.work.globalState}`, '检查当前 Work Item 与状态迁移结果', 'SAFE_RUN_STATE_MISMATCH');
      }
      changed.push(`${from} → ${target}`);
      // IMPLEMENTING 是需要真实实施工作的停点；只有 run 开始时已处于该状态才允许继续检查后续证据门。
      if (target === 'IMPLEMENTING') return emitInspection(inspection, args, changed);
    }
    return emitRunStop(inspection, args, changed, `run 自动推进已达到 ${MAX_SAFE_RUN_STEPS} 步上限，已停止继续迁移`, '检查当前 Work Item 与状态迁移结果', 'SAFE_RUN_STEP_LIMIT');
  }

  /** 只读检查工作项、实施包、执行状态、视觉门和下一动作。 */
  function check(args) {
    return emitInspection(inspect(args, 'check'), args);
  }

  /** 输出当前控制面最小状态，不泄露大段证据或动态时间字段。 */
  function status(args) {
    return emitInspection(inspect(args, 'status'), args);
  }

  return { run, check, status };
}

/** 生成稳定的当前状态键，既可识别迁移回环，也不会把时间字段带入循环检测。 */
function runStateKey(inspection) {
  const work = inspection.work;
  return [
    work.workItemId,
    work.globalState,
    work.stageId,
    work.visualStage ?? '',
    work.visualStageState ?? '',
    work.validationBatchId ?? '',
    inspection.planFingerprint ?? '',
  ].join('|');
}

/** 判断调用方是否把视觉阶段迁移参数带入 run；阶段选择必须保留在显式 transition。 */
function hasVisualStageArgs(args) {
  return args?.['visual-stage'] !== undefined || args?.['visual-stage-state'] !== undefined;
}

/** 输出 run 的保护性停止结果；循环或步数异常不能伪装成普通 READY。 */
function emitRunStop(inspection, args, changed, message, next, errorCode) {
  return emitInspection({
    ...inspection,
    blockers: [...inspection.blockers, { message, next, disposition: 'repair', errorCode }],
  }, args, changed);
}

/** 将稳定入口的所有文件参数统一解析到 --repo，绝对路径保持不变。 */
function normalizeRepoPath(repo, value) {
  if (value === undefined || value === null || value === true) return value;
  return resolve(repo, String(value));
}

/** 规范化稳定入口参数；--input 保留重复值以绑定全部显式关键输入。 */
function normalizeArgs(repo, rawArgs) {
  return {
    ...rawArgs,
    repo,
    'work-item': normalizeRepoPath(repo, rawArgs['work-item']),
    'implementation-package': normalizeRepoPath(repo, rawArgs['implementation-package']),
    evidence: normalizeRepoPath(repo, rawArgs.evidence),
    ledger: normalizeRepoPath(repo, rawArgs.ledger),
    input: list(rawArgs.input).map((path) => normalizeRepoPath(repo, path)),
  };
}

/** 读取所有适用工件并收集唯一根因；此函数绝不写入控制目录。 */
function inspectWorkflow(rawArgs, command, deps, contextOverride = null) {
  const repo = resolve(String(rawArgs.repo ?? process.cwd()));
  const args = normalizeArgs(repo, rawArgs);
  const validationContext = contextOverride ?? createValidationContext(repo, deps);
  const workPath = args['work-item'];
  const work = validationContext.validateWorkItem(workPath);
  const blockers = [];
  if (work.globalState === 'RETURN') {
    // RETURN 是明确的恢复状态，即使没有审批或视觉错误，也必须保持 BLOCKED，避免稳定入口误报 READY。
    blockers.push({ message: 'Work Item 处于 RETURN 恢复状态，不能按普通流程继续', next: null, disposition: 'repair', errorCode: 'RETURN_STATE' });
  } else if (work.globalState === 'BLOCKED') {
    // BLOCKED 同样是状态级阻断，不能依赖其他校验恰好产生 blocker 才被识别。
    blockers.push({ message: 'Work Item 处于 BLOCKED 状态，需显式恢复后才能继续', next: null, disposition: 'repair', errorCode: 'BLOCKED_STATE' });
  }
  let packagePath = args['implementation-package'] ?? work.implementationPackageRecord ?? null;
  let packageValue = null;
  let implementationPackage = null;
  let packageError = null;
  if (packagePath) {
    packagePath = normalizeRepoPath(repo, packagePath);
    try {
      packageValue = validationContext.readJson(packagePath, 'Implementation Package');
      implementationPackage = validationContext.validateImplementationPackage(packageValue, work);
    } catch (error) {
      packageError = error;
      blockers.push(toBlocker(error, 'Implementation Package 校验失败'));
    }
  }
  if (!packagePath && work.pendingApprovalActionLevel === 'A3' && ['REVIEW', 'IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'COMPLETE'].includes(work.globalState)) {
    blockers.push({ message: '缺少当前 Implementation Package；A3 不能绕过实施包进入或完成实施', next: '冻结当前阶段实施包后再次运行 check', disposition: 'repair', errorCode: 'IMPLEMENTATION_PACKAGE_MISSING' });
  }

  let executionState = null;
  const executionRequired = implementationPackage && work.pendingApprovalActionLevel === 'A3'
    && ['IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'COMPLETE'].includes(work.globalState);
  if (executionRequired) {
    try {
      executionState = deps.executionStateSummary(work, deps.loadExecutionState(work, implementationPackage, repo, deps.unitIo(repo)).state);
    } catch (error) {
      blockers.push(toBlocker(error, 'Execution State 校验失败'));
    }
  }

  let visualResult = { required: false, ok: true };
  let visualManifest = null;
  if (!packageError && implementationPackage) {
    const snapshot = validationContext.loadVisualManifestSnapshot(implementationPackage);
    if (snapshot?.errors?.length) blockers.push(toBlocker({ message: snapshot.errors[0] }, '视觉清单读取失败'));
    visualManifest = snapshot?.manifest ?? null;
  }
  if (work.globalState !== 'RETURN') {
    try {
      visualResult = deps.validateVisualStagePrerequisites({ ...work, implementationPackage, visualManifest }, {
        command,
        actionLevel: work.pendingApprovalActionLevel,
        pendingSnapshot: work.pendingVisualPrerequisiteSnapshot,
        projectRoot: repo,
        implementationPackage,
        visualManifest,
        evidence: args.evidence ? validationContext.readEvidence(args.evidence) : null,
      });
      if (visualResult.required && !visualResult.ok) blockers.push(toBlocker(deps.structuredVisualStageFailure(visualResult, command), '视觉阶段门未满足'));
    } catch (error) {
      blockers.push(toBlocker(error, '视觉阶段门检查失败'));
    }
  }

  let evidence = null;
  if (args.evidence && !packageError) {
    try {
      evidence = deps.evidenceCheck({ ...args, silent: true }, true, validationContext);
    } catch (error) {
      blockers.push(toBlocker(error, 'Evidence Manifest 校验失败'));
    }
  }

  let route = null;
  try {
    const ledger = validationContext.readLedger(args.ledger);
    route = deps.deriveRoute(work, deps.effectiveApproval(work, ledger));
  } catch (error) {
    blockers.push(toBlocker(error, '路线推导失败'));
  }
  if (route?.blockers?.length) blockers.push({ message: route.blockers[0], next: null, disposition: null });
  if (!blockers.length && work.globalState === 'PASSED' && evidence && ['A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel)) {
    const completionBlocker = sceneCompletionBlocker({ work, implementationPackage, evidence, repo }, deps);
    if (completionBlocker) blockers.push(completionBlocker);
  }

  const planFingerprint = deps.computePlanFingerprint({
    work,
    implementationPackage: packageValue,
    repo,
    extraPaths: args.input,
  });
  return { args, command, repo, workPath, work, packagePath, packageValue, implementationPackage, executionState, visualResult, evidence, route, blockers, planFingerprint, validationContext };
}

/** 将检查结果转换为统一五字段输出，并保留完整计划指纹。 */
function emitInspection(inspection, args, changed = []) {
  const first = inspection.blockers[0] ?? null;
  const state = inspection.work.globalState;
  const status = state === 'COMPLETE' && !first ? 'COMPLETE' : first ? 'BLOCKED' : 'READY';
  const next = first?.next ?? nextAction(inspection);
  const workflowView = projectWorkflowView({
    workItem: inspection.work,
    implementationPackage: inspection.implementationPackage,
    executionState: inspection.executionState,
  });
  const metadata = { planFingerprint: inspection.planFingerprint, workflowView: workflowViewMetadata(workflowView) };
  if (first?.disposition) metadata.disposition = first.disposition;
  if (first?.errorCode) metadata.errorCode = first.errorCode;
  const record = { ...inspection, output: resultRecord({ status, stage: `${inspection.work.stageId}/${state}`, changed, blocking: first ? [first.message] : [], next, metadata }) };
  writeResult(record.output, { json: args.json === true || args.json === 'true' });
  return record.output;
}

/** 生成当前唯一下一动作；不返回会执行外部动作的命令。 */
function nextAction(inspection) {
  const { work, route, implementationPackage, executionState, evidence } = inspection;
  if (work.globalState === 'RETURN') return '按 returnRecord 的最小受影响范围显式迁移到前序状态';
  if (route?.userInputRequired) return '澄清用户选择并更新 Work Item 或权威工件';
  if (route?.explicitApprovalRequired) return work.pendingApprovalPresentedId === work.pendingApprovalId ? '等待确认当前待处理事项' : '先展示当前待处理事项';
  if (work.globalState === 'REVIEW' && work.pendingApprovalActionLevel === 'A3' && !implementationPackage) return '冻结当前阶段实施包后再运行 run';
  // A3 的实施单元是进入候选审计前置的真实执行步骤，未完成时不能提前提示审计。
  const executionComplete = executionState?.unitSequenceState === 'COMPLETE';
  if (work.globalState === 'IMPLEMENTING' && work.pendingApprovalActionLevel === 'A3' && !executionComplete) return '完成当前待执行单元';
  if (['REVIEW', 'IMPLEMENTING'].includes(work.globalState) && !work.diffAuditRecord) return '记录当前候选变更审计';
  if (work.globalState === 'VALIDATING' && !evidence) return '提交当前候选验证证据';
  if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel) && !evidence) return '提交当前候选验证证据完成闭环';
  if (work.globalState === 'PASSED' && work.pendingApprovalActionLevel === 'A4' && !route?.explicitApprovalRequired) return '进入普通本地集成阶段';
  if (work.globalState === 'INTEGRATING' && work.pendingApprovalActionLevel === 'A4' && !route?.explicitApprovalRequired) return evidence ? '运行 run 完成本地集成闭环' : '提交当前候选验证证据';
  if (work.globalState === 'PASSED') return '准备正式集成审批';
  if (inspection.route?.nextLegalState && inspection.route.nextLegalState !== 'RETURN') return '运行 run 推进已满足条件的安全状态';
  return '等待当前阶段门条件满足';
}

/** 在稳定入口中复用场景完成硬门，并把 V2/V3 的同 Work Item 阶段出口转成阻断提示。 */
function sceneCompletionBlocker({ work, implementationPackage, evidence, repo }, deps) {
  const visualStage = String(work.visualStage ?? work.stageId ?? '').trim().toUpperCase();
  let guardError = null;
  if (typeof deps.assertSceneWorkItemComplete === 'function') {
    try {
      deps.assertSceneWorkItemComplete(work, implementationPackage, repo, evidence);
    } catch (error) {
      guardError = error;
    }
  }
  const nextStage = VISUAL_STAGE_NEXT[visualStage];
  if (nextStage) {
    return {
      message: guardError?.message ?? `场景 ${visualStage} 当前阶段已通过，不能直接 COMPLETE`,
      next: `在同一 Work Item 中显式迁移到 ${nextStage} 后再继续`,
      disposition: guardError ? 'repair' : null,
      errorCode: guardError?.errorCode ?? 'SCENE_NEXT_VISUAL_STAGE_REQUIRED',
    };
  }
  return guardError ? toBlocker(guardError, '场景 Work Item 完成门未满足') : null;
}

/** 为 run 的每一步只允许无审批、无外部动作、非 RETURN 的安全状态迁移。 */
function safeTransitionTarget(inspection, deps) {
  const { work, route, implementationPackage, executionState, evidence } = inspection;
  const level = work.pendingApprovalActionLevel;
  if (inspection.blockers.length || work.globalState === 'RETURN' || route?.userInputRequired || route?.explicitApprovalRequired) return null;
  if (['INTAKE', 'BASELINE', 'PROPOSAL'].includes(work.globalState)) return SAFE_RUN_TARGETS.has(route?.nextLegalState) ? route.nextLegalState : null;
  if (work.globalState === 'REVIEW') {
    if (level === 'A1' && work.diffAuditRecord) return 'VALIDATING';
    if (level === 'A2') return 'IMPLEMENTING';
    if (level === 'A3' && implementationPackage) return 'IMPLEMENTING';
    return null;
  }
  if (work.globalState === 'IMPLEMENTING') {
    if (!work.diffAuditRecord) return null;
    if (level === 'A3') {
      if (!executionState || executionState.unitSequenceState !== 'COMPLETE') return null;
      try { deps.assertExecutionWorkflowComplete(work, implementationPackage, inspection.repo, deps.unitIo(inspection.repo)); } catch { return null; }
    }
    return 'VALIDATING';
  }
  if (work.globalState === 'VALIDATING' && evidence) return 'PASSED';
  if (work.globalState === 'PASSED' && evidence && ['A1', 'A2', 'A3'].includes(level)) return 'COMPLETE';
  if (work.globalState === 'PASSED' && level === 'A4' && !route?.explicitApprovalRequired) return 'INTEGRATING';
  if (work.globalState === 'INTEGRATING' && level === 'A4' && !route?.explicitApprovalRequired && evidence) return 'COMPLETE';
  return null;
}

/** 把任意校验异常压缩成唯一根因，避免重复展开同一证据。 */
function toBlocker(error, fallback) {
  const details = error?.result ?? error?.details ?? error;
  const primary = details?.errors?.[0] ?? details;
  return {
    message: primary?.message ?? error?.message ?? fallback,
    next: details?.nextAction ?? primary?.nextAction ?? null,
    disposition: details?.disposition ?? primary?.disposition ?? 'repair',
    errorCode: details?.errorCode ?? primary?.errorCode ?? error?.errorCode ?? null,
  };
}
