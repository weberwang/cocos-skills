import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createStableCommands } from './stable-commands.mjs';

const CLI = resolve(import.meta.dirname, '..', 'workflow-control.mjs');

/** 创建可重复使用的最小 Git 项目，供稳定入口集成测试使用。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-stable-command-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'input.js'), 'export const value = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  return { repo, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
}

/** 调用 CLI 并保留 stdout/stderr，测试只验证控制面而不触发业务命令。 */
function invoke(repo, command, args, cwd = repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd, encoding: 'utf8' });
}

/** 构造稳定入口单元测试使用的最小 Work Item，避免把业务工件写入真实仓库。 */
function makeInjectedWork(overrides = {}) {
  return {
    workItemId: 'WI-INJECTED', stageId: 'G1', globalState: 'VALIDATING',
    pendingApprovalActionLevel: 'A2', pendingApprovalPresentedId: null, pendingApprovalId: 'PENDING-1',
    pendingApprovalObject: '候选对象', pendingApprovalStage: 'G1', pendingApprovalGate: 'F1', pendingApprovalState: 'VALIDATING',
    pendingApprovalContext: 'candidate', pendingApprovalActionType: 'cocos-prototype', pendingApprovalImpactSummary: [],
    pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false,
    pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false,
    pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [],
    diffAuditRecord: 'audit-1', substantiveTradeoffRequired: false, visualDecisionRequired: false,
    ...overrides,
  };
}

/** 注入稳定入口的最小纯控制依赖；transition 只更新内存状态，不执行任何业务动作。 */
function makeInjectedDeps(work, options = {}) {
  const transitions = options.transitions ?? [];
  const packageValue = options.packageValue ?? null;
  const evidence = options.evidence ?? { evidenceId: 'E-1' };
  const routeNext = (state) => ({ INTAKE: 'BASELINE', BASELINE: 'PROPOSAL', PROPOSAL: 'REVIEW' }[state.globalState] ?? null);
  return {
    transitions,
    validateWorkItem: () => work,
    readJson: () => packageValue ?? work,
    validateImplementationPackage: () => packageValue,
    loadVisualManifestSnapshot: () => ({ manifest: null, errors: [] }),
    validateVisualStagePrerequisites: () => ({ required: false, ok: true }),
    structuredVisualStageFailure: (value) => value,
    evidenceCheck: () => options.withEvidence ? evidence : null,
    readLedger: () => ({ schemaVersion: '1.0', approvals: [] }),
    deriveRoute: (current) => ({
      userInputRequired: current.substantiveTradeoffRequired === true || current.visualDecisionRequired === true,
      explicitApprovalRequired: ['A4', 'A5', 'A6'].includes(current.pendingApprovalActionLevel),
      blockers: [], nextLegalState: routeNext(current),
    }),
    effectiveApproval: () => null,
    computePlanFingerprint: () => `sha256:${'b'.repeat(64)}`,
    executionStateSummary: () => options.executionSummary ?? { workflowState: 'COMPLETE', unitSequenceState: 'COMPLETE' },
    loadExecutionState: () => ({ state: {} }),
    unitIo: () => ({}),
    assertExecutionWorkflowComplete: () => undefined,
    assertSceneWorkItemComplete: () => undefined,
    transition: (args) => {
      transitions.push(args);
      if (options.mutate !== false) work.globalState = args.to;
    },
  };
}

/** 暂时屏蔽稳定结果输出，便于直接断言 createStableCommands 的控制面返回值。 */
function withoutOutput(callback) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try { return callback(); } finally { process.stdout.write = originalWrite; }
}

