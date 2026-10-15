import { calculateFullBleedCoverTransform } from "../../cocos-game-asset-integration/scripts/full-bleed-background-adapter.mjs";

/** 横竖屏共享的固定设计基准，避免合同校验与运行计算各自维护尺寸。 */
export const DESIGN_RESOLUTIONS = Object.freeze({
  portrait: Object.freeze({ width: 1080, height: 1920, fitAxis: "width" }),
  landscape: Object.freeze({ width: 1920, height: 1080, fitAxis: "height" }),
});

/**
 * 按固定设计稿的主轴缩放，另一轴随真实视口展开或裁切，确保画布铺满屏幕。
 * 返回的可见区域使用设计稿逻辑坐标，背景需另按该区域执行等比 cover。
 */
export function calculateFixedDesignViewport({ width, height }) {
  if (![width, height].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new TypeError("CSS 视口宽高必须是正有限数");
  }
  const orientation = width < height ? "portrait" : "landscape";
  const design = DESIGN_RESOLUTIONS[orientation];
  const scale = design.fitAxis === "width" ? width / design.width : height / design.height;
  const visibleWidth = width / scale;
  const visibleHeight = height / scale;
  return {
    orientation,
    designWidth: design.width,
    designHeight: design.height,
    fitAxis: design.fitAxis,
    scale,
    visibleWidth,
    visibleHeight,
    offsetX: (visibleWidth - design.width) / 2,
    offsetY: (visibleHeight - design.height) / 2,
  };
}

/** 将设计坐标映射到 CSS 局部坐标；居中偏移只在这一层应用一次。 */
export function designPointToCss({ x, y }, viewport) {
  return { x: (x + viewport.offsetX) * viewport.scale, y: (y + viewport.offsetY) * viewport.scale };
}

/** 输入先减去画布 client rect 原点，再使用此逆变换还原设计坐标，不引入 DPR。 */
export function cssPointToDesign({ x, y }, viewport) {
  return { x: x / viewport.scale - viewport.offsetX, y: y / viewport.scale - viewport.offsetY };
}

/** 背景 cover 的可见区域原点转换为设计坐标，避免主轴适配后的居中偏移露出边缘。 */
export function calculateFixedDesignBackground({ sourceWidth, sourceHeight, viewport, sourceFocalPoint, targetPoint }) {
  if (!viewport || ![viewport.visibleWidth, viewport.visibleHeight, viewport.offsetX, viewport.offsetY].every(Number.isFinite)) {
    throw new TypeError("viewport 必须是固定设计视口计算结果");
  }
  const cover = calculateFullBleedCoverTransform({
    sourceWidth,
    sourceHeight,
    viewportWidth: viewport.visibleWidth,
    viewportHeight: viewport.visibleHeight,
    sourceFocus: sourceFocalPoint,
    targetPoint,
  });
  return { ...cover, x: cover.x - viewport.offsetX, y: cover.y - viewport.offsetY };
}
