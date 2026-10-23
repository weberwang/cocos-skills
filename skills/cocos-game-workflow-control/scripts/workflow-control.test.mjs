/** 风险驱动门禁 CLI 的工作项范围、审批和不可绕过边界回归测试。 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createExecutionState, executionStatePath, scopedDiffFingerprint } from './execution-unit-control.mjs';
import { parallelBatchFingerprint } from './parallel-batch-control.mjs';
import { bindVisualEvidenceFixture, bindPackageToVisualEvidenceFixture } from './workflow-visual-evidence-fixture.mjs';
import { createReturnRecord } from './return-disposition.mjs';
import { registerRelaxedWorkflowTests } from './workflow-control-relaxed-cases.mjs';
import { RESPONSIVE_CONTRACT_FIELDS } from './responsive-viewport-contract.mjs';
import { calculateFixedDesignViewport } from '../../cocos-game-ui-layout/scripts/fixed-design-viewport.mjs';
import { writeFixtureV2Layout } from './v2-layout-source-test-fixtures.mjs';

const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');
const INITIALIZER = resolve(import.meta.dirname, '..', '..', 'cocos-game-orchestrator', 'scripts', 'initialize_project_docs.mjs');
const HASH = `sha256:${'a'.repeat(64)}`; const CANDIDATE_HASH = `sha256:${'b'.repeat(64)}`; const VISUAL_DIFF = `sha256:${'c'.repeat(64)}`;
const RESPONSIVE_TEMPLATE = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'cocos-game-ui-layout', 'assets', 'ordinary-ui-layout-contract-template.yaml'), 'utf8'));
const RESPONSIVE_FIXTURE = Object.fromEntries(RESPONSIVE_CONTRACT_FIELDS.map((field) => [field, structuredClone(RESPONSIVE_TEMPLATE[field])]));

/** 写入格式稳定的 JSON 测试工件。 */
function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 计算测试工件的 SHA-256。 */
function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 创建包含稳定基线的隔离 Git 仓库。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-risk-gate-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const value = 1;\n');
  writeFileSync(join(repo, 'src', 'old.js'), 'export const old = true;\n');
  writeFileSync(join(repo, 'docs', 'spec.md'), '# spec\n');
  const sceneMasterPath = join(repo, 'docs', 'high-fidelity-scene.png');
  const reconstructionContractPath = join(repo, 'docs', 'scene-reconstruction-contract.json');
  const decompositionAnnotationPath = join(repo, 'docs', 'decomposition-annotation.png');
  const technicalDecompositionPath = join(repo, 'docs', 'technical-decomposition.json');
  const confirmationPath = join(repo, 'docs', 'v2-decomposition-confirmation.json');
  const pauseContextPath = join(repo, 'docs', 'pause-context.png');
  const settingsContextPath = join(repo, 'docs', 'settings-context.png');
  writeFileSync(sceneMasterPath, 'scene-master\n'); writeFileSync(reconstructionContractPath, 'scene-reconstruction-contract\n'); writeFileSync(decompositionAnnotationPath, 'decomposition-annotation\n'); writeFileSync(technicalDecompositionPath, 'technical-decomposition\n'); writeFileSync(confirmationPath, 'decomposition-confirmation\n');
  writeFileSync(pauseContextPath, 'pause-context\n'); writeFileSync(settingsContextPath, 'settings-context\n');
  // 先提供真实 V2 布局来源，V3/V4 辅助函数只绑定其资源和运行证据。
  const viewport = { width: 390, height: 844 };
  const layoutNodes = [{ layout_node_id: 'source-node', parent_layout_node_id: 'viewport', region_id: 'source-region', target_bounds: { x: 1, y: 2, width: 3, height: 4 } }];
  const reconstructionContract = { target_conditions: { scene_id: 'play', state_id: 'default', viewport }, layout_decomposition: { layout_annotation: {}, layout_annotation_confirmation: {} } };
  writeFixtureV2Layout(repo, reconstructionContract, layoutNodes);
  writeJson(reconstructionContractPath, reconstructionContract);
  writeJson(join(repo, 'docs', 'high-fidelity-scene.json'), { schemaVersion: 'cocos-scene-v2-reconstruction-plan/1.0', workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', targetSha256: HASH, candidateSha256: CANDIDATE_HASH, diffFingerprint: VISUAL_DIFF, sceneMaster: { file: 'docs/high-fidelity-scene.png', sha256: hashFile(sceneMasterPath), sceneId: 'play' }, sceneReconstructionContract: { file: 'docs/scene-reconstruction-contract.json', sha256: hashFile(reconstructionContractPath), sceneId: 'play' }, decompositionAnnotation: { file: 'docs/decomposition-annotation.png', sha256: hashFile(decompositionAnnotationPath), sceneId: 'play' }, technicalDecomposition: { file: 'docs/technical-decomposition.json', sha256: hashFile(technicalDecompositionPath), sceneId: 'play' }, visualDecompositionConfirmation: { confirmationId: 'V2-CONFIRM-1', confirmationMode: 'manual', status: 'PASS', targetSha256: HASH, candidateSha256: CANDIDATE_HASH, diffFingerprint: VISUAL_DIFF, evidenceFile: 'docs/v2-decomposition-confirmation.json', evidenceSha256: hashFile(confirmationPath) }, visualProductionContract: { contractId: 'VPC-1' }, visualProductionUnits: [{ unitId: 'scene-root', owner: 'fixed-production-visual' }], displayLayerContexts: [{ displayLayerId: 'pause', hostSceneId: 'play', hostContextImage: { file: 'docs/pause-context.png', sha256: hashFile(pauseContextPath), sceneId: 'play', displayLayerId: 'pause', hostSceneId: 'play' } }, { displayLayerId: 'settings', hostSceneId: 'play', hostContextImage: { file: 'docs/settings-context.png', sha256: hashFile(settingsContextPath), sceneId: 'play', displayLayerId: 'settings', hostSceneId: 'play' } }] });
  bindVisualEvidenceFixture({ repo, work: { workItemId: 'WI-1', baselineHash: HASH, visualStageEvidenceRefs: { V2: { path: 'docs/high-fidelity-scene.json' } } }, pkg: { executionUnits: [] } });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  return { repo, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
}

/** 构造绑定用户原始请求的 Work Item。 */
function makeWork(head, overrides = {}) {
  return {
    workItemId: 'WI-1', projectId: 'P-1', moduleIds: ['core', 'scene'], domain: 'code', stageId: 'G1', globalState: 'IMPLEMENTING', baselineId: head, baselineVersion: '1', baselineHash: HASH,
    objective: '实现明确 Cocos 功能', userOriginalText: '实现 core Cocos 功能',
    inScope: ['core'], outOfScope: ['release'], approvedRequirements: ['REQ-1'], allowedActions: ['cocos-inspect', 'cocos-spec-candidate', 'cocos-prototype', 'cocos-code-change', 'cocos-integration', 'cocos-build-upload', 'cocos-release'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3'], explicitApprovalActionLevels: ['A4', 'A5', 'A6'], prohibitedActions: [], allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], allowedExternalTargets: ['store/app'], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null,
    assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['tests pass'], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-1',
    pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'core implementation', pendingApprovalStage: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalGate: 'F0', pendingApprovalState: 'IMPLEMENTING', pendingApprovalContext: 'implementation', pendingApprovalActionType: 'cocos-code-change', pendingApprovalImpactSummary: [], pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: '2026-08-11T00:00:00.000Z', pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null,
    validationBatchId: 'BATCH-1', changeRequestFiles: [], moduleGateRequired: false, substantiveTradeoffRequired: false, visualDecisionRequired: false, releaseWorkItem: false,
    visualStage: 'V4', visualStageState: 'v4-runtime-integration-candidate', visualStageEvidenceRefs: { V2: { path: 'docs/high-fidelity-scene.json', sha256: '', workItemId: 'WI-1' }, V3: { path: 'docs/v3-acceptance.json', sha256: '', workItemId: 'WI-1' }, V4: { path: 'docs/v4-runtime-candidate.json', sha256: '', workItemId: 'WI-1' } },
    responsiveContractVersion: 'responsive-viewport/1.0', layoutContractVersion: 'layout/1.0', visualBaselineVersion: 'visual-baseline/1.0',
    ...structuredClone(RESPONSIVE_FIXTURE),
    ...overrides
  };
}

/** 构造直接绑定 Work Item 而非审批记录的 Implementation Package。 */
function makePackage(overrides = {}) {
  return { packageId: 'PKG-1', workItemId: 'WI-1', baselineVersion: '1', baselineHash: HASH, approvedRequirements: ['REQ-1'], approvedArchitecture: 'ARCH-FACT', responsiveContractVersion: 'responsive-viewport/1.0', layoutContractVersion: 'layout/1.0', visualBaselineVersion: 'visual-baseline/1.0', ...structuredClone(RESPONSIVE_FIXTURE), fileOwnership: { 'src/main.js': 'implementer', 'src/module': 'implementer', 'src/scene': 'implementer' }, executionUnits: [
    { unitId: 'SHARED-1', unitType: 'SHARED', scopeId: 'runtime-contract', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/main.js'], stateOwnership: ['runtime-contract'], acceptanceCommands: ['node --test'], serializationReason: '先冻结共享契约', highFidelityPrerequisite: null },
    { unitId: 'MODULE-1', unitType: 'MODULE', scopeId: 'core-module', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/module'], stateOwnership: ['core-state'], acceptanceCommands: ['node --test'], serializationReason: '等待共享契约冻结', highFidelityPrerequisite: null },
    { unitId: 'SCENE-1', unitType: 'SCENE', scopeId: 'play-scene', moduleId: 'scene', sceneId: 'play', displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/scene'], stateOwnership: ['scene-state'], acceptanceCommands: ['node --test'], serializationReason: '等待全部模块完成', highFidelityPrerequisite: { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', displayLayerId: null, hostSceneId: null, targetSha256: HASH, candidateSha256: CANDIDATE_HASH, diffFingerprint: VISUAL_DIFF, evidenceFile: 'docs/high-fidelity-scene.json', evidenceSha256: '' } }
  ], allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], expectedAddedFiles: [], expectedDeletedFiles: [], testScope: ['node --test'], outOfScope: ['release'], compatibilityStrategy: '不保留旧版兼容', definitionOfDone: ['tests pass'], stopConditions: ['scope changes'], ...overrides };
}

/** 构造只包含项目骨架和场景无关基础模块的 foundation-only 包。 */
function makeFoundationPackage(overrides = {}) {
  const pkg = makePackage(overrides);
  pkg.executionUnits = pkg.executionUnits.filter((unit) => unit.unitType === 'SHARED' || unit.unitType === 'MODULE');
  const ownedPaths = new Set(pkg.executionUnits.flatMap((unit) => unit.ownedPaths));
  pkg.fileOwnership = Object.fromEntries(Object.entries(pkg.fileOwnership).filter(([file]) => ownedPaths.has(file)));
  return pkg;
}

/** 构造仅在 MODULE 阶段并行、场景随后串行的顺序包。 */
function makePhaseOrderedParallelPackage() {
  const pkg = makePackage();
  const module = pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-1');
  module.parallelMode = 'PARALLEL'; module.parallelGroup = 'PG-1'; module.serializationReason = null;
  pkg.fileOwnership['src/module-peer'] = 'implementer';
  const sceneIndex = pkg.executionUnits.findIndex((unit) => unit.unitId === 'SCENE-1');
  pkg.executionUnits.splice(sceneIndex, 0, { ...module, unitId: 'MODULE-2', scopeId: 'core-module-peer', ownedPaths: ['src/module-peer'], stateOwnership: ['core-peer-state'] });
  return pkg;
}

/** 构造绑定单个实施单元的 A3 委派。 */
function makeDelegation(agent, unitId, group, ownership, overrides = {}) {
  return { workItemId: 'WI-1', stageId: 'G1', owner: 'orchestrator', assignedAgent: agent, executionUnitIds: [unitId], parallelGroup: group, ownership: [ownership], allowedActions: ['cocos-code-change'], forbiddenActions: [], actionLevel: 'A3', allowedPaths: [ownership], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true, ...overrides };
}

/** 从当前委派文件构造带内容哈希和派生索引的不可变并行批次。 */
function makeParallelBatch(repo, delegationFiles, overrides = {}) {
  const files = [...delegationFiles].sort();
  const delegations = files.map((path) => JSON.parse(readFileSync(resolve(repo, path), 'utf8')));
  const delegationHashes = Object.fromEntries(files.map((path) => [path, hashFile(resolve(repo, path))]));
  const executionUnitIds = [...new Set(delegations.flatMap((delegation) => delegation.executionUnitIds ?? []))].sort();
  const assignedAgents = [...new Set(delegations.map((delegation) => delegation.assignedAgent))].sort();
  const batch = { batchId: 'PB-1', workItemId: 'WI-1', packageId: 'PKG-1', baselineHash: HASH, parallelGroup: 'PG-1', delegationFiles: files, delegationHashes, executionUnitIds, assignedAgents, createdAt: '2026-08-11T00:03:00.000Z', ...overrides };
  batch.fingerprint = parallelBatchFingerprint(batch);
  return batch;
}

/** 构造所有实施单元均为串行的包，便于验证 READY 门。 */
function makeSerialPackage() {
  const pkg = makePackage();
  for (const unit of pkg.executionUnits) {
    unit.parallelMode = 'SERIAL'; unit.parallelGroup = null;
    if (!unit.serializationReason) unit.serializationReason = '按预设顺序串行';
  }
  return pkg;
}

/** 构造显式 a1→a2→a3 的串行预设包，验证数组位置而非依赖字段生效。 */
function makeOrderedSerialPackage() {
  const pkg = makeSerialPackage();
  pkg.executionUnits = pkg.executionUnits.map((unit, index) => ({ ...unit, unitId: `a${index + 1}`, scopeId: `ordered-${index + 1}` }));
  return pkg;
}

/** 构造精确显式批准记录。 */
function makeApproval(work, overrides = {}) {
  return {
    approvalId: 'AP-1', promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext, workItemId: work.workItemId, userOriginalText: '批准当前唯一对象', approvedAt: '2026-08-11T00:01:00.000Z', explicitObject: work.pendingApprovalObject, stageId: work.stageId, moduleIds: work.moduleIds, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, impactSummary: work.pendingApprovalImpactSummary, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, gate: work.pendingApprovalGate, invalidatedWhen: ['baseline changes'], externalTargets: work.pendingApprovalExternalTargets, invalidatedAt: null,
    ...overrides
  };
}

/** 创建完整控制工件夹具。 */
function setup(workOverrides = {}, approvals = [], packageFactory = makePackage) {
  const { repo, head } = makeRepo();
  const root = join(repo, '.workflow-control');
  const workPath = join(root, 'work-items', 'WI-1.json');
  const ledgerPath = join(root, 'approvals', 'ledger.json');
  const packagePath = join(root, 'implementation-package.json');
  mkdirSync(join(root, 'evidence', 'WI-1'), { recursive: true });
  const workValue = makeWork(head, workOverrides);
  const packageValue = packageFactory();
  bindVisualEvidenceFixture({ repo, work: workValue, pkg: packageValue });
  writeJson(workPath, { ...workValue, ...workOverrides });
  writeJson(ledgerPath, { schemaVersion: '1.0', approvals });
  writeJson(packagePath, packageValue);
  const work = JSON.parse(readFileSync(workPath, 'utf8'));
  if (work.globalState === 'IMPLEMENTING') writeExecutionState({ repo, workPath, packagePath });
  return { repo, head, root, workPath, ledgerPath, packagePath };
}

/** 写入自定义实施包时重新绑定当前 Work Item 的不可变 V2 证据，避免测试误命中无关前置门。 */
function writeBoundPackage(fixture, pkg) {
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  bindPackageToVisualEvidenceFixture({ repo: fixture.repo, work, pkg });
  writeJson(fixture.packagePath, pkg);
}

/** 为实现阶段测试夹具写入与当前包/阶段绑定的初始顺序状态。 */
function writeExecutionState(fixture) {
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(fixture.packagePath, 'utf8'));
  bindPackageToVisualEvidenceFixture({ repo: fixture.repo, work, pkg });
  writeJson(fixture.packagePath, pkg);
  const state = createExecutionState(work, pkg, { hashText: (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`, resolve, existsSync, readFileSync, fileHash: hashFile, repo: fixture.repo }, '2026-08-11T00:01:00.000Z');
  writeJson(join(fixture.repo, executionStatePath(work)), state);
}

/** 执行控制 CLI 并返回子进程结果。 */
function run(command, args, repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
}

/** 并行启动两个独立 CLI 进程，验证 Execution State 的跨进程锁而非顺序调用。 */
function runConcurrent(command, args, repo) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
}

/** 断言命令被风险门拒绝。 */
function rejects(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

/** 生成安全 A3 的真实 diff audit。 */
function auditA3(fixture) {
  writeFileSync(join(fixture.repo, 'src', 'main.js'), 'export const value = 2;\n');
  const record = join(fixture.root, 'evidence', 'WI-1', 'diff-audit.json');
  const result = run('diff-audit', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--baseline', 'HEAD~0', '--baseline-hash', HASH, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--record', record], fixture.repo);
  assert.equal(result.status, 0, result.stderr);
  return { record, audit: JSON.parse(result.stdout) };
}

/** 为当前默认实施包写入全部单元的有效完成证据。 */
function writeUnitResults(fixture, overrides = {}, options = {}) {
  const pkg = JSON.parse(readFileSync(fixture.packagePath, 'utf8'));
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  if (work.globalState === 'IMPLEMENTING') writeExecutionState(fixture);
  const unitsRoot = join(fixture.root, 'evidence', 'WI-1', 'units');
  mkdirSync(unitsRoot, { recursive: true });
  const io = { git: (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }), fileHash: hashFile, hashText: (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`, resolve };
  for (const unit of pkg.executionUnits) {
    const output = join(unitsRoot, `${unit.unitId}-output.txt`);
    writeFileSync(output, `${unit.unitId} passed\n`);
    const relativeOutput = `.workflow-control/evidence/WI-1/units/${unit.unitId}-output.txt`;
    const result = { resultId: `RESULT-${unit.unitId}`, workItemId: 'WI-1', packageId: pkg.packageId, unitId: unit.unitId, baselineHash: HASH, codeFingerprint: `git:${fixture.head}`, diffFingerprint: scopedDiffFingerprint(fixture.repo, fixture.head, unit.ownedPaths, io), completedAt: '2026-08-11T00:02:00.000Z', commands: [{ command: 'node --test', exitCode: 0, outputFile: relativeOutput, outputHash: hashFile(output) }], files: [relativeOutput], fileHashes: { [relativeOutput]: hashFile(output) }, verdict: 'PASS', ...(overrides[unit.unitId] ?? {}) };
    writeJson(join(unitsRoot, `${unit.unitId}.json`), result);
  }
  if (work.globalState === 'IMPLEMENTING' && options.completeState !== false) {
    for (const unit of pkg.executionUnits) {
      const resultPath = join(unitsRoot, `${unit.unitId}.json`);
      const checked = run('unit-check', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--result', resultPath], fixture.repo);
      assert.equal(checked.status, 0, checked.stderr);
    }
  }
}

/** 只推进指定前缀单元，保留下一单元 IN_PROGRESS 以测试 READY 和阶段边界。 */
function completeUnits(fixture, unitIds) {
  for (const unitId of unitIds) {
    const resultPath = join(fixture.root, 'evidence', 'WI-1', 'units', `${unitId}.json`);
    const checked = run('unit-check', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--result', resultPath], fixture.repo);
    assert.equal(checked.status, 0, checked.stderr);
  }
}

/** 创建含两个同阶段 MODULE 代理、委派文件和不可变批次的并行测试夹具。 */
function prepareParallelFixture(state = 'IMPLEMENTING', moduleOnly = false) {
  const packageFactory = () => {
    const pkg = makePhaseOrderedParallelPackage();
    pkg.executionUnits = pkg.executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'MODULE-2' ? { ...unit, owner: 'scene-agent' } : unit);
    if (moduleOnly) pkg.executionUnits = pkg.executionUnits.filter((unit) => unit.unitType === 'MODULE');
    pkg.fileOwnership = moduleOnly
      ? { 'src/module': 'module-agent', 'src/module-peer': 'scene-agent' }
      : { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/module-peer': 'scene-agent', 'src/scene': 'implementer' };
    return pkg;
  };
  const f = setup({ globalState: state, delegatedAgents: ['module-agent', 'scene-agent'], visualStage: moduleOnly ? 'V0' : 'V4', visualStageState: moduleOnly ? 'not-started' : 'v4-runtime-integration-candidate' }, [], packageFactory);
  const pkg = JSON.parse(readFileSync(f.packagePath, 'utf8'));
  writeExecutionState(f);
  writeJson(join(f.root, 'delegations', 'm.json'), makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(join(f.root, 'delegations', 'm2.json'), makeDelegation('scene-agent', 'MODULE-2', 'PG-1', 'src/module-peer'));
  const batchPath = join(f.root, 'delegations', 'batches', 'batch.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/m2.json']));
  return { f, batchPath };
}

/** 生成绑定当前 diff 与 F0-F3 的完整证据。 */
function makeEvidence(fixture, audit) {
  writeUnitResults(fixture);
  const output = join(fixture.root, 'evidence', 'WI-1', 'test-output.txt');
  writeFileSync(output, 'tests passed\n');
  const rel = '.workflow-control/evidence/WI-1/test-output.txt';
  const common = { status: 'PASS', baselineHash: HASH, diffFingerprint: audit.diffFingerprint };
  // V4 门禁现在先验证响应式实测事实；夹具必须覆盖完整矩阵，才能继续断言后续证据门。
  const responsiveBase = {
    verificationStatus: 'verified', runtimeMeasured: true, measuredAt: '2026-08-11T00:02:00.000Z', viewportRect: { width: 320, height: 800 }, canvasRect: { width: 320, height: 800 }, designTransform: calculateFixedDesignViewport({ width: 320, height: 800 }), logicalSize: { width: 320, height: 800 }, backingSize: { width: 640, height: 1600 }, cssDisplaySize: { width: 320, height: 800 }, rawDevicePixelRatio: 2, effectiveDevicePixelRatio: 2, logicalToCssScale: 1, cssToPhysicalScale: 2, gameSize: { width: 320, height: 800 }, cameraViewport: { width: 320, height: 800 }, cameraZoom: 1, cameraOrigin: { x: 0, y: 0 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, edgeGaps: { top: 0, right: 0, bottom: 0, left: 0 }, backgroundCoverage: { covered: true }, keyUiRects: [{ id: 'play', x: 20, y: 20, width: 100, height: 48 }], inputHitResults: [{ id: 'play', logicalPoint: { x: 30, y: 30 }, hit: true }], resizeTrajectory: [{ event: 'same-page-resize' }, { event: 'orientation-change' }, { event: 'dpr-drop-to-1' }, { event: 'dpr-unchanged-resize' }], pageReloaded: false, screenshot: 'evidence/scene.png', sceneId: 'play', stateId: 'default', candidateSha256: CANDIDATE_HASH, layoutContractVersion: 'layout/1.0', visualBaselineVersion: 'visual-baseline/1.0', matrixCases: ['dpr-1', 'dpr-1.25-1.5', 'dpr-2', 'dpr-above-2-cap', 'same-page-resize', 'orientation-change', 'dpr-drop-to-1', 'same-dpr-resize']
  };
  const measured = (width, height, rawDpr, extra = {}) => {
    const effectiveDpr = Math.min(rawDpr, 2);
    return { ...structuredClone(responsiveBase), viewportRect: { width, height }, canvasRect: { width, height }, designTransform: calculateFixedDesignViewport({ width, height }), logicalSize: { width, height }, backingSize: { width: Math.ceil(width * effectiveDpr), height: Math.ceil(height * effectiveDpr) }, cssDisplaySize: { width, height }, rawDevicePixelRatio: rawDpr, effectiveDevicePixelRatio: effectiveDpr, cssToPhysicalScale: { x: effectiveDpr, y: effectiveDpr }, gameSize: { width, height }, cameraViewport: { width, height }, ...extra };
  };
  const responsiveEvidence = [
    measured(360, 800, 1.5, { contextId: 'page-a' }),
    measured(390, 844, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    measured(844, 390, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    measured(1366, 768, 2, { contextId: 'page-b' }),
    measured(1280, 720, 3, { contextId: 'page-b', samePageWithPrevious: true }),
  ];
  return { evidenceId: 'EV-1', batchId: 'BATCH-1', workItemId: 'WI-1', baselineHash: HASH, codeFingerprint: `git:${fixture.head}`, diffFingerprint: audit.diffFingerprint, recordedAt: new Date(Date.parse(audit.recordedAt) + 1000).toISOString(), commands: [{ command: 'node --test', exitCode: 0, outputFile: rel, outputHash: hashFile(output) }], environment: { node: process.version }, dataSources: ['git diff'], files: [rel], fileHashes: { [rel]: hashFile(output) }, gateResults: { F0: { ...common, workItemId: 'WI-1', authorizationBasis: 'TASK_SCOPE' }, F1: { ...common }, F2: { ...common, reviewer: 'independent-reviewer', reviewMode: 'INDEPENDENT' }, F3: { ...common, evidenceId: 'EV-1' } }, responsiveEvidence, verdict: 'PASS', uncoveredItems: [], completedOutputs: ['src/main.js'], completedUnitIds: JSON.parse(readFileSync(fixture.packagePath, 'utf8')).executionUnits.map((unit) => unit.unitId), satisfiedExitCriteria: ['tests pass'] };
}

registerRelaxedWorkflowTests({ assert, test, setup, makeFoundationPackage, makePackage, writeBoundPackage, run, rejects, readFileSync, writeJson, join, rmSync, existsSync, makeEvidence, hash: HASH, prepareParallelFixture, writeUnitResults, makeParallelBatch });

test('基础实施包：仅伪造冻结状态而缺少三候选人工证据时 fail closed', () => {
  const f = setup();
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.visualStage = 'V1'; work.visualStageState = 'global-static-baseline-frozen'; work.globalStaticBaselineState = 'global-static-baseline-frozen';
  writeJson(f.workPath, work);
  writeJson(f.packagePath, makeFoundationPackage());
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /3 张候选图|人工确认|globalVisualBaselineSelectionRef/);
});

test('基础实施包：缺少全局静态 visual_baseline 冻结声明时 fail closed', () => {
  const f = setup();
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.visualStage = 'V1'; work.visualStageState = 'global-static-baseline-frozen'; delete work.globalStaticBaselineState;
  writeJson(f.workPath, work);
  writeJson(f.packagePath, makeFoundationPackage());
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /globalStaticBaselineState|globalVisualBaselineSelectionRef|基础实施包/);
});

test('混合场景实施包：包含 SCENE 时仍必须通过 V2 规划门', () => {
  const f = setup();
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.visualStage = 'V1'; work.visualStageState = 'global-static-baseline-frozen'; work.globalStaticBaselineState = 'global-static-baseline-frozen';
  work.globalVisualBaselineSelectionRef = { path: 'docs/global-baseline-selection.json', sha256: HASH, workItemId: 'WI-1' };
  writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /V2 前置门|V2/);
});

test('正式场景执行：V2 规划完成仍须先验收 V3 资源并进入 V4', () => {
  assert.throws(
    () => setup({ visualStage: 'V2', visualStageState: 'v2-production-planning-complete' }),
    /V4 正式功能执行前置门|V3/,
  );
});

test('响应式身份：Work Item 或 Implementation Package 缺版本时 fail closed', () => {
  const missingWorkVersion = setup({ layoutContractVersion: undefined });
  rejects(run('preflight', ['--work-item', missingWorkVersion.workPath, '--implementation-package', missingWorkVersion.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], missingWorkVersion.repo), /响应式身份|layoutContractVersion/);

  const missingPackageVersion = setup();
  const pkg = JSON.parse(readFileSync(missingPackageVersion.packagePath, 'utf8'));
  delete pkg.visualBaselineVersion;
  writeJson(missingPackageVersion.packagePath, pkg);
  rejects(run('preflight', ['--work-item', missingPackageVersion.workPath, '--implementation-package', missingPackageVersion.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], missingPackageVersion.repo), /响应式身份|visualBaselineVersion/);
});

test('A0-A2：只读、文档和隔离原型依 Work Item 范围直接通过', () => {
  const f = setup({ globalState: 'REVIEW' });
  for (const [level, action, path] of [['A0', 'cocos-inspect', 'src/main.js'], ['A1', 'cocos-spec-candidate', 'docs/spec.md']]) {
    const args = ['--work-item', f.workPath, '--action-level', level, '--path', path];
    args.push('--action-type', action);
    const result = run('preflight', args, f.repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).authorizationBasis, 'TASK_SCOPE');
  }
  const a2 = setup({ globalState: 'IMPLEMENTING' });
  assert.equal(run('preflight', ['--work-item', a2.workPath, '--action-level', 'A2', '--action-type', 'cocos-prototype', '--path', 'src/main.js'], a2.repo).status, 0);
});

test('A3：有效实施包依 Work Item 范围无需 Approval Ledger', () => {
  const f = setup(); const pkg = JSON.parse(readFileSync(f.packagePath, 'utf8')); pkg.visualManifestSha256 = 17; writeJson(f.packagePath, pkg);
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).explicitApprovalRequired, false);
});

test('A3：F0-F3 通过后 PASSED 可直接 COMPLETE', () => {
  const f = setup({ visualStage: 'V0', visualStageState: 'not-started' }, [], makeFoundationPackage);
  const { audit } = auditA3(f);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'evidence.json');
  writeJson(evidencePath, makeEvidence(f, audit));
  assert.equal(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo).status, 0);
  const passed = run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', evidencePath], f.repo);
  assert.equal(passed.status, 0, passed.stderr);
  const complete = run('transition', ['--work-item', f.workPath, '--to', 'COMPLETE', '--evidence', evidencePath], f.repo);
  assert.equal(complete.status, 0, complete.stderr);
});