/** 验证 run 连续推进基础控制面状态、check 只读、status/JSON 与指纹输出。 */
test('run/check/status 提供稳定紧凑入口', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const outsideCwd = mkdtempSync(join(tmpdir(), 'cocos-stable-cwd-'));
  const advanced = invoke(fixture.repo, 'run', ['--repo', fixture.repo, '--work-item', '.workflow-control/work-items/WI-1.json', '--json'], outsideCwd);
  assert.equal(advanced.status, 0, advanced.stderr);
  const advancedValue = JSON.parse(advanced.stdout);
  assert.deepEqual(advancedValue.changed, ['INTAKE → BASELINE', 'BASELINE → PROPOSAL', 'PROPOSAL → REVIEW']);
  assert.match(advancedValue.metadata.planFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(advancedValue.metadata.workflowView, { phaseId: 'global-baseline', phaseLabel: '全局基线', sceneStepId: null, sceneStepLabel: null });
  assert.equal(JSON.parse(readFileSync(workPath, 'utf8')).globalState, 'REVIEW');
  assert.equal(existsSync(join(outsideCwd, '.workflow-control')), false);
  const before = readFileSync(workPath);
  const first = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--input', 'src/input.js', '--json']);
  const second = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--input', 'src/input.js', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(before, readFileSync(workPath));
  const status = invoke(fixture.repo, 'status', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(Object.keys(JSON.parse(status.stdout)), ['status', 'stage', 'changed', 'blocking', 'next', 'metadata']);
});

test('run 从 VALIDATING 连续推进到 PASSED 和 COMPLETE', () => {
  const work = makeInjectedWork({
    pendingApprovalActionLevel: 'A3', pendingApprovalActionType: 'cocos-code-change', implementationPackageRecord: 'package.json',
  });
  const deps = makeInjectedDeps(work, {
    withEvidence: true,
    packageValue: { packageId: 'PKG-1', executionUnits: [{ unitType: 'SHARED' }] },
  });
  const result = withoutOutput(() => createStableCommands(deps).run({ 'work-item': 'ignored', repo: '.', evidence: 'evidence.json', json: true }));
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(result.changed, ['VALIDATING → PASSED', 'PASSED → COMPLETE']);
  assert.equal(work.globalState, 'COMPLETE');
  assert.equal(deps.transitions.length, 2);
});

test('run 进入 IMPLEMENTING 后停止，下一次 run 才能继续证据门', () => {
  const work = makeInjectedWork({ globalState: 'REVIEW', pendingApprovalActionLevel: 'A2', pendingApprovalActionType: 'cocos-prototype' });
  const deps = makeInjectedDeps(work);
  const result = withoutOutput(() => createStableCommands(deps).run({ 'work-item': 'ignored', repo: '.', json: true }));
  assert.equal(result.stage, 'G1/IMPLEMENTING');
  assert.deepEqual(result.changed, ['REVIEW → IMPLEMENTING']);
  assert.equal(deps.transitions.length, 1);
});

test('run 在缺少证据、用户决定、A4-A6 或 RETURN 时保持只读停止', () => {
  const cases = [
    { name: '缺证据', work: makeInjectedWork({ globalState: 'VALIDATING' }), options: {}, expectedNext: '提交当前候选验证证据' },
    { name: '用户决定', work: makeInjectedWork({ globalState: 'REVIEW', substantiveTradeoffRequired: true }), options: {}, expectedNext: '澄清用户选择并更新 Work Item 或权威工件' },
    { name: 'A4', work: makeInjectedWork({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A4', pendingApprovalActionType: 'cocos-integration' }), options: {}, expectedNext: '先展示当前待处理事项' },
    { name: 'A5', work: makeInjectedWork({ pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload' }), options: {}, expectedNext: '先展示当前待处理事项' },
    { name: 'A6', work: makeInjectedWork({ pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'cocos-release' }), options: {}, expectedNext: '先展示当前待处理事项' },
    { name: 'RETURN', work: makeInjectedWork({ globalState: 'RETURN' }), options: {}, expectedNext: '按 returnRecord 的最小受影响范围显式迁移到前序状态' },
  ];
  for (const current of cases) {
    const deps = makeInjectedDeps(current.work, current.options);
    const result = withoutOutput(() => createStableCommands(deps).run({ 'work-item': 'ignored', repo: '.', json: true }));
    assert.equal(deps.transitions.length, 0, current.name);
    assert.equal(result.next, current.expectedNext, current.name);
  }
});

test('场景 V2/V3 在 PASSED 时提示同一 Work Item 的下一视觉阶段', () => {
  const work = makeInjectedWork({ globalState: 'PASSED', pendingApprovalActionLevel: 'A1', visualStage: 'V2' });
  const deps = makeInjectedDeps(work, { withEvidence: true });
  deps.assertSceneWorkItemComplete = () => { throw new Error('场景 Work Item 只有 V4 运行态联合验收完成后才能 COMPLETE'); };
  const result = withoutOutput(() => createStableCommands(deps).run({ 'work-item': 'ignored', repo: '.', evidence: 'evidence.json', json: true }));
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.changed, []);
  assert.match(result.blocking[0], /V4/);
  assert.equal(result.next, '在同一 Work Item 中显式迁移到 V3 后再继续');
  assert.equal(deps.transitions.length, 0);
});

test('重复 run 不重复写入，错误迁移依赖也会在有限步内停止', () => {
  const work = makeInjectedWork({ globalState: 'INTAKE', pendingApprovalActionLevel: 'A1', diffAuditRecord: null });
  const deps = makeInjectedDeps(work);
  const commands = createStableCommands(deps);
  const first = withoutOutput(() => commands.run({ 'work-item': 'ignored', repo: '.', json: true }));
  const writesAfterFirstRun = deps.transitions.length;
  const second = withoutOutput(() => commands.run({ 'work-item': 'ignored', repo: '.', json: true }));
  assert.deepEqual(first.changed, ['INTAKE → BASELINE', 'BASELINE → PROPOSAL', 'PROPOSAL → REVIEW']);
  assert.deepEqual(second.changed, []);
  assert.equal(deps.transitions.length, writesAfterFirstRun);

  const loopWork = makeInjectedWork({ globalState: 'INTAKE' });
  const loopDeps = makeInjectedDeps(loopWork, { mutate: false });
  const loop = withoutOutput(() => createStableCommands(loopDeps).run({ 'work-item': 'ignored', repo: '.', json: true }));
  assert.equal(loop.status, 'BLOCKED');
  assert.equal(loop.metadata.errorCode, 'SAFE_RUN_STATE_MISMATCH');
  assert.deepEqual(loop.changed, []);
  assert.equal(loopDeps.transitions.length, 1);
});

/** run 的自动状态推进不能隐式执行场景阶段切换。 */
test('run 拒绝视觉阶段参数且不写入状态', () => {
  const work = makeInjectedWork({ globalState: 'REVIEW', pendingApprovalActionLevel: 'A1', diffAuditRecord: null });
  const deps = makeInjectedDeps(work);
  const result = withoutOutput(() => createStableCommands(deps).run({ 'work-item': 'ignored', repo: '.', 'visual-stage': 'V3', json: true }));
  assert.equal(result.metadata.errorCode, 'VISUAL_STAGE_EXPLICIT_REQUIRED');
  assert.equal(deps.transitions.length, 0);
});

test('CLI 帮助支持顶层、命令级和短选项入口，未知命令仍拒绝', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-help-'));
  for (const args of [['--help'], ['-h'], ['help'], ['help', 'run'], ['run', '--help'], ['check', '-h'], ['status', '--help'], ['init', '--help']]) {
    const result = invoke(repo, args[0], args.slice(1));
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stdout, /用法：/);
  }
  assert.match(invoke(repo, 'help', ['run']).stdout, /--work-item/);
  assert.match(invoke(repo, 'init', ['--help']).stdout, /--baseline-hash/);
  const unknown = invoke(repo, 'unknown-command', ['--help']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /未知命令/);
});

/** 验证关键输入文件变化会被 check 指纹感知。 */
test('check 指纹随关键输入变化而变化', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--baseline-hash', fixture.head, '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(Object.hasOwn(JSON.parse(initialized.stdout), 'ledger'), false);
  assert.equal(existsSync(join(fixture.repo, '.workflow-control', 'approvals', 'ledger.json')), false);
  const first = JSON.parse(invoke(fixture.repo, 'check', ['--work-item', workPath, '--input', 'src/input.js', '--json']).stdout);
  writeFileSync(join(fixture.repo, 'src', 'input.js'), 'export const value = 2;\n');
  const second = JSON.parse(invoke(fixture.repo, 'check', ['--work-item', workPath, '--input', 'src/input.js', '--json']).stdout);
  assert.notEqual(first.metadata.planFingerprint, second.metadata.planFingerprint);
});

/** 验证阻断结果对自动化返回非零，status 作为查询入口仍成功返回。 */
test('run/check 阻断返回 2，status 阻断仍返回 0', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--baseline-hash', fixture.head, '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const work = JSON.parse(readFileSync(workPath, 'utf8'));
  work.globalState = 'INTEGRATING'; work.pendingApprovalActionLevel = 'A4';
  work.pendingApprovalActionType = 'cocos-integration'; work.pendingApprovalImpactSummary = ['破坏性替换集成入口']; work.pendingApprovalDestructive = true;
  work.allowedActions = [...work.allowedActions, 'cocos-integration']; work.explicitApprovalActionLevels = ['A4'];
  writeFileSync(workPath, `${JSON.stringify(work)}\n`);
  const check = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  const run = invoke(fixture.repo, 'run', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  const status = invoke(fixture.repo, 'status', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  assert.equal(check.status, 2); assert.equal(JSON.parse(check.stdout).status, 'BLOCKED');
  assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).status, 'BLOCKED');
  assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).status, 'BLOCKED');
});

