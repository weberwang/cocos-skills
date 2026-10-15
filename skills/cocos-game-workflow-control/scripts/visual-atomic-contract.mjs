/**
 * 原子视觉需求的纯函数合同。
 *
 * 该模块不依赖验证器或 SVG 渲染器，保证 V3、实施包和标注图都从同一
 * “唯一 component × required state”来源派生生图需求，避免再次把编号区域
 * 误当成资产数量单位。
 */

/** 状态别名表；同一游戏状态只能派生一份原子资源需求。 */
const STATE_ALIASES = new Map([
  ["default", "default"], ["normal", "default"], ["idle", "default"],
  ["selected", "selected"], ["select", "selected"],
  ["active", "active"], ["activated", "active"],
  ["disabled", "disabled"], ["disable", "disabled"],
  ["pressed", "pressed"], ["down", "pressed"],
  ["hover", "hover"], ["hovered", "hover"], ["over", "hover"],
  ["victory", "victory"], ["win", "victory"], ["won", "victory"], ["success", "victory"],
  ["defeat", "defeat"], ["lose", "defeat"], ["lost", "defeat"], ["failure", "defeat"], ["fail", "defeat"],
  ["paused", "paused"], ["pause", "paused"],
]);

/** 判断值是否为非数组对象，避免不完整合同触发运行时异常。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断字符串是否有实际合同内容。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 按正式字段优先读取一个别名，保持派生逻辑集中。 */
function firstDefined(value, names, fallback = "") {
  if (!isObject(value)) return fallback;
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  return fallback;
}

/** 将状态别名归一化，确保 selected/win/lose 等状态在需求派生中只有一个身份。 */
export function atomicCanonicalStateId(value) {
  if (!nonEmptyString(value)) return "";
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return STATE_ALIASES.get(normalized) ?? normalized;
}

/** 读取区域或嵌套 production_contract 的生产方式和交付类型。 */
function productionContract(region = {}) {
  const nested = isObject(region.production_contract) ? region.production_contract : (isObject(region.productionContract) ? region.productionContract : {});
  const value = (snake, camel = snake) => firstDefined(region, [snake, camel], firstDefined(nested, [snake, camel], ""));
  return {
    production_method: value("production_method", "productionMethod"),
    delivery_kind: value("delivery_kind", "deliveryKind"),
  };
}

/** 读取唯一原子 component 清单，编号本身不参与资产计数。 */
function inventoryValue(region = {}) {
  const nested = isObject(region.production_contract) ? region.production_contract : (isObject(region.productionContract) ? region.productionContract : {});
  return region.component_inventory ?? region.componentInventory ?? nested.component_inventory ?? nested.componentInventory ?? {};
}

/** 读取区域声明的 expected_assets 原子资源列表。 */
function expectedValue(region = {}) {
  const nested = isObject(region.production_contract) ? region.production_contract : (isObject(region.productionContract) ? region.productionContract : {});
  return region.expected_assets ?? region.expectedAssets ?? nested.expected_assets ?? nested.expectedAssets ?? [];
}

/** 读取状态分析对象，派生需求不得凭 default 猜测缺失状态。 */
function stateValue(region = {}) {
  const nested = isObject(region.production_contract) ? region.production_contract : (isObject(region.productionContract) ? region.productionContract : {});
  return region.state_analysis ?? region.stateAnalysis ?? nested.state_analysis ?? nested.stateAnalysis ?? {};
}

/** 规范化唯一原子 component 及其可见 placement，保留状态和位置语义。 */
export function normalizeAtomicComponents(region = {}) {
  const inventory = inventoryValue(region);
  const components = Array.isArray(inventory?.components) ? inventory.components : [];
  return components.map((component) => {
    const stateCoverage = Array.isArray(component?.state_coverage) ? component.state_coverage : (Array.isArray(component?.stateCoverage) ? component.stateCoverage : []);
    const placements = Array.isArray(component?.placements) ? component.placements : [];
    return {
      component_id: firstDefined(component, ["component_id", "componentId"]),
      atomic_visual_key: firstDefined(component, ["atomic_visual_key", "atomicVisualKey"]),
      role: firstDefined(component, ["role", "component_role"]),
      reusable: component?.reusable,
      state_coverage: stateCoverage.map((state) => ({
        state_id: firstDefined(state, ["state_id", "stateId"]),
        canonical_state_id: atomicCanonicalStateId(firstDefined(state, ["state_id", "stateId"])),
        requirement: firstDefined(state, ["requirement", "applicability"]),
        reason: firstDefined(state, ["reason", "rationale"]),
      })),
      placements: placements.map((placement) => ({
        placement_id: firstDefined(placement, ["placement_id", "placementId"]),
        bounds: isObject(placement?.bounds) ? { x: placement.bounds.x, y: placement.bounds.y, width: placement.bounds.width, height: placement.bounds.height } : null,
        interaction_required: firstDefined(placement, ["interaction_required", "interactionRequired"]),
      })),
    };
  });
}

