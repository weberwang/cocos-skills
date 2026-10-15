import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { main as generateAnnotation } from "./generate_effect_image_annotation.mjs";
import { computeRegionDefinitionSha256, renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { annotationProductionContract, asciiGlyph, decodePngRgba, effectImageFontGlyph, encodePngRgba } from "./effect_image_raster.mjs";
import { EFFECT_IMAGE_FONT_PROVENANCE } from "./effect_image_font.mjs";
import { validateAnnotatedPng } from "./validate_visual_manifest.mjs";
import { deriveAtomicImageRequirements } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";

/** 计算测试证据的标准 SHA-256 字符串。 */
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

test("cocos-graphics 使用程序绘制标签而不是图片资产标签", () => {
  const production = annotationProductionContract({ production_method: "cocos-graphics", delivery_kind: "runtime-drawing", implementation_plan: { mode: "runtime-program" } });
  assert.equal(production.label, "程序绘制或动态逻辑");
});

/** 计算测试 PNG chunk 的 CRC-32，保证坏图反例与合法图均不依赖外部库。 */
function pngCrc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }

/** 返回无需外部依赖即可解码的最小合法 RGBA PNG。 */
function minimalPng(width = 1, height = 1) { const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body)); return Buffer.concat([length, body, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; const raw = Buffer.alloc(height * (width * 4 + 1)); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/** 构造供标注脚本使用的最小冻结效果图清单。 */
function addAtomicVisualContract(region, assetId) {
  const states = [{ state_id: "default", requirement: "required", reason: "普通可见状态" }, ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前区域不适用该状态" }))];
  const componentId = `${region.id}-component`;
  const atomicKey = `${region.id}-visual`;
  region.state_analysis = { status: "complete", phase: "before-component-splitting", evidence: `evidence/${region.id}-state.md`, evidence_sha256: `sha256:${"a".repeat(64)}`, reference_target_sha256: `sha256:${"a".repeat(64)}`, analysis_id: `${region.id}-analysis`, completed_at: "2026-08-15T00:00:00Z", states };
  const layoutNodeId = region.layout_node_ids?.[0] ?? `${region.id}-layout-node`;
  region.layout_node_ids ??= [layoutNodeId];
  region.decomposition_elements = [{ element_id: layoutNodeId, element_type: "component", role: "visual-component", bounds: { ...region.bounds }, scene_id: region.scene_id, state_id: region.state_id, region_id: region.id, component_id: componentId, placement_id: `${region.id}-placement`, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整视觉组件在当前区域独立布局" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" }, owner_type: region.owner_type, region_layer: region.layer, empty_container: false }];
  region.component_inventory = { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [{ component_id: componentId, atomic_visual_key: atomicKey, role: "visual-component", reusable: true, state_coverage: states, placements: [{ placement_id: `${region.id}-placement`, layout_node_id: layoutNodeId, bounds: { ...region.bounds }, interaction_required: false }] }] };
  region.expected_assets = [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: atomicKey, component_id: componentId, state_id: "default", source_file: `art/${assetId}.png`, runtime_file: `public/${assetId}.png` }];
  region.interaction_hotspots = [];
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  return region;
}

/** 创建带编号与区域身份的最小标注清单，供几何及证据测试复用。 */
function annotationManifest(targetSha) {
  const manifest = {
    schema_version: "1.5",
    workItemId: "work-item-1",
    candidateVersion: "candidate-1",
    visualStage: "V3",
    visualStageState: "v2-production-planning-complete",
    effect_image_reconstruction: { applicability: "effect-image", lifecycle: "v2-ready" },
    reference_target: { candidate_id: "candidate-1", original_file: "reference.png", target_sha256: targetSha, frozen_at: "2026-08-15T00:00:00Z", status: "reference-target-frozen", scene_ids: ["main"], state_ids: ["default"] },
    coverage_audit: {
      canvases: [{ scene_id: "main", state_id: "default", width: 32, height: 24 }],
      regions: [
        { id: "runtime-background", scene_id: "main", state_id: "default", layout_node_ids: ["runtime-background"], decomposition_elements: [{ element_id: "runtime-background", element_type: "component", role: "background", bounds: { x: 0, y: 0, width: 32, height: 24 }, scene_id: "main", state_id: "default", region_id: "runtime-background", component_id: "runtime-background", placement_id: "runtime-background-placement", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整背景由运行时独立绘制无需功能容器" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "STRETCH", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "FULL_BLEED", interaction_policy: "NONE" }, owner_type: "runtime-rendered", region_layer: "background", empty_container: false }], layer: "background", bounds: { x: 0, y: 0, width: 32, height: 24 }, owner_type: "runtime-rendered", owner_id: "background", ownership_evidence: "evidence/background-review.md", annotation_number: 1, implementation_plan: { mode: "runtime-program", summary: "运行时绘制背景" }, runtime_implementation: { kind: "runtime-program", integration_files: ["src/runtime-background.mjs"], layout_node_ids: ["runtime-background"] } },
        { id: "hero", scene_id: "main", state_id: "default", layout_node_ids: ["layout-hero"], layer: "actors", bounds: { x: 4, y: 4, width: 8, height: 8 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["hero"], asset_id: "hero", owner_id: "art", ownership_evidence: "evidence/hero-review.md", annotation_number: 2, implementation_plan: { mode: "generate-now", summary: "本次生成主角" } },
        { id: "badge", scene_id: "main", state_id: "default", layout_node_ids: ["layout-badge"], layer: "hud", bounds: { x: 20, y: 2, width: 8, height: 6 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "reuse", delivery_kind: "existing-asset", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["badge"], asset_id: "badge", owner_id: "art", ownership_evidence: "evidence/badge-review.md", annotation_number: 3, reuse_snapshot: { schema: "asset-reuse-snapshot/1.0", source_asset_id: "badge", source_manifest_file: "docs/reuse-snapshot.json", source_manifest_sha256: targetSha, source_file: "badge.png", source_sha256: targetSha, compatibility_evidence_file: "evidence/badge-consistency.json", compatibility_evidence_sha256: targetSha, accepted_at: "2026-08-15T00:00:00Z", source_status: "accepted" }, implementation_plan: { mode: "reuse-existing", summary: "复用既有资源" } },
      ],
    },
  };
  addAtomicVisualContract(manifest.coverage_audit.regions[1], "hero");
  addAtomicVisualContract(manifest.coverage_audit.regions[2], "badge");
  return manifest;
}

/** 为“复用”标注夹具写入可复算的 accepted asset-reuse-snapshot 证据。 */
async function addReuseEvidence(root, manifest) {
  const region = manifest.coverage_audit.regions.find((item) => item.id === "badge");
  const sourceBytes = minimalPng(8, 6); const compatibilityBytes = Buffer.from(JSON.stringify({ status: "passed" }));
  const sourceSha = sha256(sourceBytes); const sourceManifest = { status: "accepted", source_file: "badge.png", source_sha256: sourceSha }; const snapshotBytes = Buffer.from(JSON.stringify(sourceManifest));
  const snapshot = { schema: "asset-reuse-snapshot/1.0", source_asset_id: "badge", source_manifest_file: "docs/reuse-snapshot.json", source_manifest_sha256: sha256(snapshotBytes), source_file: "badge.png", source_sha256: sourceSha, compatibility_evidence_file: "evidence/badge-consistency.json", compatibility_evidence_sha256: sha256(compatibilityBytes), accepted_at: "2026-08-15T00:00:00Z", source_status: "accepted" };
  region.reuse_snapshot = snapshot;
  for (const [path, bytes] of [["docs/reuse-snapshot.json", snapshotBytes], ["badge.png", sourceBytes], ["public/badge.png", sourceBytes], ["evidence/badge-consistency.json", compatibilityBytes], ["docs/license.md", Buffer.from("license")]]) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
}

test("生成独立效果图标注 PNG、右栏说明和绑定提案", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-"));
  const original = minimalPng(32, 24); const targetSha = sha256(original); const manifest = annotationManifest(targetSha);
  const panelNineSlice = { mode: "stretch", reason: "小型面板源图的四角需要保留原像素尺寸", source_size: { width: 8, height: 8 }, borders: { left: 1, right: 1, top: 1, bottom: 1 } };
  const heroRegion = manifest.coverage_audit.regions[1];
  heroRegion.decomposition_elements[0].nine_slice = structuredClone(panelNineSlice);
  heroRegion.component_inventory.components[0].nine_slice = structuredClone(panelNineSlice);
  heroRegion.component_inventory.components[0].placements[0].nine_slice = structuredClone(panelNineSlice);
  heroRegion.expected_assets[0].nine_slice = structuredClone(panelNineSlice);
  const manifestPath = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await addReuseEvidence(root, manifest); await writeFile(manifestPath, JSON.stringify(manifest));
  const code = await generateAnnotation([manifestPath, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "evidence/annotation.png", "--proposal", "evidence/annotation-proposal.json", "--proposal-id", "proposal-1"]);
  assert.equal(code, 0);
  const pngBytes = await readFile(join(root, "evidence/annotation.png")); const decoded = decodePngRgba(pngBytes);
  assert.equal(decoded.metadata.schema, "effect-image-annotation/png/1"); assert.equal(decoded.metadata.layout, "image-plus-right-panel"); assert(decoded.width > 32); assert(decoded.height >= 24); assert.equal(decoded.metadata.visible_row_count, decoded.metadata.visible_rows.length);
  const summaryRows = decoded.metadata.visible_rows.filter((row) => row.kind === "summary"); const labelRows = decoded.metadata.visible_rows.filter((row) => row.kind === "label"); const technicalRowKinds = new Set(["production", "region", "mode", "component", "placement", "requirement"]); assert.deepEqual(summaryRows.map((row) => row.text.split(" ", 1)[0]), ["1", "2", "3"]); assert(summaryRows.some((row) => row.text.startsWith("2 本次生成主角"))); assert(summaryRows.some((row) => row.text.includes("运行时绘制背景"))); assert.equal(labelRows.find((row) => row.annotation_number === 1).label, "程序绘制或动态逻辑"); assert.equal(labelRows.find((row) => row.annotation_number === 2).label, "新建图片资产"); assert.equal(labelRows.find((row) => row.annotation_number === 3).label, "复用现有图片"); assert.equal(decoded.metadata.visible_rows.some((row) => technicalRowKinds.has(row.kind)), false); assert(decoded.metadata.visible_rows.every((row) => !/[A-Z_]{3,}/.test(row.text)));
  const nineSliceRows = decoded.metadata.visible_rows.filter((row) => row.kind === "nine-slice"); assert(nineSliceRows.length > 0); assert(nineSliceRows.every((row) => row.region_id === "hero")); assert.match(nineSliceRows.map((row) => row.text).join(""), /九宫格 源图8×8 边宽 左1 右1 上1 下1/);
  const heroSummary = summaryRows.find((row) => row.annotation_number === 2); const heroPixels = []; for (let y = heroSummary.top; y <= heroSummary.bottom; y += 1) for (let x = 40; x < decoded.width; x += 1) { const index = (y * decoded.width + x) * 4; if (decoded.pixels[index] < 230 || decoded.pixels[index + 1] < 230 || decoded.pixels[index + 2] < 230) heroPixels.push(index); } assert(heroPixels.length > 0, "中文摘要必须真实落入 PNG 像素");
  assert.deepEqual(decoded.metadata.plan_labels, { "generate-now": "新建图片资产", "reuse-existing": "复用现有图片", "runtime-program": "程序绘制或动态逻辑" }); assert.equal(decoded.metadata.regions.length, 3);
  const proposalBytes = await readFile(join(root, "evidence/annotation-proposal.json")); const proposal = JSON.parse(proposalBytes.toString("utf8"));
  const backgroundElement = proposal.decomposition_elements.find((element) => element.element_id === "runtime-background");
  assert.deepEqual(backgroundElement.ui_layout, { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "STRETCH", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "FULL_BLEED", interaction_policy: "NONE" });
  assert.deepEqual(proposal.decomposition_elements.find((element) => element.element_id === "layout-hero").nine_slice, panelNineSlice);
  assert.equal(proposal.numbered_image_mime, "image/png"); assert.equal(proposal.numbered_image_sha256, sha256(pngBytes)); assert.deepEqual(proposal.region_ids, ["runtime-background", "hero", "badge"]); assert.deepEqual(proposal.layout_node_ids, ["runtime-background", "layout-hero", "layout-badge"]); assert.deepEqual(proposal.decomposition_elements.map((element) => element.element_id), ["runtime-background", "layout-hero", "layout-badge"]); assert.equal(proposal.target_sha256, targetSha); assert.equal(proposal.proposal_kind, "effect-image-decomposition-technical-analysis"); assert.deepEqual(proposal.canvas, { scene_id: "main", state_id: "default", width: 32, height: 24 }); assert.equal(proposal.visual_regions.find((region) => region.region_id === "hero").summary, "本次生成主角"); assert.deepEqual(decoded.metadata.regions.find((region) => region.region_id === "hero").layout_node_ids, ["layout-hero"]); assert.deepEqual(decoded.metadata.regions.find((region) => region.region_id === "hero").placement_layout_node_ids, [{ placement_id: "hero-placement", layout_node_id: "layout-hero" }]);
  const technicalHero = proposal.technical_analysis.regions.find((region) => region.region_id === "hero"); assert.deepEqual(technicalHero.layout_node_ids, ["layout-hero"]); assert.equal(technicalHero.placements[0].layout_node_id, "layout-hero"); assert.deepEqual(technicalHero.bounds, manifest.coverage_audit.regions[1].bounds); assert.deepEqual(technicalHero.components[0].placements[0].bounds, manifest.coverage_audit.regions[1].component_inventory.components[0].placements[0].bounds); assert.equal(technicalHero.state_analysis.states.length, 9); assert.equal(technicalHero.production_contract.production_method, "authored-raster"); assert.equal(technicalHero.resource_mapping.asset_ids[0], "hero"); assert.equal(technicalHero.atomic_image_requirements[0].asset_id, "hero");
  assert.deepEqual(technicalHero.decomposition_elements[0].nine_slice, panelNineSlice);
  assert.deepEqual(technicalHero.component_inventory.components[0].nine_slice, panelNineSlice);
  assert.deepEqual(technicalHero.component_inventory.components[0].placements[0].nine_slice, panelNineSlice);
  assert.deepEqual(technicalHero.expected_assets[0].nine_slice, panelNineSlice);
  const validErrors = []; validateAnnotatedPng(pngBytes, original, manifest.coverage_audit.regions, proposal, "annotation", validErrors); assert.deepEqual(validErrors, []);
  const tampered = structuredClone(manifest); tampered.coverage_audit.regions[1].bounds.width += 1; const errors = [];
  validateAnnotatedPng(pngBytes, original, tampered.coverage_audit.regions, proposal, "annotation", errors);
  assert(errors.some((item) => item.includes("bounds 不一致") || item.includes("atomic_image_requirements") || item.includes("placement")), "区域几何变化仍需由实际技术内容复核");
  const nineSliceDrifts = [
    ["mode", (slice) => ({ mode: "not-applicable", reason: "改为不拉伸" })],
    ["source_size", (slice) => ({ ...slice, source_size: { ...slice.source_size, width: slice.source_size.width + 1 } })],
    ["borders", (slice) => ({ ...slice, borders: { ...slice.borders, left: slice.borders.left + 1 } })],
  ];
  for (const [field, mutate] of nineSliceDrifts) {
    const driftedRegions = structuredClone(manifest.coverage_audit.regions);
    driftedRegions[1].component_inventory.components[0].nine_slice = mutate(driftedRegions[1].component_inventory.components[0].nine_slice);
    const driftErrors = [];
    validateAnnotatedPng(pngBytes, original, driftedRegions, proposal, `annotation-nine-slice-${field}`, driftErrors);
    assert(driftErrors.some((item) => item.includes("technical_definition 与当前区域不一致")), `${field} 变化必须与已确认的实际区域定义不一致`);
  }
  const alteredProposal = structuredClone(proposal); alteredProposal.technical_analysis.regions.find((region) => region.region_id === "hero").bounds.width += 1; const proposalErrors = []; validateAnnotatedPng(pngBytes, original, manifest.coverage_audit.regions, alteredProposal, "annotation", proposalErrors); assert(proposalErrors.some((item) => item.includes("技术文件") && item.includes("bounds")), "篡改技术 JSON 的坐标尺寸必须被验证器发现");
  const alteredMetadata = structuredClone(decoded.metadata); alteredMetadata.visible_rows.find((row) => row.kind === "summary" && row.annotation_number === 2).text = "2 被篡改的摘要"; const alteredLabel = alteredMetadata.visible_rows.find((row) => row.kind === "label" && row.annotation_number === 2); alteredLabel.text = "复用既有资源"; alteredLabel.label = "复用既有资源"; alteredMetadata.regions.find((region) => region.region_id === "hero").summary = "被篡改的区域摘要"; const alteredPng = encodePngRgba(decoded.width, decoded.height, decoded.pixels, alteredMetadata); const summaryErrors = []; validateAnnotatedPng(alteredPng, original, manifest.coverage_audit.regions, proposal, "annotation", summaryErrors); assert(summaryErrors.some((item) => item.includes("右栏第") && item.includes("未精确呈现")), "删除或修改右栏中文摘要必须被验证器发现"); assert(summaryErrors.some((item) => item.includes("中文摘要与区域合同不一致")), "嵌入区域中文摘要被篡改必须被验证器发现"); assert(summaryErrors.some((item) => item.includes("用户说明")), "用户生产标签被篡改必须被验证器发现");
  const missingKind = structuredClone(proposal); delete missingKind.proposal_kind; const missingKindErrors = []; validateAnnotatedPng(pngBytes, original, manifest.coverage_audit.regions, missingKind, "annotation", missingKindErrors); assert(missingKindErrors.some((item) => item.includes("proposal_kind") && item.includes("技术文件")), "缺少 proposal_kind 必须拒绝正式标注");
  const missingTechnical = structuredClone(proposal); delete missingTechnical.technical_analysis; const missingTechnicalErrors = []; validateAnnotatedPng(pngBytes, original, manifest.coverage_audit.regions, missingTechnical, "annotation", missingTechnicalErrors); assert(missingTechnicalErrors.some((item) => item.includes("technical_analysis")), "缺少 technical_analysis 必须拒绝正式标注");
});

test("缺失或错误的冻结目标、复用来源和状态分析摘要不阻断有效图像标注", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-stale-digests-"));
  const original = minimalPng(32, 24);
  const manifest = annotationManifest("invalid-target-digest");
  await writeFile(join(root, "reference.png"), original);
  await addReuseEvidence(root, manifest);
  const badge = manifest.coverage_audit.regions.find((region) => region.id === "badge");
  const hero = manifest.coverage_audit.regions.find((region) => region.id === "hero");
  delete badge.reuse_snapshot.source_sha256;
  badge.reuse_snapshot.source_manifest_sha256 = { stale: true };
  badge.reuse_snapshot.compatibility_evidence_sha256 = "bad-digest";
  delete hero.state_analysis.evidence_sha256;
  hero.state_analysis.reference_target_sha256 = "old-target";
  const manifestPath = join(root, "visual-assets.json");
  await writeFile(manifestPath, JSON.stringify(manifest));

  const code = await generateAnnotation([manifestPath, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "evidence/annotation.png", "--proposal", "evidence/annotation-proposal.json"]);
  assert.equal(code, 0);
  const decoded = decodePngRgba(await readFile(join(root, "evidence/annotation.png")));
  assert.equal(decoded.metadata.schema, "effect-image-annotation/png/1");
});

test("正式标注生成必须同时输出拆解分析技术文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-missing-proposal-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const manifestPath = join(root, "visual-assets.json");
  await writeFile(join(root, "reference.png"), original); await addReuseEvidence(root, manifest); await writeFile(manifestPath, JSON.stringify(manifest));
  const code = await generateAnnotation([manifestPath, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "evidence/annotation.png"]);
  assert.equal(code, 1, "省略 --proposal 时不得生成只有用户图示的成功产物");
});

test("标注脚本拒绝重复编号和运行区域挂生产资产", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-invalid-")); const original = minimalPng(); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[2].annotation_number = 2; manifest.coverage_audit.regions[0].asset_id = "forged";
  await writeFile(join(root, "reference.png"), original); await addReuseEvidence(root, manifest); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.png", "--proposal", "bad.json"]), 1);
});

test("标注脚本拒绝坏冻结原图和 PNG 尺寸不匹配", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-png-")); const bad = Buffer.from("not-a-png"); const badManifest = annotationManifest(sha256(bad));
  await writeFile(join(root, "reference.png"), bad); await addReuseEvidence(root, badManifest); const path = join(root, "bad.json"); await writeFile(path, JSON.stringify(badManifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.png", "--proposal", "bad.json"]), 1);
  const original = minimalPng(32, 24); const mismatch = annotationManifest(sha256(original)); mismatch.coverage_audit.canvases[0].width = 31; mismatch.coverage_audit.regions[0].bounds.width = 31;
  await addReuseEvidence(root, mismatch); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(mismatch));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "mismatch.png", "--proposal", "mismatch.json"]), 1);
});

