#!/usr/bin/env node

const DEFAULT_NORMALIZED_POINT = Object.freeze({ x: 0.5, y: 0.5 });

/** 判断参数是否为可读取的普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 校验必须为正数且不能溢出为无穷大的尺寸输入。 */
function assertPositiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} 必须是正有限数`);
  }
  return value;
}

/** 校验归一化坐标，并复制成不可被调用方后续修改的数值对象。 */
function normalizePoint(value, label) {
  const point = value === undefined ? DEFAULT_NORMALIZED_POINT : value;
  if (!isObject(point)) throw new TypeError(`${label} 必须是包含 x/y 的对象`);
  const { x, y } = point;
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) {
    throw new RangeError(`${label}.x 必须是 [0, 1] 内的有限数`);
  }
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) {
    throw new RangeError(`${label}.y 必须是 [0, 1] 内的有限数`);
  }
  return { x, y };
}

/** 将焦点计算出的坐标限制在完整覆盖 viewport 所允许的范围内。 */
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * 计算装饰性满幅背景的等比 cover 变换。
 *
 * 结果中的 x/y 使用图像左上原点、Y 向下，crop 与 viewport 使用同一单位。
 * Creator 节点必须先按父节点和 Sprite 的 UITransform 锚点转换为局部 Y 向上
 * 坐标，不能直接将结果传给 setPosition。焦点超出裁切范围时会被限制，避免露底。
 *
 * @param {object} options
 * @param {number} options.sourceWidth 源图宽度
 * @param {number} options.sourceHeight 源图高度
 * @param {number} options.viewportWidth 目标 viewport 宽度
 * @param {number} options.viewportHeight 目标 viewport 高度
 * @param {{x:number,y:number}} [options.sourceFocus] 源图归一化焦点，默认中心
 * @param {{x:number,y:number}} [options.targetPoint] viewport 归一化落点，默认中心
 * @returns {{x:number,y:number,scale:number,displayWidth:number,displayHeight:number,crop:{left:number,top:number,right:number,bottom:number}}}
 */
export function calculateFullBleedCoverTransform(options = {}) {
  if (!isObject(options)) throw new TypeError("options 必须是对象");

  const sourceWidth = assertPositiveFinite(options.sourceWidth, "sourceWidth");
  const sourceHeight = assertPositiveFinite(options.sourceHeight, "sourceHeight");
  const viewportWidth = assertPositiveFinite(options.viewportWidth, "viewportWidth");
  const viewportHeight = assertPositiveFinite(options.viewportHeight, "viewportHeight");
  const sourceFocus = normalizePoint(options.sourceFocus, "sourceFocus");
  const targetPoint = normalizePoint(options.targetPoint, "targetPoint");

  const scale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  if (!Number.isFinite(scale) || !Number.isFinite(displayWidth) || !Number.isFinite(displayHeight)) {
    throw new RangeError("计算出的缩放或显示尺寸必须是有限数");
  }

  const desiredX = targetPoint.x * viewportWidth - sourceFocus.x * displayWidth;
  const desiredY = targetPoint.y * viewportHeight - sourceFocus.y * displayHeight;
  // x/y 的下界保证右/下边覆盖 viewport，上界保证左/上边覆盖 viewport。
  const x = clamp(desiredX, viewportWidth - displayWidth, 0);
  const y = clamp(desiredY, viewportHeight - displayHeight, 0);
  const crop = {
    left: Math.max(0, -x),
    top: Math.max(0, -y),
    right: Math.max(0, x + displayWidth - viewportWidth),
    bottom: Math.max(0, y + displayHeight - viewportHeight),
  };

  return { x, y, scale, displayWidth, displayHeight, crop };
}