/** 规范化 expected asset，派生函数只读取资源身份，不推断组合图。 */
export function normalizeAtomicExpectedAssets(region = {}) {
  const values = expectedValue(region);
  return (Array.isArray(values) ? values : []).map((asset) => {
    if (typeof asset === "string") return { asset_id: asset, component_id: "", state_id: "", atomic_visual_key: "", asset_scope: "" };
    return {
      asset_id: firstDefined(asset, ["asset_id", "assetId", "id", "name"]),
      component_id: firstDefined(asset, ["component_id", "componentId"]),
      state_id: firstDefined(asset, ["state_id", "stateId"]),
      canonical_state_id: atomicCanonicalStateId(firstDefined(asset, ["state_id", "stateId"])),
      atomic_visual_key: firstDefined(asset, ["atomic_visual_key", "atomicVisualKey"]),
      asset_scope: firstDefined(asset, ["asset_scope", "assetScope"]),
      source_file: firstDefined(asset, ["source_file", "sourceFile", "file"]),
      runtime_file: firstDefined(asset, ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile"]),
    };
  });
}

/** 规范化生产审计的 expected_assets，保留透明路线与边缘冻结事实，防止审计时过滤合同漂移。 */
export function normalizeProductionExpectedAssets(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (nonEmptyString(item)) return { asset_id: item };
    if (!isObject(item)) return { asset_id: "" };
    return {
      asset_id: item.asset_id ?? item.id ?? item.name ?? item.file ?? item.path ?? "",
      file: item.file ?? item.path ?? item.source_file ?? "",
      delivery_kind: item.delivery_kind ?? item.deliveryKind ?? "",
      mime_type: item.mime_type ?? item.mimeType ?? "",
      width: item.width,
      height: item.height,
      alpha: item.alpha, transparency_requirements: item.transparency_requirements,
      // SHA 仅作为可选追踪字段保留在原始输入，不纳入生产资产身份投影。
      asset_scope: item.asset_scope ?? item.assetScope ?? "",
      atomic_visual_key: item.atomic_visual_key ?? item.atomicVisualKey ?? "",
      component_id: item.component_id ?? item.componentId ?? "",
      state_id: item.state_id ?? item.stateId ?? "",
      source_file: item.source_file ?? item.sourceFile ?? item.file ?? "",
      runtime_file: item.runtime_file ?? item.runtimeFile ?? "",
    };
  });
}

/** 取得区域状态分析中的 canonical 状态与适用性。 */
function regionStates(region) {
  const analysis = stateValue(region);
  return (Array.isArray(analysis?.states) ? analysis.states : []).map((state) => ({
    state_id: firstDefined(state, ["state_id", "stateId"]),
    canonical_state_id: atomicCanonicalStateId(firstDefined(state, ["state_id", "stateId"])),
    requirement: firstDefined(state, ["requirement", "applicability"]),
  }));
}

/** 规范化需求对象，数组顺序只影响展示，不影响合同等价比较。 */
export function normalizeAtomicImageRequirements(value) {
  const values = Array.isArray(value) ? value : [];
  return values.map((item) => ({
    requirement_id: firstDefined(item, ["requirement_id", "requirementId"]),
    annotation_number: item?.annotation_number ?? item?.annotationNumber,
    region_id: firstDefined(item, ["region_id", "regionId"]),
    atomic_visual_key: firstDefined(item, ["atomic_visual_key", "atomicVisualKey"]),
    component_id: firstDefined(item, ["component_id", "componentId"]),
    state_id: atomicCanonicalStateId(firstDefined(item, ["state_id", "stateId"])),
    production_method: firstDefined(item, ["production_method", "productionMethod"]),
    delivery_kind: firstDefined(item, ["delivery_kind", "deliveryKind"]),
    asset_id: firstDefined(item, ["asset_id", "assetId"]),
    source_file: firstDefined(item, ["source_file", "sourceFile"]),
    runtime_file: firstDefined(item, ["runtime_file", "runtimeFile"]),
    placement_ids: (Array.isArray(item?.placement_ids) ? item.placement_ids : (Array.isArray(item?.placementIds) ? item.placementIds : [])).slice().sort(),
  })).sort((left, right) => `${left.requirement_id}\0${left.component_id}\0${left.state_id}`.localeCompare(`${right.requirement_id}\0${right.component_id}\0${right.state_id}`));
}

/**
 * 从唯一 component × required state 直接派生机器可执行生图需求。
 * 缺少 expected asset 时仍返回带空资源身份的需求，交给验证器报告具体缺失项。
 */
export function deriveAtomicImageRequirements(region = {}) {
  const components = normalizeAtomicComponents(region);
  const expectedAssets = normalizeAtomicExpectedAssets(region);
  const production = productionContract(region);
  const annotationNumber = region.annotation_number ?? region.annotationNumber ?? "";
  const regionId = region.id ?? region.region_id ?? region.regionId ?? "";
  const regionStatesById = new Map(regionStates(region).map((state) => [state.canonical_state_id, state.requirement]));
  const requirements = [];
  for (const component of components) {
    const coverage = component.state_coverage.length ? component.state_coverage : regionStates(region);
    for (const state of coverage) {
      if (state.requirement !== "required" || !state.canonical_state_id) continue;
      const stateRequirement = regionStatesById.get(state.canonical_state_id);
      if (stateRequirement === "not-applicable") continue;
      const asset = expectedAssets.find((item) => item.component_id === component.component_id && item.canonical_state_id === state.canonical_state_id) ?? {};
      const atomicKey = component.atomic_visual_key;
      requirements.push({
        requirement_id: `atomic:${annotationNumber}:${regionId}:${atomicKey}:${state.canonical_state_id}`,
        annotation_number: annotationNumber,
        region_id: regionId,
        atomic_visual_key: atomicKey,
        component_id: component.component_id,
        state_id: state.canonical_state_id,
        production_method: production.production_method,
        delivery_kind: production.delivery_kind,
        asset_id: asset.asset_id ?? "",
        source_file: asset.source_file ?? "",
        runtime_file: asset.runtime_file ?? "",
        placement_ids: component.placements.map((placement) => placement.placement_id).filter(nonEmptyString).sort(),
      });
    }
  }
  return normalizeAtomicImageRequirements(requirements);
}

/** 比较区域、提案和实施包的派生需求是否严格等价。 */
export function atomicImageRequirementsEqual(left, right) {
  return JSON.stringify(normalizeAtomicImageRequirements(left)) === JSON.stringify(normalizeAtomicImageRequirements(right));
}
