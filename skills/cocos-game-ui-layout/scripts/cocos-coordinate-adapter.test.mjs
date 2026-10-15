import assert from "node:assert/strict";
import test from "node:test";
import { layoutPointToNodeLocal, nodeLocalToLayoutPoint, coverTransformToCocos } from "./cocos-coordinate-adapter.mjs";
import { calculateFullBleedCoverTransform } from "../../cocos-game-asset-integration/scripts/full-bleed-background-adapter.mjs";

test("左上布局坐标明确转换为 Creator 居中且 Y 向上的父空间", () => {
  const parent = { width: 1080, height: 1920 };
  assert.deepEqual(layoutPointToNodeLocal({ x: 0, y: 0 }, parent), { x: -540, y: 960 });
  assert.deepEqual(layoutPointToNodeLocal({ x: 1080, y: 1920 }, parent), { x: 540, y: -960 });
  const custom = { width: 400, height: 200, anchorX: 0.25, anchorY: 0.75 };
  const point = { x: -20, y: 300 };
  assert.deepEqual(nodeLocalToLayoutPoint(layoutPointToNodeLocal(point, custom), custom), point);
});

test("满幅背景的不同锚点转换后仍覆盖父矩形", () => {
  const parent = { width: 390, height: 844 };
  const cover = calculateFullBleedCoverTransform({ sourceWidth: 1920, sourceHeight: 1080, viewportWidth: parent.width, viewportHeight: parent.height });
  for (const anchor of [{ x: 0.5, y: 0.5 }, { x: 0, y: 1 }, { x: 0.2, y: 0.8 }]) {
    const position = coverTransformToCocos(cover, parent, anchor);
    const left = position.x - cover.displayWidth * anchor.x;
    const top = position.y + cover.displayHeight * (1 - anchor.y);
    assert(left <= -parent.width / 2 + 1e-8);
    assert(left + cover.displayWidth >= parent.width / 2 - 1e-8);
    assert(top >= parent.height / 2 - 1e-8);
    assert(top - cover.displayHeight <= -parent.height / 2 + 1e-8);
  }
});

test("无效坐标与尺寸拒绝进入节点设置", () => {
  assert.throws(() => layoutPointToNodeLocal({ x: NaN, y: 0 }, { width: 10, height: 10 }), /坐标/);
  assert.throws(() => nodeLocalToLayoutPoint({ x: 0, y: 0 }, { width: 0, height: 10 }), /尺寸/);
  assert.throws(() => coverTransformToCocos({ x: 0, y: 0, displayWidth: 0, displayHeight: 1, scale: 1 }, { width: 1, height: 1 }), /cover/);
});
