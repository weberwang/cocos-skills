#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkReuseSourceFiles, loadManifest, readPngDimensions } from "./validate_visual_manifest.mjs";
import { computeRegionDefinitionSha256, PLAN_COLORS, renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { annotationProductionContract } from "./effect_image_raster.mjs";
import { deriveAtomicImageRequirements } from "../../cocos-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { resolveProductionContract } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";
import { validateVisualComponentContract } from "../../cocos-game-workflow-control/scripts/visual-component-contract.mjs";
import { buildDecompositionElements, decompositionElementIds } from "./decomposition-elements.mjs";

/** 判断值是否为去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 读取区域已确认拆解元素身份；阶段 A 不预生成布局节点。 */
function decompositionIds(region) { return decompositionElementIds(buildDecompositionElements([region])); }

/** 收集并稳定排序 placement 与布局节点的绑定，供 proposal、结果和确认快照共同使用。 */
function placementLayoutNodeIds(region) {
  const production = resolveProductionContract(region);
  const inventory = region.component_inventory ?? production.component_inventory;
  const components = Array.isArray(inventory?.components) ? inventory.components : [];
  return components.flatMap((component) => (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({ placement_id: placement.placement_id, layout_node_id: placement.layout_node_id ?? null }))).sort((left, right) => String(left.placement_id).localeCompare(String(right.placement_id)));
}

/** 计算字节内容的标准 SHA-256 表示。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 将清单相对路径解析到项目内，拒绝生成文件逃逸。 */
function projectPath(projectRoot, value) {
  const result = resolve(projectRoot, value); const root = resolve(projectRoot); const rel = relative(root, result);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`路径逃逸项目根目录：${value}`);
  const rootReal = nearestExistingRealPath(root); const resultReal = nearestExistingRealPath(result);
  if (rootReal && resultReal) {
    const realRel = relative(rootReal, resultReal);
    if (isAbsolute(realRel) || realRel === ".." || realRel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`路径真实位置逃逸项目根目录：${value}`);
  }
  return result;
}

/** 解析文件或最近存在的父目录，避免标注输出经 symlink/junction 逃逸。 */
function nearestExistingRealPath(candidate) {
  let current = candidate;
  while (true) {
    try { return realpathSync(current); } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** 解析命令行参数。 */
function parseArgs(argv) {
  const args = { projectRoot: "." };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!args.manifest && !token.startsWith("-")) args.manifest = token;
    else if (token === "--project-root") args.projectRoot = argv[++index];
    else if (token === "--scene-id") args.sceneId = argv[++index];
    else if (token === "--state-id") args.stateId = argv[++index];
    else if (token === "--output") args.output = argv[++index];
    else if (token === "--proposal") args.proposal = argv[++index];
    else if (token === "--proposal-id") args.proposalId = argv[++index];
    else if (token === "--created-at") args.createdAt = argv[++index];
    else throw new Error(`不支持的参数：${token}`);
  }
  for (const field of ["manifest", "sceneId", "stateId", "output"]) if (!nonEmptyString(args[field])) throw new Error(`缺少参数：${field}`);
  if (!nonEmptyString(args.proposal)) throw new Error("缺少参数：proposal；正式效果图拆解必须提供用于拆解分析技术文件的 --proposal JSON");
  if (!args.output.toLowerCase().endsWith(".png")) throw new Error("标注输出必须使用 .png；正式流程不生成 SVG/JPG");
  return args;
}

