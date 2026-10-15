import assert from "node:assert/strict";
import test from "node:test";
import { deriveVisibleAnnotationRows, decodePngRgba, encodePngRgba, renderRasterAnnotation } from "./effect_image_raster.mjs";

/** 阶段 A 的人工材料包含可扫描的正反决策；此测试只验证结构与编码，不检查图片显示。 */
test("九宫格适用、小图尺寸、四边值及不适用原因写入拆解图旁栏", () => {
  const regions = [{ id: "panel", annotation_number: 2, bounds: { x: 0, y: 0, width: 32, height: 24 }, implementation_plan: { mode: "generate-now", summary: "底板" } }];
  const metadata = { regions: [{ region_id: "panel", decomposition_elements: [
    { element_id: "skin", nine_slice: { mode: "stretch", reason: "角边固定", source_size: { width: 96, height: 64 }, borders: { left: 12, right: 12, top: 10, bottom: 10 } } },
    { element_id: "logo", nine_slice: { mode: "not-applicable", reason: "图案保持完整" } },
  ] }] };
  const rows = deriveVisibleAnnotationRows(regions, metadata);
  const textFor = (id) => rows.filter((row) => row.element_id === id).map((row) => row.text).join("");
  assert.match(textFor("skin"), /96×64/);
  assert.match(textFor("skin"), /左12 右12 上10 下10/);
  assert.match(textFor("logo"), /九宫格不适用；图案保持完整/);
  const source = encodePngRgba(32, 24, Buffer.alloc(32 * 24 * 4));
  const encoded = renderRasterAnnotation(source, { width: 32, height: 24 }, regions, metadata, { "generate-now": "#ef4444" }, { "generate-now": "新建图片资产" });
  const decoded = decodePngRgba(encoded);
  assert.deepEqual(decoded.metadata.visible_rows.map((row) => row.text), rows.map((row) => row.text));
  assert(decoded.metadata.visible_rows.every((row) => row.top >= 0 && row.bottom <= decoded.height));
});