test("PNG 解码器拒绝缺 IEND、尾随垃圾、重复 IHDR 和坏 CRC", () => {
  const valid = minimalPng();
  const missingIend = valid.subarray(0, valid.length - 12);
  const trailing = Buffer.concat([valid, Buffer.from([0])]);
  const duplicateIhdr = Buffer.concat([valid.subarray(0, 33), valid.subarray(8, 33), valid.subarray(33)]);
  const badCrc = Buffer.from(valid); badCrc[32] ^= 1;
  for (const candidate of [missingIend, trailing, duplicateIhdr, badCrc]) assert.throws(() => decodePngRgba(candidate));
});

test("小画布的图例和边缘区域内容始终夹在画布内", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-edge-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 2, height: 2 }; manifest.coverage_audit.regions[1].bounds = { x: 24, y: 16, width: 8, height: 8 }; manifest.coverage_audit.regions[1].component_inventory.components[0].placements[0].bounds = { x: 24, y: 16, width: 8, height: 8 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await addReuseEvidence(root, manifest); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge.png", "--proposal", "edge.json"]), 0);
  const decoded = decodePngRgba(await readFile(join(root, "edge.png"))); assert.equal(decoded.metadata.regions.length, 3); assert(decoded.metadata.panel_width > 0); assert.equal(decoded.width, decoded.metadata.original_width + decoded.metadata.panel_width);
});