/** 验证选定 scene/state 的画布、区域编号和三类实现计划。 */
async function selectRegions(manifest, sceneId, stateId, projectRoot) {
  const audit = manifest.coverage_audit; const key = `${sceneId}\0${stateId}`;
  if (!isObject(audit) || !Array.isArray(audit.canvases) || !Array.isArray(audit.regions)) throw new Error("coverage_audit 缺少 canvases 或 regions");
  const canvas = audit.canvases.find((item) => `${item.scene_id}\0${item.state_id}` === key);
  if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) throw new Error("找不到选定 scene/state 的有效目标画布");
  const regions = audit.regions.filter((item) => item.scene_id === sceneId && item.state_id === stateId).sort((left, right) => left.annotation_number - right.annotation_number);
  if (regions.length === 0) throw new Error("选定 scene/state 没有覆盖区域");
  const numbers = new Set();
  for (const region of regions) {
    if (!isObject(region) || !Number.isInteger(region.annotation_number) || region.annotation_number <= 0 || numbers.has(region.annotation_number)) throw new Error(`区域 annotation_number 无效或重复：${region?.id ?? "unknown"}`);
    numbers.add(region.annotation_number);
    if (!isObject(region.bounds) || region.bounds.x < 0 || region.bounds.y < 0 || region.bounds.width <= 0 || region.bounds.height <= 0 || region.bounds.x + region.bounds.width > canvas.width || region.bounds.y + region.bounds.height > canvas.height) throw new Error(`区域 bounds 超出目标画布：${region.id}`);
    if (!nonEmptyString(region.ownership_evidence)) throw new Error(`区域 ${region.id} 缺少已有 coverage/ownership 审阅证据`);
    const plan = region.implementation_plan;
    if (!isObject(plan) || !Object.hasOwn(PLAN_COLORS, plan.mode) || !nonEmptyString(plan.summary)) throw new Error(`区域 implementation_plan 无效：${region.id}`);
    const productionMethod = resolveProductionContract(region).production_method;
    if (productionMethod === "reuse" && plan.mode !== "reuse-existing") throw new Error(`区域 ${region.id} production_method=reuse 必须绑定 implementation_plan.mode=reuse-existing`);
    if (plan.mode === "reuse-existing" && productionMethod !== "reuse") throw new Error(`区域 ${region.id} implementation_plan.mode=reuse-existing 必须绑定 production_method=reuse`);
    if (plan.mode === "generate-now" && region.owner_type !== "fixed-production-visual") throw new Error(`区域 ${region.id} 的 generate-now 必须由 fixed-production-visual 负责`);
    if (plan.mode === "reuse-existing" && region.owner_type !== "fixed-production-visual") throw new Error(`区域 ${region.id} 的 reuse-existing 必须由 fixed-production-visual 负责`);
    if (plan.mode === "runtime-program" && (!["runtime-program", "runtime-data", "runtime-rendered"].includes(region.owner_type) || Object.hasOwn(region, "asset_id"))) throw new Error(`区域 ${region.id} 的 runtime-program 不得映射生产位图`);
    if (plan.mode === "reuse-existing") {
      const source = region.reuse_snapshot;
      if (!isObject(source) || source.schema !== "asset-reuse-snapshot/1.0" || !["source_file", "source_manifest_file", "compatibility_evidence_file", "accepted_at", "source_status"].every((field) => nonEmptyString(source[field]))) throw new Error(`区域 ${region.id} 的 reuse_snapshot 字段不完整`);
      if (source.source_status !== "accepted" || Number.isNaN(Date.parse(source.accepted_at))) throw new Error(`区域 ${region.id} 的 reuse_snapshot 必须是 accepted 且包含有效 accepted_at`);
      if (!/\.(?:png|jpe?g)$/i.test(source.source_file)) throw new Error(`区域 ${region.id} 的 reuse_snapshot.source_file 必须是 PNG/JPG`);
      if (basename(source.source_manifest_file.replace(/\\/g, "/")).toLowerCase() === "visual-assets.json") throw new Error(`区域 ${region.id} 的 reuse_snapshot 必须指向不可变快照，不能指向当前 visual-assets.json`);
      const reuseErrors = []; await checkReuseSourceFiles(projectRoot, `coverage_audit.regions[${region.annotation_number}]`, source, reuseErrors);
      if (reuseErrors.length) throw new Error(reuseErrors[0]);
    }
    if (region.owner_type === "fixed-production-visual") {
      const componentErrors = validateVisualComponentContract(region, { stage: "V3", annotation_number: region.annotation_number, region_id: region.id }, { canvas });
      if (componentErrors.length) throw new Error(componentErrors[0]);
    }
  }
  return { canvas, regions };
}

