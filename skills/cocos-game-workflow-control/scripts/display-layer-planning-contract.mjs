/**
 * 当前工作项的显示层规划合同校验。
 *
 * 场景工作项只记录自身常驻显示层；弹窗、抽屉和 Toast 由独立
 * DISPLAY_LAYER 工作项规划与验收。host_scene_id 仅绑定运行上下文，
 * 不把独立显示层并回宿主场景的完成条件。
 */

import { collectGlobalVisualConsistencyEvidencePaths, validateVisualEffectImageOrigin } from "./global-visual-consistency-contract.mjs";

const DISPLAY_LAYER_TYPES = new Set(["hud", "modal", "popup", "drawer", "toast"]);
const DISPLAY_LAYER_LIFECYCLES = new Set(["persistent", "transient"]);
const REPLAY_PHASES = ["open", "interact", "close", "restore"];

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断正数 viewport。 */
function validViewport(value) {
  return isObject(value)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

/** 判断字段是否为可复核的结构化合同事实。 */
function hasFact(value, { allowEmptyArray = false, allowBoolean = true } = {}) {
  if (Array.isArray(value)) return allowEmptyArray || value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  if (allowBoolean && typeof value === "boolean") return true;
  return nonEmptyString(value) || typeof value === "number";
}

/** 生成带阶段和显示层身份的稳定错误文本。 */
function planningError(stage, layer, message, details = "") {
  const layerId = layer?.layer_id ?? "*";
  const hostScene = layer?.host_scene_id ?? "*";
  const suffix = details ? ` ${details}` : "";
  return `[${stage}] display_layer=${layerId} host_scene=${hostScene} ${message}${suffix}`;
}

/** 校验宿主场景上下文效果图的身份，拒绝孤立组件图冒充完整证据。 */
function validateContextualEffectImage(image, layer, state, sceneMaster, targetInfo, stage, errors, visualBaseline = null) {
  const label = `${layer.layer_id}/${state.state_id}`;
  if (!isObject(image)) {
    errors.push(planningError(stage, layer, `required state ${state.state_id} 缺少宿主场景上下文效果图`, `缺失=contextual_effect_image`));
    return;
  }
  for (const [field, description] of [
    ["evidence", "效果图证据"],
    ["origin", "效果图来源身份"],
    ["host_scene_id", "宿主 scene_id"],
    ["viewport", "效果图 viewport"],
    ["kind", "效果图类型"],
    ["isolated_only", "孤立图标志"],
  ]) {
    if (image[field] === undefined || image[field] === null) errors.push(planningError(stage, layer, `${label} 上下文效果图缺少 ${description}`, `缺失=contextual_effect_image.${field}`));
  }
  if (!nonEmptyString(image.evidence)) errors.push(planningError(stage, layer, `${label} 上下文效果图 evidence 必须是项目内文件路径`, "实际=missing"));
  // SHA 摘要仅供追踪；场景身份由显式 scene_id/state_id 与实际证据路径校验。
  if (image.kind !== "host-scene-context") errors.push(planningError(stage, layer, `${label} 效果图必须声明 kind=host-scene-context`, `实际=${String(image.kind ?? "missing")}`));
  if (image.isolated_only !== false) errors.push(planningError(stage, layer, `${label} 孤立组件图不能作为完整效果图证据`, "预期=isolated_only:false"));
  if (image.host_scene_id !== sceneMaster.scene_id || image.host_scene_id !== layer.host_scene_id || image.host_scene_id !== targetInfo.sceneId) errors.push(planningError(stage, layer, `${label} 上下文效果图未绑定宿主场景`, `预期=${sceneMaster.scene_id}`));
  const masterViewport = sceneMaster.viewport ?? {};
  if (!validViewport(image.viewport) || image.viewport.width !== masterViewport.width || image.viewport.height !== masterViewport.height) errors.push(planningError(stage, layer, `${label} 上下文效果图 viewport 必须与 scene master 一致`, `预期=${masterViewport.width ?? "missing"}x${masterViewport.height ?? "missing"}`));
  errors.push(...validateVisualEffectImageOrigin(image, {
    label: `${label} contextual_effect_image`,
    visual_baseline: visualBaseline,
  }));
}

/** 校验 V4 的真实打开→交互→关闭→恢复轨迹。 */
function validateRuntimeReplay(replay, layer, sceneMaster, stage, errors) {
  if (!isObject(replay)) {
    errors.push(planningError(stage, layer, "transient 显示层缺少宿主场景运行轨迹", "缺失=runtime_replay"));
    return;
  }
  if (!["passed", "PASS"].includes(String(replay.status))) errors.push(planningError(stage, layer, "runtime_replay 必须通过", `实际=${String(replay.status ?? "missing")}`));
  if (replay.host_scene_id !== layer.host_scene_id || replay.host_scene_id !== sceneMaster.scene_id) errors.push(planningError(stage, layer, "runtime_replay 未绑定宿主场景", `预期=${sceneMaster.scene_id}`));
  if (replay.same_screen_combination !== true) errors.push(planningError(stage, layer, "runtime_replay 必须声明宿主场景同屏组合", "预期=same_screen_combination:true"));
  if (!Array.isArray(replay.steps)) {
    errors.push(planningError(stage, layer, "runtime_replay.steps 必须覆盖 open/interact/close/restore", "缺失=steps"));
    return;
  }
  const seen = new Set();
  for (const [index, step] of replay.steps.entries()) {
    if (!isObject(step) || !REPLAY_PHASES.includes(step.phase)) {
      errors.push(planningError(stage, layer, `runtime_replay.steps[${index}] 阶段无效`, `预期=${REPLAY_PHASES.join("/")}`));
      continue;
    }
    if (seen.has(step.phase)) errors.push(planningError(stage, layer, `runtime_replay.steps 重复阶段 ${step.phase}`));
    seen.add(step.phase);
    if (!nonEmptyString(step.evidence)) errors.push(planningError(stage, layer, `runtime_replay.steps.${step.phase} evidence 必须是项目内文件路径`));
  }
  for (const phase of REPLAY_PHASES) if (!seen.has(phase)) errors.push(planningError(stage, layer, `runtime_replay 缺少 ${phase} 轨迹证据`, "预期=open→interact→close→restore"));
}

/** 校验单个显示层的状态、上下文效果图和生命周期合同。 */
function validateLayer(layer, sceneMaster, targetInfo, stage, errors, layerIds, visualBaseline = null) {
  if (!isObject(layer)) {
    errors.push(planningError(stage, null, "display layer 必须是对象"));
    return;
  }
  const requiredFields = [
    ["layer_id", "稳定 ID"], ["type", "类型"], ["host_scene_id", "宿主场景"],
    ["persistence", "persistent/transient"],
    ["states", "状态列表"], ["in_scene_master", "scene master 归属"], ["trigger", "触发条件"],
    ["dismiss", "关闭条件"], ["input_blocking", "输入阻断策略"], ["z_order", "层级"],
    ["backdrop", "遮罩策略"], ["focus_restore", "焦点恢复策略"], ["responsive", "响应式规则"], ["relations", "互斥/共存关系"],
  ];
  for (const [field, description] of requiredFields) if (layer[field] === undefined || layer[field] === null) errors.push(planningError(stage, layer, `显示层缺少 ${description}`, `缺失=${field}`));
  if (!nonEmptyString(layer.layer_id)) return;
  if (layerIds.has(layer.layer_id)) errors.push(planningError(stage, layer, "layer_id 重复"));
  layerIds.add(layer.layer_id);
  if (!DISPLAY_LAYER_TYPES.has(layer.type)) errors.push(planningError(stage, layer, "type 无效", `预期=${[...DISPLAY_LAYER_TYPES].join("/")}`));
  if (!nonEmptyString(layer.host_scene_id) || layer.host_scene_id !== sceneMaster.scene_id || layer.host_scene_id !== targetInfo.sceneId) errors.push(planningError(stage, layer, "host_scene_id 必须绑定当前宿主场景", `预期=${sceneMaster.scene_id}`));
  if (!DISPLAY_LAYER_LIFECYCLES.has(layer.persistence)) errors.push(planningError(stage, layer, "persistence 只能为 persistent 或 transient"));
  if (layer.type === "hud" && layer.persistence !== "persistent") errors.push(planningError(stage, layer, "HUD 必须声明 persistent 生命周期"));
  if (typeof layer.in_scene_master !== "boolean") errors.push(planningError(stage, layer, "in_scene_master 必须为布尔值"));
  const mustBeInMaster = layer.persistence === "persistent" || layer.type === "hud";
  if (layer.in_scene_master !== mustBeInMaster) errors.push(planningError(stage, layer, `显示层 ${mustBeInMaster ? "必须" : "不得"}进入默认 scene master`, `实际=${String(layer.in_scene_master)}`));
  if (!hasFact(layer.trigger) || !hasFact(layer.dismiss) || !hasFact(layer.input_blocking) || !hasFact(layer.backdrop) || !hasFact(layer.focus_restore) || !hasFact(layer.responsive) || !isObject(layer.relations)) errors.push(planningError(stage, layer, "触发/关闭、输入、遮罩、焦点、响应式和关系合同必须完整"));
  if (!Array.isArray(layer.states) || layer.states.length === 0) {
    errors.push(planningError(stage, layer, "states 必须为非空结构化数组"));
  } else {
    const stateIds = new Set();
    for (const [index, state] of layer.states.entries()) {
      if (!isObject(state) || !nonEmptyString(state.state_id) || typeof state.required !== "boolean") {
        errors.push(planningError(stage, layer, `states[${index}] 必须包含 state_id 和 required`));
        continue;
      }
      if (stateIds.has(state.state_id)) errors.push(planningError(stage, layer, `state_id 重复：${state.state_id}`));
      stateIds.add(state.state_id);
      if (layer.persistence === "transient" && state.required === true) validateContextualEffectImage(state.contextual_effect_image, layer, state, sceneMaster, targetInfo, stage, errors, visualBaseline);
      else if (state.contextual_effect_image !== undefined) validateContextualEffectImage(state.contextual_effect_image, layer, state, sceneMaster, targetInfo, stage, errors, visualBaseline);
    }
  }
  for (const relationType of ["mutually_exclusive_layer_ids", "coexists_with_layer_ids"]) {
    const relationIds = layer.relations?.[relationType];
    if (!Array.isArray(relationIds) || relationIds.some((id) => !nonEmptyString(id)) || new Set(relationIds).size !== relationIds.length) errors.push(planningError(stage, layer, `relations.${relationType} 必须是无重复非空 layer_id 数组`));
  }
  if (stage === "V4" && layer.persistence === "transient") validateRuntimeReplay(layer.runtime_replay, layer, sceneMaster, stage, errors);
}

/**
 * 校验当前工作项的场景上下文和显示层清单。
 *
 * inventory=[] 是场景没有自有显示层的显式声明。未实现的弹窗不得以
 * deferred_layers 挂在场景下，而应建立独立 DISPLAY_LAYER 工作项。
 */
export function validateDisplayLayerPlanning(planning, targetInfo = null, options = {}) {
  const stage = String(options.stage ?? "V1").toUpperCase();
  const scope = options.scope ?? "display-layer";
  const errors = [];
  if (!isObject(planning)) {
    errors.push(planningError(stage, null, "缺少 display_layer_planning；即使无显示层也必须声明 inventory=[]"));
    return errors;
  }
  if (!nonEmptyString(planning.version)) errors.push(planningError(stage, null, "display_layer_planning.version 缺失"));
  if (!isObject(planning.scene_master)) {
    errors.push(planningError(stage, null, "scene_master 必须是对象"));
    return errors;
  }
  const sceneMaster = planning.scene_master;
  for (const field of ["scene_id", "state_id", "origin", "viewport", "persistent_layer_ids"]) if (sceneMaster[field] === undefined || sceneMaster[field] === null) errors.push(planningError(stage, null, `scene_master 缺少 ${field}`));
  if (!nonEmptyString(sceneMaster.scene_id) || !nonEmptyString(sceneMaster.state_id)) errors.push(planningError(stage, null, "scene_master.scene_id/state_id 必须为非空字符串"));
  if (!validViewport(sceneMaster.viewport)) errors.push(planningError(stage, null, "scene_master.viewport 必须包含正数 width/height"));
  if (!Array.isArray(sceneMaster.persistent_layer_ids) || sceneMaster.persistent_layer_ids.some((id) => !nonEmptyString(id)) || new Set(sceneMaster.persistent_layer_ids).size !== sceneMaster.persistent_layer_ids.length) errors.push(planningError(stage, null, "scene_master.persistent_layer_ids 必须是无重复字符串数组"));
  errors.push(...validateVisualEffectImageOrigin(sceneMaster, {
    label: "scene_master",
    visual_baseline: options.visual_baseline ?? null,
  }).map((message) => planningError(stage, null, message)));
  if (targetInfo) {
    if (sceneMaster.scene_id !== targetInfo.sceneId || sceneMaster.state_id !== targetInfo.stateId) errors.push(planningError(stage, null, "scene_master scene/state 未绑定当前冻结目标", `预期=${targetInfo.sceneId}/${targetInfo.stateId}`));
    const masterViewport = sceneMaster.viewport ?? {};
    if (!validViewport(targetInfo.viewport) || masterViewport.width !== targetInfo.viewport.width || masterViewport.height !== targetInfo.viewport.height) errors.push(planningError(stage, null, "scene_master.viewport 未绑定当前冻结目标", `预期=${targetInfo.viewport?.width}x${targetInfo.viewport?.height}`));
  }
  if (!Array.isArray(planning.inventory)) {
    errors.push(planningError(stage, null, "display_layer_planning.inventory 必须是数组；无显示层时使用 []"));
    return errors;
  }
  const layerIds = new Set();
  for (const layer of planning.inventory) {
    // 场景合同只允许 scene master 的常驻层；瞬态弹窗必须转入独立工作项，避免其状态进入场景门。
    if (scope === "scene" && isObject(layer) && layer.persistence === "transient") {
      errors.push(planningError(stage, layer, "瞬态显示层不属于场景工作项", "请建立独立 DISPLAY_LAYER Work Item；host_scene_id 仅作为运行上下文"));
      continue;
    }
    validateLayer(layer, sceneMaster, targetInfo ?? { sceneId: sceneMaster.scene_id }, stage, errors, layerIds, options.visual_baseline ?? null);
  }
  if (Object.hasOwn(planning, "deferred_layers")) errors.push(planningError(stage, null, "display_layer_planning.deferred_layers 已移除", "弹窗、抽屉和 Toast 必须建立独立 DISPLAY_LAYER 工作项，不得挂入场景验收"));
  const declaredMasterIds = new Set(sceneMaster.persistent_layer_ids ?? []);
  for (const declaredId of declaredMasterIds) if (!layerIds.has(declaredId)) errors.push(planningError(stage, null, `scene_master.persistent_layer_ids 引用了不存在的 layer_id：${declaredId}`));
  for (const layer of planning.inventory) {
    if (!isObject(layer) || !nonEmptyString(layer.layer_id)) continue;
    const shouldBeMaster = layer.persistence === "persistent" || layer.type === "hud";
    if (shouldBeMaster !== declaredMasterIds.has(layer.layer_id)) errors.push(planningError(stage, layer, `scene_master.persistent_layer_ids 与 ${shouldBeMaster ? "常驻层" : "瞬态层"}归属不一致`));
    for (const relationType of ["mutually_exclusive_layer_ids", "coexists_with_layer_ids"]) for (const relatedId of (layer.relations?.[relationType] ?? [])) {
      // 关系可以指向其他独立 Work Item；这里只阻止自引用，不把外部层拉入当前任务验收。
      if (relatedId === layer.layer_id) errors.push(planningError(stage, layer, `relations.${relationType} 不得引用自身`));
    }
  }
  return [...new Set(errors)];
}

/** 提取显示层上下文证据路径，供 visual manifest 文件门复用。 */
export function collectDisplayLayerEvidencePaths(planning) {
  const paths = [];
  if (!isObject(planning) || !Array.isArray(planning.inventory)) return paths;
  if (isObject(planning.scene_master?.generation_record)) for (const item of collectGlobalVisualConsistencyEvidencePaths(planning.scene_master.generation_record, "display_layer_planning.scene_master.generation_record")) paths.push(item);
  for (const layer of planning.inventory) {
    if (!isObject(layer)) continue;
    for (const state of Array.isArray(layer.states) ? layer.states : []) {
      const image = state?.contextual_effect_image;
      if (isObject(image) && nonEmptyString(image.evidence)) paths.push({ field: `display_layer_planning.${layer.layer_id}.${state.state_id}.contextual_effect_image`, path: image.evidence });
      if (isObject(image?.generation_record)) for (const item of collectGlobalVisualConsistencyEvidencePaths(image.generation_record, `display_layer_planning.${layer.layer_id}.${state.state_id}.generation_record`)) paths.push(item);
    }
    for (const step of layer.runtime_replay?.steps ?? []) if (isObject(step) && nonEmptyString(step.evidence)) paths.push({ field: `display_layer_planning.${layer.layer_id}.runtime_replay.${step.phase}`, path: step.evidence });
  }
  return paths;
}
