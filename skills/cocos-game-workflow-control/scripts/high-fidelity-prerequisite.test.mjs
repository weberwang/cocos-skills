import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertGlobalVisualBaselineSelection } from './global-visual-baseline-contract.mjs';
import { assertFormalExecutionAfterV3, assertFormalImplementationAfterV2, assertHighFidelityPrerequisite, validateHighFidelityPrerequisiteShape } from './high-fidelity-prerequisite.mjs';
import { encodePngRgba } from '../../cocos-game-asset-integration/scripts/effect_image_raster.mjs';
import { bindVisualEvidenceFixture } from './workflow-visual-evidence-fixture.mjs';

const TARGET_SHA = `sha256:${'a'.repeat(64)}`;
const CANDIDATE_SHA = `sha256:${'b'.repeat(64)}`;
const DIFF = 'sha256:scene-v2-diff';
// 1×1 PNG 最小字节样本，用于让全局候选夹具覆盖真实图片魔数校验。
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** 计算测试证据文件的当前字节身份。 */
function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 写入文件证据并同步更新其引用哈希，模拟不可变 V2 结果。 */
function writeEvidenceFile(fixture, changes = {}) {
  fixture.evidence = { ...fixture.evidence, ...changes };
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`, 'utf8');
  fixture.unit.highFidelityPrerequisite.evidenceSha256 = hashFile(fixture.evidencePath);
  fixture.work.visualStageEvidenceRefs.V2.sha256 = fixture.unit.highFidelityPrerequisite.evidenceSha256;
}

/** 为 foundation-only 门构造三张同条件候选、唯一人工确认和冻结正文证据。 */
function writeGlobalBaselineSelectionEvidence(fixture, overrides = {}) {
  const producerWorkItemId = overrides.producerWorkItemId ?? 'WI-1';
  const baselineFiles = {
    brief: join(fixture.repo, 'docs', 'global-baseline-brief.json'),
    candidates: [join(fixture.repo, 'docs', 'global-baseline-a.png'), join(fixture.repo, 'docs', 'global-baseline-b.png'), join(fixture.repo, 'docs', 'global-baseline-c.png')],
    generationRecords: [join(fixture.repo, 'docs', 'global-baseline-a-generation.json'), join(fixture.repo, 'docs', 'global-baseline-b-generation.json'), join(fixture.repo, 'docs', 'global-baseline-c-generation.json')],
    decision: join(fixture.repo, 'docs', 'global-baseline-human-decision.json'),
    document: join(fixture.repo, 'docs', 'visual-baseline.md'),
    selection: join(fixture.repo, 'docs', 'global-baseline-selection.json'),
  };
  const briefContent = {
    schemaVersion: 'cocos-game-art-brief/1.0',
    workItemId: producerWorkItemId,
    briefId: 'GLOBAL-BRIEF-1',
    theme: '舒缓的纸感花园解谜主题',
    audience: '偏好轻松休闲解谜并主要使用触屏游玩的玩家',
    coreLoop: '观察棋盘、选择相邻元素并完成局部目标',
    experienceGoals: ['轻松专注', '反馈清楚', '长时间观看保持舒适'],
    viewingContext: '移动端竖屏，单局中会反复查看棋盘并连续操作',
    visualHierarchy: '棋盘与目标优先，其次是操作反馈，装饰保持安静',
    stimulusBudget: {
      baseline: { brightnessContrast: '背景与面板维持柔和对比，避免大片纯白高光', screenCoverage: '装饰局限在棋盘周边留白', duration: '常驻但不动画', triggerFrequency: '持续可见', maxConcurrent: 0, recovery: '静态基线无需恢复动画', blendPolicy: '不与交互反馈叠加发光' },
      interaction: { brightnessContrast: '仅突出当前操作目标，保持文字和棋盘优先', screenCoverage: '限制在被操作元素附近', duration: '操作结束后及时淡出', triggerFrequency: '可随玩家连续操作触发', maxConcurrent: 1, recovery: '每次反馈后恢复常态层级', blendPolicy: '同一元素上的重复反馈合并' },
      peak: { brightnessContrast: '奖励时可短暂强化对比，但不覆盖主要信息', screenCoverage: '集中在奖励来源附近', duration: '短暂出现并明确收尾', triggerFrequency: '仅关卡完成等低频事件', maxConcurrent: 1, recovery: '事件结束后回到常态视觉层级', blendPolicy: '避免与其他峰值动画同时播放' },
      measurementMethod: '在目标移动端视口中人工观察常态游玩、连续操作和关卡完成片段，并记录遮挡、抢眼与恢复情况。',
    },
  };
  writeFileSync(baselineFiles.brief, `${JSON.stringify(briefContent, null, 2)}\n`, 'utf8');
  baselineFiles.candidates.forEach((path) => writeFileSync(path, MINIMAL_PNG));
  writeFileSync(baselineFiles.document, '# Frozen global visual baseline\n', 'utf8');
  const brief = { briefId: 'GLOBAL-BRIEF-1', path: 'docs/global-baseline-brief.json', sha256: hashFile(baselineFiles.brief) };
  const generationBatchId = 'GLOBAL-BATCH-1';
  const conditionsFingerprint = `sha256:${'c'.repeat(64)}`;
  const candidates = baselineFiles.candidates.map((path, index) => {
    const candidateId = `GLOBAL-CANDIDATE-${String.fromCharCode(65 + index)}`;
    const image = { path: path.slice(fixture.repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(path) };
    const generationRecord = {
      schemaVersion: 'cocos-global-visual-baseline-candidate-generation/1.0', workItemId: producerWorkItemId, briefId: brief.briefId,
      briefSha256: brief.sha256, generationBatchId, conditionsFingerprint, candidateId, origin: 'generated', outputPath: image.path,
      outputSha256: image.sha256, generatedAt: '2026-08-29T00:00:00.000Z', prompt: `全局基线候选 ${candidateId}`,
    };
    writeFileSync(baselineFiles.generationRecords[index], `${JSON.stringify(generationRecord, null, 2)}\n`, 'utf8');
    return { candidateId, origin: 'generated', status: 'GENERATED', image, generationRecord: { path: baselineFiles.generationRecords[index].slice(fixture.repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(baselineFiles.generationRecords[index]) } };
  });
  const selectedCandidateId = overrides.selectedCandidateId ?? candidates[0].candidateId;
  const presentedCandidateIds = candidates.map((candidate) => candidate.candidateId);
  const candidateAssessments = candidates.map((candidate, index) => {
    // 这些仅是测试夹具中的模拟人工记录，用于验证机器只校验结构和身份绑定。
    const status = index === 0 ? 'passed' : index === 1 ? 'failed' : 'unverified';
    const checks = Object.fromEntries(['themeFit', 'audienceFit', 'readability', 'comfort', 'craft'].map((dimension) => [dimension, {
      status: dimension === 'comfort' && index === 1 ? 'failed' : status,
      reason: `测试夹具：${candidate.candidateId} 的 ${dimension} 模拟评估理由`,
    }]));
    return { candidateId: candidate.candidateId, checks };
  });
  const humanSelection = {
    reviewMode: overrides.reviewMode ?? 'SINGLE_HUMAN', status: overrides.status ?? 'CONFIRMED', selectedCandidateId,
    presentedCandidateIds, candidateAssessments, decisionFile: 'docs/global-baseline-human-decision.json', decisionSha256: '',
    confirmedAt: '2026-08-29T00:01:00.000Z', userOriginalText: '我选择候选 A 作为全局视觉基线。',
  };
  const decision = {
    schemaVersion: 'cocos-global-visual-baseline-selection-decision/1.1', selectionId: 'GLOBAL-SELECTION-1', workItemId: producerWorkItemId,
    briefId: brief.briefId, briefSha256: brief.sha256, generationBatchId, conditionsFingerprint, presentedCandidateIds,
    reviewMode: humanSelection.reviewMode, status: humanSelection.status, selectedCandidateId: humanSelection.selectedCandidateId,
    candidateAssessments, confirmedAt: humanSelection.confirmedAt, userOriginalText: humanSelection.userOriginalText,
  };
  writeFileSync(baselineFiles.decision, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  humanSelection.decisionSha256 = hashFile(baselineFiles.decision);
  const selected = candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? candidates[0];
  const baselineDocumentSha256 = hashFile(baselineFiles.document);
  const baseline = {
    id: 'project-global-style', version: '1.0.0', status: 'global-static-baseline-frozen', document: 'docs/visual-baseline.md',
    documentSha256: baselineDocumentSha256, styleFingerprint: baselineDocumentSha256,
    primaryAnchor: selected.image, selectedCandidateId, selectedCandidate: selected.image,
  };
  const selection = {
    schemaVersion: 'cocos-global-visual-baseline-selection/1.1', workItemId: producerWorkItemId, selectionId: 'GLOBAL-SELECTION-1',
    brief, generationBatchId, conditionsFingerprint, candidates, humanSelection, baseline, frozenAt: '2026-08-29T00:02:00.000Z',
  };
  writeFileSync(baselineFiles.selection, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  const selectionReference = {
    path: 'docs/global-baseline-selection.json',
    sha256: hashFile(baselineFiles.selection),
  };
  // null 模拟仅保存 path+sha 的消费者引用；未指定时保留生产者标识用于交叉校验。
  if (overrides.referenceWorkItemId !== null) selectionReference.workItemId = overrides.referenceWorkItemId ?? producerWorkItemId;
  fixture.work.globalVisualBaselineSelectionRef = selectionReference;
  // 保留 files.candidates 作为原始图片路径；候选合同对象单独命名，避免覆盖文件夹具。
  return { ...baselineFiles, selection, selectionFile: baselineFiles.selection, candidateEntries: candidates };
}

/** 构造声明视觉资产依赖的基础包，用于覆盖全局基线门而不引入完整视觉清单。 */
function makeVisualFoundationPackage(overrides = {}) {
  return {
    executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }],
    visualManifestFile: 'docs/visual-assets.json',
    ...overrides,
  };
}

/** 重写选择证据并同步 Work Item 引用，便于定向覆盖结构错误分支。 */
function refreshGlobalBaselineSelectionReference(fixture, selection) {
  writeFileSync(join(fixture.repo, 'docs', 'global-baseline-selection.json'), `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  fixture.work.globalVisualBaselineSelectionRef.sha256 = hashFile(join(fixture.repo, 'docs', 'global-baseline-selection.json'));
}