test('A1：从 REVIEW 连续推进不经过审批状态且不需要 Ledger', () => {
  const f = setup({ globalState: 'REVIEW', visualStage: 'V0', visualStageState: 'not-started', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'cocos-spec-candidate', pendingApprovalFileScope: ['docs'] }, [], makeFoundationPackage);
  const record = join(f.root, 'evidence', 'WI-1', 'a1-audit.json');
  const audited = run('diff-audit', ['--work-item', f.workPath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--artifact', 'docs/spec.md', '--record', record], f.repo);
  assert.equal(audited.status, 0, audited.stderr);
  const audit = JSON.parse(audited.stdout);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'a1-evidence.json');
  writeJson(evidencePath, makeEvidence(f, audit));
  for (const expected of ['VALIDATING', 'PASSED', 'COMPLETE']) {
    const args = ['--work-item', f.workPath];
    if (expected !== 'VALIDATING') args.push('--evidence', evidencePath);
    const result = run('advance', args, f.repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, expected);
  }
});

test('A3：从 REVIEW 直接进入 IMPLEMENTING，不经过审批状态且不需要 Ledger', () => {
  const f = setup({ globalState: 'REVIEW' });
  const result = run('advance', ['--work-item', f.workPath, '--implementation-package', f.packagePath], f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, 'IMPLEMENTING');
});

test('A3：删除旧实现被拒绝并升级到 A4/A6', () => {
  const f = setup();
  const deletionPackage = makePackage({ expectedDeletedFiles: ['src/old.js'] });
  deletionPackage.fileOwnership['src/old.js'] = 'implementer';
  deletionPackage.executionUnits.find((unit) => unit.unitId === 'SHARED-1').ownedPaths.push('src/old.js');
  writeBoundPackage(f, deletionPackage);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/old.js'], f.repo), /A3.*不得删除|升级/);
  rmSync(join(f.repo, 'src', 'old.js'));
  writeBoundPackage(f, makePackage());
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'delete.json')], f.repo), /A3.*不得删除|升级/);
});

