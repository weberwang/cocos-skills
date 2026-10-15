/** V0→V4 视觉阶段硬门回归；V2 来源、V3 资源和 V4 运行验收必须绑定。 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { classifyVisibleVisualProductionIntegration, structuredVisualStageFailure, validateVisualStageDeclaration, validateVisualStagePrerequisites } from './visual-stage-prerequisites.mjs';
import { bindVisualEvidenceFixture } from './workflow-visual-evidence-fixture.mjs';

const SHA = `sha256:${'a'.repeat(64)}`;
const HASH2 = `sha256:${'b'.repeat(64)}`;
const HASH3 = `sha256:${'d'.repeat(64)}`;
const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');

/** 为测试工件建立可复核身份，供绑定和漂移用例使用。 */
function sha(path) { return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`; }
/** 写入确定性 JSON 工件，减少夹具生成的无关格式差异。 */
function writeJson(root, relative, value) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { path: relative.replaceAll('\\', '/'), sha256: sha(path) };
}
/** 构造严格 V2 冻结计划，并复用工作流夹具生成无需草图的 V3/V4 来源链。 */
function evidenceSet(root, overrides = {}) {
  const sceneId = 'main-scene';
  const artifactFiles = {
    sceneMaster: 'docs/reference.png',
    reconstructionContract: 'docs/reconstruction-contract.json',
    decompositionAnnotation: 'docs/decomposition-annotation.png',
    technicalDecomposition: 'docs/technical-decomposition.json',
    confirmation: 'docs/v2-confirmation.json',
  };
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, artifactFiles.sceneMaster), 'reference image pixels\n', 'utf8');
  writeFileSync(join(root, artifactFiles.decompositionAnnotation), 'confirmed annotation pixels\n', 'utf8');
  writeFileSync(join(root, artifactFiles.technicalDecomposition), '{"analysis":"visual layout source"}\n', 'utf8');
  writeFileSync(join(root, artifactFiles.confirmation), 'manual V2 confirmation\n', 'utf8');
  const targetSha = sha(join(root, artifactFiles.sceneMaster));
  const artifact = (file) => ({ file, sha256: sha(join(root, file)), sceneId });
  const sourceNode = { layout_node_id: 'source-node', parent_layout_node_id: 'viewport', region_id: 'source-region', target_bounds: { x: 1, y: 2, width: 3, height: 4 } };
  const viewport = { width: 390, height: 844 };
  const nodesRef = writeJson(root, 'docs/layout-nodes.json', { schema: 'cocos-layout-nodes/1.0', target_sha256: targetSha, scene_id: sceneId, state_id: 'default', viewport, layout_nodes: [sourceNode] });
  const contract = {
    target_conditions: { target_sha256: targetSha, scene_id: sceneId, state_id: 'default', viewport },
    layout_decomposition: { layout_nodes: [sourceNode], layout_annotation: { layout_nodes_file: nodesRef.path, layout_nodes_sha256: nodesRef.sha256 } },
  };
  writeFileSync(join(root, artifactFiles.reconstructionContract), `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const v2 = {
    schemaVersion: 'cocos-scene-v2-reconstruction-plan/1.0',
    workItemId: 'WI-VISUAL', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId,
    targetSha256: targetSha, candidateSha256: HASH2, diffFingerprint: HASH2,
    sceneMaster: artifact(artifactFiles.sceneMaster),
    sceneReconstructionContract: artifact(artifactFiles.reconstructionContract),
    decompositionAnnotation: artifact(artifactFiles.decompositionAnnotation),
    technicalDecomposition: artifact(artifactFiles.technicalDecomposition),
    visualDecompositionConfirmation: {
      confirmationId: 'CONFIRM-V2', confirmationMode: 'manual', status: 'PASS',
      targetSha256: targetSha, candidateSha256: HASH2, diffFingerprint: HASH2,
      evidenceFile: artifactFiles.confirmation, evidenceSha256: sha(join(root, artifactFiles.confirmation)),
    },
    visualProductionContract: { contractId: 'CONTRACT-V2' },
    visualProductionUnits: [{ unitId: 'unit', owner: 'fixed-production-visual' }],
    displayLayerContexts: [],
  };
  const initialWork = {
    workItemId: 'WI-VISUAL', baselineHash: SHA, visualStage: 'V4',
    visualStageEvidenceRefs: { V2: writeJson(root, 'evidence/V2.json', v2) },
  };
  const pkg = {};
  bindVisualEvidenceFixture({ repo: root, work: initialWork, pkg });
  const refs = { ...initialWork.visualStageEvidenceRefs };
  // 每次变体都重算文件引用 SHA，测试内容校验而非无关的旧引用哈希错误。
  for (const [stage, patch] of Object.entries(overrides)) {
    if (!refs[stage] || !patch) continue;
    const current = JSON.parse(readFileSync(join(root, refs[stage].path), 'utf8'));
    refs[stage] = writeJson(root, refs[stage].path, { ...current, ...patch });
  }
  return refs;
}
/** 创建指定视觉阶段的 Work Item，默认使用完整且可复核的 V2/V3/V4 证据链。 */
function subject(root, options = {}) {
  const refs = options.refs ?? evidenceSet(root, options.evidence);
  const visualStage = options.visualStage ?? 'V4';
  const visualStageState = options.visualStageState ?? ({ V3: 'v3-formal-acceptance-complete', V4: 'v4-runtime-integration-candidate' }[visualStage] ?? 'pending');
  const targetSha = sha(join(root, 'docs/reference.png'));
  return {
    workItemId: 'WI-VISUAL',
    domain: 'visual',
    stageId: options.stageId ?? 'production-entry',
    visualStage,
    visualStageState,
    visualIntegration: options.visualIntegration ?? { registersFormalScene: true },
    baselineHash: SHA,
    targetSha256: targetSha,
    visualStageEvidenceRefs: refs,
    ...options,
  };
}
/** 隔离阶段证据夹具，避免污染项目与其他用例。 */
function tempFixture(options = {}) { const root = mkdtempSync(join(tmpdir(), 'cocos-visual-stage-')); return { root, work: subject(root, options) }; }
/** 只提取结构化错误码，避免测试与诊断文案耦合。 */
function errorCodes(result) { return result.errors.map((item) => item.errorCode); }