/** 通过依赖注入验证 RETURN 和 A4 都不会被 run 自动推进。 */
test('run 永不自动选择 RETURN 或执行 A4-A6', () => {
  const transitions = [];
  const baseWork = { stageId: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalPresentedId: null, pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'object', pendingApprovalActionType: 'cocos-code-change', pendingApprovalExternalTargets: [] };
  const deps = {
    validateWorkItem: (value) => value,
    readJson: () => baseWork,
    validateImplementationPackage: () => null,
    loadVisualManifestSnapshot: () => ({ manifest: null, errors: [] }),
    validateVisualStagePrerequisites: () => ({ required: false, ok: true }),
    structuredVisualStageFailure: (value) => value,
    evidenceCheck: () => null,
    readLedger: () => ({ schemaVersion: '1.0', approvals: [] }),
    deriveRoute: () => ({ userInputRequired: false, explicitApprovalRequired: false, blockers: [], nextLegalState: 'BASELINE' }),
    effectiveApproval: () => null,
    computePlanFingerprint: () => `sha256:${'a'.repeat(64)}`,
    executionStateSummary: () => null,
    loadExecutionState: () => ({ state: {} }),
    unitIo: () => ({}),
    assertExecutionWorkflowComplete: () => null,
    transition: () => transitions.push(true),
  };
  const commands = createStableCommands(deps);
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    baseWork.globalState = 'RETURN';
    commands.run({ 'work-item': 'ignored', repo: '.', json: true });
    baseWork.globalState = 'INTEGRATING'; baseWork.pendingApprovalActionLevel = 'A4';
    commands.run({ 'work-item': 'ignored', repo: '.', json: true });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(transitions, []);
});

