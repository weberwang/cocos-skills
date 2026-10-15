import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateFullBleedCoverTransform } from "./full-bleed-background-adapter.mjs";

/** 校验结果保持等比、覆盖 viewport 且四边裁切量没有负数。 */
function assertCover(result, viewportWidth, viewportHeight, sourceWidth, sourceHeight) {
  assert.equal(result.displayWidth / sourceWidth, result.scale);
  assert.equal(result.displayHeight / sourceHeight, result.scale);
  assert(result.displayWidth >= viewportWidth);
  assert(result.displayHeight >= viewportHeight);
  assert(result.crop.left >= 0);
  assert(result.crop.top >= 0);
  assert(result.crop.right >= 0);
  assert(result.crop.bottom >= 0);
  assert(result.x <= 0 && result.x + result.displayWidth >= viewportWidth);
  assert(result.y <= 0 && result.y + result.displayHeight >= viewportHeight);
}

test("横图进入竖屏时按 cover 铺满并裁切左右", () => {
  const result = calculateFullBleedCoverTransform({
    sourceWidth: 1920,
    sourceHeight: 1080,
    viewportWidth: 390,
    viewportHeight: 844,
  });

  const scale = 844 / 1080;
  const displayWidth = 1920 * scale;
  const horizontalCrop = (displayWidth - 390) / 2;
  assert.equal(result.scale, scale);
  assert.equal(result.displayWidth, displayWidth);
  assert.equal(result.displayHeight, 844);
  assert.equal(result.x, -horizontalCrop);
  assert.equal(result.y, 0);
  assert.deepEqual(result.crop, { left: horizontalCrop, top: 0, right: horizontalCrop, bottom: 0 });
  assertCover(result, 390, 844, 1920, 1080);
});

test("竖图进入横屏时按 cover 铺满并裁切上下", () => {
  const result = calculateFullBleedCoverTransform({
    sourceWidth: 1080,
    sourceHeight: 1920,
    viewportWidth: 844,
    viewportHeight: 390,
  });

  const scale = 844 / 1080;
  const displayHeight = 1920 * scale;
  const verticalCrop = (displayHeight - 390) / 2;
  assert.equal(result.scale, scale);
  assert.equal(result.displayWidth, 844);
  assert.equal(result.displayHeight, displayHeight);
  assert.equal(result.x, 0);
  assert.equal(result.y, -verticalCrop);
  assert.deepEqual(result.crop, { left: 0, top: verticalCrop, right: 0, bottom: verticalCrop });
  assertCover(result, 844, 390, 1080, 1920);
});

test("源图与 viewport 同宽高比时不产生裁切", () => {
  const result = calculateFullBleedCoverTransform({
    sourceWidth: 1600,
    sourceHeight: 900,
    viewportWidth: 320,
    viewportHeight: 180,
  });

  assert.deepEqual(result, {
    x: 0,
    y: 0,
    scale: 0.2,
    displayWidth: 320,
    displayHeight: 180,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  });
});

test("非中心焦点落点会改变位置，超出裁切空间时 clamp 且仍无空隙", () => {
  const result = calculateFullBleedCoverTransform({
    sourceWidth: 200,
    sourceHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    sourceFocus: { x: 0, y: 0 },
    targetPoint: { x: 1, y: 1 },
  });

  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
  assert.deepEqual(result.crop, { left: 0, top: 0, right: 100, bottom: 0 });
  assertCover(result, 100, 100, 200, 100);

  const opposite = calculateFullBleedCoverTransform({
    sourceWidth: 200,
    sourceHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    sourceFocus: { x: 1, y: 0 },
    targetPoint: { x: 0, y: 1 },
  });
  assert.equal(opposite.x, -100);
  assert.equal(opposite.y, 0);
  assertCover(opposite, 100, 100, 200, 100);
});

test("默认焦点和落点为中心", () => {
  const implicit = calculateFullBleedCoverTransform({
    sourceWidth: 400,
    sourceHeight: 200,
    viewportWidth: 100,
    viewportHeight: 100,
  });
  const explicit = calculateFullBleedCoverTransform({
    sourceWidth: 400,
    sourceHeight: 200,
    viewportWidth: 100,
    viewportHeight: 100,
    sourceFocus: { x: 0.5, y: 0.5 },
    targetPoint: { x: 0.5, y: 0.5 },
  });
  assert.deepEqual(implicit, explicit);
});

test("非法尺寸和归一化坐标会被拒绝", () => {
  const valid = { sourceWidth: 100, sourceHeight: 100, viewportWidth: 50, viewportHeight: 50 };
  for (const [field, value] of [
    ["sourceWidth", 0],
    ["sourceHeight", -1],
    ["viewportWidth", Number.NaN],
    ["viewportHeight", Number.POSITIVE_INFINITY],
  ]) {
    assert.throws(() => calculateFullBleedCoverTransform({ ...valid, [field]: value }), /必须是正有限数/);
  }
  assert.throws(() => calculateFullBleedCoverTransform({ ...valid, sourceFocus: { x: -0.01, y: 0.5 } }), /sourceFocus\.x/);
  assert.throws(() => calculateFullBleedCoverTransform({ ...valid, sourceFocus: { x: 0.5, y: 1.01 } }), /sourceFocus\.y/);
  assert.throws(() => calculateFullBleedCoverTransform({ ...valid, targetPoint: { x: Number.NaN, y: 0.5 } }), /targetPoint\.x/);
  assert.throws(() => calculateFullBleedCoverTransform({ ...valid, targetPoint: null }), /targetPoint 必须是包含 x\/y 的对象/);
});
