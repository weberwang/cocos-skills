import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertSceneWorkItemComplete, createExecutionState, executionStatePath } from './execution-unit-control.mjs';
import { prepareSceneStageTransition } from './scene-stage-transition.mjs';
import { prepareImplementationTransition } from './workflow-implementation-transition.mjs';
import { bindVisualEvidenceFixture } from './workflow-visual-evidence-fixture.mjs';

const BASELINE_SHA = `sha256:${'a'.repeat(64)}`;
const CANDIDATE_SHA = `sha256:${'b'.repeat(64)}`;
const DIFF_SHA = `sha256:${'c'.repeat(64)}`;

/** 计算文件字节摘要，夹具只把真实文件哈希作为不可变引用。 */
function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** 写入文件并返回相对路径，避免测试引用脱离临时项目根目录。 */
function writeFile(repo, file, bytes) {
  const path = resolve(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

/** 写入 JSON 证据并返回它当前的真实 SHA-256。 */
function writeJson(repo, file, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFile(repo, file, bytes);
  return { path: file, sha256: hashBytes(bytes) };
}

/** 提供阶段门读取临时仓库所需的最小只读 IO。 */
function fixtureIo() {
  return {
    resolve: (root, file) => resolve(root, file),
    existsSync: (path) => { try { readFileSync(path); return true; } catch { return false; } },
    readFileSync,
    normalizeRepoPath: (root, path) => relative(root, path).replaceAll('\\', '/'),
    hashText: (value) => hashBytes(String(value)),
  };
}

/** 构造字段封闭的 V2 冻结方案，并绑定直接消费的 V3 资源与 V4 运行证据。 */
function makeSceneFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'scene-stage-v4-'));
  const sceneId = 'main-scene';
  const referenceFile = 'docs/reference.png';
  const targetSha256 = hashBytes(Buffer.from('frozen reference bytes\n'));
  writeFile(repo, referenceFile, 'frozen reference bytes\n');
  writeFile(repo, 'docs/decomposition-annotation.png', 'manual decomposition annotation\n');
  writeFile(repo, 'docs/technical-decomposition.json', '{"source":"accepted layout analysis"}\n');
  writeFile(repo, 'docs/v2-confirmation.txt', 'manual V2 confirmation\n');

  const sourceNode = { layout_node_id: 'source-node', parent_layout_node_id: 'viewport', region_id: 'source-region', target_bounds: { x: 1, y: 2, width: 3, height: 4 } };
  const nodesRef = writeJson(repo, 'docs/layout-nodes.json', { schema: 'cocos-layout-nodes/1.0', target_sha256: targetSha256, scene_id: sceneId, state_id: 'default', viewport: { width: 390, height: 844 }, layout_nodes: [sourceNode] });
  const contract = {
    target_conditions: { target_sha256: targetSha256, scene_id: sceneId, state_id: 'default', viewport: { width: 390, height: 844 } },
    layout_decomposition: { layout_nodes: [sourceNode], layout_annotation: { layout_nodes_file: nodesRef.path, layout_nodes_sha256: nodesRef.sha256 } },
  };
  const contractRef = writeJson(repo, 'docs/reconstruction-contract.json', contract);
  const artifact = (file, sha256 = hashBytes(readFileSync(resolve(repo, file)))) => ({ file, sha256, sceneId });
  const plan = {
    schemaVersion: 'cocos-scene-v2-reconstruction-plan/1.0',
    workItemId: 'WI-SCENE-V4',
    status: 'COMPLETE',
    stage: 'V2',
    frozen: true,
    sceneId,
    targetSha256,
    candidateSha256: CANDIDATE_SHA,
    diffFingerprint: DIFF_SHA,
    sceneMaster: artifact(referenceFile, targetSha256),
    sceneReconstructionContract: artifact(contractRef.path, contractRef.sha256),
    decompositionAnnotation: artifact('docs/decomposition-annotation.png'),
    technicalDecomposition: artifact('docs/technical-decomposition.json'),
    visualDecompositionConfirmation: {
      confirmationId: 'CONFIRM-V2-SCENE',
      confirmationMode: 'manual',
      status: 'PASS',
      targetSha256,
      candidateSha256: CANDIDATE_SHA,
      diffFingerprint: DIFF_SHA,
      evidenceFile: 'docs/v2-confirmation.txt',
      evidenceSha256: hashBytes(readFileSync(resolve(repo, 'docs/v2-confirmation.txt'))),
    },
    visualProductionContract: { contractId: 'V2-CONTRACT-SCENE' },
    visualProductionUnits: [{ unitId: 'V2-UNIT-SCENE', owner: 'fixed-production-visual' }],
    displayLayerContexts: [],
  };
  const v2 = writeJson(repo, 'docs/v2-plan.json', plan);
  const pkg = { packageId: 'PKG-V4-SCENE', baselineVersion: '1', executionUnits: [{ unitId: 'SCENE-MAIN', unitType: 'SCENE' }] };
  const work = {
    workItemId: 'WI-SCENE-V4',
    baselineHash: BASELINE_SHA,
    visualStage: 'V4',
    visualStageEvidenceRefs: { V2: v2 },
  };
  const bound = bindVisualEvidenceFixture({ repo, work, pkg });
  const packagePath = 'docs/implementation-package-v4.json';
  writeJson(repo, packagePath, pkg);
  Object.assign(work, {
    domain: 'visual',
    visualIntegration: { registersFormalScene: true },
    visualStage: 'V2',
    visualStageState: 'v2-production-planning-complete',
    stageId: 'V2',
    globalState: 'REVIEW',
    pendingApprovalActionLevel: 'A3',
    pendingApprovalState: 'REVIEW',
    pendingApprovalStage: 'V2',
    evidenceRoot: 'docs/evidence',
    targetSha256: bound.targetSha,
    visualStageEvidenceRefs: work.visualStageEvidenceRefs,
    pendingVisualPrerequisiteSnapshot: { oldStage: 'V2' },
    diffAuditRecord: { auditId: 'OLD-AUDIT' },
    diffAuditLedgerRecord: { ledgerId: 'OLD-LEDGER' },
  });
  return { repo, work, pkg, packagePath, bound };
}

