/** 为 visual manifest 文件门构造可解码的真实 Alpha 夹具，不代表真实生成器实测。 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { prepareTransparencyFixture } from "../../cocos-game-workflow-control/scripts/transparent-route-test-fixtures.mjs";
import { encodePngRgba } from "./effect_image_raster.mjs";
import { writeTransparencyPreviews } from "./transparent-raster.mjs";

/** 生成透明背景、实色主体和硬边 Alpha 的确定性 PNG 样例。 */
function hardEdgeSamplePng(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 12; y < height - 12; y += 1) for (let x = 18; x < width - 18; x += 1) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 224; pixels[offset + 1] = 92; pixels[offset + 2] = 56; pixels[offset + 3] = 255;
  }
  return encodePngRgba(width, height, pixels);
}

/** 按真实透明输出更新所有清单镜像、SHA、归一化与固定能力记录。 */
export function configureManifestTransparentFixture(manifest) {
  const asset = manifest.assets[0]; const region = manifest.coverage_audit.regions.find((item) => item.id === "region-hero");
  const record = asset.generation_record; const png = hardEdgeSamplePng(asset.width, asset.height);
  const digest = `sha256:${createHash("sha256").update(png).digest("hex")}`;
  const requirements = { strategy: "direct-alpha", edge_profile: "hard-edge" };
  const mirrors = [region, asset, manifest.production_contract_audit.units.find((unit) => unit.region_id === region.id), manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === region.id)];
  for (const mirror of mirrors) for (const expected of mirror?.expected_assets ?? []) expected.transparency_requirements = { ...requirements };
  asset.sha256 = digest; record.raw_source_file = asset.source_file; record.source_file = asset.source_file; record.runtime_file = asset.output_file;
  record.raw_source_sha256 = digest; record.source_sha256 = digest; record.raw_source_has_alpha = true; record.source_has_alpha = true;
  record.normalization_record = asset.normalization_record; Object.assign(record.normalization_record, { source_file: asset.source_file, source_sha256: digest, output_file: asset.output_file, output_sha256: digest, preserve_alpha: true });
  asset.normalization_record = record.normalization_record; record.command_or_recipe = "fixture: preserve a verified true-alpha PNG through normalization"; record.postprocess = [];
  for (const expected of [...region.expected_assets, ...asset.expected_assets, ...manifest.production_contract_audit.units.find((unit) => unit.region_id === region.id).expected_assets]) { expected.sha256 = digest; expected.alpha = true; expected.transparency_requirements = { ...requirements }; }
  for (const actual of manifest.production_contract_audit.units.find((unit) => unit.region_id === region.id).actual_assets) actual.sha256 = digest;
  record.output_sha256 = digest; record.transparency_strategy = requirements.strategy; record.edge_profile = requirements.edge_profile; record.edge_evidence = "固定 PNG 样例具有透明背景、可见主体和硬边 Alpha";
  prepareTransparencyFixture(record, { alpha: true, runtime_file: asset.output_file }, requirements);
  for (const mirror of [asset.runtime_consumption, manifest.production_contract_audit.units.find((unit) => unit.region_id === region.id).runtime_consumption]) {
    for (const usage of mirror?.component_usages ?? []) usage.runtime_sha256 = digest;
  }
  return png;
}

/** 写入同一候选的直接 Alpha 输出及深浅底合成预览，并回填真实路径与 SHA。 */
export async function writeManifestTransparentFixtures(root, manifest) {
  const asset = manifest.assets[0]; const record = asset.generation_record; const bytes = hardEdgeSamplePng(asset.width, asset.height);
  for (const file of new Set([record.raw_source_file, record.source_file, asset.output_file])) {
    const path = resolve(root, file); await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, bytes);
  }
  const preview = await writeTransparencyPreviews({ sourceFile: resolve(root, asset.output_file), previewDirectory: resolve(root, "evidence/transparent"), candidateSha256: manifest.candidate_identity.sha256 });
  const projectPath = (file) => relative(root, file).replaceAll("\\", "/");
  record.transparency_preview = {
    candidate_sha256: preview.candidate_sha256,
    source_file: asset.output_file,
    source_sha256: preview.source_sha256,
    light: { ...preview.light, file: projectPath(preview.light.file) },
    dark: { ...preview.dark, file: projectPath(preview.dark.file) },
    inspection: { status: "passed", evidence: "本地固定硬边 Alpha 预览夹具；不代表实际美术视觉验收", checks: { subject_integrity: "passed", background_residue: "passed", color_fringe: "passed", semi_transparency: "not-applicable" } },
  };
}