/** 生成与共享确认门相同的区域快照；提案的 regions 不能混入可变展示字段。 */
function confirmationRegionSnapshot(region) {
  const production = resolveProductionContract(region);
  const planLabels = { "generate-now": "新建图片资产", "reuse-existing": "复用现有图片", "runtime-program": "程序绘制或动态逻辑" };
  const components = Array.isArray(production.component_inventory?.components) ? production.component_inventory.components : [];
  const stateIds = [...new Set([
    region.state_id,
    ...(Array.isArray(region.state_analysis?.states) ? region.state_analysis.states.map((item) => item?.state_id) : []),
    ...components.flatMap((component) => (Array.isArray(component?.state_coverage) ? component.state_coverage : []).map((item) => item?.state_id)),
  ].filter(nonEmptyString))].sort();
  const requirements = deriveAtomicImageRequirements(region);
  const assetIds = [...new Set([
    ...(Array.isArray(production.asset_ids) ? production.asset_ids : []), production.asset_id,
    ...(Array.isArray(production.expected_assets) ? production.expected_assets.map((item) => item?.asset_id) : []),
  ].filter(nonEmptyString))].sort();
  return {
    annotation_number: region.annotation_number,
    region_id: region.id,
    scene_id: region.scene_id,
    state_id: region.state_id,
    layout_node_ids: decompositionIds(region),
    placement_layout_node_ids: placementLayoutNodeIds(region),
    region_definition_sha256: computeRegionDefinitionSha256(region),
    production_origin: production.production_origin ?? null,
    production_method: production.production_method ?? "",
    delivery_kind: production.delivery_kind ?? "",
    production_label: region.production_label ?? planLabels[region.implementation_plan?.mode] ?? production.production_method ?? "",
    component_ids: components.map((item) => item?.component_id).filter(nonEmptyString).sort(),
    state_ids: stateIds,
    asset_requirement_ids: requirements.map((item) => item.requirement_id).filter(nonEmptyString).sort(),
    asset_ids: assetIds,
  };
}

