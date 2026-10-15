import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_PHASES, SCENE_STEPS, projectWorkflowView, workflowViewMetadata } from './workflow-view.mjs';
import { renderResult, resultRecord } from './output.mjs';

/** 验证项目视图显式区分场景与弹窗生产，避免 CLI 把独立工作项混为大厅实现。 */
test('六阶段视图在生产阶段内区分场景和弹窗任务', () => {
  assert.deepEqual(PROJECT_PHASES.map((phase) => phase.label), ['需求与范围', '全局基线', '基础工程', '场景与弹窗生产', '全局集成验证', '发布']);
  assert.equal(new Set(PROJECT_PHASES.map((phase) => phase.id)).size, 6);
  assert.deepEqual(SCENE_STEPS.map((step) => step.label), ['场景定义', '拆解确认', '正式资源验收', '正式还原与运行验收']);
});

/** 验证六阶段的状态/包信号均能落到对应用户阶段，且不触碰内部状态值。 */
test('六阶段映射覆盖需求、基线、基础、场景、集成和发布', () => {
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G0', globalState: 'INTAKE' } }).phaseId, 'requirements-scope');
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G0', globalState: 'BASELINE' } }).phaseId, 'global-baseline');
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G1', globalState: 'IMPLEMENTING' }, implementationPackage: { executionUnits: [{ unitType: 'SHARED' }] } }).phaseId, 'foundation-engineering');
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G1', globalState: 'IMPLEMENTING' }, implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] } }).phaseId, 'scene-production');
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G2', globalState: 'VALIDATING' } }).phaseId, 'global-integration-validation');
  assert.equal(projectWorkflowView({ workItem: { stageId: 'G3', globalState: 'RELEASE_APPROVAL_REQUIRED' } }).phaseId, 'release');
});

/** 验证 V0/V1/V2/V3/V4 到四步场景视图的完整确定性映射。 */
test('V0/V1/V2/V3/V4 固定映射到四步单场景视图', () => {
  const expected = {
    V0: ['scene-definition', '场景定义'], V1: ['scene-definition', '场景定义'],
    V2: ['direction-confirmation', '拆解确认'],
    V3: ['production-ready', '正式资源验收'],
    V4: ['formal-implementation-runtime-validation', '正式还原与运行验收'],
  };
  for (const [stage, [stepId, stepLabel]] of Object.entries(expected)) {
    const view = projectWorkflowView({ workItem: { stageId: stage, globalState: 'IMPLEMENTING' } });
    assert.equal(view.phaseId, 'scene-production');
    assert.equal(view.sceneStepId, stepId);
    assert.equal(view.sceneStepLabel, stepLabel);
  }
});

/** 验证 foundation-only 与场景包按单元类型区分，不让基础包误显示为场景生产。 */
test('foundation-only、场景和弹窗实施包映射不同阶段', () => {
  const foundation = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING', visualStage: 'V1' },
    implementationPackage: { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] },
  });
  assert.equal(foundation.phaseId, 'foundation-engineering');
  assert.equal(foundation.sceneStepId, null);

  const scene = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING', visualStage: 'V4' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] },
  });
  assert.equal(scene.phaseId, 'scene-production');
  assert.equal(scene.sceneStepId, 'formal-implementation-runtime-validation');

  const popup = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING', visualStage: 'V4' },
    implementationPackage: { executionUnits: [{ unitType: 'DISPLAY_LAYER' }] },
  });
  assert.equal(popup.phaseId, 'scene-production');
  assert.equal(popup.sceneStepId, null);
});

/** 验证合法完整实施顺序允许场景单元与集成单元同包，纯集成包也能单独投影。 */
test('完整场景包与纯集成包按合法单元顺序投影', () => {
  const complete = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING', visualStage: 'V3' },
    implementationPackage: { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }, { unitType: 'SCENE' }, { unitType: 'INTEGRATION' }] },
  });
  assert.equal(complete.phaseId, 'scene-production');
  assert.equal(complete.sceneStepId, 'production-ready');

  const integrated = projectWorkflowView({
    workItem: { stageId: 'G2', globalState: 'INTEGRATING', visualStage: 'V4' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }, { unitType: 'INTEGRATION' }] },
  });
  assert.equal(integrated.phaseId, 'global-integration-validation');
  assert.equal(integrated.sceneStepId, null);

  const integration = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING' },
    implementationPackage: { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'INTEGRATION' }] },
  });
  assert.equal(integration.phaseId, 'global-integration-validation');
  assert.equal(integration.sceneStepId, null);
});