test("右下边缘摘要自动换侧并夹紧基线", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-summary-edge-")); const original = minimalPng(160, 100); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.canvases[0] = { scene_id: "main", state_id: "default", width: 160, height: 100 }; manifest.coverage_audit.regions[2].bounds = { x: 140, y: 85, width: 10, height: 10 }; manifest.coverage_audit.regions[2].component_inventory.components[0].placements[0].bounds = { x: 140, y: 85, width: 10, height: 10 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await addReuseEvidence(root, manifest); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge-summary.png", "--proposal", "edge-summary.json"]), 0);
  const decoded = decodePngRgba(await readFile(join(root, "edge-summary.png"))); assert(decoded.height >= 100); assert(decoded.metadata.panel_content_complete); assert.equal(decoded.metadata.visible_row_count, decoded.metadata.visible_rows.length); assert(decoded.metadata.panel_width > 0);
});

test("篡改 PNG 标注字节会改变确定性证据", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const standard = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions);
   const tampered = [Buffer.from(standard).fill(0, standard.length - 12), Buffer.concat([standard, Buffer.from([0])]), standard.subarray(0, standard.length - 1)];
   assert(tampered.every((value) => !value.equals(standard)));
});
test("多组件标注只画 placement 原子框，父组合框和左侧说明文本均不存在", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = manifest.coverage_audit.regions[1];
  region.bounds = { x: 4, y: 4, width: 16, height: 8 };
  const first = region.component_inventory.components[0]; first.placements[0].bounds = { x: 4, y: 4, width: 8, height: 8 };
  const second = structuredClone(first); second.component_id = "hero-secondary"; second.atomic_visual_key = "hero-secondary-visual"; second.placements[0].placement_id = "hero-secondary-placement"; second.placements[0].bounds = { x: 12, y: 4, width: 8, height: 8 };
  region.component_inventory.components.push(second); region.component_inventory.component_count = 2; region.component_inventory.visible_instance_count = 2;
  region.expected_assets.push({ asset_id: "hero-secondary", asset_scope: "atomic-component", atomic_visual_key: second.atomic_visual_key, component_id: second.component_id, state_id: "default", source_file: "art/hero-secondary.png", runtime_file: "public/hero-secondary.png" });
  region.asset_ids = ["hero", "hero-secondary"]; region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  const png = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions); const heroMeta = decodePngRgba(png).metadata.regions.find((item) => item.region_id === "hero");
  assert.equal(heroMeta.placement_ids.length, 2); assert.deepEqual(heroMeta.placement_ids, ["hero-placement", "hero-secondary-placement"]); assert.equal(heroMeta.plan_mode, "generate-now");
});