/** 让各阶段直接调用正式入口，避免测试自行模拟状态字段迁移。 */
function transition(fixture, work, target, args) {
  return prepareSceneStageTransition({
    work,
    target,
    args,
    repo: fixture.repo,
    validationContext: fixture.validationContext ?? validationContext(fixture.repo),
    unitIo: () => fixtureIo(),
    validateWorkItem: (value) => value,
  });
}

/** 按正式顺序推进到 V3 正式资源验收完成，作为 V4 激活的直接前置。 */
function completeV3Acceptance(fixture) {
  const v3 = transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V3' }).nextWork;
  assert.equal(v3.visualStageState, 'in-progress');
  const accepted = transition(fixture, v3, 'REVIEW', { 'visual-stage': 'V3', 'visual-stage-state': 'v3-formal-acceptance-complete' }).nextWork;
  return accepted;
}

/** 提供读取实施包与校验阶段提交所需的内存适配器。 */
function validationContext(repo) {
  return {
    readJson: (file) => JSON.parse(readFileSync(resolve(repo, file), 'utf8')),
    validateImplementationPackage: (value) => value,
  };
}

/** 在 V3 PASS 证据上通过 A3 激活 V4 新包，并返回可继续提交运行候选的 Work Item。 */
function activateV4(fixture, v3Work, stageId) {
  const prior = {
    ...v3Work,
    pendingVisualPrerequisiteSnapshot: { staleStage: 'V3' },
    diffAuditRecord: { auditId: 'STALE-AUDIT' },
    diffAuditLedgerRecord: { ledgerId: 'STALE-LEDGER' },
  };
  const stageTransitionPlan = transition(fixture, prior, 'IMPLEMENTING', {
    'visual-stage': 'V4',
    ...(stageId ? { 'stage-id': stageId } : {}),
  });
  const initialized = [];
  const activation = prepareImplementationTransition({
    work: stageTransitionPlan.nextWork,
    args: { 'implementation-package': fixture.packagePath },
    repo: fixture.repo,
    validationContext: validationContext(fixture.repo),
    stageTransitionPlan,
    stageIo: fixtureIo(),
    unitIo: () => fixtureIo(),
    validateWorkItem: (value) => value,
    isVisualProductionWork: () => true,
    initializeExecutionState: (...args) => initialized.push(args),
    normalizeRepoPath: (root, path) => relative(root, resolve(root, path)).replaceAll('\\', '/'),
  });
  return { ...activation, stageTransitionPlan, initialized, work: { ...activation.work, globalState: 'IMPLEMENTING' } };
}