/** 验证未知或坏结构保守返回 unknown，并携带内部阶段而不伪造进度。 */
test('未知组合返回 unknown 并保留内部阶段', () => {
  const view = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }, { unitType: 'UNSUPPORTED' }] },
  });
  assert.equal(view.phaseId, 'unknown');
  assert.equal(view.phaseLabel, '未知阶段');
  assert.equal(view.sceneStepId, null);
  assert.equal(view.internalStage, 'G1/IMPLEMENTING');
});

test('SCENE 与 DISPLAY_LAYER 混包保守返回 unknown', () => {
  const view = projectWorkflowView({
    workItem: { stageId: 'G1', globalState: 'IMPLEMENTING', visualStage: 'V4' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }, { unitType: 'DISPLAY_LAYER' }] },
  });
  assert.equal(view.phaseId, 'unknown');
});

/** 验证 V3 资源验收与 V4 正式实施按真实阶段显示，不能用全局状态冒充视觉阶段。 */
test('实施状态不能将 V3 资源验收投影为 V4 正式还原', () => {
  for (const globalState of ['IMPLEMENTING', 'VALIDATING', 'PASSED', 'COMPLETE']) {
    const accepted = projectWorkflowView({
      workItem: { stageId: 'V3', globalState, visualStage: 'V3', visualStageState: 'v3-formal-acceptance-complete' },
      implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] },
    });
    assert.equal(accepted.sceneStepId, 'production-ready');
    assert.equal(accepted.sceneStepLabel, '正式资源验收');
  }

  const pending = projectWorkflowView({
    workItem: { stageId: 'V3', globalState: 'IMPLEMENTING', visualStage: 'V3', visualStageState: 'pending' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] },
  });
  assert.equal(pending.sceneStepId, 'production-ready');

  const review = projectWorkflowView({
    workItem: { stageId: 'V3', globalState: 'REVIEW', visualStage: 'V3', visualStageState: 'v3-formal-acceptance-complete' },
    implementationPackage: { executionUnits: [{ unitType: 'SCENE' }] },
  });
  assert.equal(review.sceneStepId, 'production-ready');
});

/** 验证 stable metadata 仅暴露固定展示字段，未知场景步骤也显式输出 null。 */
test('workflowView metadata 字段稳定且场景步骤可显式为空', () => {
  const metadata = workflowViewMetadata(projectWorkflowView({ workItem: { stageId: 'G0', globalState: 'BASELINE' } }));
  assert.deepEqual(Object.keys(metadata), ['phaseId', 'phaseLabel', 'sceneStepId', 'sceneStepLabel']);
  assert.deepEqual(metadata, { phaseId: 'global-baseline', phaseLabel: '全局基线', sceneStepId: null, sceneStepLabel: null });
});

/** 验证 JSON 顶层协议保持不变，默认文本优先显示六阶段与单场景步骤。 */
test('JSON 顶层字段不变且默认文本显示简化阶段', () => {
  const view = workflowViewMetadata(projectWorkflowView({ workItem: { stageId: 'V2', globalState: 'REVIEW' } }));
  const record = resultRecord({ status: 'READY', stage: 'V2/REVIEW', next: '完成当前待执行单元', metadata: { workflowView: view } });
  assert.deepEqual(Object.keys(record), ['status', 'stage', 'changed', 'blocking', 'next', 'metadata']);
  const text = renderResult(record);
  assert.match(text, /阶段：场景与弹窗生产 · 拆解确认/);
  assert.doesNotMatch(text, /阶段：V2\/REVIEW/);
  assert.match(text, /下一步：完成当前待执行单元/);
});

/** 已移除阶段保持未知，避免旧状态被展示成合法的正式实施进度。 */
test("V5 不再属于场景生产步骤，V4 直接显示正式还原", () => {
  for (const globalState of ["REVIEW", "IMPLEMENTING", "PASSED"]) {
    const view = projectWorkflowView({ workItem: { stageId: "V5", visualStage: "V5", globalState }, implementationPackage: { executionUnits: [{ unitType: "SCENE" }] } });
    assert.equal(view.phaseId, "unknown");
  }
  const view = projectWorkflowView({ workItem: { stageId: "V4", visualStage: "V4", visualStageState: "in-progress", globalState: "IMPLEMENTING" } });
  assert.equal(view.sceneStepId, "formal-implementation-runtime-validation");
});