test("单一可复用部件的三个 placement 只保留原子框且不显示技术行", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = manifest.coverage_audit.regions[1];
  region.bounds = { x: 2, y: 2, width: 28, height: 8 }; const component = region.component_inventory.components[0];
  component.placements = [0, 1, 2].map((index) => ({ placement_id: `hero-placement-${index + 1}`, bounds: { x: 2 + index * 9, y: 2, width: 8, height: 8 }, interaction_required: false }));
  region.component_inventory.visible_instance_count = 3; region.atomic_image_requirements = deriveAtomicImageRequirements(region); const png = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions); const decoded = decodePngRgba(png); const heroMeta = decoded.metadata.regions.find((item) => item.region_id === "hero");
  assert.deepEqual(heroMeta.placement_ids, ["hero-placement-1", "hero-placement-2", "hero-placement-3"]); assert.equal(decoded.metadata.region_frame_modes.find((item) => item.region_id === "hero").parent_frame_drawn, false); assert.equal(decoded.metadata.visible_rows.filter((row) => row.region_id === "hero" && ["production", "region", "mode", "component", "placement", "requirement"].includes(row.kind)).length, 0); assert(decoded.metadata.visible_rows.filter((row) => row.region_id === "hero" && row.kind === "summary").every((row) => !row.text.includes("实例")));
  const renamed = structuredClone(manifest.coverage_audit.regions); renamed[1].component_inventory.components[0].placements[0].placement_id = "renamed-placement"; const renamedPng = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], renamed); assert.deepEqual(decodePngRgba(renamedPng).pixels, decoded.pixels, "placement ID 不得绘制到左侧像素");
});