/** 构造旧阶段未完成状态，用于验证有 Execution State 时不能绕过正式闭环。 */
function attachIncompleteExecutionState(fixture, work, stageName) {
  const unit = {
    unitId: `ASSET-${stageName}`,
    unitType: 'ASSET',
    parallelMode: 'SERIAL',
    parallelGroup: null,
    owner: 'test-fixture',
    ownedPaths: [],
    stateOwnership: [],
    acceptanceCommands: [],
    highFidelityPrerequisite: null,
  };
  const priorPackage = { packageId: `PKG-${stageName}-PREP`, baselineVersion: '1', executionUnits: [unit] };
  const packagePath = `docs/${priorPackage.packageId}.json`;
  writeJson(fixture.repo, packagePath, priorPackage);
  const boundWork = { ...work, implementationPackageRecord: packagePath, evidenceRoot: 'docs/evidence' };
  mkdirSync(resolve(fixture.repo, boundWork.evidenceRoot), { recursive: true });
  const state = createExecutionState(boundWork, priorPackage, { ...fixtureIo(), repo: fixture.repo }, '2026-10-01T00:00:00.000Z');
  writeJson(fixture.repo, executionStatePath(boundWork), state);
  return boundWork;
}

test('V2→V3 只接受严格冻结来源并清除旧阶段审计快照', () => {
  const fixture = makeSceneFixture();
  const plan = transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V3' });
  assert.equal(plan.nextWork.workItemId, fixture.work.workItemId);
  assert.equal(plan.nextWork.visualStage, 'V3');
  assert.equal(plan.nextWork.visualStageState, 'in-progress');
  assert.equal(plan.nextWork.pendingApprovalState, 'REVIEW');
  assert.equal(plan.nextWork.pendingVisualPrerequisiteSnapshot, undefined);
  assert.equal(plan.nextWork.diffAuditRecord, undefined);
  assert.equal(plan.nextWork.diffAuditLedgerRecord, undefined);
  assert.notEqual(plan.nextWork.validationBatchId, fixture.work.validationBatchId);
});

test('V2来源文件字节漂移不因 SHA 摘要阻断阶段推进', () => {
  const fixture = makeSceneFixture();
  const before = structuredClone(fixture.work);
  writeFile(fixture.repo, 'docs/technical-decomposition.json', '{"source":"changed after freeze"}\n');
  const result = transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V3' });
  assert.equal(result.nextWork.visualStage, 'V3');
  assert.deepEqual(fixture.work, before);
});

test('V3 正式资源 PASS 后直接激活新实施包进入 V4', () => {
  const fixture = makeSceneFixture();
  const v3 = completeV3Acceptance(fixture);
  assert.equal(v3.visualStage, 'V3');
  assert.equal(v3.visualStageState, 'v3-formal-acceptance-complete');
  const activated = activateV4(fixture, v3);
  assert.equal(activated.packageActivated, true);
  assert.equal(activated.work.visualStage, 'V4');
  assert.equal(activated.work.visualStageState, 'in-progress');
  assert.deepEqual(Object.keys(activated.work.visualStageEvidenceRefs).sort(), ['V2', 'V3', 'V4']);
});

