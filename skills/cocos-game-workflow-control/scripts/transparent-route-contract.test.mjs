import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { validateTransparencyRoute, validateTransparencyPreview } from "./transparent-route-contract.mjs";
import { prepareTransparencyFixture } from "./transparent-route-test-fixtures.mjs";
import { auditProductionContract, validateVisualProductionCoverage } from "./visual-production-contract.mjs";

/** 固定像素只证明机器门，不把合成样例当作已完成美术验收。 */
async function fixture(edge = "glow", alphas = [0, 80, 200, 255]) {
  const root = await mkdtemp(join(tmpdir(), "alpha-route-"));
  // 全不透明负例使用实际灰白棋盘像素，避免把测试名称当作图片事实。
  const pixels = Buffer.from(alphas.flatMap((alpha, index) => alphas.every((value) => value === 255)
    ? [0, 0, 0].map(() => (index % 2) !== Math.floor(index / 2) ? 240 : 180).concat(alpha)
    : [index % 2 ? 240 : 180, 100, 80, alpha]));
  const bytes = encodePngRgba(2, 2, pixels);
  const sha = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  await writeFile(join(root, "asset.png"), bytes);
  const expected = { alpha: true, runtime_file: "asset.png" };
  const generation = { generator: "fixture", generator_version: "1", source_file: "asset.png", normalization_record: { source_sha256: sha, output_sha256: sha }, candidate_sha256: `sha256:${"c".repeat(64)}` };
  prepareTransparencyFixture(generation, expected, { strategy: "direct-alpha", edgeProfile: edge });
  generation.source_sha256 = sha; generation.raw_source_sha256 = sha;
  generation.transparency_preview.inspection = { status: "pending" };
  generation.transparency_preview.source_sha256 = sha;
  for (const [mode, color] of [["light", "#F2E9DF"], ["dark", "#16202E"]]) {
    const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
    const composed = Buffer.from(pixels);
    for (let index = 0; index < composed.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      for (let channel = 0; channel < 3; channel++) composed[index + channel] = Math.round(pixels[index + channel] * alpha + rgb[channel] * (1 - alpha));
      composed[index + 3] = 255;
    }
    const preview = encodePngRgba(2, 2, composed);
    await writeFile(join(root, `${mode}.png`), preview);
    generation.transparency_preview[mode] = { file: `${mode}.png`, sha256: `sha256:${createHash("sha256").update(preview).digest("hex")}`, background_color: color };
  }
  return { root, generation, expected, options: { checkFiles: true, projectRoot: root, stage: "V3" } };
}

for (const edge of ["hard-edge", "semi-transparent", "glow"]) {
  test(`${edge} 真实 Alpha 和同候选深浅底可进入生产但等待视觉验收`, async () => {
    const item = await fixture(edge);
    try {
      assert.deepEqual(validateTransparencyRoute(item.generation, item.expected, item.options), []);
      assert.deepEqual(validateTransparencyPreview(item.generation, item.expected, item.options), []);
      assert(validateTransparencyPreview(item.generation, item.expected, { ...item.options, stage: "V4" }).some((error) => error.includes("视觉验收")));
    } finally { await rm(item.root, { recursive: true, force: true }); }
  });
}

test("不透明或烘焙棋盘格即使有 Alpha 通道也拒绝直接透明", async () => {
  const item = await fixture("hard-edge", [255, 255, 255, 255]);
  try { assert(validateTransparencyRoute(item.generation, item.expected, item.options).some((error) => error.includes("真实透明像素"))); }
  finally { await rm(item.root, { recursive: true, force: true }); }
});

test("辉光硬抠、能力缺口和冻结路线替换仍拒绝，预览摘要差异不阻断", async () => {
  const item = await fixture("glow", [0, 255, 255, 255]);
  try {
    assert(validateTransparencyRoute(item.generation, item.expected, item.options).some((error) => error.includes("半透明像素")));
    item.generation.capability.verified_edge_profiles = ["hard-edge"];
    assert(validateTransparencyRoute(item.generation, item.expected).some((error) => error.includes("能力缺口")));
    item.generation.transparency_strategy = "background-removal";
    assert(validateTransparencyRoute(item.generation, item.expected).some((error) => error.includes("hard-edge")));
    assert(validateTransparencyRoute(item.generation, item.expected).some((error) => error.includes("变更流程")));
    item.generation.transparency_preview.candidate_sha256 = `sha256:${"d".repeat(64)}`;
    assert.equal(validateTransparencyPreview(item.generation, item.expected).some((error) => /SHA|candidate|候选身份/i.test(error)), false);
    item.generation.transparency_preview.light.file = "dark.png";
    item.generation.transparency_preview.light.sha256 = item.generation.transparency_preview.dark.sha256;
    assert(validateTransparencyPreview(item.generation, item.expected, item.options).some((error) => error.includes("真实深浅底合成")));
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("生产 coverage 入口必须执行预览文件门与外部裁切边界门", async () => {
  const item = await fixture();
  try {
    const expected = { ...item.expected, asset_id: "glow", component_id: "glow", state_id: "default", source_file: "asset.png", width: 2, height: 2, mime_type: "image/png" };
    const contract = { owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "image-generation", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "forbid", expected_assets: [expected] };
    const asset = { ...contract, id: "glow", generation_record: item.generation, source_file: "asset.png", runtime_file: "asset.png", runtime_outputs: ["asset.png"], mime_type: "image/png", alpha: true, width: 2, height: 2, sha256: item.generation.source_sha256 };
    const manifest = { assets: [asset], coverage_audit: { regions: [{ ...contract, id: "r-glow", asset_ids: ["glow"] }] } };
    const options = { ...item.options, requireManualConfirmation: false };
    // 其他完整生产字段在专属测试验证；此处只确认真实文件门经过主调用链。
    assert(!validateVisualProductionCoverage(manifest, options).some((error) => error.includes("light 预览")));
    item.generation.transparency_preview.light.file = "missing.png";
    assert(validateVisualProductionCoverage(manifest, options).some((error) => error.includes("light 预览 文件不存在")));
    manifest.production_contract_audit = { status: "passed", units: [{ ...contract, region_id: "r-glow", status: "passed", actual_assets: [] }] };
    assert((await auditProductionContract(manifest, options)).some((error) => error.includes("light 预览 文件不存在")));
    item.generation.normalization_record.aspect_ratio_correction = { crop_rect: { left: 1, top: 1, width: 1, height: 1 } };
    assert(validateVisualProductionCoverage(manifest, options).some((error) => error.includes("不得裁掉")));
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("独立遮罩必须读取真实原图文件并保留路径绑定", async () => {
  const item = await fixture();
  try {
    item.generation.transparency_strategy = "mask-composition"; item.expected.transparency_requirements.strategy = "mask-composition";
    delete item.generation.capability;
    item.generation.mask_record = { source_file: "asset.png", source_sha256: item.generation.source_sha256, mask_file: "asset.png", mask_sha256: item.generation.source_sha256, output_file: "asset.png", output_sha256: item.generation.source_sha256, tool: "fixture-mask", tool_version: "1", parameters: {}, evidence: "固定遮罩记录" };
    assert.deepEqual(validateTransparencyRoute(item.generation, item.expected, item.options), []);
    item.generation.raw_source_file = "missing-original.png"; item.generation.mask_record.source_file = "missing-original.png";
    assert(validateTransparencyRoute(item.generation, item.expected, item.options).some((error) => error.includes("遮罩原图不存在")));
  } finally { await rm(item.root, { recursive: true, force: true }); }
});
