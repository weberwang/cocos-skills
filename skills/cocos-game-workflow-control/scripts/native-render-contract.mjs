/** 原生视觉参数与运行消费共用合同，禁止用近似绘制掩盖不支持的特征。 */
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isPlainObject, nonEmptyString } from "./visual-contract-core.mjs";
import { manifestEvidenceIdentity, safeProjectPath, validateEvidenceIdentity } from "./visual-runtime-evidence.mjs";

const COLOR = /^#[a-fA-F0-9]{6}$/;

/** 校验被冻结的原生参数；不适用的描边、圆角和渐变也必须显式声明零值或 none。 */
export function validateNativeRenderContract(value, region = {}) {
  if (!isPlainObject(value)) return ["native_suitability.render_contract 必须冻结原生渲染参数"];
  const errors = [];
  if (!nonEmptyString(value.renderer)) errors.push("render_contract.renderer 必须指明实际 Cocos 渲染能力");
  if (!isPlainObject(value.dimensions) || ![value.dimensions.width, value.dimensions.height].every((size) => Number.isFinite(size) && size > 0)) errors.push("render_contract.dimensions 必须冻结正数 width/height");
  if (!Array.isArray(value.colors) || value.colors.length === 0 || !value.colors.every((color) => typeof color === "string" && COLOR.test(color))) errors.push("render_contract.colors 必须冻结 #RRGGBB 颜色");
  for (const field of ["line_width", "corner_radius"]) if (!Number.isFinite(value[field]) || value[field] < 0) errors.push(`render_contract.${field} 必须是非负有限数值`);
  if (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) errors.push("render_contract.opacity 必须在 0..1 范围内");
  if (!Array.isArray(value.applicable_states) || value.applicable_states.length === 0 || !value.applicable_states.every(nonEmptyString)) errors.push("render_contract.applicable_states 必须冻结适用状态");
  else if (nonEmptyString(region.state_id) && !value.applicable_states.includes(region.state_id)) errors.push("render_contract.applicable_states 未覆盖当前 state_id");
  if (!Array.isArray(value.unsupported_features) || value.unsupported_features.length !== 0) errors.push("render_contract.unsupported_features 必须显式为空；不支持的视觉特征必须重新选择生产路线，禁止近似替代");
  const gradient = value.gradient;
  if (!isPlainObject(gradient) || !["none", "linear"].includes(gradient.type) || !Array.isArray(gradient.stops)) errors.push("render_contract.gradient 必须冻结 type 和 stops");
  else if (gradient.type === "none") {
    if (gradient.stops.length !== 0 || gradient.angle !== undefined) errors.push("无渐变必须使用 none、空 stops 且不声明 angle");
  } else {
    // 任意角度是否可表达必须由 renderer 资格证据证明；这里不把声明角度视为引擎支持证明。
    if (!Number.isFinite(gradient.angle) || gradient.angle < 0 || gradient.angle > 360) errors.push("线性渐变必须冻结 0..360 的 angle");
    if (gradient.stops.length < 2 || gradient.stops.some((stop, index) => !isPlainObject(stop) || !Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1 || (index > 0 && stop.offset <= gradient.stops[index - 1]?.offset) || typeof stop.color !== "string" || !COLOR.test(stop.color))) errors.push("线性渐变 stops 必须包含至少两个位置严格递增的 #RRGGBB 色标");
  }
  return errors;
}

/** V4 核对实际原生输出和消费证据；规划参数本身不能充当运行验收结果。 */
export function validateNativeRuntimeEvidence(region, contract, manifest, options = {}) {
  if (String(options.stage).toUpperCase() !== "V4") return [];
  const analysis = region.visual_route_analysis;
  const evidence = region.native_runtime_evidence;
  if (!isPlainObject(evidence)) return ["V4 原生路线缺少 native_runtime_evidence 实际输出与运行消费证据"];
  const errors = [];
  if (evidence.status !== "passed") errors.push("native_runtime_evidence.status 必须为 passed");
  if (evidence.observed_method !== analysis.production_method || evidence.observed_delivery_kind !== analysis.delivery_kind) errors.push("native_runtime_evidence 实际生产方式/交付类型与冻结路线不一致");
  if (!isDeepStrictEqual(evidence.render_contract, analysis.native_suitability?.render_contract)) errors.push("native_runtime_evidence.render_contract 与冻结原生参数不一致");
  const identity = manifestEvidenceIdentity(manifest);
  errors.push(...validateEvidenceIdentity(evidence, { stage: "V4", region_id: region.region_id, annotation_number: region.annotation_number, expectedMethod: analysis.production_method, observedMethod: evidence.observed_method }, identity, options));
  if (options.projectRoot) {
    const path = safeProjectPath(options.projectRoot, evidence.evidence);
    if (path && existsSync(path) && statSync(path).isFile()) {
      // 必须读取工件中的实际消费事实，避免把无关文件绑定为原生输出证据。
      try {
        const report = JSON.parse(readFileSync(path, "utf8"));
        if (!isPlainObject(report) || report.report_schema !== "native-render-consumption/1.0" || report.consumed !== true) errors.push("原生运行工件必须记录 native-render-consumption/1.0 和 consumed=true");
        else {
          for (const field of ["region_id", "scene_id", "state_id"]) if (report[field] !== region[field]) errors.push(`原生运行工件 ${field} 未绑定当前区域`);
          for (const field of ["observed_method", "observed_delivery_kind", "render_contract"]) if (!isDeepStrictEqual(report[field], evidence[field])) errors.push(`原生运行工件 ${field} 与消费证据不一致`);
        }
      } catch {
        errors.push("原生运行工件必须是可读取的 JSON 消费记录");
      }
    }
  }
  return errors;
}