/** 修改当前真实 V4 来源文件中的人工验收，并同步刷新阶段引用。 */
function updateArtAcceptance(fixture, update) {
  const reference = fixture.work.visualStageEvidenceRefs.V4;
  const candidate = JSON.parse(readFileSync(join(fixture.root, reference.path), 'utf8'));
  candidate.artExperienceAcceptance = update(structuredClone(candidate.artExperienceAcceptance));
  fixture.work.visualStageEvidenceRefs.V4 = writeJson(fixture.root, reference.path, candidate);
}

/** 通过完整 V4 阶段门复核测试夹具中的美术体验证据。 */
function validateArtAcceptanceFixture(fixture) {
  return validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root });
}

/** 构造携带真实 V2 场景/显示层身份的 V4 工作项并运行完整阶段门。 */
function validateDisplayLayerAcceptanceFixture(fixture, { contexts, subjectSceneId, subjectHostSceneId, unitHostSceneId = 'main-scene' }) {
  const v2Reference = fixture.work.visualStageEvidenceRefs.V2;
  const v2 = JSON.parse(readFileSync(join(fixture.root, v2Reference.path), 'utf8'));
  v2.displayLayerContexts = contexts;
  fixture.work.visualStageEvidenceRefs.V2 = writeJson(fixture.root, v2Reference.path, v2);
  fixture.work.displayLayerId = 'pause-overlay';
  if (subjectSceneId !== undefined) fixture.work.sceneId = subjectSceneId;
  if (subjectHostSceneId !== undefined) fixture.work.hostSceneId = subjectHostSceneId;
  const implementationPackage = {
    executionUnits: [{ unitType: 'DISPLAY_LAYER', displayLayerId: 'pause-overlay', hostSceneId: unitHostSceneId }],
  };
  return validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root, implementationPackage });
}