test('本地服务：查重后的本项目安全验证启动不需要批准', () => {
  const f = setup();
  const processPath = join(f.root, 'process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [], healthStatus: 'none', existingHealthy: false, reusePlanned: false, privileged: false, externalWrite: false });
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo);
  assert.equal(result.status, 0, result.stderr);
  const unsafe = JSON.parse(readFileSync(processPath, 'utf8')); unsafe.projectRoot = tmpdir(); unsafe.privileged = true; writeJson(processPath, unsafe);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /本项目、非特权/);
});

test('非 Cocos 操作：无 Work Item 时 route/preflight 均直接退出控制面且不落盘', () => {
  const root = mkdtempSync(join(tmpdir(), 'outside-cocos-'));
  for (const action of ['git-push', 'git-reset-hard', 'shell-command', 'github-pr', 'message-send', 'package-install']) {
    for (const command of ['route', 'preflight']) {
      const result = run(command, ['--action-type', action, '--external', '--destructive', '--release', '--record', join(root, `${action}-${command}.json`)], root);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { controlled: false, channel: 'OUT_OF_SCOPE', authorizationBasis: 'OUTSIDE_COCOS_WORKFLOW', explicitApprovalRequired: false });
    }
  }
  assert.deepEqual(readdirSync(root), []);
});

