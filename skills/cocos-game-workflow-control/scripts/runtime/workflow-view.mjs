/**
 * 用户可见的项目阶段定义；这些标签只用于投影，不会替代控制面内部状态。
 */
export const PROJECT_PHASES = Object.freeze([
  Object.freeze({ id: 'requirements-scope', label: '需求与范围' }),
  Object.freeze({ id: 'global-baseline', label: '全局基线' }),
  Object.freeze({ id: 'foundation-engineering', label: '基础工程' }),
  Object.freeze({ id: 'scene-production', label: '场景与弹窗生产' }),
  Object.freeze({ id: 'global-integration-validation', label: '全局集成验证' }),
  Object.freeze({ id: 'release', label: '发布' }),
]);

/** 单场景生命周期按连续阶段展示，V4 直接负责正式实现与运行验收。 */
export const SCENE_STEPS = Object.freeze([
  Object.freeze({ id: 'scene-definition', label: '场景定义', stages: Object.freeze(['V0', 'V1']) }),
  Object.freeze({ id: 'direction-confirmation', label: '拆解确认', stages: Object.freeze(['V2']) }),
  Object.freeze({ id: 'production-ready', label: '正式资源验收', stages: Object.freeze(['V3']) }),
  Object.freeze({ id: 'formal-implementation-runtime-validation', label: '正式还原与运行验收', stages: Object.freeze(['V4']) }),
]);

/** 只读内部索引和受控类型集合，确保投影不会依赖输入对象中的任意文本。 */
const PHASE_BY_ID = new Map(PROJECT_PHASES.map((phase) => [phase.id, phase]));
const SCENE_STEP_BY_STAGE = new Map(SCENE_STEPS.flatMap((step) => step.stages.map((stage) => [stage, step])));
const VISUAL_STAGES = new Set(['V0', 'V1', 'V2', 'V3', 'V4']);
const GLOBAL_BASELINE_STATES = new Set(['BASELINE', 'PROPOSAL', 'REVIEW']);
const RELEASE_STATES = new Set(['RELEASE_APPROVAL_REQUIRED', 'RELEASING']);
const FOUNDATION_UNIT_TYPES = new Set(['SHARED', 'MODULE']);
const VALID_UNIT_TYPES = new Set(['SHARED', 'MODULE', 'SCENE', 'DISPLAY_LAYER', 'INTEGRATION']);

/** 把可选的状态值规范化为稳定的大写标识；缺失值保持 null，避免伪造阶段。 */
function normalizeIdentifier(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().toUpperCase() || null;
}

/** 统一读取对象参数，缺少工作项或可选工件时返回空值，避免接口分支引入隐式状态。 */
function normalizeInput(input) {
  if (!input || typeof input !== 'object') return { workItem: null, implementationPackage: null, executionState: null };
  return {
    workItem: input.workItem ?? null,
    implementationPackage: input.implementationPackage ?? null,
    executionState: input.executionState ?? null,
  };
}

/** 提取实施包单元类型；任何未声明或未知类型都会保留为不可信输入。 */
function packageKind(implementationPackage) {
  if (implementationPackage === null || implementationPackage === undefined) return 'absent';
  if (typeof implementationPackage !== 'object' || !Object.hasOwn(implementationPackage, 'executionUnits')) return 'unknown';
  if (!Array.isArray(implementationPackage.executionUnits) || implementationPackage.executionUnits.length === 0) return 'unknown';
  const types = implementationPackage.executionUnits.map((unit) => normalizeIdentifier(unit?.unitType));
  if (types.some((type) => !type || !VALID_UNIT_TYPES.has(type))) return 'unknown';
  const uniqueTypes = new Set(types);
  const hasScene = uniqueTypes.has('SCENE');
  const hasDisplayLayer = uniqueTypes.has('DISPLAY_LAYER');
  const hasIntegration = uniqueTypes.has('INTEGRATION');
  const foundationOnly = types.every((type) => FOUNDATION_UNIT_TYPES.has(type));
  if (foundationOnly) return 'foundation';
  // 场景与弹窗使用独立实施包；混包无法投影成可信的用户进度。
  if (hasScene && hasDisplayLayer) return 'unknown';
  if (hasScene) return 'scene';
  if (hasDisplayLayer) return 'display-layer';
  if (hasIntegration) return 'integration';
  return 'unknown';
}

/** 读取 Work Item 与执行状态中的视觉阶段/阶段状态，并识别互相冲突的声明。 */
function visualStageInfo(workItem, executionState, stageId) {
  const workVisualStage = normalizeIdentifier(workItem?.visualStage ?? workItem?.visual_stage);
  const executionVisualStage = normalizeIdentifier(executionState?.visualStage ?? executionState?.visual_stage);
  const workVisualStageState = normalizeStageState(workItem?.visualStageState ?? workItem?.visual_stage_state);
  const executionVisualStageState = normalizeStageState(executionState?.visualStageState ?? executionState?.visual_stage_state);
  const declared = [workVisualStage, executionVisualStage].filter(Boolean);
  if (declared.some((stage) => !VISUAL_STAGES.has(stage))) return { stage: null, conflict: true };
  if (new Set(declared).size > 1) return { stage: null, conflict: true };
  const stageFromStageId = VISUAL_STAGES.has(stageId) ? stageId : null;
  if (stageFromStageId && declared.length && declared[0] !== stageFromStageId) return { stage: null, conflict: true };
  const states = [workVisualStageState, executionVisualStageState].filter(Boolean);
  if (new Set(states).size > 1) return { stage: null, stageState: null, conflict: true };
  return { stage: declared[0] ?? stageFromStageId, stageState: states[0] ?? null, conflict: false };
}