/** 创建真实 Git 基线，供 CLI 交接阶段验证候选 diff，而不是只测试纯函数。 */
function makeCliFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-visual-cli-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '视觉门测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const scene = true;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const refs = evidenceSet(repo);
  const root = join(repo, '.workflow-control');
  mkdirSync(join(root, 'work-items'), { recursive: true });
  mkdirSync(join(root, 'approvals'), { recursive: true });
  const workPath = join(root, 'work-items', 'WI-VISUAL.json');
  const ledgerPath = join(root, 'approvals', 'ledger.json');
  const work = {
    workItemId: 'WI-VISUAL', projectId: 'P-VISUAL', moduleIds: ['scene'], domain: 'visual', stageId: 'main', globalState: 'PASSED', baselineId: head, baselineVersion: '1', baselineHash: SHA,
    objective: '将正式视觉候选接入 Main Scene',
    inScope: ['scene'], outOfScope: ['release'], approvedRequirements: ['REQ-VISUAL'], allowedActions: ['cocos-inspect', 'cocos-spec-candidate', 'cocos-prototype', 'cocos-code-change', 'cocos-integration'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3'], explicitApprovalActionLevels: ['A4', 'A5', 'A6'], prohibitedActions: [], allowedPaths: ['src'], forbiddenPaths: ['.git'], allowedExternalTargets: [], protectedExternalTargets: [], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null,
    assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['视觉证据复核'], nextGate: 'F4', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-VISUAL',
    pendingApprovalId: 'PENDING-OLD', pendingApprovalObject: '旧候选', pendingApprovalStage: 'main', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'cocos-integration', pendingApprovalActionType: 'cocos-integration', pendingApprovalImpactSummary: ['验证候选'], pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: '2026-08-20T00:00:00.000Z', pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null,
    validationBatchId: 'BATCH-VISUAL', changeRequestFiles: [], visualStage: 'V4', visualStageState: 'v4-runtime-integration-candidate', visualStageEvidenceRefs: refs, visualIntegration: { registersFormalScene: true },
  };
  writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`, 'utf8');
  writeFileSync(ledgerPath, `${JSON.stringify({ schemaVersion: '1.0', approvals: [] }, null, 2)}\n`, 'utf8');
  return { repo, root, head, workPath, ledgerPath, refs };
}

/** 执行真实 workflow-control CLI，保留 stdout/stderr 供错误码与落盘断言使用。 */
function runCli(fixture, command, args = []) {
  return spawnSync(process.execPath, [CLI, command, ...args, '--repo', fixture.repo], { cwd: fixture.repo, encoding: 'utf8' });
}

test('静态基线 global-static-baseline-frozen 不能冒充 V2', () => {
  const f = tempFixture({ visualStage: 'V2', visualStageState: 'pending', globalStaticBaselineState: 'global-static-baseline-frozen' });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false);
  assert(errorCodes(result).includes('VISUAL_STAGE_NOT_READY'));
});

test('V0/V1 全局冻结状态缺少三候选人工选择引用时拒绝', () => {
  const errors = validateVisualStageDeclaration({ workItemId: 'WI-GLOBAL', visualStage: 'V1', visualStageState: 'global-static-baseline-frozen' });
  assert(errors.some((item) => item.errorCode === 'GLOBAL_VISUAL_BASELINE_SELECTION_MISSING'));
});

test('V2 PASS 但 V3/V4 缺失时正式运行硬门拒绝', () => {
  const f = tempFixture();
  delete f.work.visualStageEvidenceRefs.V3; delete f.work.visualStageEvidenceRefs.V4;
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert.equal(result.disposition, 'revalidate'); assert(result.missingEvidence.some((item) => item.startsWith('V3 source evidence path'))); assert.equal(result.missingEvidence.some((item) => item.startsWith('V5 source evidence path')), false); assert(result.missingEvidence.some((item) => item.startsWith('V4 source evidence path')));
});

test('V2 技术拆解文件摘要变化不使 pending 过期', () => {
  const f = tempFixture();
  const v2 = JSON.parse(readFileSync(join(f.root, f.work.visualStageEvidenceRefs.V2.path), 'utf8'));
  writeFileSync(join(f.root, v2.technicalDecomposition.file), 'changed technical decomposition\n', 'utf8');
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, true);
  assert.notEqual(result.disposition, 'return');
  assert.equal(result.returnStage, null);
  assert.equal(errorCodes(result).includes('VISUAL_PENDING_STALE'), false);
});

test('V3 资源验收后 V4 实现候选演进不触发阶段回退', () => {
  const f = tempFixture({ evidence: {
    V4: { contentHash: HASH3, diffFingerprint: HASH3, candidateIdentity: { sha256: HASH3, diffFingerprint: HASH3 } },
  } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, true);
  assert.notEqual(result.disposition, 'return');
  assert.equal(result.returnStage, null);
});

test('V3 完成后可直接进入 V4 进行态，且不要求草图或 V4 预置引用', () => {
  const ready = tempFixture({ visualStage: 'V3', visualStageState: 'v3-formal-acceptance-complete' });
  delete ready.work.visualStageEvidenceRefs.V4;
  const readyResult = validateVisualStagePrerequisites(ready.work, { projectRoot: ready.root });
  assert.equal(readyResult.ok, true);

  const implementation = tempFixture({ visualStage: 'V4', visualStageState: 'in-progress' });
  delete implementation.work.visualStageEvidenceRefs.V4;
  const implementationResult = validateVisualStagePrerequisites(implementation.work, { projectRoot: implementation.root, implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] } });
  assert.equal(implementationResult.ok, true);

  const removedStage = tempFixture({ visualStage: 'V5', visualStageState: 'in-progress' });
  const removedStageResult = validateVisualStagePrerequisites(removedStage.work, { projectRoot: removedStage.root });
  assert.equal(removedStageResult.ok, false);
  assert(errorCodes(removedStageResult).includes('VISUAL_STAGE_DECLARATION_INVALID'));
});

test('V3 资源缺失、未通过或来源错配均阻断 V3→V4', () => {
  const missingV3 = tempFixture({ visualStage: 'V3', visualStageState: 'v3-formal-acceptance-complete' });
  delete missingV3.work.visualStageEvidenceRefs.V3;
  const missingResult = validateVisualStagePrerequisites(missingV3.work, { projectRoot: missingV3.root });
  assert.equal(missingResult.ok, false);
  assert(missingResult.missingEvidence.some((item) => item.startsWith('V3 source evidence path')));

  const failedV3 = tempFixture({ visualStage: 'V3', visualStageState: 'v3-formal-acceptance-complete', evidence: { V3: { status: 'FAIL' } } });
  assert.equal(validateVisualStagePrerequisites(failedV3.work, { projectRoot: failedV3.root }).ok, false);

  for (const mismatch of [
    (manifest) => { manifest.reference_target.original_file = 'docs/other-reference.png'; },
    (manifest) => { manifest.reference_target.scene_ids = ['other-scene']; },
    (manifest) => { manifest.reference_target.state_ids = ['other-state']; },
    (manifest) => { manifest.coverage_audit.canvases[0].width += 1; },
    (manifest) => { manifest.coverage_audit.canvases.push({ ...manifest.coverage_audit.canvases[0] }); },
  ]) {
    const fixture = tempFixture();
    const ref = fixture.work.visualStageEvidenceRefs.V3;
    const v3 = JSON.parse(readFileSync(join(fixture.root, ref.path), 'utf8'));
    const manifestPath = join(fixture.root, v3.visualManifestFile);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    mismatch(manifest);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const result = validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root });
    assert.equal(result.ok, false);
  }
});

test('V3 混合固定图片与原生实现来源均可闭合，不要求原生路线伪造 actual_assets', () => {
  const fixture = tempFixture();
  const v3Ref = fixture.work.visualStageEvidenceRefs.V3;
  const v3 = JSON.parse(readFileSync(join(fixture.root, v3Ref.path), 'utf8'));
  const manifestPath = join(fixture.root, v3.visualManifestFile);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mkdirSync(join(fixture.root, 'src'), { recursive: true });
  writeFileSync(join(fixture.root, 'src/native-renderer.js'), 'export const drawNativeRegion = true;\n', 'utf8');
  manifest.coverage_audit.regions = [{
    id: 'native-region',
    annotation_number: 2,
    production_method: 'cocos-graphics',
    runtime_implementation: { kind: 'cocos-graphics', integration_files: ['src/native-renderer.js'] },
  }];
  manifest.production_contract_audit.units.push({ annotation_number: 2, region_id: 'native-region', observed_method: 'cocos-graphics', status: 'passed' });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  v3.formalAssets.push({ id: 'native-region', region_id: 'native-region', status: 'accepted' });
  fixture.work.visualStageEvidenceRefs.V3 = writeJson(fixture.root, v3Ref.path, v3);
  const result = validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root });
  assert.equal(result.ok, true, JSON.stringify(result.missingEvidence));
});

test('V3 visual manifest 经仓库外 symlink 引用时拒绝', (t) => {
  const fixture = tempFixture();
  const outsideRoot = mkdtempSync(join(tmpdir(), 'cocos-visual-manifest-outside-'));
  const v3Ref = fixture.work.visualStageEvidenceRefs.V3;
  const v3 = JSON.parse(readFileSync(join(fixture.root, v3Ref.path), 'utf8'));
  const manifestPath = join(fixture.root, v3.visualManifestFile);
  const outsideFile = join(outsideRoot, 'manifest.json');
  const linkFile = join(fixture.root, 'docs', 'external-manifest.json');
  writeFileSync(outsideFile, readFileSync(manifestPath));
  try { symlinkSync(outsideFile, linkFile, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) { t.skip('当前 Windows 环境不允许创建文件 symlink'); return; }
    throw error;
  }
  v3.visualManifestFile = 'docs/external-manifest.json';
  fixture.work.visualStageEvidenceRefs.V3 = writeJson(fixture.root, v3Ref.path, v3);
  const result = validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root });
  assert.equal(result.ok, false);
  assert(result.missingEvidence.some((item) => item.includes('V3 visual manifest source file/path')));
});

test('V2 layout_nodes 来源必须是当前 schema 和完整节点事实，属性顺序不影响绑定', () => {
  const mutations = [
    (document) => { document.schema = 'unrelated-data/3.0'; },
    (document) => { document.scene_id = 'other-scene'; },
    (document) => { document.state_id = 'other-state'; },
    (document) => { document.viewport.width += 1; },
    (document) => { document.layout_nodes[0].target_bounds.x += 1; },
  ];
  for (const mutate of mutations) {
    const fixture = tempFixture();
    const v2 = JSON.parse(readFileSync(join(fixture.root, fixture.work.visualStageEvidenceRefs.V2.path), 'utf8'));
    const contract = JSON.parse(readFileSync(join(fixture.root, v2.sceneReconstructionContract.file), 'utf8'));
    const nodesPath = join(fixture.root, contract.layout_decomposition.layout_annotation.layout_nodes_file);
    const nodes = JSON.parse(readFileSync(nodesPath, 'utf8'));
    mutate(nodes);
    writeFileSync(nodesPath, `${JSON.stringify(nodes, null, 2)}\n`, 'utf8');
    const result = validateVisualStagePrerequisites(fixture.work, { projectRoot: fixture.root });
    assert.equal(result.ok, false);
  }

  const reordered = tempFixture();
  const v2 = JSON.parse(readFileSync(join(reordered.root, reordered.work.visualStageEvidenceRefs.V2.path), 'utf8'));
  const contract = JSON.parse(readFileSync(join(reordered.root, v2.sceneReconstructionContract.file), 'utf8'));
  const nodesPath = join(reordered.root, contract.layout_decomposition.layout_annotation.layout_nodes_file);
  const nodes = JSON.parse(readFileSync(nodesPath, 'utf8'));
  nodes.viewport = { height: nodes.viewport.height, width: nodes.viewport.width };
  nodes.layout_nodes = nodes.layout_nodes.map((node) => Object.fromEntries(Object.entries(node).reverse()));
  writeFileSync(nodesPath, `${JSON.stringify(nodes, null, 2)}\n`, 'utf8');
  const result = validateVisualStagePrerequisites(reordered.work, { projectRoot: reordered.root });
  assert.equal(result.ok, true, JSON.stringify(result.missingEvidence));
});

test('V2 目标摘要变化不要求回退；当前冻结场景仍通过真实来源链核对', () => {
  const f = tempFixture();
  const reference = f.work.visualStageEvidenceRefs.V2;
  const v2Path = join(f.root, reference.path);
  const v2 = JSON.parse(readFileSync(v2Path, 'utf8'));
  v2.targetSha256 = HASH3;
  writeFileSync(v2Path, `${JSON.stringify(v2, null, 2)}\n`, 'utf8');
  reference.sha256 = HASH2;
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, true);
  assert.notEqual(result.disposition, 'return');
  assert.equal(result.returnStage, null);
  assert.deepEqual(result.identityChanges, []);
});

test('标准 V2、accepted V3 与 V4 允许正式运行验收', () => {
  const f = tempFixture();
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, true); assert.equal(result.required, true);
  assert.equal(result.stage, 'V4');
  assert.equal(JSON.parse(readFileSync(join(f.root, f.work.visualStageEvidenceRefs.V2.path), 'utf8')).schemaVersion, 'cocos-scene-v2-reconstruction-plan/1.0');
  assert.equal(Object.hasOwn(f.work.visualStageEvidenceRefs, 'V5'), false);
});

test('V4 COMPLETE 所需的持续游玩美术验收由真实候选证据完整闭合', () => {
  const fixture = tempFixture();
  const result = validateArtAcceptanceFixture(fixture);
  assert.equal(result.ok, true);
  const candidate = JSON.parse(readFileSync(join(fixture.root, fixture.work.visualStageEvidenceRefs.V4.path), 'utf8'));
  assert.equal(candidate.artExperienceAcceptance.status, 'passed');
  assert.equal(candidate.artExperienceAcceptance.scenarios.find((item) => item.kind === 'normal-play').applicability, 'required');
  assert(candidate.artExperienceAcceptance.scenarios.filter((item) => item.applicability === 'not-applicable').length > 0);
});

test('V4 美术验收缺失、未通过、身份不符或缺少用户原文都会阻断完整阶段门', () => {
  const variants = [
    ['failed', (acceptance) => ({ ...acceptance, status: 'failed' })],
    ['unverified', (acceptance) => ({ ...acceptance, status: 'unverified' })],
    ['缺少用户原文', (acceptance) => ({ ...acceptance, userOriginalText: '   ' })],
    ['错误 Work Item', (acceptance) => ({ ...acceptance, workItemId: 'WI-OTHER' })],
    ['错误候选', (acceptance) => ({ ...acceptance, candidateId: 'V4-OTHER' })],
    ['错误场景', (acceptance) => ({ ...acceptance, sceneId: 'other-scene' })],
  ];
  const missing = tempFixture();
  const missingRef = missing.work.visualStageEvidenceRefs.V4;
  const missingCandidate = JSON.parse(readFileSync(join(missing.root, missingRef.path), 'utf8'));
  delete missingCandidate.artExperienceAcceptance;
  missing.work.visualStageEvidenceRefs.V4 = writeJson(missing.root, missingRef.path, missingCandidate);
  const missingResult = validateArtAcceptanceFixture(missing);
  assert.equal(missingResult.ok, false);
  assert(missingResult.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')));

  for (const [label, update] of variants) {
    const fixture = tempFixture();
    updateArtAcceptance(fixture, update);
    const result = validateArtAcceptanceFixture(fixture);
    assert.equal(result.ok, false, label);
    assert(result.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')), label);
  }
});

test('V4 情境必须包含必需常态片段，且合法不适用事件不得伪造观看记录', () => {
  const missingNormalPlay = tempFixture();
  updateArtAcceptance(missingNormalPlay, (acceptance) => ({
    ...acceptance,
    scenarios: acceptance.scenarios.filter((item) => item.kind !== 'normal-play'),
  }));
  const missingResult = validateArtAcceptanceFixture(missingNormalPlay);
  assert.equal(missingResult.ok, false);
  assert(missingResult.missingEvidence.some((item) => item.includes('normal-play')));

  const falseNotApplicable = tempFixture();
  updateArtAcceptance(falseNotApplicable, (acceptance) => ({
    ...acceptance,
    scenarios: acceptance.scenarios.map((item) => item.kind === 'event-peak'
      ? { ...item, reason: '', recordingFile: 'docs/art-experience-normal-play.test-recording', observation: '已查看' }
      : item),
  }));
  const invalidResult = validateArtAcceptanceFixture(falseNotApplicable);
  assert.equal(invalidResult.ok, false);
  assert(invalidResult.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')));
});

test('V4 必需片段拒绝缺失、越界或非普通文件录屏及非法时段和计数', () => {
  const variants = [
    ['缺失录屏', (scenario) => ({ ...scenario, recordingFile: 'docs/missing-recording.mp4' })],
    ['越界录屏', (scenario) => ({ ...scenario, recordingFile: '../outside-recording.mp4' })],
    ['非普通文件', (scenario) => ({ ...scenario, recordingFile: 'docs' })],
    ['非法时段', (scenario) => ({ ...scenario, endSeconds: scenario.startSeconds })],
    ['非法触发计数', (scenario) => ({ ...scenario, triggerCount: -1 })],
    ['非法并发计数', (scenario) => ({ ...scenario, peakConcurrent: 1.5 })],
  ];
  for (const [label, update] of variants) {
    const fixture = tempFixture();
    updateArtAcceptance(fixture, (acceptance) => ({
      ...acceptance,
      scenarios: acceptance.scenarios.map((item) => item.kind === 'normal-play' ? update(item) : item),
    }));
    const result = validateArtAcceptanceFixture(fixture);
    assert.equal(result.ok, false, label);
    assert(result.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')), label);
  }
});

test('V4 不允许使用仓库外 symlink 录屏', (t) => {
  const fixture = tempFixture();
  const outsideRoot = mkdtempSync(join(tmpdir(), 'cocos-art-outside-'));
  const outsideFile = join(outsideRoot, 'recording.mp4');
  const linkFile = join(fixture.root, 'docs', 'external-recording.mp4');
  writeFileSync(outsideFile, 'external recording fixture\n');
  try { symlinkSync(outsideFile, linkFile, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) { t.skip('当前 Windows 环境不允许创建文件 symlink'); return; }
    throw error;
  }
  updateArtAcceptance(fixture, (acceptance) => ({
    ...acceptance,
    scenarios: acceptance.scenarios.map((item) => item.kind === 'normal-play' ? { ...item, recordingFile: 'docs/external-recording.mp4' } : item),
  }));
  const result = validateArtAcceptanceFixture(fixture);
  assert.equal(result.ok, false);
  assert(result.missingEvidence.some((item) => item.includes('仓库内')));
});

test('DISPLAY_LAYER 的美术验收可沿唯一 V2 显示层上下文绑定宿主场景', () => {
  const fixture = tempFixture();
  const result = validateDisplayLayerAcceptanceFixture(fixture, {
    contexts: [{ displayLayerId: 'pause-overlay', hostSceneId: 'main-scene' }],
    subjectHostSceneId: 'main-scene',
  });
  assert.equal(result.ok, true);
});

test('DISPLAY_LAYER 缺失或重复的 V2 显示层上下文不能通过完整 V4 门', () => {
  const context = { displayLayerId: 'pause-overlay', hostSceneId: 'main-scene' };
  for (const [label, contexts] of [['缺失', []], ['重复', [context, { ...context }]]]) {
    const fixture = tempFixture();
    const result = validateDisplayLayerAcceptanceFixture(fixture, { contexts, subjectHostSceneId: 'main-scene' });
    assert.equal(result.ok, false, label);
    assert(result.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')), label);
  }
});

test('DISPLAY_LAYER 宿主必须与 V2.sceneId、V2 对应上下文及 Work Item 身份一致', () => {
  const context = { displayLayerId: 'pause-overlay', hostSceneId: 'main-scene' };
  const variants = [
    ['上下文宿主与 V2 场景不符', { ...context, hostSceneId: 'other-scene' }, 'other-scene', 'other-scene'],
    ['Work Item 宿主与对应上下文不符', context, 'other-scene', 'main-scene'],
    ['Work Item 场景与 V2 场景不符', context, 'main-scene', 'main-scene', 'other-scene'],
    ['实施单元宿主与 V2 上下文不符', context, 'main-scene', 'other-scene'],
  ];
  for (const [label, displayContext, subjectHostSceneId, unitHostSceneId, subjectSceneId] of variants) {
    const fixture = tempFixture();
    const result = validateDisplayLayerAcceptanceFixture(fixture, {
      contexts: [displayContext], subjectHostSceneId, unitHostSceneId, subjectSceneId,
    });
    assert.equal(result.ok, false, label);
    assert(result.missingEvidence.some((item) => item.startsWith('V4 art experience acceptance:')), label);
  }
});

test('V2 只接受标准冻结方案，拒绝旧 evidenceType 别名和额外根字段', () => {
  const alias = tempFixture({ evidence: { V2: { schemaVersion: null, evidenceType: 'v2-production-plan' } } });
  const aliasResult = validateVisualStagePrerequisites(alias.work, { projectRoot: alias.root });
  assert.equal(aliasResult.ok, false);
  assert(aliasResult.missingEvidence.some((item) => item.startsWith('V2')));

  const extra = tempFixture({ evidence: { V2: { evidenceType: 'v2-production-plan' } } });
  const extraResult = validateVisualStagePrerequisites(extra.work, { projectRoot: extra.root });
  assert.equal(extraResult.ok, false);
  assert(extraResult.missingEvidence.some((item) => item.startsWith('V2')));
});

test('灰盒隔离 A2 允许，注册正式入口仍拒绝', () => {
  const isolated = tempFixture({ stageId: 'graybox', visualIntegration: {}, graybox: true, isolatedPrototype: true, actionLevel: 'A2' });
  assert.equal(classifyVisibleVisualProductionIntegration(isolated.work).isVisibleVisualProductionIntegration, false);
  const formal = tempFixture({ stageId: 'graybox', visualIntegration: { registersFormalScene: true }, graybox: true, actionLevel: 'A2' });
  assert.equal(classifyVisibleVisualProductionIntegration(formal.work).isVisibleVisualProductionIntegration, true);
});

test('V3 Main 范围不因目标文字误判正式场景运行接入', () => {
  for (const objective of ['当前场景的正式资源生产与验收', '替换失败的正式图片资源', '实现当前主场景']) {
    const f = tempFixture({
      stageId: 'main', visualStage: 'V3', visualStageState: 'in-progress',
      objective, inScope: ['正式资源目录'], visualIntegration: {},
    });
    const classification = classifyVisibleVisualProductionIntegration(f.work);
    assert.equal(classification.isVisibleVisualProductionIntegration, false, objective);
    const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
    assert.equal(result.ok, true, objective);
    assert.equal(result.required, false, objective);
    assert.deepEqual(result.errors, [], objective);
  }
});

test('V3 明确正式入口、资源消费或 Boot→Scene 接入仍受阶段硬门阻断', () => {
  const cases = [
    {
      objective: '当前场景的正式资源生产与验收',
      visualIntegration: { registerFormalScene: true },
    },
    {
      objective: '当前场景的正式资源生产与验收',
      visualIntegration: { consumeVisibleAsset: true },
    },
    {
      objective: '正式 Boot→Scene 接入并消费正式图片资源',
      visualIntegration: {},
    },
    {
      objective: '生成正式资源并验收',
      inScope: ['注册正式主场景入口'],
      visualIntegration: {},
    },
  ];
  for (const options of cases) {
    const f = tempFixture({ stageId: 'main', visualStage: 'V3', visualStageState: 'in-progress', ...options });
    const classification = classifyVisibleVisualProductionIntegration(f.work);
    assert.equal(classification.isVisibleVisualProductionIntegration, true, JSON.stringify(options));
    const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
    assert.equal(result.ok, false, JSON.stringify(options));
    assert.equal(result.required, true, JSON.stringify(options));
    assert(errorCodes(result).includes('VISUAL_STAGE_NOT_READY'), JSON.stringify(options));
  }
});

test('裸 frozen 在 Schema 阶段声明校验中失败', () => {
  const errors = validateVisualStageDeclaration({ domain: 'visual', stageId: 'V2', visualStage: 'V2', visualStageState: 'frozen' });
  assert.equal(errors[0].errorCode, 'VISUAL_BARE_FROZEN');
});

/** 新 V4 只承接正式运行职责，不恢复已删除的草图确认状态。 */
test('V4 拒绝旧草图确认状态', () => {
  const errors = validateVisualStageDeclaration({ domain: 'visual', stageId: 'V4', visualStage: 'V4', visualStageState: 'v4-page-sketch-confirmed' });
  assert(errors.some((item) => item.errorCode === 'VISUAL_STAGE_STATE_INVALID'));
});

test('自定义 stageId 不能替代显式视觉阶段', () => {
  const f = tempFixture({ stageId: 'main', visualStage: 'V2', visualStageState: 'v2-production-planning-complete' });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(errorCodes(result).includes('VISUAL_STAGE_NOT_READY'));
});

test('根 PASS 或顶层布尔值不能满足依赖', () => {
  const f = tempFixture({ visualStageEvidenceRefs: undefined, pass: true, visualPass: true });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(result.missingEvidence.some((item) => item.includes('source evidence path')));
});

test('上游来源摘要变化不使 pending stale', () => {
  const f = tempFixture();
  const first = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(first.ok, true);
  const v3Path = join(f.root, f.work.visualStageEvidenceRefs.V3.path);
  const content = readFileSync(v3Path, 'utf8');
  writeFileSync(v3Path, `${content} \n`, 'utf8');
  f.work.visualStageEvidenceRefs.V3.sha256 = 'stale-summary';
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root, pendingSnapshot: first.snapshot });
  assert.equal(result.ok, true);
  assert.notEqual(result.disposition, 'return');
  assert.equal(result.returnStage, null);
  assert.equal(errorCodes(result).includes('VISUAL_PENDING_STALE'), false);
  assert.equal(result.invalidatedDependencies.some((item) => item.includes('V3ReferenceHash')), false);
});

test('缺唯一 V2 拆解确认时拒绝 V3/V4 下游阶段', () => {
  const f = tempFixture({ evidence: { V2: { visualDecompositionConfirmation: null } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(result.missingEvidence.includes('V2 manual decomposition confirmation identity'));
});

test('planned/pending 正式资产或未批准替代时拒绝', () => {
  const f = tempFixture({ evidence: { V3: { formalAssets: [{ id: 'pending', status: 'planned' }] } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(errorCodes(result).includes('VISUAL_PENDING_ASSET'));
});

test('完整 V4 运行候选可供所有入口复用同一结果', () => {
  const f = tempFixture();
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  const output = structuredVisualStageFailure(result, 'route');
  assert.equal(result.ok, true); assert.equal(output.ok, true); assert.deepEqual(result.snapshot, validateVisualStagePrerequisites(f.work, { projectRoot: f.root }).snapshot);
});

test('非视觉 A4 与普通安全 A3 不被误伤', () => {
  assert.equal(classifyVisibleVisualProductionIntegration({ domain: 'architecture', stageId: 'integration', objective: '更新数据契约' }).isVisibleVisualProductionIntegration, false);
  assert.equal(classifyVisibleVisualProductionIntegration({ domain: 'code', stageId: 'G1', objective: '实现安全 A3' }).isVisibleVisualProductionIntegration, false);
});

test('当前没有控制目录或真实视觉证据时不能生成 Main Scene A4 pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocos-no-control-'));
  const work = subject(root, { visualStage: 'V2', visualStageState: 'v2-production-planning-complete', visualStageEvidenceRefs: undefined, stageId: 'main' });
  const result = validateVisualStagePrerequisites(work, { projectRoot: root });
  assert.equal(result.ok, false); assert(result.missingEvidence.length > 0); assert.equal(readFileSync(join(root, 'evidence/V2.json'), 'utf8').length > 0, true);
});

test('CLI：普通集成不需批准，破坏性集成的 stale pending 不写 Ledger', () => {
  const fixture = makeCliFixture();
  const beforeWork = readFileSync(fixture.workPath, 'utf8');
  const beforeLedger = readFileSync(fixture.ledgerPath, 'utf8');
  const route = runCli(fixture, 'route', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.equal(route.status, 0, route.stderr);
  assert.equal(JSON.parse(route.stdout).authorizationBasis, 'TASK_SCOPE');
  assert.equal(JSON.parse(route.stdout).explicitApprovalRequired, false);

  const preflight = runCli(fixture, 'preflight', ['--work-item', fixture.workPath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src']);
  assert.notEqual(preflight.status, 0);
  const preflightError = JSON.parse(preflight.stderr);
  assert.equal(preflightError.errorCode, 'VISUAL_FORMAL_ENTRY_REQUIRES_A4');
  assert.equal(readFileSync(fixture.workPath, 'utf8'), beforeWork);
  assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), beforeLedger);

  const originalWork = JSON.parse(beforeWork);
  const removedStageWork = { ...originalWork, visualStage: 'V5', visualStageState: 'in-progress' };
  writeFileSync(fixture.workPath, `${JSON.stringify(removedStageWork, null, 2)}\n`, 'utf8');
  const prematureA4 = runCli(fixture, 'preflight', ['--work-item', fixture.workPath, '--action-level', 'A4', '--action-type', 'cocos-integration', '--path', 'src']);
  assert.notEqual(prematureA4.status, 0);
  assert.equal(JSON.parse(prematureA4.stderr).errorCode, 'VISUAL_STAGE_DECLARATION_INVALID');
  writeFileSync(fixture.workPath, `${JSON.stringify(originalWork, null, 2)}\n`, 'utf8');

  const invalid = { ...originalWork, visualStageEvidenceRefs: { ...originalWork.visualStageEvidenceRefs } };
  delete invalid.visualStageEvidenceRefs.V3; delete invalid.visualStageEvidenceRefs.V4;
  writeFileSync(fixture.workPath, `${JSON.stringify(invalid, null, 2)}\n`, 'utf8');
  for (const command of ['status', 'route']) {
    const blockedRead = runCli(fixture, command, ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, ...(command === 'status' ? ['--json'] : [])]);
    if (command === 'status') {
      // status 是只读查询入口，统一输出 BLOCKED 但保留成功退出码；route 仍需硬门非零阻断。
      assert.equal(blockedRead.status, 0);
      assert.equal(JSON.parse(blockedRead.stdout).status, 'BLOCKED');
    } else {
      assert.notEqual(blockedRead.status, 0);
      assert.equal(JSON.parse(blockedRead.stderr).errorCode, 'VISUAL_PREREQUISITES_MISSING');
    }
  }
  const prepareArgs = ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--pending-id', 'PENDING-V4', '--object', 'replace Main Scene visual entry', '--stage', 'main', '--action-type', 'cocos-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'cocos-integration', '--path', 'src', '--destructive', '--impact', '破坏性替换正式视觉入口'];
  const blockedPrepare = runCli(fixture, 'prepare-approval', prepareArgs);
  assert.notEqual(blockedPrepare.status, 0);
  const blockedError = JSON.parse(blockedPrepare.stderr);
  assert.equal(blockedError.errorCode, 'VISUAL_PREREQUISITES_MISSING');
  assert.deepEqual(JSON.parse(readFileSync(fixture.ledgerPath, 'utf8')).approvals, []);
  assert.deepEqual(JSON.parse(readFileSync(fixture.workPath, 'utf8')).pendingApprovalId, 'PENDING-OLD');

  writeFileSync(fixture.workPath, `${JSON.stringify(originalWork, null, 2)}\n`, 'utf8');
  const prepared = runCli(fixture, 'prepare-approval', prepareArgs);
  assert.equal(prepared.status, 0, prepared.stderr);
  const pending = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  assert.equal(pending.pendingApprovalStatus, 'pending');
  assert.ok(pending.pendingVisualPrerequisiteSnapshot);
  const handedOff = runCli(fixture, 'handoff', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.equal(handedOff.status, 0, handedOff.stderr);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).pendingApprovalPresentedId, 'PENDING-V4');

  const v3Path = join(fixture.repo, fixture.refs.V3.path);
  const originalV3 = readFileSync(v3Path);
  writeFileSync(v3Path, Buffer.concat([originalV3, Buffer.from('\nchanged after handoff\n')]));
  const staleHandoff = runCli(fixture, 'handoff', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.notEqual(staleHandoff.status, 0);
  assert.ok(['VISUAL_PENDING_STALE', 'VISUAL_PREREQUISITES_MISSING'].includes(JSON.parse(staleHandoff.stderr).errorCode));
  const staleApprove = runCli(fixture, 'approve', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--approval-id', 'AP-STALE', '--user-text', '批准']);
  assert.notEqual(staleApprove.status, 0);
  const staleError = JSON.parse(staleApprove.stderr);
  assert.ok(['VISUAL_PENDING_STALE', 'VISUAL_PREREQUISITES_MISSING'].includes(staleError.errorCode));
  assert.equal(staleError.disposition, 'revalidate');
  assert.equal(staleError.returnStage, null);
  assert.deepEqual(JSON.parse(readFileSync(fixture.ledgerPath, 'utf8')).approvals, []);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).approvalRecord, null);

  writeFileSync(v3Path, originalV3);
  const approved = runCli(fixture, 'approve', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--approval-id', 'AP-V4', '--user-text', '批准']);
  assert.equal(approved.status, 0, approved.stderr);
  const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
  assert.equal(ledger.approvals.length, 1);
  assert.equal(ledger.approvals[0].approvalId, 'AP-V4');
});

test('CLI：RETURN 必须声明必要分类并持久化最小影响范围', () => {
  const fixture = makeCliFixture();
  const missing = runCli(fixture, 'transition', ['--work-item', fixture.workPath, '--to', 'RETURN']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /return-classification/i);

  const accepted = runCli(fixture, 'transition', [
    '--work-item', fixture.workPath,
    '--to', 'RETURN',
    '--return-classification', 'upstream-fact-invalidated',
    '--return-reason', 'V2 冻结候选身份已变化',
    '--affected-scope', 'stage:V2,scene:scene-main',
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  assert.equal(work.globalState, 'RETURN');
  assert.equal(work.returnRecord.classification, 'upstream-fact-invalidated');
  assert.deepEqual(work.returnRecord.affectedScope, ['stage:V2', 'scene:scene-main']);

  const status = runCli(fixture, 'status', ['--work-item', fixture.workPath, '--json']);
  assert.equal(status.status, 0, status.stderr);
  const statusResult = JSON.parse(status.stdout);
  assert.equal(statusResult.status, 'BLOCKED');
  assert.match(statusResult.next, /returnRecord/);
  const automatic = runCli(fixture, 'advance', ['--work-item', fixture.workPath]);
  assert.notEqual(automatic.status, 0);
  assert.match(automatic.stderr, /不能使用 advance/);

  const tampered = { ...work, returnRecord: { ...work.returnRecord, affectedScope: [] } };
  writeFileSync(fixture.workPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  const rejected = runCli(fixture, 'status', ['--work-item', fixture.workPath]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /affectedScope/);

  writeFileSync(fixture.workPath, `${JSON.stringify(work, null, 2)}\n`, 'utf8');
  const recovered = runCli(fixture, 'transition', ['--work-item', fixture.workPath, '--to', 'REVIEW']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).globalState, 'REVIEW');
});