test('Cocos 命名空间：未知动作和非 Cocos 审批工件明确拒绝', () => {
  rejects(run('route', ['--action-type', 'cocos-foo']), /不是受控 Cocos 动作白名单成员/);
  const invalidWork = setup({ pendingApprovalActionType: 'github-pr' });
  rejects(run('status', ['--work-item', invalidWork.workPath], invalidWork.repo), /不是受控 Cocos 动作白名单成员/);
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const invalidApproval = makeApproval(base, { actionType: 'github-release' });
  const ledger = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] }, [invalidApproval]);
  rejects(run('route', ['--work-item', ledger.workPath, '--ledger', ledger.ledgerPath], ledger.repo), /Approval Ledger.actionType.*不是受控 Cocos/);
});

test('A5：没有当前精确外部目标批准时拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'cocos-build-upload', '--object', 'game build', '--external', '--external-target', 'store/app'], f.repo), /没有唯一|审批/);
});

test('A6：破坏、真机与发布永不按 Work Item 范围放行', () => {
  const f = setup({ globalState: 'RELEASE_APPROVAL_REQUIRED', releaseWorkItem: true, pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'cocos-release', pendingApprovalImpactSummary: ['发布到应用商店'], pendingApprovalExternalWrite: true, pendingApprovalRelease: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'cocos-release', '--object', 'store release', '--external-target', 'store/app', '--release'], f.repo), /没有唯一|审批/);
  const device = setup();
  rejects(run('preflight', ['--work-item', device.workPath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js', '--device', '--external-target', 'store/app'], device.repo), /必须为 A6|至少为 A5/);
});

test('A6 真机：精确目标不等于外部写入，device-only 批准可通过且无目标拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', nextGate: 'F4', pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'cocos-device-test', pendingApprovalImpactSummary: ['在指定真机验证游戏构建'], pendingApprovalState: 'INTEGRATING', pendingApprovalGate: 'F4', pendingApprovalPhysicalDevice: true, pendingApprovalExternalWrite: false, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.allowedActions.push('cocos-device-test');
  work.approvalRecord = 'AP-1';
  writeJson(f.workPath, work);
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [makeApproval(work)] });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'cocos-device-test', '--object', work.pendingApprovalObject, '--external-target', 'store/app', '--device'];
  const result = run('preflight', args, f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
  rejects(run('preflight', args.filter((value) => value !== '--external-target' && value !== 'store/app'), f.repo), /必须声明精确 --external-target/);
});

test('A6 发布：请求副作用必须与批准逐字段精确匹配', () => {
  const f = setup({ globalState: 'INTEGRATING', nextGate: 'F4', pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'cocos-release', pendingApprovalImpactSummary: ['发布指定 Cocos 游戏构建'], pendingApprovalState: 'INTEGRATING', pendingApprovalGate: 'F4', pendingApprovalRelease: true, pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.approvalRecord = 'AP-RELEASE';
  writeJson(f.workPath, work);
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [makeApproval(work, { approvalId: 'AP-RELEASE' })] });
  const base = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'cocos-release', '--object', work.pendingApprovalObject, '--external-target', 'store/app'];
  rejects(run('preflight', [...base, '--release'], f.repo), /没有唯一.*精确匹配/);
  rejects(run('preflight', [...base, '--external'], f.repo), /没有唯一.*精确匹配/);
  const complete = run('preflight', [...base, '--external', '--release'], f.repo);
  assert.equal(complete.status, 0, complete.stderr);
});

test('模块与视觉：已有事实基线不机械触发人工门', () => {
  const f = setup({ moduleGateRequired: true, substantiveTradeoffRequired: false, visualDecisionRequired: false });
  assert.equal(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo).status, 0);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.substantiveTradeoffRequired = true; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /USER_INPUT_REQUIRED/);
});

