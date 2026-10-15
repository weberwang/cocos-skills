/**
 * 工作流统一 DPR 合同。
 *
 * 运行时 DPR 从设备值动态解析，允许 (0, RUNTIME_MAX_DPR] 的有效数值；
 * 图片生产使用独立的 IMAGE_PRODUCTION_DPR 基线，避免把运行时封顶误当成
 * 资源尺寸要求。把两套数值集中在本模块，避免布局、QA、场景还原和视觉清单
 * 各自实现不同的封顶或生产校验逻辑。
 */
export const RUNTIME_MAX_DPR = 2;
/** 图片按逻辑显示尺寸 1:1 生产，运行时高分屏密度不再额外放大资源。 */
export const IMAGE_PRODUCTION_DPR = 1;
export const DEFAULT_DPR = 1;
export const DPR_POLICY = "dynamic-capped-2";

/** 判断值是否为有效的运行时/证据 DPR；字符串等隐式值必须拒绝。 */
export function isWorkflowDpr(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= RUNTIME_MAX_DPR;
}

/** 判断原始设备输入是否可参与动态封顶；此处允许大于上限的设备值。 */
export function isDeviceDprInput(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 判断值是否为图片生产尺寸合同的固定基线。 */
export function isImageProductionDpr(value) {
  return typeof value === "number" && Number.isFinite(value) && value === IMAGE_PRODUCTION_DPR;
}

/**
 * 从原始设备 DPR 解析运行时有效 DPR。
 *
 * 浏览器设备值缺失或非法时使用安全默认值 1；正有限设备值则动态封顶到
 * RUNTIME_MAX_DPR。该函数不负责接受合同中的“声明值”，声明值仍须由
 * `isWorkflowDpr`/`validateWorkflowDpr` 严格校验，避免把手写 3 当成有效证据。
 */
export function parseDeviceDpr(deviceDpr, fallback = DEFAULT_DPR) {
  const safeFallback = isWorkflowDpr(fallback) ? fallback : DEFAULT_DPR;
  if (!isDeviceDprInput(deviceDpr)) return safeFallback;
  return Math.min(deviceDpr, RUNTIME_MAX_DPR);
}

/** 生成统一的 DPR 失败文案，明确这是范围合同而非固定数字合同。 */
export function workflowDprError(label = "dpr", actual) {
  const observed = actual === undefined ? "missing" : JSON.stringify(actual);
  return `${label} 必须是正有限数字且不超过 ${RUNTIME_MAX_DPR}（实际=${observed}）`;
}

/** 生成图片生产基线错误；运行时 DPR 可变化，但 max_dpr 只能是数字 1。 */
export function imageProductionDprError(label = "max_dpr", actual) {
  const observed = actual === undefined ? "missing" : JSON.stringify(actual);
  return `${label} 必须严格为图片生产基线 ${IMAGE_PRODUCTION_DPR}（实际=${observed}）`;
}

/** 返回字段的动态 DPR 校验结果；通过时返回 null。 */
export function validateWorkflowDpr(value, label = "dpr") {
  return isWorkflowDpr(value) ? null : workflowDprError(label, value);
}

/** 返回图片生产 max_dpr 校验结果；通过时返回 null。 */
export function validateImageProductionDpr(value, label = "max_dpr") {
  return isImageProductionDpr(value) ? null : imageProductionDprError(label, value);
}