/** 复制 JSON 合同值，避免技术文件与运行时清单共享可变引用。 */
function cloneJson(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

/** 收集一个区域的完整技术拆解，用户图示不展示的坐标、状态和资源映射都在这里留档。 */
export function technicalRegionSnapshot(region) {
  const production = resolveProductionContract(region);
  const displayProduction = annotationProductionContract(region);
  const requirements = deriveAtomicImageRequirements(region);
  const inventory = cloneJson(region.component_inventory ?? production.component_inventory ?? null);
  const components = Array.isArray(inventory?.components) ? inventory.components : [];
  const placements = components.flatMap((component) => (Array.isArray(component?.placements) ? component.placements : []).map((placement) => ({
    ...cloneJson(placement),
    component_id: component.component_id,
  })));
  const expectedAssets = cloneJson(region.expected_assets ?? production.expected_assets ?? []);
  const stateAnalysis = region.state_analysis ?? region.stateAnalysis;
  const assetIds = [...new Set([
    ...(Array.isArray(region.asset_ids) ? region.asset_ids : []),
    region.asset_id,
    ...(Array.isArray(production.asset_ids) ? production.asset_ids : []),
    production.asset_id,
    ...(Array.isArray(expectedAssets) ? expectedAssets.map((asset) => asset?.asset_id) : []),
  ].filter(nonEmptyString))].sort();
  const stateIds = [...new Set([
    region.state_id,
    ...(Array.isArray(stateAnalysis?.states) ? stateAnalysis.states.map((state) => state?.state_id) : []),
    ...components.flatMap((component) => (Array.isArray(component?.state_coverage) ? component.state_coverage : []).map((state) => state?.state_id)),
    ...requirements.map((requirement) => requirement.state_id),
  ].filter(nonEmptyString))].sort();
  // confirmation 文件会在写入 proposal 后补齐 SHA；技术快照排除这组可变证据字段，避免确认落盘反向改写区域合同。
  const { confirmation: _confirmation, ...technicalDefinition } = region;
  return {
    annotation_number: region.annotation_number,
    region_id: region.id,
    scene_id: region.scene_id,
    state_id: region.state_id,
    layout_node_ids: decompositionIds(region),
    decomposition_elements: buildDecompositionElements([region]),
    layer: region.layer,
    bounds: cloneJson(region.bounds),
    owner_type: region.owner_type,
    owner_id: region.owner_id,
    implementation_plan: cloneJson(region.implementation_plan),
    state_analysis: cloneJson(stateAnalysis),
    state_ids: stateIds,
    component_inventory: inventory,
    components: cloneJson(components),
    placements,
    interaction_hotspots: cloneJson(region.interaction_hotspots ?? []),
    production_contract: {
      production_origin: production.production_origin ?? displayProduction.production_origin ?? null,
      production_method: production.production_method ?? displayProduction.production_method ?? "",
      delivery_kind: production.delivery_kind ?? displayProduction.delivery_kind ?? "",
      image_generation_required: production.image_generation_required,
      generation_record_required: production.generation_record_required,
      substitution_policy: production.substitution_policy,
      runtime_implementation: cloneJson(production.runtime_implementation ?? region.runtime_implementation),
      asset_id: production.asset_id ?? region.asset_id,
      asset_ids: cloneJson(production.asset_ids ?? region.asset_ids ?? []),
      expected_assets: cloneJson(expectedAssets),
    },
    expected_assets: expectedAssets,
    resource_mapping: {
      asset_id: production.asset_id ?? region.asset_id ?? null,
      asset_ids: assetIds,
      expected_assets: cloneJson(expectedAssets),
      component_assets: requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        component_id: requirement.component_id,
        state_id: requirement.state_id,
        asset_id: requirement.asset_id,
        source_file: requirement.source_file,
        runtime_file: requirement.runtime_file,
      })),
    },
    atomic_image_requirements: cloneJson(requirements),
    region_definition_sha256: computeRegionDefinitionSha256(region),
    // 保留原始区域合同快照，确保新增技术字段不会因图示精简而丢失。
    technical_definition: cloneJson(technicalDefinition),
  };
}