test('Work Item 范围：仓库越界拒绝，旧授权字段不再作为绑定凭据', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', '../outside.js'], f.repo), /越出仓库|allowedPaths/);
  writeBoundPackage(f, makePackage({ taskAuthorizationId: 'FAKE' }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /Schema 禁止字段|taskAuthorizationId/);
});

test('Work Item 范围可在任务内更新，禁止路径和动作冲突仍受校验', () => {
  const f = setup();
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.allowedPaths.push('secrets');
  work.allowedActions.push('cocos-asset-change');
  writeJson(f.workPath, work);
  assert.equal(run('status', ['--work-item', f.workPath], f.repo).status, 0);
  work.prohibitedActions.push('cocos-code-change'); writeJson(f.workPath, work);
  rejects(run('status', ['--work-item', f.workPath], f.repo), /当前动作必须已允许|不得相交/);
});

test('工作项动作集合：pending 未允许或同时被禁止时 status/diff-audit 均拒绝', () => {
  const missing = setup();
  const missingWork = JSON.parse(readFileSync(missing.workPath, 'utf8'));
  missingWork.allowedActions = missingWork.allowedActions.filter((action) => action !== missingWork.pendingApprovalActionType);
  writeJson(missing.workPath, missingWork);
  rejects(run('status', ['--work-item', missing.workPath], missing.repo), /当前动作必须已允许/);

  const prohibited = setup();
  const prohibitedWork = JSON.parse(readFileSync(prohibited.workPath, 'utf8'));
  prohibitedWork.prohibitedActions.push(prohibitedWork.pendingApprovalActionType);
  writeJson(prohibited.workPath, prohibitedWork);
  rejects(run('diff-audit', ['--work-item', prohibited.workPath, '--implementation-package', prohibited.packagePath, '--baseline', prohibited.head, '--baseline-hash', HASH, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--record', join(prohibited.root, 'blocked-audit.json')], prohibited.repo), /当前动作必须已允许|不得相交/);
});

test('范围与委派：A4-A6 操作不能伪装成 A0-A3 委派动作', () => {
  const f = setup({ delegatedAgents: ['worker'] });
  const delegation = { workItemId: 'WI-1', stageId: 'G1', owner: 'orchestrator', assignedAgent: 'worker', executionUnitIds: ['MODULE-1'], parallelGroup: null, ownership: ['src/module'], allowedActions: ['cocos-integration'], forbiddenActions: [], actionLevel: 'A4', allowedPaths: ['src/module'], forbiddenPaths: ['.git'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(f.root, 'delegations', 'high-risk.json'); writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /只能委派 A0-A3/);
});

test('固定动作等级：A0-A3 携带高风险副作用时直接拒绝', () => {
  for (const extra of [
    ['--external', '--external-target', 'store/app'],
    ['--destructive'],
    ['--release', '--external-target', 'store/app'],
    ['--delete'],
    ['--device', '--external-target', 'store/app']
  ]) {
    const f = setup();
    rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js', ...extra], f.repo), /至少为 A5|必须为 A6|破坏性动作必须为 A4\/A6|删除旧实现只允许 A4\/A6/);
    assert.deepEqual(JSON.parse(readFileSync(f.ledgerPath, 'utf8')).approvals, []);
  }
  const wrongLevel = setup();
  rejects(run('preflight', ['--work-item', wrongLevel.workPath, '--action-level', 'A5', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], wrongLevel.repo), /只能使用 A3/);
});

test('用户选择：视觉或实质取舍输出 USER_INPUT_REQUIRED 且不创建审批', () => {
  const visual = setup({ globalState: 'REVIEW', visualDecisionRequired: true, pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'cocos-spec-candidate', pendingApprovalFileScope: ['docs'] });
  const route = JSON.parse(run('route', ['--work-item', visual.workPath], visual.repo).stdout);
  assert.equal(route.authorizationBasis, 'TASK_SCOPE');
  assert.equal(route.userInputRequired, true);
  rejects(run('preflight', ['--work-item', visual.workPath, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--path', 'docs/spec.md'], visual.repo), /USER_INPUT_REQUIRED/);
  rejects(run('advance', ['--work-item', visual.workPath], visual.repo), /USER_INPUT_REQUIRED/);
  assert.deepEqual(JSON.parse(readFileSync(visual.ledgerPath, 'utf8')).approvals, []);
  const substantive = setup({ substantiveTradeoffRequired: true, moduleGateRequired: false });
  rejects(run('preflight', ['--work-item', substantive.workPath, '--implementation-package', substantive.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], substantive.repo), /USER_INPUT_REQUIRED/);
});

test('用户选择：A1-A3 即使有未决选择也不能 prepare-approval，澄清后继续 Work Item', () => {
  const ordinary = setup({ globalState: 'REVIEW', pendingApprovalState: 'REVIEW', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'cocos-spec-candidate', pendingApprovalFileScope: ['docs'] });
  const baseArgs = ['--work-item', ordinary.workPath, '--ledger', ordinary.ledgerPath, '--pending-id', 'PENDING-NEW', '--object', 'visual choice', '--stage', 'G1', '--action-type', 'cocos-spec-candidate', '--action-level', 'A1', '--gate', 'F0', '--context', 'decision', '--path', 'docs'];
  rejects(run('prepare-approval', baseArgs, ordinary.repo), /不能在|A1/);
  const work = JSON.parse(readFileSync(ordinary.workPath, 'utf8')); work.visualDecisionRequired = true; writeJson(ordinary.workPath, work);
  rejects(run('prepare-approval', [...baseArgs, '--impact', '改变视觉方向'], ordinary.repo), /不能在|A1/);
  work.visualDecisionRequired = false; work.globalState = 'REVIEW'; writeJson(ordinary.workPath, work);
  assert.equal(run('preflight', ['--work-item', ordinary.workPath, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--path', 'docs/spec.md'], ordinary.repo).status, 0);
});

test('route：明确区分 Work Item 范围与显式批准', () => {
  const safe = setup();
  const safeRoute = run('route', ['--work-item', safe.workPath], safe.repo);
  assert.equal(JSON.parse(safeRoute.stdout).authorizationBasis, 'TASK_SCOPE');
  const external = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const externalRoute = run('route', ['--work-item', external.workPath, '--ledger', external.ledgerPath], external.repo);
  assert.equal(JSON.parse(externalRoute.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
});

test('操作审批：A4-A6 缺少影响摘要时拒绝准备', () => {
  const f = setup({ globalState: 'PASSED' });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-A4', '--object', 'replace entry', '--stage', 'G1', '--action-type', 'cocos-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'cocos-integration', '--path', 'src', '--destructive'];
  rejects(run('prepare-approval', args, f.repo), /--impact|影响/);
});

test('操作审批：A5/A6 缺少必需副作用时拒绝且不改 Work Item', () => {
  for (const [level, action, error] of [
    ['A5', 'cocos-build-upload', /A5.*外部写入/],
    ['A6', 'cocos-release', /A6.*高风险副作用/]
  ]) {
    const f = setup({ globalState: 'INTEGRATING' });
    const before = readFileSync(f.workPath, 'utf8');
    const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', `PENDING-${level}`, '--object', `${level} operation`, '--stage', 'G1', '--action-type', action, '--action-level', level, '--gate', 'F4', '--context', `${level} operation`, '--impact', '改变 Cocos 游戏外部状态', '--external-target', 'store/app'];
    rejects(run('prepare-approval', args, f.repo), error);
    assert.equal(readFileSync(f.workPath, 'utf8'), before);
    assert.deepEqual(JSON.parse(readFileSync(f.ledgerPath, 'utf8')).approvals, []);
  }
});

test('操作审批：操作与影响精确匹配可通过，篡改或遗漏影响被拒绝', () => {
  const f = setup({ globalState: 'PASSED' });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-A4', '--object', 'replace entry', '--stage', 'G1', '--action-type', 'cocos-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'cocos-integration', '--path', 'src', '--impact', '替换正式入口', '--destructive'];
  assert.equal(run('prepare-approval', args, f.repo).status, 0);
  assert.equal(run('handoff', ['--work-item', f.workPath], f.repo).status, 0);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  const recordPath = join(f.root, 'tampered-approval.json');
  writeJson(recordPath, makeApproval(work, { approvalId: 'AP-BAD', impactSummary: ['删除用户数据'] }));
  rejects(run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--record', recordPath], f.repo), /当前已展示|影响|扩写/);
  const approved = run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--approval-id', 'AP-GOOD', '--user-text', '批准'], f.repo);
  assert.equal(approved.status, 0, approved.stderr);
  const ledger = JSON.parse(readFileSync(f.ledgerPath, 'utf8'));
  assert.deepEqual(ledger.approvals[0].impactSummary, ['替换正式入口']);
});

test('基线与实施包：摘要漂移可通过，范围漂移和所有权缺失仍拒绝', () => {
  const f = setup();
  writeBoundPackage(f, makePackage({ baselineHash: `sha256:${'b'.repeat(64)}` }));
  const stalePackage = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo);
  assert.equal(stalePackage.status, 0, stalePackage.stderr);
  writeBoundPackage(f, makePackage({ allowedPaths: ['src'] }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /范围不一致/);
  writeBoundPackage(f, makePackage({ fileOwnership: { docs: 'implementer' } }));
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 9;\n');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'bad-owner.json')], f.repo), /未归属|未唯一映射/);
});

test('路径门：forbiddenPaths、仓库越界和未授权动作不能旁路', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--path', 'src/secret/token.txt'], f.repo), /forbiddenPaths/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--path', '..'], f.repo), /越出仓库/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A3', '--action-type', 'cocos-asset-change', '--path', 'docs/spec.md'], f.repo), /allowedActions/);
});

test('变更请求：未决范围变化阻断安全 A3', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-1.json'] });
  writeJson(join(f.root, 'change-requests', 'CR-1.json'), { changeRequestId: 'CR-1', workItemId: 'WI-1', change: '扩大玩家可见行为', reason: '新增需求', affectedModules: ['core'], affectedBaselineHash: HASH, invalidatedApprovalIds: [], newRisk: '产品范围变化', newAcceptance: ['new behavior'], userDecisionRequest: '是否扩大范围', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /Change Request.*ACCEPTED 用户决定/);
});

test('变更请求：使用用户决定状态且拒绝旧 APPROVED 审批语义', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-2.json'] });
  const path = join(f.root, 'change-requests', 'CR-2.json');
  const change = { changeRequestId: 'CR-2', workItemId: 'WI-1', change: '扩大玩家可见行为', reason: '用户选择新范围', affectedModules: ['core'], affectedBaselineHash: `sha256:${'b'.repeat(64)}`, invalidatedApprovalIds: [], newRisk: '产品范围变化', newAcceptance: ['new behavior'], userDecisionRequest: '是否接受新范围', status: 'APPROVED' };
  writeJson(path, change);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /PENDING\/ACCEPTED\/REJECTED|用户决定/);
  change.status = 'ACCEPTED'; writeJson(path, change);
  assert.equal(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo).status, 0);
});

test('服务复用：已有健康实例时禁止重复启动', () => {
  const f = setup();
  const processPath = join(f.root, 'healthy-process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [1234], healthStatus: 'healthy', existingHealthy: true, reusePlanned: false, privileged: false, externalWrite: false });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /必须复用/);
});

test('A5/A6：错误外部目标、受保护目标和低等级设备动作均拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'cocos-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'cocos-build-upload', '--object', 'push', '--external', '--external-target', 'production'], f.repo), /受保护|未授权/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A5', '--action-type', 'cocos-build-upload', '--object', 'device', '--external', '--external-target', 'store/app', '--device'], f.repo), /必须为 A6/);
});

test('证据门：SELF 审查仍拒绝，摘要缺失或漂移可验收，失败命令仍拒绝', () => {
  const f = setup();
  const { audit } = auditA3(f); writeUnitResults(f);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidence = makeEvidence(f, audit);
  evidence.gateResults.F2 = { ...evidence.gateResults.F2, reviewer: 'implementer', reviewMode: 'SELF' };
  let path = join(f.root, 'evidence', 'WI-1', 'self.json'); writeJson(path, evidence);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', path], f.repo), /独立 reviewer/);
  evidence.gateResults.F2 = { ...evidence.gateResults.F2, reviewer: 'independent', reviewMode: 'INDEPENDENT' };
  evidence.diffFingerprint = `sha256:${'c'.repeat(64)}`; path = join(f.root, 'evidence', 'WI-1', 'stale.json'); writeJson(path, evidence);
  evidence.baselineHash = 'sha256:stale'; evidence.codeFingerprint = 'git:stale'; evidence.commands[0].outputHash = 'sha256:stale';
  evidence.fileHashes = { 'stale-path': 'not-a-digest' };
  for (const gate of Object.values(evidence.gateResults)) { gate.baselineHash = 'sha256:stale'; gate.diffFingerprint = 'stale'; }
  writeJson(path, evidence);
  const accepted = run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', path], f.repo);
  assert.equal(accepted.status, 0, accepted.stderr);

  const failedFixture = setup();
  const { audit: failedAudit } = auditA3(failedFixture);
  const failedWork = JSON.parse(readFileSync(failedFixture.workPath, 'utf8')); failedWork.globalState = 'VALIDATING'; writeJson(failedFixture.workPath, failedWork);
  const failed = makeEvidence(failedFixture, failedAudit); failed.commands[0].exitCode = 1;
  path = join(failedFixture.root, 'evidence', 'WI-1', 'failed.json'); writeJson(path, failed);
  rejects(run('transition', ['--work-item', failedFixture.workPath, '--to', 'PASSED', '--evidence', path], failedFixture.repo), /命令.*失败/);
});

test('Diff Audit：空 A3 与伪造 owner 拒绝，摘要漂移不阻断同一变更路径', () => {
  const empty = setup();
  rejects(run('diff-audit', ['--work-item', empty.workPath, '--implementation-package', empty.packagePath, '--baseline', empty.head, '--baseline-hash', HASH, '--action-level', 'A3', '--artifact', 'src/main.js', '--record', join(empty.root, 'empty.json')], empty.repo), /禁止空 diff/);
  const f = setup(); const { record } = auditA3(f); writeUnitResults(f);
  const audit = JSON.parse(readFileSync(record, 'utf8')); audit.entries[0].owner = 'forged'; audit.baselineId = 'sha1:stale-baseline'; writeJson(record, audit);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /ownership 不一致/);
  audit.entries[0].owner = 'implementer'; writeJson(record, audit); writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 10;\n');
  const afterContentEdit = run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo);
  assert.equal(afterContentEdit.status, 0, afterContentEdit.stderr);
});

test('并行计划：两个 MODULE 单元可在同组通过并行委派检查', () => {
  const f = setup({ delegatedAgents: ['module-agent', 'scene-agent'] });
  const pkg = makePhaseOrderedParallelPackage();
  pkg.fileOwnership = { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/module-peer': 'scene-agent', 'src/scene': 'implementer' };
  pkg.executionUnits = pkg.executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'MODULE-2' ? { ...unit, owner: 'scene-agent' } : unit);
  writeJson(f.packagePath, pkg);
  const modulePath = join(f.root, 'delegations', 'module.json');
  const peerPath = join(f.root, 'delegations', 'module-peer.json');
  writeJson(modulePath, makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(peerPath, makeDelegation('scene-agent', 'MODULE-2', 'PG-1', 'src/module-peer'));
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo).status, 0);
  // 只保留并行阶段之前的共享单元结果，验证同组 peer 不构成 READY 前序条件。
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-1.json'));
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-2.json'));
  const batchPath = join(f.root, 'delegations', 'batches', 'valid.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/module.json', '.workflow-control/delegations/module-peer.json']));
  const result = run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('预设串行顺序：a1→a2→a3 只按数组位置放行并拒绝跳过前序', () => {
  const f = setup({ delegatedAgents: ['implementer'] });
  writeJson(f.packagePath, makeOrderedSerialPackage());
  writeExecutionState(f);
  const delegationPath = join(f.root, 'delegations', 'a3.json');
  writeJson(delegationPath, makeDelegation('implementer', 'a3', null, 'src/scene'));

  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /a3.*a1|尚未 READY/);
  writeUnitResults(f, {}, { completeState: false });
  completeUnits(f, ['a1', 'a2']);
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'a2.json'));
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'a3.json'));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /a3.*a2|预设顺序前序证据/);
  writeUnitResults(f, {}, { completeState: false });
  completeUnits(f, ['a1', 'a2']);
  assert.equal(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo).status, 0);
});