test("多组件编号首行只显示对应中文摘要", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = structuredClone(manifest.coverage_audit.regions[1]); region.implementation_plan.summary = "顶部按钮";
  const template = region.component_inventory.components[0]; region.component_inventory.components = Array.from({ length: 6 }, (_, index) => { const component = structuredClone(template); component.component_id = `top-button-${index + 1}`; component.atomic_visual_key = `top-button-${index + 1}-visual`; component.placements[0].placement_id = `top-button-${index + 1}-placement`; return component; }); region.component_inventory.component_count = 6; region.component_inventory.visible_instance_count = 6;
  const png = renderEffectImageAnnotation(original, "reference.png", { width: 32, height: 24 }, [region]); const summary = decodePngRgba(png).metadata.visible_rows.find((row) => row.kind === "summary"); assert.equal(summary.text, "2 顶部按钮"); assert(!summary.text.includes("原子资源"));
});

test("长中文摘要稳定换行并扩展右栏而不越界", () => {
  const original = minimalPng(12, 10); const manifest = annotationManifest(sha256(original)); const region = structuredClone(manifest.coverage_audit.regions[1]); region.implementation_plan.summary = "顶部按钮状态说明".repeat(12); region.bounds = { x: 1, y: 1, width: 4, height: 4 }; region.component_inventory.components[0].placements[0].bounds = { ...region.bounds };
  const png = renderEffectImageAnnotation(original, "reference.png", { width: 12, height: 10 }, [region]); const decoded = decodePngRgba(png); const summaries = decoded.metadata.visible_rows.filter((row) => row.kind === "summary"); assert(summaries.length > 1); assert(decoded.width > 12); assert(summaries.every((row) => row.top >= 0 && row.bottom <= decoded.height && row.text.length > 0)); assert.equal(decoded.metadata.visible_row_count, decoded.metadata.visible_rows.length);
});

