import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodePngRgba, encodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { removeBackgroundLocal } from "../../cocos-game-asset-integration/scripts/remove-background-local.mjs";
import { normalizeImageToContract } from "./visual-image-normalization.mjs";
import { buildSolidBackgroundPrompt, normalizeSourceBackgroundColor, validateTransparentBackgroundContract } from "./visual-transparent-background-contract.mjs";
import { validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";

test("公共去背记录可直接接入透明合同和 Sharp 归一化", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocos-background-pipeline-"));
  try {
    const rawFile = join(root, "raw.png");
    const sourceFile = join(root, "transparent.png");
    const runtimeFile = join(root, "runtime.png");
    const sourceBackgroundColor = "#00aa55";
    const sourceBackgroundColorRecord = normalizeSourceBackgroundColor(sourceBackgroundColor);
    const pixels = Buffer.alloc(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) pixels.set([0, 170, 85, 255], index * 4);
    pixels.set([240, 20, 20, 255], 5 * 4);
    await writeFile(rawFile, encodePngRgba(4, 4, pixels));
    const removal = await removeBackgroundLocal({ sourceFile: rawFile, outputFile: sourceFile, backgroundColor: sourceBackgroundColor, tolerance: 0, requireSolidBackground: true, edgeProfile: "hard-edge", colorSeparationVerified: true });
    assert.equal(removal.status, "PASS");
    assert.equal(removal.background_removal_attempt.evidence.solid_background_check.status, "passed");
    assert.equal(removal.background_removal_attempt.evidence.solid_background_check.background_color, sourceBackgroundColor);
    assert.equal(removal.background_removal_attempt.evidence.solid_background_check.matched_boundary_pixels, removal.background_removal_attempt.evidence.solid_background_check.boundary_pixels);
    const normalization = await normalizeImageToContract({ sourceFile, outputFile: runtimeFile, targetWidth: 4, targetHeight: 4, requireAlpha: true, candidateSha256: `sha256:${"c".repeat(64)}` });
    const expectedAsset = { source_file: sourceFile, runtime_file: runtimeFile, width: 4, height: 4, mime_type: "image/png", alpha: true, transparency_requirements: { strategy: "background-removal", edge_profile: "hard-edge" } };
    const contract = { production_method: "image-generation", image_generation_required: true };
    // 原始 RGBA 可完全不透明但仍有 Alpha 通道；生产合同必须保留实际通道事实。
    const generation = {
      parameters: { size: "4x4" }, postprocess: ["background-removal"],
      edge_profile: "hard-edge", edge_evidence: "固定纯色背景与红色硬边主体明确区分", color_separation_verified: true, raw_source_sha256: removal.source_sha256, source_sha256: removal.output_sha256, transparency_preview: normalization.transparency_preview, source_background_mode: "opaque", final_background_mode: "transparent", transparency_strategy: "background-removal",
      source_background_color: sourceBackgroundColorRecord,
      raw_source_file: rawFile, raw_source_has_alpha: removal.source_has_alpha,
      source_file: sourceFile, source_has_alpha: true, full_prompt: `生成独立角色。\n${buildSolidBackgroundPrompt(sourceBackgroundColor)}`,
      background_removal_attempts: [removal.background_removal_attempt], normalization_record: normalization,
    };
    const metadata = { file: runtimeFile, mime_type: "image/png", alpha: true, width: 4, height: 4, sha256: normalization.output_sha256 };
    assert.deepEqual(validateTransparentBackgroundContract({ generation, contract, expectedAsset, metadata }), []);
    assert.deepEqual(validateImageNormalizationContract({ generation, contract, expectedAsset, metadata }), []);
    const output = decodePngRgba(await readFile(runtimeFile));
    assert.equal(output.pixels[3], 0);
    assert.equal(output.pixels[5 * 4 + 3], 255);
    assert.equal(normalization.source_sha256, removal.output_sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