test('并行计划：预设顺序、同阶段连续组、阶段隔离和所有权保护均生效', () => {
  for (const [mutate, pattern] of [
    [(pkg) => { pkg.executionUnits[0].dependsOn = []; }, /字段不严格.*多余 dependsOn/],
    [(pkg) => { const peer = pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2'); const interstitial = { ...peer, unitId: 'MODULE-3', scopeId: 'core-module-serial', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/module-serial'], stateOwnership: ['core-serial-state'], serializationReason: '按模块顺序串行' }; pkg.fileOwnership['src/module-serial'] = 'implementer'; pkg.executionUnits.splice(2, 0, interstitial); }, /并行组.*必须在 executionUnits 中连续出现/],
    [(pkg) => { const scene = pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1'); scene.parallelMode = 'PARALLEL'; scene.parallelGroup = 'PG-1'; scene.serializationReason = null; }, /并行组.*不得跨越全局阶段/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').parallelMode = 'SERIAL'; pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').parallelGroup = null; pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').serializationReason = '等待模块契约'; }, /至少需要两个/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').stateOwnership = ['core-state']; }, /状态所有权冲突/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-1').owner = 'worker'; }, /唯一映射到同一 owner/],
    [(pkg) => { pkg.fileOwnership['src/unplanned'] = 'implementer'; }, /fileOwnership 未唯一反向绑定/],
    [(pkg) => { pkg.expectedAddedFiles = ['src/unplanned/new.js']; }, /预期增删文件未唯一绑定/]
  ]) {
    const f = setup({ delegatedAgents: ['worker'] }); const pkg = makePhaseOrderedParallelPackage(); mutate(pkg); writeBoundPackage(f, pkg);
    rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), pattern);
  }
  const f = setup({ delegatedAgents: ['scene-agent', 'worker'] });
  const pkg = makePhaseOrderedParallelPackage();
  pkg.fileOwnership = { 'src/main.js': 'implementer', 'src/module': 'scene-agent', 'src/module-peer': 'implementer', 'src/scene': 'implementer' };
  pkg.executionUnits = pkg.executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'scene-agent' } : unit);
  writeJson(f.packagePath, pkg);
  writeJson(join(f.root, 'delegations', 'mismatch.json'), makeDelegation('worker', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(join(f.root, 'delegations', 'mismatch-module.json'), makeDelegation('scene-agent', 'MODULE-2', 'PG-1', 'src/module-peer'));
  writeUnitResults(f);
  const batchPath = join(f.root, 'delegations', 'batches', 'mismatch.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/mismatch.json', '.workflow-control/delegations/mismatch-module.json']));
  rejects(run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo), /代理与 execution unit.owner 不一致/);
});