/** 规范化视觉阶段状态；阶段状态使用连字符小写，便于与 Work Item 合同直接比较。 */
function normalizeStageState(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().toLowerCase() || null;
}

/** 创建统一的未知投影，保留内部阶段信息供诊断而不猜测用户进度。 */
function unknownView(internalStage, reason) {
  return {
    phaseId: 'unknown',
    phaseLabel: '未知阶段',
    sceneStepId: null,
    sceneStepLabel: null,
    internalStage,
    reason,
  };
}

/** 获取阶段定义并返回稳定的四字段视图，同时保留内部诊断字段供未知组合使用。 */
function knownView(phaseId, sceneStep = null, internalStage = null) {
  const phase = PHASE_BY_ID.get(phaseId);
  return {
    phaseId: phase.id,
    phaseLabel: phase.label,
    sceneStepId: sceneStep?.id ?? null,
    sceneStepLabel: sceneStep?.label ?? null,
    internalStage,
  };
}

/**
 * 将当前 Work Item 投影为六阶段项目视图和四步场景视图。
 *
 * 该函数只读输入并按固定优先级判断：发布、集成、foundation-only、场景视觉阶段、
 * 基线状态。遇到冲突或未经识别的组合时返回 unknown，绝不把不完整输入显示成已完成进度。
 * 调用参数统一为 `{ workItem, implementationPackage, executionState }` 对象。
 */
export function projectWorkflowView(input = {}) {
  const normalized = normalizeInput(input);
  const workItem = normalized.workItem && typeof normalized.workItem === 'object' ? normalized.workItem : {};
  const stageId = normalizeIdentifier(workItem.stageId);
  const globalState = normalizeIdentifier(workItem.globalState);
  const internalStage = stageId && globalState ? `${stageId}/${globalState}` : stageId ?? globalState ?? 'unknown';
  const kind = packageKind(normalized.implementationPackage);
  const visual = visualStageInfo(workItem, normalized.executionState, stageId);

  // stageId 以 V 开头却不在 V0/V1/V2/V3/V4 中时属于未知内部阶段，不能降级显示为基线或场景进度。
  if (stageId?.startsWith('V') && !VISUAL_STAGES.has(stageId)) return unknownView(internalStage, '视觉阶段标识无法识别');

  // G3、发布状态和独立发布 Work Item 必须优先归入发布，避免被旧的视觉字段遮蔽。
  if (stageId === 'G3' || RELEASE_STATES.has(globalState) || workItem.releaseWorkItem === true) return knownView('release', null, internalStage);

  // G2、INTEGRATING 或纯 INTEGRATION 包表示跨场景集成，不再显示为单场景生产。
  if (stageId === 'G2' || globalState === 'INTEGRATING' || kind === 'integration') return knownView('global-integration-validation', null, internalStage);

  if (kind === 'unknown' || visual.conflict) return unknownView(internalStage, visual.conflict ? '视觉阶段声明冲突' : '实施单元组合无法识别');

  // foundation-only 允许在场景视觉门之前执行；V2 及之后与基础包组合属于矛盾输入。
  if (kind === 'foundation') {
    if (visual.stage && !['V0', 'V1'].includes(visual.stage)) return unknownView(internalStage, 'foundation-only 包与 V2/V3/V4 阶段冲突');
    return knownView('foundation-engineering', null, internalStage);
  }

  // 弹窗沿用 V0/V1/V2/V3/V4 证据门，但作为独立工作项展示，不冒充宿主场景进度。
  if (kind === 'display-layer') {
    if (globalState === 'INTAKE') return unknownView(internalStage, 'INTAKE 与弹窗生产声明冲突');
    return knownView('scene-production', null, internalStage);
  }

  const sceneStep = visual.stage ? SCENE_STEP_BY_STAGE.get(visual.stage) : null;
  const hasExplicitSceneStage = Boolean(visual.stage);
  if (kind === 'scene' || hasExplicitSceneStage) {
    // INTAKE 与场景实施包无法同时表示可信进度，保持 fail-closed。
    if (globalState === 'INTAKE') return unknownView(internalStage, 'INTAKE 与场景生产声明冲突');
    // V3 资源验收后直接进入 V4；投影只消费真实视觉阶段，不再保留草图中间步。
    return knownView('scene-production', sceneStep, internalStage);
  }

  // INTAKE 优先于 G0，因初始化时 stageId 通常已是 G0，但用户仍处于需求录入阶段。
  if (globalState === 'INTAKE') return knownView('requirements-scope', null, internalStage);
  if (stageId === 'G0' || GLOBAL_BASELINE_STATES.has(globalState)) return knownView('global-baseline', null, internalStage);

  return unknownView(internalStage, '缺少可识别的阶段、状态或实施包信息');
}

/** 从完整投影中提取写入稳定 CLI metadata 的四个展示字段。 */
export function workflowViewMetadata(view) {
  const value = view && typeof view === 'object' ? view : unknownView('unknown', '未提供工作流投影');
  return {
    phaseId: value.phaseId ?? 'unknown',
    phaseLabel: value.phaseLabel ?? '未知阶段',
    sceneStepId: value.sceneStepId ?? null,
    sceneStepLabel: value.sceneStepLabel ?? null,
  };
}