test('A3 nextAction 先完成待执行单元，再提示候选变更审计', () => {
  const work = {
    stageId: 'G1', globalState: 'IMPLEMENTING', pendingApprovalActionLevel: 'A3',
    pendingApprovalPresentedId: null, pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'object',
    pendingApprovalActionType: 'cocos-code-change', pendingApprovalExternalTargets: [], diffAuditRecord: null, implementationPackageRecord: 'package.json',
  };
  const deps = {
    validateWorkItem: (value) => value,
    readJson: () => work,
    validateImplementationPackage: () => ({}),
    loadVisualManifestSnapshot: () => ({ manifest: null, errors: [] }),
    validateVisualStagePrerequisites: () => ({ required: false, ok: true }),
    structuredVisualStageFailure: (value) => value,
    evidenceCheck: () => null,
    readLedger: () => ({ schemaVersion: '1.0', approvals: [] }),
    deriveRoute: () => ({ userInputRequired: false, explicitApprovalRequired: false, blockers: [], nextLegalState: null }),
    effectiveApproval: () => null,
    computePlanFingerprint: () => `sha256:${'a'.repeat(64)}`,
    executionStateSummary: () => ({ workflowState: 'IN_PROGRESS' }),
    loadExecutionState: () => ({ state: {} }),
    unitIo: () => ({}),
    assertExecutionWorkflowComplete: () => null,
    transition: () => undefined,
  };
  const commands = createStableCommands(deps);
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.equal(commands.status({ 'work-item': 'ignored', repo: '.', json: true }).next, '完成当前待执行单元');
    // V2 单元序列完成后可能继续进入 V3 planning，workflowState 仍为 IN_PROGRESS；此时应进入审计提示。
    deps.executionStateSummary = () => ({ workflowState: 'IN_PROGRESS', unitSequenceState: 'COMPLETE' });
    assert.equal(commands.status({ 'work-item': 'ignored', repo: '.', json: true }).next, '记录当前候选变更审计');
  } finally {
    process.stdout.write = originalWrite;
  }
});