test("标注生成器拒绝 SVG/JPG 输出", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-format-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  for (const output of ["evidence/annotation.svg", "evidence/annotation.jpg"]) assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", output, "--proposal", "evidence/proposal.json"]), 1, output);
});

test("右栏 ASCII 字模使用标准 5x7 且 A/S 可区分", () => {
  const a = asciiGlyph("A"); const s = asciiGlyph("S");
  assert.deepEqual(a, [["01110", "10001", "10001", "11111", "10001", "10001", "10001"]]);
  assert.deepEqual(s, [["01111", "10000", "10000", "01110", "00001", "00001", "11110"]]);
  assert.notDeepEqual(a, s);
});

test("固定 OFL 中文字库为顶部按钮四字提供不同真实像素且覆盖颜色角色生命值", () => {
  const buttonGlyphs = [..."顶部按钮"].map((character) => effectImageFontGlyph(character)); const uniqueButtonGlyphs = new Set(buttonGlyphs.map((glyph) => JSON.stringify(glyph)));
  assert.equal(EFFECT_IMAGE_FONT_PROVENANCE.glyph_count, 7540); assert.equal(EFFECT_IMAGE_FONT_PROVENANCE.license, "SIL Open Font License 1.1"); assert.equal(buttonGlyphs.length, 4); assert.equal(uniqueButtonGlyphs.size, 4); assert([..."颜色角色生命值"].every((character) => effectImageFontGlyph(character).some((row) => row.includes("1"))));
  assert.throws(() => effectImageFontGlyph("𠀀"), /未收录字符/);
});