test('V5 明确非法，V2 不能跳到 V4，V3 未完成不能激活正式包', () => {
  const fixture = makeSceneFixture();
  assert.throws(() => transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V5' }), /未知视觉阶段/);
  for (const stageId of ['V5', 'V6']) assert.throws(() => transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V3', 'stage-id': stageId }), /已知阶段且与 --visual-stage 一致/);
  assert.throws(() => transition(fixture, fixture.work, 'IMPLEMENTING', { 'visual-stage': 'V4' }), /未知视觉阶段|V2→V3→V4/);
  const v3 = transition(fixture, fixture.work, 'REVIEW', { 'visual-stage': 'V3' }).nextWork;
  assert.throws(() => transition(fixture, v3, 'IMPLEMENTING', { 'visual-stage': 'V4' }), /V2→V3→V4 前进/);
  const acceptedV3 = completeV3Acceptance(fixture);
  assert.throws(() => transition(fixture, acceptedV3, 'IMPLEMENTING', { 'visual-stage': 'V4', 'visual-stage-state': 'v4-runtime-integration-candidate' }), /必须先通过 A3 激活/);
  assert.throws(() => transition(fixture, { ...v3, pendingApprovalActionLevel: 'A4' }, 'REVIEW', { 'visual-stage': 'V5' }), /不能替代/);
});

test('存在旧 Execution State 时 V2→V3 入口要求旧执行序列闭环', () => {
  const fixture = makeSceneFixture();
  const withState = attachIncompleteExecutionState(fixture, fixture.work, 'V2');
  assert.throws(() => transition(fixture, withState, 'REVIEW', { 'visual-stage': 'V3' }), /旧阶段实施序列尚未完成/);
});

test('V3→V4 A3 实施包激活保留审批阶段身份并清除旧候选快照', () => {
  for (const stageId of [undefined, 'scene-runtime-approval']) {
    const fixture = makeSceneFixture();
    const v3Accepted = completeV3Acceptance(fixture);
    const result = activateV4(fixture, v3Accepted, stageId);
    const expectedStage = stageId ?? 'V4';
    assert.equal(result.packageActivated, true);
    assert.equal(result.work.visualStage, 'V4');
    assert.equal(result.work.visualStageState, 'in-progress');
    assert.equal(result.work.globalState, 'IMPLEMENTING');
    assert.equal(result.work.pendingApprovalState, 'IMPLEMENTING');
    assert.equal(result.work.stageId, expectedStage);
    assert.equal(result.work.pendingApprovalStage, expectedStage);
    assert.equal(result.work.pendingVisualPrerequisiteSnapshot, undefined);
    assert.equal(result.work.diffAuditRecord, undefined);
    assert.equal(result.work.diffAuditLedgerRecord, undefined);
    assert.equal(result.work.validationBatchId, `BATCH-${fixture.work.workItemId}-${fixture.pkg.packageId}`);
    assert.equal(result.work.implementationPackageRecord, fixture.packagePath);
    assert.equal(result.initialized.length, 1);
  }
});

test('存在旧 Execution State 时 V3→V4 激活新包要求旧执行序列闭环', () => {
  const fixture = makeSceneFixture();
  const v3Accepted = completeV3Acceptance(fixture);
  const withState = attachIncompleteExecutionState(fixture, v3Accepted, 'V3');
  assert.throws(() => transition(fixture, withState, 'IMPLEMENTING', { 'visual-stage': 'V4' }), /旧阶段实施序列尚未完成/);
});

test('V4 同阶段运行验收完成后，COMPLETE 要求完整 V2/V3/V4 阶段证据链但不比较摘要', () => {
  const fixture = makeSceneFixture();
  const v3Accepted = completeV3Acceptance(fixture);
  const activated = activateV4(fixture, v3Accepted).work;
  const completed = transition(fixture, activated, 'IMPLEMENTING', {
    'visual-stage': 'V4',
    'visual-stage-state': 'v4-runtime-integration-candidate',
  }).nextWork;
  assert.equal(completed.visualStage, 'V4');
  assert.equal(completed.visualStageState, 'v4-runtime-integration-candidate');
  assert.doesNotThrow(() => assertSceneWorkItemComplete(completed, fixture.pkg, fixture.repo, { diffFingerprint: DIFF_SHA }));
  assert.doesNotThrow(() => assertSceneWorkItemComplete(completed, fixture.pkg, fixture.repo, { diffFingerprint: 'sha256:stale' }));
  assert.doesNotThrow(() => assertSceneWorkItemComplete(completed, fixture.pkg, fixture.repo));
  const missingV3 = { ...completed, visualStageEvidenceRefs: { ...completed.visualStageEvidenceRefs, V3: undefined } };
  assert.throws(() => assertSceneWorkItemComplete(missingV3, fixture.pkg, fixture.repo, { diffFingerprint: DIFF_SHA }), /V3|未闭合/);
});

/** 设计阶段与草图尚未进入正式运行态，不能关闭场景工作项。 */
test('V2/V3不得提前 COMPLETE，普通非视觉工作不受场景完成门影响', () => {
  for (const visualStage of ['V2', 'V3']) assert.throws(() => assertSceneWorkItemComplete({ visualStage }, null, '.'), /只有 V4/);
  assert.equal(assertSceneWorkItemComplete({ stageId: 'G1' }, null, '.'), true);
});