/** 生成绑定目标、区域定义和编号标注图 SHA 的拆解分析技术文件。 */
function buildProposal(args, manifest, canvas, outputRelative, annotationSha, regions) {
  const createdAt = args.createdAt ?? manifest.reference_target.frozen_at;
  if (!nonEmptyString(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new Error("proposal created_at 必须通过 --created-at 提供可解析时间，或使用可解析冻结时间");
  const proposalId = args.proposalId ?? `annotation-${args.sceneId}-${args.stateId}-${Date.parse(createdAt)}`;
  const targetSha = manifest.reference_target.target_sha256;
  const visualRegions = regions.map((region) => { const production = annotationProductionContract(region); return { region_id: region.id, annotation_number: region.annotation_number, mode: region.implementation_plan.mode, summary: region.implementation_plan.summary, production_method: production.production_method, production_origin: production.production_origin, delivery_kind: production.delivery_kind, production_label: production.label, ownership_evidence: region.ownership_evidence, layout_node_ids: decompositionIds(region), placement_layout_node_ids: placementLayoutNodeIds(region), atomic_image_requirements: deriveAtomicImageRequirements(region), region_definition_sha256: computeRegionDefinitionSha256(region) }; });
  const canvasSnapshot = { scene_id: canvas.scene_id, state_id: canvas.state_id, width: canvas.width, height: canvas.height };
  const technicalRegions = regions.map(technicalRegionSnapshot);
  const decompositionElements = buildDecompositionElements(regions); const technicalLayoutNodeIds = decompositionElementIds(decompositionElements);
  return {
    schema_version: "1.5",
    proposal_kind: "effect-image-decomposition-technical-analysis",
    proposal_id: proposalId,
    created_at: createdAt,
    target_sha256: targetSha,
    scene_id: args.sceneId,
    state_id: args.stateId,
    canvas: canvasSnapshot,
    annotation_file: outputRelative,
    annotation_mime: "image/png",
    annotation_sha256: annotationSha,
    numbered_image_file: outputRelative,
    numbered_image_mime: "image/png",
    numbered_image_sha256: annotationSha,
    region_ids: regions.map((region) => region.id),
    layout_node_ids: technicalLayoutNodeIds,
    decomposition_elements: decompositionElements,
    // regions/visual_regions 保持原确认链快照字段；完整技术资料使用独立命名空间。
    regions: regions.map(confirmationRegionSnapshot),
    visual_regions: visualRegions,
    technical_analysis: {
      schema_version: "1",
      canvas: canvasSnapshot,
      layout_node_ids: technicalLayoutNodeIds,
      decomposition_elements: decompositionElements,
      regions: technicalRegions,
    },
  };
}

/** 运行标注图生成流程。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); const projectRoot = resolve(args.projectRoot); const manifest = await loadManifest(projectPath(projectRoot, args.manifest));
    if (!isObject(manifest.reference_target) || !nonEmptyString(manifest.reference_target.original_file)) throw new Error("reference_target 缺少 original_file");
    const { canvas, regions } = await selectRegions(manifest, args.sceneId, args.stateId, projectRoot); const originalPath = projectPath(projectRoot, manifest.reference_target.original_file); const originalBytes = await readFile(originalPath);
    const dimensions = readPngDimensions(originalBytes);
    if (!dimensions) throw new Error("reference_target.original_file 必须是完整合法 PNG");
    if (dimensions.width !== canvas.width || dimensions.height !== canvas.height) throw new Error("冻结原图 PNG 尺寸必须与选定 scene/state 画布一致");
    const outputPath = projectPath(projectRoot, args.output); await mkdir(dirname(outputPath), { recursive: true }); const pngBytes = renderEffectImageAnnotation(originalBytes, manifest.reference_target.original_file, canvas, regions); await writeFile(outputPath, pngBytes);
    const outputRelative = relative(projectRoot, outputPath).replace(/\\/g, "/"); const decompositionElements = buildDecompositionElements(regions); const result = { annotation_file: outputRelative, annotation_mime: "image/png", annotation_sha256: sha256Bytes(pngBytes), target_sha256: manifest.reference_target.target_sha256, scene_id: args.sceneId, state_id: args.stateId, layout_node_ids: decompositionElementIds(decompositionElements), decomposition_elements: decompositionElements, regions: regions.map((region) => { const production = annotationProductionContract(region); return { region_id: region.id, annotation_number: region.annotation_number, mode: region.implementation_plan.mode, summary: region.implementation_plan.summary, production_method: production.production_method, production_origin: production.production_origin, delivery_kind: production.delivery_kind, production_label: production.label, ownership_evidence: region.ownership_evidence, layout_node_ids: decompositionIds(region), placement_layout_node_ids: placementLayoutNodeIds(region), region_definition_sha256: computeRegionDefinitionSha256(region) }; }) };
    const proposal = buildProposal(args, manifest, canvas, outputRelative, result.annotation_sha256, regions); const proposalPath = projectPath(projectRoot, args.proposal); await mkdir(dirname(proposalPath), { recursive: true }); const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`); await writeFile(proposalPath, proposalBytes); result.proposal_file = relative(projectRoot, proposalPath).replace(/\\/g, "/"); result.proposal_sha256 = sha256Bytes(proposalBytes); result.proposal_id = proposal.proposal_id;
    console.log(JSON.stringify(result)); return 0;
  } catch (error) { console.error(`效果图标注生成失败：${error.message}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
