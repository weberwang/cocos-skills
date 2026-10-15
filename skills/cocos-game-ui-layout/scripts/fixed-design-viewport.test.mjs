import test from "node:test";
import assert from "node:assert/strict";
import { calculateFixedDesignBackground, calculateFixedDesignViewport, designPointToCss, cssPointToDesign } from "./fixed-design-viewport.mjs";

test("竖屏按 1080 宽度适配并展开可见高度", () => {
  const viewport = calculateFixedDesignViewport({ width: 390, height: 844 });
  assert.equal(viewport.orientation, "portrait");
  assert.equal(viewport.designWidth, 1080);
  assert.equal(viewport.designHeight, 1920);
  assert.equal(viewport.scale, 390 / 1080);
  assert.equal(viewport.visibleWidth, 1080);
  near(viewport.visibleHeight * viewport.scale, 844);
});

test("横屏按 1080 高度适配并裁切可见宽度", () => {
  const viewport = calculateFixedDesignViewport({ width: 1366, height: 1024 });
  assert.equal(viewport.orientation, "landscape");
  assert.equal(viewport.designWidth, 1920);
  assert.equal(viewport.designHeight, 1080);
  assert.equal(viewport.scale, 1024 / 1080);
  assert.equal(viewport.visibleHeight, 1080);
  near(viewport.visibleWidth * viewport.scale, 1366);
});

test("两种方向的背景经设计坐标偏移后仍覆盖 CSS 视口", () => {
  for (const dimensions of [{ width: 320, height: 480 }, { width: 1366, height: 1024 }, { width: 2560, height: 1080 }, { width: 1080, height: 2400 }]) {
    const viewport = calculateFixedDesignViewport(dimensions);
    const background = calculateFixedDesignBackground({
      sourceWidth: viewport.designWidth,
      sourceHeight: viewport.designHeight,
      viewport,
    });
    const cssX = (background.x + viewport.offsetX) * viewport.scale;
    const cssY = (background.y + viewport.offsetY) * viewport.scale;
    assert(cssX <= 1e-9 && cssY <= 1e-9);
    assert(cssX + background.displayWidth * viewport.scale >= dimensions.width - 1e-9);
    assert(cssY + background.displayHeight * viewport.scale >= dimensions.height - 1e-9);
  }
});

/** 浮点坐标转换按容差验证，避免二进制舍入造成误报。 */
function near(actual, expected) { assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test("基准、超宽横屏和长竖屏满足指定几何", () => {
  for (const [width, height, visibleWidth, visibleHeight, offsetX, offsetY] of [
    [1920, 1080, 1920, 1080, 0, 0], [2560, 1080, 2560, 1080, 320, 0],
    [1080, 1920, 1080, 1920, 0, 0], [1080, 2400, 1080, 2400, 0, 240],
  ]) {
    const viewport = calculateFixedDesignViewport({ width, height });
    assert.equal(viewport.scale, 1);
    assert.deepEqual([viewport.visibleWidth, viewport.visibleHeight, viewport.offsetX, viewport.offsetY], [visibleWidth, visibleHeight, offsetX, offsetY]);
    assert.equal(viewport.fitAxis, width < height ? "width" : "height");
  }
});

test("同方向窄视口、输入往返、DPR 隔离和重复重排", () => {
  for (const dimensions of [{ width: 1440, height: 1080 }, { width: 900, height: 1920 }]) {
    const viewport = calculateFixedDesignViewport(dimensions);
    assert.equal(viewport.scale, dimensions.width < dimensions.height ? dimensions.width / 1080 : dimensions.height / 1080);
    assert(viewport.offsetX < 0 || viewport.offsetY > 0);
    for (const point of [{ x: 0, y: 0 }, { x: 540, y: 960 }, { x: -80, y: 2200 }]) {
      const roundtrip = cssPointToDesign(designPointToCss(point, viewport), viewport);
      near(roundtrip.x, point.x); near(roundtrip.y, point.y);
    }
    for (const dpr of [1, 1.5, 2, 3]) assert.deepEqual(calculateFixedDesignViewport({ ...dimensions, dpr }), viewport);
    for (let index = 0; index < 10; index++) assert.deepEqual(calculateFixedDesignViewport(dimensions), viewport);
  }
});

test("非法 CSS 视口尺寸失败", () => {
  assert.throws(() => calculateFixedDesignViewport({ width: 0, height: 844 }), /正有限数/);
  assert.throws(() => calculateFixedDesignViewport({ width: Infinity, height: 844 }), /正有限数/);
});