test('并行委派：并行组不匹配、所有权冲突或写范围冲突均拒绝', () => {
  const cases = [
    { peer: { parallelGroup: 'PG-OTHER' }, pattern: /同一非空组|parallelGroup.*不一致/ },
    { peer: { actionLevel: 'A2', allowedActions: ['cocos-prototype'] }, pattern: /不得携带 executionUnitIds|必须全部.*A3|至少两个/ },
    { packageMutation: (pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').stateOwnership = ['core-state']; }, pattern: /状态所有权冲突/ },
    { packageMutation: (pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-2').ownedPaths = ['src/module']; pkg.fileOwnership = { 'src/main.js': 'implementer', 'src/module': 'worker' }; }, peer: { ownership: ['src/module'] }, pattern: /写范围冲突|未唯一反向绑定|未唯一映射/ }
  ];
  for (const item of cases) {
    const f = setup({ delegatedAgents: ['module-agent', 'scene-agent'] }); const pkg = makePhaseOrderedParallelPackage(); pkg.fileOwnership = { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/module-peer': 'scene-agent', 'src/scene': 'implementer' }; pkg.executionUnits = pkg.executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'MODULE-2' ? { ...unit, owner: 'scene-agent' } : unit);
    item.packageMutation?.(pkg); writeJson(f.packagePath, pkg);
    const leftPath = join(f.root, 'delegations', 'left.json'); const peerPath = join(f.root, 'delegations', 'peer.json');
    writeJson(leftPath, makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
    writeJson(peerPath, makeDelegation('scene-agent', 'MODULE-2', 'PG-1', item.peer?.ownership?.[0] ?? 'src/module-peer', item.peer ?? {}));
    // 这些用例验证批次结构先行失败，故只生成 Result 文件，不尝试推进故意损坏的实施包状态。
    writeUnitResults(f, {}, { completeState: false });
    const batchPath = join(f.root, 'delegations', 'batches', 'invalid.json');
    writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/left.json', '.workflow-control/delegations/peer.json']));
    rejects(run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo), item.pattern);
  }
});

test('单元证据：前序顺序仍生效，缺失或漂移摘要不阻断真实 READY', () => {
  const f = setup({ delegatedAgents: ['implementer'] });
  writeJson(f.packagePath, makeSerialPackage());
  writeExecutionState(f);
  const delegationPath = join(f.root, 'delegations', 'serial-module.json');
  writeJson(delegationPath, makeDelegation('implementer', 'MODULE-1', null, 'src/module'));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /尚未 READY|预设顺序前序证据/);
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  const staleBaseline = JSON.parse(readFileSync(sharedResult, 'utf8')); staleBaseline.baselineHash = 'sha256:stale';
  delete staleBaseline.diffFingerprint; delete staleBaseline.codeFingerprint; delete staleBaseline.fileHashes; delete staleBaseline.commands[0].outputHash;
  writeJson(sharedResult, staleBaseline);
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo).status, 0);
  assert.equal(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo).status, 0);
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 77;\n');
  const changedCandidate = run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo);
  assert.equal(changedCandidate.status, 0, changedCandidate.stderr);
});

test('委派结构与状态：A0-A2 不携带实施单元，A3 必须携带且仅 IMPLEMENTING', () => {
  const a1 = setup({ globalState: 'REVIEW', delegatedAgents: ['worker'] });
  const base = { workItemId: 'WI-1', stageId: 'G1', owner: 'orchestrator', assignedAgent: 'worker', ownership: ['docs'], allowedActions: ['cocos-spec-candidate'], forbiddenActions: [], actionLevel: 'A1', allowedPaths: ['docs'], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(a1.root, 'delegations', 'a1.json'); writeJson(path, base);
  assert.equal(run('delegate-check', ['--work-item', a1.workPath, '--delegation', path], a1.repo).status, 0);
  writeJson(path, { ...base, executionUnitIds: ['MODULE-1'], parallelGroup: null });
  rejects(run('delegate-check', ['--work-item', a1.workPath, '--delegation', path], a1.repo), /A0-A2.*不得携带/);
  const review = setup({ globalState: 'REVIEW', delegatedAgents: ['worker'] });
  const a3 = makeDelegation('worker', 'MODULE-1', null, 'src/module'); delete a3.executionUnitIds; delete a3.parallelGroup; writeJson(path, a3);
  rejects(run('delegate-check', ['--work-item', review.workPath, '--delegation', path, '--implementation-package', review.packagePath], review.repo), /A3 委派必须携带|executionUnitIds 必须为字符串数组/);
  writeJson(path, makeDelegation('worker', 'MODULE-1', null, 'src/module'));
  rejects(run('delegate-check', ['--work-item', review.workPath, '--delegation', path, '--implementation-package', review.packagePath], review.repo), /A3.*IMPLEMENTING/);
});

test('模块与边界：多模块变更阻断，SHARED/INTEGRATION 不得伪装并行，diff 记录精确归属', () => {
  const changed = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-SCENE.json'] });
  writeJson(join(changed.root, 'change-requests', 'CR-SCENE.json'), { changeRequestId: 'CR-SCENE', workItemId: 'WI-1', change: '改变场景', reason: '新需求', affectedModules: ['scene'], affectedBaselineHash: HASH, invalidatedApprovalIds: [], newRisk: '场景变化', newAcceptance: ['scene'], userDecisionRequest: '是否接受', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', changed.workPath, '--implementation-package', changed.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], changed.repo), /CR-SCENE.*ACCEPTED/);
  const boundary = setup(); const pkg = makePackage(); const shared = pkg.executionUnits.find((unit) => unit.unitId === 'SHARED-1'); shared.parallelMode = 'PARALLEL'; shared.parallelGroup = 'PG-1'; shared.serializationReason = null; writeJson(boundary.packagePath, pkg);
  rejects(run('preflight', ['--work-item', boundary.workPath, '--implementation-package', boundary.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], boundary.repo), /SHARED.*只能 SERIAL/);
  const audited = setup(); const { audit } = auditA3(audited); assert.deepEqual({ unit: audit.entries[0].executionUnitId, module: audit.entries[0].moduleId, scene: audit.entries[0].sceneId }, { unit: 'SHARED-1', module: 'core', scene: null });
});

test('并行批次：缺 READY、遗漏、重复代理/单元、REVIEW 和历史重复均拒绝', () => {
  let item = prepareParallelFixture(); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /尚未 READY/);
  item = prepareParallelFixture('REVIEW'); writeUnitResults(item.f); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /仅允许 IMPLEMENTING/);
  item = prepareParallelFixture(); writeUnitResults(item.f); writeJson(item.batchPath, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json'])); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /至少两个/);
  item = prepareParallelFixture(); writeUnitResults(item.f); writeJson(join(item.f.root, 'delegations', 'm2.json'), makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module')); writeJson(item.batchPath, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/m2.json'])); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /至少两个|重复分配|代理身份重复/);
  item = prepareParallelFixture(); writeUnitResults(item.f); const history = join(item.f.root, 'delegations', 'batches', 'history.json'); writeJson(history, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/m2.json'], { batchId: 'PB-HISTORY' })); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /历史并行批次分配/);
});

test('单元证据严格映射：files 重复拒绝，但摘要映射可缺失或漂移', () => {
  const f = setup(); writeUnitResults(f, {}, { completeState: false }); const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  let result = JSON.parse(readFileSync(resultPath, 'utf8')); result.files.push(result.files[0]); writeJson(resultPath, result);
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /files 不得重复/);
  writeUnitResults(f, {}, { completeState: false }); result = JSON.parse(readFileSync(resultPath, 'utf8')); result.fileHashes = { extra: 'not-a-digest' }; result.commands[0].outputHash = 'stale'; delete result.diffFingerprint; delete result.codeFingerprint; delete result.baselineHash; writeJson(resultPath, result);
  const accepted = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo);
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('A3 COMPLETE：completedUnitIds 或当前 Unit Result 缺失时拒绝', () => {
  const missingId = setup(); const { audit } = auditA3(missingId); const evidencePath = join(missingId.root, 'evidence', 'WI-1', 'complete.json'); const evidence = makeEvidence(missingId, audit); evidence.completedUnitIds.pop(); writeJson(evidencePath, evidence);
  const missingIdValidating = run('transition', ['--work-item', missingId.workPath, '--to', 'VALIDATING'], missingId.repo); assert.equal(missingIdValidating.status, 0, `${missingIdValidating.stderr} ${missingIdValidating.stdout} ${missingIdValidating.error?.message ?? ''}`);
  rejects(run('transition', ['--work-item', missingId.workPath, '--to', 'PASSED', '--evidence', evidencePath], missingId.repo), /completedUnitIds/);
  const missingResult = setup(); const audited = auditA3(missingResult); const secondEvidence = join(missingResult.root, 'evidence', 'WI-1', 'complete.json'); writeJson(secondEvidence, makeEvidence(missingResult, audited.audit)); rmSync(join(missingResult.root, 'evidence', 'WI-1', 'units', 'SCENE-1.json'));
  rejects(run('transition', ['--work-item', missingResult.workPath, '--to', 'VALIDATING'], missingResult.repo), /Execution State.*结果文件不存在|缺少当前有效 Unit Result/);
});