/** 同步写入测试中的决定文件评估副本，避免把根与决定的不一致误当作合法更新。 */
function writeGlobalBaselineDecisionAssessments(files, assessments) {
  const decision = JSON.parse(readFileSync(files.decision, 'utf8'));
  decision.candidateAssessments = assessments;
  writeFileSync(files.decision, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
}

/** 创建场景或独立弹窗 Work Item 及其完整 V2 结果夹具。 */
function makeFixture(unitType = 'SCENE', selectedLayer = 'pause') {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-scene-v2-'));
  mkdirSync(join(repo, 'docs'), { recursive: true });
  const files = {
    sceneMaster: join(repo, 'docs', 'scene-master.png'),
    reconstructionContract: join(repo, 'docs', 'scene-reconstruction-contract.json'),
    decompositionAnnotation: join(repo, 'docs', 'decomposition-annotation.png'),
    technicalDecomposition: join(repo, 'docs', 'technical-decomposition.json'),
    layoutNodes: join(repo, 'docs', 'layout-nodes.json'),
    confirmation: join(repo, 'docs', 'v2-decomposition-confirmation.json'),
    pauseContext: join(repo, 'docs', 'pause-context.png'),
    settingsContext: join(repo, 'docs', 'settings-context.png'),
  };
  Object.values(files).forEach((path) => writeFileSync(path, `${path}\n`));
  const layoutNode = { layout_node_id: 'scene-root', parent_layout_node_id: 'viewport', region_id: 'scene', target_bounds: { x: 0, y: 0, width: 390, height: 844 } };
  const viewport = { width: 390, height: 844 };
  writeFileSync(files.layoutNodes, `${JSON.stringify({ schema: 'cocos-layout-nodes/1.0', scene_id: 'play', state_id: 'default', viewport, layout_nodes: [layoutNode] }, null, 2)}\n`);
  writeFileSync(files.reconstructionContract, `${JSON.stringify({ target_conditions: { scene_id: 'play', state_id: 'default', viewport }, layout_decomposition: { layout_nodes: [layoutNode], layout_annotation: { layout_nodes_file: 'docs/layout-nodes.json' } } }, null, 2)}\n`);
  const workItemId = unitType === 'SCENE' ? 'WI-1' : `WI-DISPLAY-${selectedLayer}`;
  const expected = unitType === 'SCENE' ? { sceneId: 'play', displayLayerId: null, hostSceneId: null } : { sceneId: 'play', displayLayerId: selectedLayer, hostSceneId: 'play' };
  const artifact = (path) => ({ file: path.slice(repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(path), sceneId: 'play' });
  const contextArtifact = (path, displayLayerId) => ({ ...artifact(path), displayLayerId, hostSceneId: 'play' });
  const visualDecompositionConfirmation = { confirmationId: 'V2-CONFIRM-1', confirmationMode: 'manual', status: 'PASS', targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, evidenceFile: 'docs/v2-decomposition-confirmation.json', evidenceSha256: hashFile(files.confirmation) };
  const evidence = {
    schemaVersion: 'cocos-scene-v2-reconstruction-plan/1.0', workItemId, status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play',
    targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, sceneMaster: artifact(files.sceneMaster),
    sceneReconstructionContract: artifact(files.reconstructionContract), decompositionAnnotation: artifact(files.decompositionAnnotation), technicalDecomposition: artifact(files.technicalDecomposition), visualDecompositionConfirmation,
    visualProductionContract: { contractId: 'VPC-1' },
    visualProductionUnits: [{ unitId: 'scene-root', owner: 'fixed-production-visual' }],
    displayLayerContexts: [
      { displayLayerId: 'pause', hostSceneId: 'play', hostContextImage: contextArtifact(files.pauseContext, 'pause') },
      { displayLayerId: 'settings', hostSceneId: 'play', hostContextImage: contextArtifact(files.settingsContext, 'settings') },
    ],
  };
  const evidencePath = join(repo, 'docs', 'scene-v2-plan.json');
  const unit = { unitId: unitType === 'SCENE' ? 'SCENE-1' : `DISPLAY-${selectedLayer}`, unitType, sceneId: unitType === 'SCENE' ? 'play' : null, displayLayerId: unitType === 'SCENE' ? null : selectedLayer, hostSceneId: unitType === 'SCENE' ? null : 'play', highFidelityPrerequisite: { workItemId, status: 'COMPLETE', stage: 'V2', frozen: true, ...expected, targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, evidenceFile: 'docs/scene-v2-plan.json', evidenceSha256: '' } };
  const work = { workItemId, visualStage: 'V2', visualStageState: 'v2-production-planning-complete', visualStageEvidenceRefs: { V2: { path: 'docs/scene-v2-plan.json', sha256: '', workItemId } } };
  const pkg = { workItemId };
  const fixture = { repo, evidencePath, evidence, unit, work, pkg, io: { resolve, existsSync, readFileSync, fileHash: hashFile } };
  writeEvidenceFile(fixture);
  return fixture;
}

test('SCENE 与 DISPLAY_LAYER 使用各自 Work Item 的 V2 拆解还原方案', () => {
  const fixtures = [makeFixture('SCENE'), makeFixture('DISPLAY_LAYER', 'pause'), makeFixture('DISPLAY_LAYER', 'settings')];
  assert.equal(new Set(fixtures.map((fixture) => fixture.work.workItemId)).size, 3);
  for (const fixture of fixtures) {
    assert.doesNotThrow(() => assertHighFidelityPrerequisite(fixture.unit, fixture.work, fixture.pkg, fixture.repo, fixture.io));
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('摘要字段可以缺省或变化，严格结构仍拒绝 shadow 等非摘要未知字段', () => {
  const fixture = makeFixture();
  const prerequisite = fixture.unit.highFidelityPrerequisite;
  prerequisite.style_fingerprint = 'stale-style';
  prerequisite.conditionsFingerprint = 'not-a-sha';
  assert.deepEqual(validateHighFidelityPrerequisiteShape(fixture.unit), []);
  delete prerequisite.style_fingerprint;
  delete prerequisite.conditionsFingerprint;
  assert.deepEqual(validateHighFidelityPrerequisiteShape(fixture.unit), []);
  prerequisite.shadow = '保持严格结构';
  assert(validateHighFidelityPrerequisiteShape(fixture.unit).some((message) => message.includes('shadow')));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('独立 taskId/sourceWorkItemId 不能伪造场景 V2 前置', () => {
  const fixture = makeFixture();
  fixture.unit.highFidelityPrerequisite.taskId = 'INDEPENDENT-TASK';
  fixture.unit.highFidelityPrerequisite.sourceWorkItemId = 'INDEPENDENT-WORK-ITEM';
  assert.throws(() => assertHighFidelityPrerequisite(fixture.unit, fixture.work, fixture.pkg, fixture.repo, fixture.io), /字段不严格/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('无选图的纯基础包可在 V2/V3 前规划和执行', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'in-progress';
  // 纯基础包不消费视觉合同或正式资产，因此不要求全局三候选和冻结状态。
  assert.doesNotThrow(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io));
  assert.doesNotThrow(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('含视觉产物的基础包仍需全局冻结与选择引用', () => {
  const fixture = makeFixture();
  const packageValue = makeVisualFoundationPackage();
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'in-progress';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /globalStaticBaselineState|基础实施包|3 张候选图/);
  writeGlobalBaselineSelectionEvidence(fixture);
  assert.doesNotThrow(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io));
  assert.doesNotThrow(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('基础包声明正式视觉行为时回到 V2/V3 门，不得借单元类型绕过', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] };
  fixture.work.visualIntegration = { registersFormalScene: true };
  fixture.work.visualStage = 'V2'; fixture.work.visualStageState = 'v2-production-planning-complete';
  // 正式入口行为不消费全局选图门；正式执行必须进入 V4 并复核 V2/V3 来源。
  assert.doesNotThrow(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io));
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io), /只能在 V4/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('生产者冻结的全局基线根证据可被多个消费者 Work Item 通过 path+sha 复用', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture, { producerWorkItemId: 'WI-GLOBAL' });
  const packageValue = makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] });
  const sharedReference = { path: 'docs/global-baseline-selection.json', sha256: hashFile(files.selectionFile) };

  for (const consumerWorkItemId of ['WI-SCENE-A', 'WI-SCENE-B']) {
    const consumer = {
      ...fixture.work,
      workItemId: consumerWorkItemId,
      // 消费者只需保存根文件的不可变引用，不复制或改写生产者所有权。
      globalVisualBaselineSelectionRef: sharedReference,
    };
    assert.doesNotThrow(() => assertFormalImplementationAfterV2(consumer, packageValue, fixture.repo, fixture.io));
  }

  assert.equal(files.selection.workItemId, 'WI-GLOBAL');
  assert.equal(JSON.parse(readFileSync(files.generationRecords[0], 'utf8')).workItemId, 'WI-GLOBAL');
  assert.equal(JSON.parse(readFileSync(files.decision, 'utf8')).workItemId, 'WI-GLOBAL');
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('引用误写消费者 Work Item 身份时拒绝，path+sha-only 引用仍通过', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture, {
    producerWorkItemId: 'WI-GLOBAL',
    referenceWorkItemId: 'WI-SCENE-A',
  });
  const consumer = { ...fixture.work, workItemId: 'WI-SCENE-A' };
  assert.throws(
    () => assertGlobalVisualBaselineSelection(consumer, fixture.repo, fixture.io),
    /必须与根证据生产者 Work Item 一致/,
  );

  consumer.globalVisualBaselineSelectionRef = { path: 'docs/global-baseline-selection.json', sha256: hashFile(files.selectionFile) };
  assert.doesNotThrow(() => assertGlobalVisualBaselineSelection(consumer, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('全局基线根证据或候选生成记录生产者不一致时拒绝', () => {
  const rootMismatchFixture = makeFixture();
  const rootMismatchFiles = writeGlobalBaselineSelectionEvidence(rootMismatchFixture, { producerWorkItemId: 'WI-GLOBAL' });
  rootMismatchFiles.selection.workItemId = 'WI-OTHER';
  refreshGlobalBaselineSelectionReference(rootMismatchFixture, rootMismatchFiles.selection);
  assert.throws(
    () => assertGlobalVisualBaselineSelection(rootMismatchFixture.work, rootMismatchFixture.repo, rootMismatchFixture.io),
    /未绑定当前三候选生成合同|未绑定唯一人工确认|生产者 Work Item 一致/,
  );
  rmSync(rootMismatchFixture.repo, { recursive: true, force: true });

  const candidateMismatchFixture = makeFixture();
  const candidateMismatchFiles = writeGlobalBaselineSelectionEvidence(candidateMismatchFixture, { producerWorkItemId: 'WI-GLOBAL' });
  const generationRecord = JSON.parse(readFileSync(candidateMismatchFiles.generationRecords[1], 'utf8'));
  generationRecord.workItemId = 'WI-OTHER';
  writeFileSync(candidateMismatchFiles.generationRecords[1], `${JSON.stringify(generationRecord, null, 2)}\n`, 'utf8');
  candidateMismatchFiles.selection.candidates[1].generationRecord.sha256 = hashFile(candidateMismatchFiles.generationRecords[1]);
  refreshGlobalBaselineSelectionReference(candidateMismatchFixture, candidateMismatchFiles.selection);
  assert.throws(
    () => assertGlobalVisualBaselineSelection(candidateMismatchFixture.work, candidateMismatchFixture.repo, candidateMismatchFixture.io),
    /未绑定当前三候选生成合同/,
  );
  rmSync(candidateMismatchFixture.repo, { recursive: true, force: true });
});

test('foundation-only 包仅伪造冻结状态或缺少三候选人工证据时拒绝', () => {
  const fixture = makeFixture();
  const packageValue = makeVisualFoundationPackage();
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /globalStaticBaselineState|基础实施包|3 张候选图/);
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io), /globalStaticBaselineState|基础实施包|3 张候选图/);
  fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /3 张候选图|人工确认/);
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io), /3 张候选图|人工确认/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('混入 SCENE 的实施包仍受 V2/V3 正式门约束', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'SCENE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'global-static-baseline-frozen'; fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /V2 拆解方案|V2 前置门/);
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, packageValue, fixture.repo, fixture.io), /只能在 V4/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('全局基线候选不是恰好三张时拒绝 foundation-only 门', () => {
  for (const count of [2, 4]) {
    const fixture = makeFixture();
    const baseline = writeGlobalBaselineSelectionEvidence(fixture).selection;
    baseline.candidates = count === 2 ? baseline.candidates.slice(0, 2) : [...baseline.candidates, { ...baseline.candidates[0], candidateId: 'GLOBAL-CANDIDATE-D' }];
    refreshGlobalBaselineSelectionReference(fixture, baseline);
    const packageValue = makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] });
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /恰好包含 3 张|3 张候选图/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线候选 ID、图片或生成记录重复时拒绝', () => {
  for (const duplicateField of ['candidateId', 'image', 'generationRecord']) {
    const fixture = makeFixture();
    const baseline = writeGlobalBaselineSelectionEvidence(fixture).selection;
    baseline.candidates[1][duplicateField] = duplicateField === 'candidateId'
      ? baseline.candidates[0].candidateId
      : baseline.candidates[0][duplicateField];
    refreshGlobalBaselineSelectionReference(fixture, baseline);
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] }), fixture.repo, fixture.io), /必须唯一|不同的候选效果图|不同的生成记录/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线没有唯一人工确认或使用 AUTO/pending 时拒绝', () => {
  for (const status of ['PENDING', 'CONFIRMED']) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    files.selection.humanSelection.status = status;
    files.selection.humanSelection.reviewMode = status === 'PENDING' ? 'SINGLE_HUMAN' : 'AUTO';
    refreshGlobalBaselineSelectionReference(fixture, files.selection);
    const packageValue = makeVisualFoundationPackage({ executionUnits: [{ unitType: 'MODULE' }] });
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /SINGLE_HUMAN|CONFIRMED|AUTO|pending/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线所选候选不在三张候选图中时拒绝', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture);
  files.selection.humanSelection.selectedCandidateId = 'GLOBAL-CANDIDATE-MISSING';
  refreshGlobalBaselineSelectionReference(fixture, files.selection);
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] }), fixture.repo, fixture.io), /selectedCandidateId|三张候选图|人工确认/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('缺字段、身份不符或非 JSON 的游戏美术 brief 阻断冻结', () => {
  const cases = [
    ['missing field', (path) => {
      const brief = JSON.parse(readFileSync(path, 'utf8'));
      delete brief.viewingContext;
      writeFileSync(path, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
    }, /brief\.content 字段不严格/],
    ['wrong identity', (path) => {
      const brief = JSON.parse(readFileSync(path, 'utf8'));
      brief.workItemId = 'WI-OTHER';
      writeFileSync(path, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
    }, /brief\.content\.workItemId/],
    ['wrong brief ID', (path) => {
      const brief = JSON.parse(readFileSync(path, 'utf8'));
      brief.briefId = 'GLOBAL-BRIEF-OTHER';
      writeFileSync(path, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
    }, /brief\.content\.briefId/],
    ['non JSON', (path) => writeFileSync(path, '这是普通文本 brief\n', 'utf8'), /不是有效 JSON/],
  ];
  for (const [, corruptBrief, expectedError] of cases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    corruptBrief(files.brief);
    assert.throws(() => assertGlobalVisualBaselineSelection(fixture.work, fixture.repo, fixture.io), expectedError);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('刺激预算缺层或 maxConcurrent 不是非负整数时拒绝冻结', () => {
  const cases = [
    ['missing layer', (brief) => { delete brief.stimulusBudget.interaction; }, /stimulusBudget 字段不严格|stimulusBudget\.interaction 必须为对象/],
    ['negative concurrency', (brief) => { brief.stimulusBudget.baseline.maxConcurrent = -1; }, /maxConcurrent 必须为非负整数/],
    ['fractional concurrency', (brief) => { brief.stimulusBudget.peak.maxConcurrent = 0.5; }, /maxConcurrent 必须为非负整数/],
  ];
  for (const [, corruptBrief, expectedError] of cases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    const brief = JSON.parse(readFileSync(files.brief, 'utf8'));
    corruptBrief(brief);
    writeFileSync(files.brief, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
    assert.throws(() => assertGlobalVisualBaselineSelection(fixture.work, fixture.repo, fixture.io), expectedError);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('候选评估维度、ID、状态和理由不完整时拒绝冻结', () => {
  const cases = [
    ['missing dimension', (assessments) => { delete assessments[0].checks.comfort; }, /checks 字段不严格/],
    ['duplicate candidate ID', (assessments) => { assessments[2].candidateId = assessments[1].candidateId; }, /candidateId 不得重复|缺少候选/],
    ['unknown status', (assessments) => { assessments[1].checks.themeFit.status = 'excellent'; }, /status 必须为 passed、failed 或 unverified/],
    ['empty reason', (assessments) => { assessments[1].checks.themeFit.reason = '  '; }, /reason 必须为非空人工理由/],
  ];
  for (const [, corruptAssessments, expectedError] of cases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    const assessments = files.selection.humanSelection.candidateAssessments;
    corruptAssessments(assessments);
    writeGlobalBaselineDecisionAssessments(files, assessments);
    refreshGlobalBaselineSelectionReference(fixture, files.selection);
    assert.throws(() => assertGlobalVisualBaselineSelection(fixture.work, fixture.repo, fixture.io), expectedError);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('所选候选任一项失败、未验证或三张均无合格项时拒绝冻结', () => {
  const fixtureCases = [
    ['selected failed', (assessments) => { assessments[0].checks.comfort.status = 'failed'; }],
    ['selected unverified', (assessments) => { assessments[0].checks.craft.status = 'unverified'; }],
    ['all candidates unqualified', (assessments) => {
      for (const assessment of assessments) for (const check of Object.values(assessment.checks)) check.status = 'unverified';
    }],
  ];
  for (const [, corruptAssessments] of fixtureCases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    const assessments = files.selection.humanSelection.candidateAssessments;
    corruptAssessments(assessments);
    writeGlobalBaselineDecisionAssessments(files, assessments);
    refreshGlobalBaselineSelectionReference(fixture, files.selection);
    assert.throws(() => assertGlobalVisualBaselineSelection(fixture.work, fixture.repo, fixture.io), /全部维度必须为 passed|不能冻结/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('非所选候选不通过不阻断，评估键顺序和候选数组顺序不影响决定绑定', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture);
  const decision = JSON.parse(readFileSync(files.decision, 'utf8'));
  decision.candidateAssessments.reverse();
  decision.candidateAssessments = decision.candidateAssessments.map(({ candidateId, checks }) => ({
    checks: Object.fromEntries(Object.entries(checks).reverse().map(([dimension, check]) => [
      dimension,
      Object.fromEntries(Object.entries(check).reverse()),
    ])),
    candidateId,
  }));
  writeFileSync(files.decision, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  assert.doesNotThrow(() => assertGlobalVisualBaselineSelection(fixture.work, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('决定文件评估与根选择不一致或使用旧 schema 时拒绝冻结', () => {
  const mismatchFixture = makeFixture();
  const mismatchFiles = writeGlobalBaselineSelectionEvidence(mismatchFixture);
  mismatchFiles.selection.humanSelection.candidateAssessments[0].checks.themeFit.reason = '测试夹具：根决定内容已漂移';
  refreshGlobalBaselineSelectionReference(mismatchFixture, mismatchFiles.selection);
  assert.throws(() => assertGlobalVisualBaselineSelection(mismatchFixture.work, mismatchFixture.repo, mismatchFixture.io), /评估语义一致/);
  rmSync(mismatchFixture.repo, { recursive: true, force: true });

  const oldRootFixture = makeFixture();
  const oldRootFiles = writeGlobalBaselineSelectionEvidence(oldRootFixture);
  oldRootFiles.selection.schemaVersion = 'cocos-global-visual-baseline-selection/1.0';
  refreshGlobalBaselineSelectionReference(oldRootFixture, oldRootFiles.selection);
  assert.throws(() => assertGlobalVisualBaselineSelection(oldRootFixture.work, oldRootFixture.repo, oldRootFixture.io), /schemaVersion 必须为 cocos-global-visual-baseline-selection\/1\.1/);
  rmSync(oldRootFixture.repo, { recursive: true, force: true });

  const oldDecisionFixture = makeFixture();
  const oldDecisionFiles = writeGlobalBaselineSelectionEvidence(oldDecisionFixture);
  const oldDecision = JSON.parse(readFileSync(oldDecisionFiles.decision, 'utf8'));
  oldDecision.schemaVersion = 'cocos-global-visual-baseline-selection-decision/1.0';
  writeFileSync(oldDecisionFiles.decision, `${JSON.stringify(oldDecision, null, 2)}\n`, 'utf8');
  assert.throws(() => assertGlobalVisualBaselineSelection(oldDecisionFixture.work, oldDecisionFixture.repo, oldDecisionFixture.io), /schemaVersion 未绑定唯一人工确认/);
  rmSync(oldDecisionFixture.repo, { recursive: true, force: true });
});

test('全局基线摘要陈旧不阻断仍可读取的候选、决定和冻结正文', () => {
  const cases = [
    ['candidate image', (files) => writeFileSync(files.candidates[0], encodePngRgba(1, 1, Buffer.from([220, 30, 60, 255])))],
    ['human decision', (files) => writeFileSync(files.decision, `${JSON.stringify(JSON.parse(readFileSync(files.decision, 'utf8')), null, 4)}\n`, 'utf8')],
    ['baseline document', (files) => writeFileSync(files.document, 'baseline-drift\n', 'utf8')],
  ];
  for (const [, drift] of cases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    drift(files);
    assert.doesNotThrow(() => assertFormalImplementationAfterV2(fixture.work, makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] }), fixture.repo, fixture.io));
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线候选扩展名伪装为 PNG 时拒绝', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture);
  writeFileSync(files.candidates[0], 'not-an-image\n', 'utf8');
  const fakeSha = hashFile(files.candidates[0]);
  const generationRecord = JSON.parse(readFileSync(files.generationRecords[0], 'utf8'));
  generationRecord.outputSha256 = fakeSha;
  writeFileSync(files.generationRecords[0], `${JSON.stringify(generationRecord, null, 2)}\n`, 'utf8');
  files.selection.candidates[0].image.sha256 = fakeSha;
  files.selection.candidates[0].generationRecord.sha256 = hashFile(files.generationRecords[0]);
  files.selection.baseline.primaryAnchor.sha256 = fakeSha;
  files.selection.baseline.selectedCandidate.sha256 = fakeSha;
  refreshGlobalBaselineSelectionReference(fixture, files.selection);
  assert.throws(
    () => assertFormalImplementationAfterV2(fixture.work, makeVisualFoundationPackage({ executionUnits: [{ unitType: 'SHARED' }] }), fixture.repo, fixture.io),
    /真实 PNG\/JPEG 图片文件|图片扩展名/,
  );
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('V2/V3 资源阶段禁止正式场景执行，V4 直接复核真实 V2/V3 来源', () => {
  const fixture = makeFixture();
  fixture.pkg.executionUnits = [{ unitType: 'SCENE' }];
  bindVisualEvidenceFixture({ repo: fixture.repo, work: fixture.work, pkg: fixture.pkg });
  fixture.work.visualStage = 'V2'; fixture.work.visualStageState = 'v2-production-planning-complete';
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, fixture.pkg, fixture.repo, fixture.io), /只能在 V4/);
  fixture.work.visualStage = 'V3'; fixture.work.visualStageState = 'v3-formal-acceptance-complete';
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, fixture.pkg, fixture.repo, fixture.io), /只能在 V4/);
  fixture.work.visualStage = 'V4'; fixture.work.visualStageState = 'in-progress';
  assert.doesNotThrow(() => assertFormalExecutionAfterV3(fixture.work, fixture.pkg, fixture.repo, fixture.io));
  fixture.work.visualStageEvidenceRefs.V3 = undefined;
  assert.throws(() => assertFormalExecutionAfterV3(fixture.work, fixture.pkg, fixture.repo, fixture.io), (error) => error.result?.missingEvidence?.includes('V3 source evidence path'));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('Work Item 身份漂移仍失败，target/candidate/diff 摘要差异不阻断', () => {
  const prerequisiteWorkItem = makeFixture();
  prerequisiteWorkItem.unit.highFidelityPrerequisite.workItemId = 'OTHER-WI';
  assert.throws(() => assertHighFidelityPrerequisite(prerequisiteWorkItem.unit, prerequisiteWorkItem.work, prerequisiteWorkItem.pkg, prerequisiteWorkItem.repo, prerequisiteWorkItem.io), /当前 Work Item/);
  rmSync(prerequisiteWorkItem.repo, { recursive: true, force: true });

  const evidenceWorkItem = makeFixture();
  writeEvidenceFile(evidenceWorkItem, { workItemId: 'OTHER-WI' });
  assert.throws(() => assertHighFidelityPrerequisite(evidenceWorkItem.unit, evidenceWorkItem.work, evidenceWorkItem.pkg, evidenceWorkItem.repo, evidenceWorkItem.io), /当前 Work Item/);
  rmSync(evidenceWorkItem.repo, { recursive: true, force: true });

  const candidate = makeFixture();
  writeEvidenceFile(candidate, { candidateSha256: `sha256:${'d'.repeat(64)}` });
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(candidate.unit, candidate.work, candidate.pkg, candidate.repo, candidate.io));
  rmSync(candidate.repo, { recursive: true, force: true });

  const diff = makeFixture();
  writeEvidenceFile(diff, { diffFingerprint: 'sha256:other-scene-v2-diff' });
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(diff.unit, diff.work, diff.pkg, diff.repo, diff.io));
  rmSync(diff.repo, { recursive: true, force: true });
});

test('唯一拆解确认必须是绑定身份的 manual PASS 事实', () => {
  const pending = makeFixture();
  writeEvidenceFile(pending, { visualDecompositionConfirmation: { ...pending.evidence.visualDecompositionConfirmation, status: 'PENDING' } });
  assert.throws(() => assertHighFidelityPrerequisite(pending.unit, pending.work, pending.pkg, pending.repo, pending.io), /visualDecompositionConfirmation/);
  rmSync(pending.repo, { recursive: true, force: true });

  const identity = makeFixture();
  writeEvidenceFile(identity, { visualDecompositionConfirmation: { ...identity.evidence.visualDecompositionConfirmation, diffFingerprint: 'sha256:other-scene-v2-diff' } });
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(identity.unit, identity.work, identity.pkg, identity.repo, identity.io));
  rmSync(identity.repo, { recursive: true, force: true });
});

test('缺字段、非 COMPLETE 和宿主身份漂移仍 fail closed；证据摘要变化不阻断', () => {
  const missing = makeFixture();
  delete missing.unit.highFidelityPrerequisite.evidenceFile;
  assert.throws(() => assertHighFidelityPrerequisite(missing.unit, missing.work, missing.pkg, missing.repo, missing.io), /V2/);
  rmSync(missing.repo, { recursive: true, force: true });

  const pending = makeFixture();
  writeEvidenceFile(pending, { status: 'PENDING' });
  assert.throws(() => assertHighFidelityPrerequisite(pending.unit, pending.work, pending.pkg, pending.repo, pending.io), /V2 拆解方案未绑定当前 Work Item、场景、完成状态或冻结状态/);
  rmSync(pending.repo, { recursive: true, force: true });

  const identity = makeFixture('DISPLAY_LAYER');
  identity.unit.highFidelityPrerequisite.hostSceneId = 'menu';
  assert.throws(() => assertHighFidelityPrerequisite(identity.unit, identity.work, identity.pkg, identity.repo, identity.io), /scene\/layer\/host/);
  rmSync(identity.repo, { recursive: true, force: true });

  const drift = makeFixture();
  writeFileSync(drift.evidencePath, `${readFileSync(drift.evidencePath, 'utf8')} \n`, 'utf8');
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(drift.unit, drift.work, drift.pkg, drift.repo, drift.io));
  rmSync(drift.repo, { recursive: true, force: true });
});

test('显示层必须绑定唯一匹配宿主上下文图，其他 unitType 不受逐单元门影响', () => {
  const display = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(display, { displayLayerContexts: display.evidence.displayLayerContexts.map((context) => context.displayLayerId === 'pause' ? { ...context, hostContextImage: { ...context.hostContextImage, displayLayerId: 'other' } } : context) });
  assert.throws(() => assertHighFidelityPrerequisite(display.unit, display.work, display.pkg, display.repo, display.io), /displayLayerContexts|scene\/layer\/host/);
  rmSync(display.repo, { recursive: true, force: true });

  const missing = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(missing, { displayLayerContexts: missing.evidence.displayLayerContexts.filter((context) => context.displayLayerId !== 'pause') });
  assert.throws(() => assertHighFidelityPrerequisite(missing.unit, missing.work, missing.pkg, missing.repo, missing.io), /唯一匹配上下文/);
  rmSync(missing.repo, { recursive: true, force: true });

  const duplicate = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(duplicate, { displayLayerContexts: [...duplicate.evidence.displayLayerContexts, duplicate.evidence.displayLayerContexts[0]] });
  assert.throws(() => assertHighFidelityPrerequisite(duplicate.unit, duplicate.work, duplicate.pkg, duplicate.repo, duplicate.io), /重复宿主上下文/);
  rmSync(duplicate.repo, { recursive: true, force: true });

  const moduleUnit = { unitId: 'MODULE-1', unitType: 'MODULE', highFidelityPrerequisite: null };
  assert.equal(assertHighFidelityPrerequisite(moduleUnit, { workItemId: 'WI-1' }, { workItemId: 'WI-1' }, null, null), null);
});