test("右栏遇到未知生僻字在生成阶段明确失败，不绘制缺字框继续通过", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = structuredClone(manifest.coverage_audit.regions[1]); region.implementation_plan.summary = "顶部𠀀";
  assert.throws(() => renderEffectImageAnnotation(original, "reference.png", { width: 32, height: 24 }, [region]), /未收录字符/);
});

test("布局节点、placement 布局身份和 runtime 布局消费均参与区域定义 SHA", () => {
  const manifest = annotationManifest(sha256(minimalPng(32, 24)));
  const region = manifest.coverage_audit.regions[1];
  const original = computeRegionDefinitionSha256(region);
  region.layout_node_ids = ["layout-hero-v2"];
  assert.notEqual(computeRegionDefinitionSha256(region), original, "区域布局节点变化必须使确认 SHA 失效");
  region.component_inventory.components[0].placements[0].layout_node_id = "layout-hero-v3";
  const placementChanged = computeRegionDefinitionSha256(region);
  assert.notEqual(placementChanged, original, "placement 布局节点变化必须使确认 SHA 失效");
  region.runtime_implementation = { kind: "runtime-program", integration_files: ["src/hero.mjs"], layout_node_ids: ["layout-hero-v3"] };
  assert.notEqual(computeRegionDefinitionSha256(region), placementChanged, "runtime 布局消费变化必须使确认 SHA 失效");
});