test('状态合同：串行 unit-check 完成当前单元并立即激活下一单元，最后明确 COMPLETE', () => {
  const f = setup();
  writeJson(f.packagePath, makeSerialPackage());
  writeExecutionState(f);
  writeUnitResults(f, {}, { completeState: false });
  const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json');
  const check = (unitId) => {
    const result = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', join(f.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], f.repo);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).executionState;
  };
  let output = check('SHARED-1');
  assert.deepEqual(output.currentUnitIds, ['MODULE-1']);
  assert.equal(output.nextTask.kind, 'SERIAL_UNIT');
  assert.equal(output.nextTask.taskId, 'MODULE-1');
  output = check('MODULE-1');
  assert.deepEqual(output.currentUnitIds, ['SCENE-1']);
  output = check('SCENE-1');
  assert.equal(output.workflowState, 'COMPLETE');
  assert.equal(output.unitSequenceState, 'COMPLETE');
  assert.equal(output.nextTask.kind, 'WORKFLOW_COMPLETE');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert(state.units.every((unit) => unit.state === 'COMPLETE'));
});

test('状态合同：并行组未齐不推进，全部完成后才激活下一阶段', () => {
  const f = setup();
  writeJson(f.packagePath, makePhaseOrderedParallelPackage());
  writeExecutionState(f);
  writeUnitResults(f, {}, { completeState: false });
  const check = (unitId) => {
    const result = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', join(f.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], f.repo);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).executionState;
  };
  check('SHARED-1');
  const partial = check('MODULE-1');
  assert.deepEqual(partial.currentUnitIds, ['MODULE-2']);
  assert.equal(partial.nextTask.kind, 'PARALLEL_GROUP');
  assert.equal(partial.nextTask.taskId, 'PG-1');
  const complete = check('MODULE-2');
  assert.deepEqual(complete.currentUnitIds, ['SCENE-1']);
  assert.equal(complete.nextTask.kind, 'SERIAL_UNIT');
  const finished = check('SCENE-1');
  assert.equal(finished.workflowState, 'COMPLETE');
  assert.equal(finished.nextTask.kind, 'WORKFLOW_COMPLETE');
});

test('状态合同：缺失或篡改 Execution State 时所有单元放行路径 fail closed', () => {
  const missing = setup({ delegatedAgents: ['implementer'] });
  rmSync(join(missing.root, 'evidence', 'WI-1', 'execution-state.json'));
  const delegationPath = join(missing.root, 'delegations', 'shared.json');
  writeJson(delegationPath, makeDelegation('implementer', 'SHARED-1', null, 'src/main.js'));
  rejects(run('delegate-check', ['--work-item', missing.workPath, '--delegation', delegationPath, '--implementation-package', missing.packagePath], missing.repo), /缺少当前 Execution State/);

  const tampered = setup();
  const statePath = join(tampered.root, 'evidence', 'WI-1', 'execution-state.json');
  const resultPath = join(tampered.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  writeUnitResults(tampered, {}, { completeState: false });
  const state = JSON.parse(readFileSync(statePath, 'utf8')); state.executionUnitIds = ['SCENE-1', 'MODULE-1', 'SHARED-1']; writeJson(statePath, state);
  rejects(run('unit-check', ['--work-item', tampered.workPath, '--implementation-package', tampered.packagePath, '--result', resultPath], tampered.repo), /executionUnits 预设顺序|Execution State/);
});

test('并行 unit-check：两个独立进程并发完成同阶段 MODULE 后再完成场景', async () => {
  const { f } = prepareParallelFixture();
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  const shared = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo);
  assert.equal(shared.status, 0, shared.stderr);
  const moduleResult = join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-1.json');
  const peerResult = join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-2.json');
  const [moduleCheck, peerCheck] = await Promise.all([
    runConcurrent('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', moduleResult], f.repo),
    runConcurrent('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', peerResult], f.repo)
  ]);
  assert.equal(moduleCheck.status, 0, moduleCheck.stderr); assert.equal(peerCheck.status, 0, peerCheck.stderr);
  const sceneResult = join(f.root, 'evidence', 'WI-1', 'units', 'SCENE-1.json');
  const sceneCheckResult = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sceneResult], f.repo);
  assert.equal(sceneCheckResult.status, 0, sceneCheckResult.stderr);
  const state = JSON.parse(readFileSync(join(f.root, 'evidence', 'WI-1', 'execution-state.json'), 'utf8'));
  assert.deepEqual(state.units.map((unit) => [unit.unitId, unit.state]), [['SHARED-1', 'COMPLETE'], ['MODULE-1', 'COMPLETE'], ['MODULE-2', 'COMPLETE'], ['SCENE-1', 'COMPLETE']]);
  assert.equal(state.workflowState, 'COMPLETE'); assert.equal(state.nextTask.kind, 'WORKFLOW_COMPLETE');
});

test('unit-check 状态门：BLOCKED、RETURN、VALIDATING 均拒绝且 Execution State 字节不变', () => {
  for (const globalState of ['BLOCKED', 'RETURN', 'VALIDATING']) {
    const f = setup(); const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json');
    writeUnitResults(f, {}, { completeState: false });
    const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
    if (globalState === 'RETURN') work.returnRecord = createReturnRecord({ classification: 'hard-gate-would-be-bypassed', reason: '验证 RETURN 状态禁止继续执行实施单元', affectedScope: ['stage:V2'] }, work);
    work.globalState = globalState; writeJson(f.workPath, work);
    const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json'); const before = readFileSync(statePath, 'utf8');
    rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /仅允许 IMPLEMENTING|禁止动作|生产实现只能在 IMPLEMENTING/);
    assert.equal(readFileSync(statePath, 'utf8'), before);
  }
});

test('unit-check 重复 Result：已 COMPLETE 的单元拒绝重放且状态不变', () => {
  const f = setup(); writeUnitResults(f, {}, { completeState: false });
  const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo).status, 0);
  const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json'); const before = readFileSync(statePath, 'utf8');
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /不是 IN_PROGRESS/);
  assert.equal(readFileSync(statePath, 'utf8'), before);
});

test('lint：当前仓库策略、Schema 和 Markdown 链接一致', () => {
  const repo = resolve(import.meta.dirname, '..', '..', '..');
  const result = run('lint', ['--repository', repo], repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：无 Work Item 不能直接运行领域 initializer', () => {
  const { repo } = makeRepo();
  const result = spawnSync(process.execPath, [INITIALIZER, '--project-root', repo], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--work-item/);
});

test('正向：initializer 使用 A1 Work Item 范围且不强制读取 Ledger', () => {
  const f = setup({ globalState: 'REVIEW' });
  const result = spawnSync(process.execPath, [INITIALIZER, '--project-root', f.repo, '--work-item', f.workPath, '--object', 'initialize project docs'], { cwd: f.repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.repo, 'docs', 'GDD.md'), 'utf8').startsWith('# 游戏设计文档'), true);
});

test('V2 视觉 Work Item 缺失 visualProductionUnits 时规划迁移拒绝绕过 coverage', () => {
  const f = setup({ domain: 'visual-assets', stageId: 'V2', globalState: 'REVIEW', pendingApprovalState: 'REVIEW', visualStage: 'V2', visualStageState: 'v2-production-planning-complete' }); rejects(run('transition', ['--work-item', f.workPath, '--to', 'IMPLEMENTING', '--implementation-package', f.packagePath], f.repo), /visualManifestFile|visualProductionUnits/);
});

test('V4 视觉门不允许 domain=code 通过自由文本绕过', () => {
  const f = setup({ domain: 'code', stageId: 'V4', visualStage: 'V4', visualStageState: 'v4-runtime-integration-candidate' }); rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'], f.repo), /visualManifestFile|visualProductionUnits/);
});

test('V3 视觉 Implementation Package 的 图像生成 编号未映射 coverage 时 CLI 拒绝', () => {
  const f = setup({ domain: 'visual-assets', stageId: 'V2', globalState: 'REVIEW', pendingApprovalState: 'REVIEW', visualStage: 'V2', visualStageState: 'v2-production-planning-complete' });
  const manifestPath = join(f.repo, 'docs', 'visual-assets.json');
  writeJson(manifestPath, { schema_version: '1.5', effect_image_reconstruction: { applicability: 'effect-image', lifecycle: 'v2-ready' }, coverage_audit: { regions: [{ id: 'hero', annotation_number: 1, owner_type: 'fixed-production-visual', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['hero'], asset_id: 'hero' }] }, assets: [{ id: 'hero', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['hero'] }] });
  const pkg = makePackage({ visualManifestFile: 'docs/visual-assets.json', visualManifestSha256: hashFile(manifestPath), visualProductionUnits: [{ unitId: 'VIS-2', annotation_number: 2, region_id: 'other', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['other'], owner: 'implementer', ownedPaths: ['src'], outputPaths: ['docs/other.png'] }] });
  writeBoundPackage(f, pkg); rejects(run('transition', ['--work-item', f.workPath, '--to', 'IMPLEMENTING', '--implementation-package', f.packagePath], f.repo), /未映射|visualProductionUnits|annotation_number/);
});
