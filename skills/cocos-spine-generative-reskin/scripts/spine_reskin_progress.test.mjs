import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { atlasText, parseAtlas } from "./spine_atlas.mjs";
import { candidateFingerprint } from "./spine_batch.mjs";
import { discoverSpineAsset, prepareSpineAsset } from "./spine_assets.mjs";
import { auditSkeleton } from "./spine_skeleton.mjs";
import { ALPHA_CONTRACT_THRESHOLDS, isProcessAlive, main, shouldReclaimLock } from "./spine_reskin_progress.mjs";

/** 创建真实 PNG，测试不使用扩展名伪装或内联占位图。 */
async function image(path, width, height, background) {
  await sharp({ create: { width, height, channels: 4, background: { r: background[0], g: background[1], b: background[2], alpha: background[3] / 255 } } }).png().toFile(path);
}

/** 创建最小但真实可复算的控制面绑定，测试不得脱离 Work Item/V2 approval。 */
async function controlManifest(root) {
  const evidence = join(root, "v2-approval.txt");
  await writeFile(evidence, "accepted spine visual direction");
  const control = join(root, "control.json");
  await writeFile(control, JSON.stringify({ workItemId: "spine-work-item", production_contract: { contract_version: "spine-production/1.0", status: "PASS", scope: ["spine-reskin"] }, visual_human_approval: { review_id: "v2-spine", reviewed_at: "2026-08-23T00:00:00Z", status: "PASS", target_sha256: "a".repeat(64), candidate_sha256: "b".repeat(64), diff_fingerprint: "spine-diff", baseline_sha256: "c".repeat(64), evidence: { path: "v2-approval.txt", sha256: await sha(evidence) }, evidence_sha256: await sha(evidence) } }));
  return control;
}

/** 创建 schema v3 的最小 Spine 资产，支持低版本升级和多 Region 批次门测试。 */
async function fixture({ version = "3.8.98", names = ["body"] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-v3-"));
  await image(join(root, "page.png"), 12, 8, [0, 0, 0, 255]);
  const lines = ["page.png", "size: 12, 8", "format: RGBA8888", "filter: Linear,Linear", "repeat: none", "pma: false", ""];
  names.forEach((name, index) => lines.push(name, "rotate: false", `xy: ${index * 3}, 0`, "size: 2, 2", "orig: 2, 2", "offset: 0, 0", "index: -1", ""));
  const atlas = join(root, "source.atlas");
  await writeFile(atlas, `${lines.join("\n")}\n`);
  const skinSlots = Object.fromEntries(names.map((name) => [name, { type: name === "mesh" ? "mesh" : "region", path: name, ...(name === "mesh" ? { vertices: [0, 0, 1, 1, 0, 1], triangles: [0, 1, 2], uvs: [0, 0, 1, 1, 0, 1] } : {}) }]));
  const skeleton = join(root, "character.json");
  await writeFile(skeleton, JSON.stringify({ skeleton: { spine: version }, bones: [{ name: "root" }], slots: names.map((name) => ({ name: `${name}-slot`, bone: "root" })), skins: { default: { ...Object.fromEntries(names.map((name) => [`${name}-slot`, { [name]: skinSlots[name] }])) } }, animations: { Idle: {}, Attack: {} } }));
  const candidate = join(root, "candidate");
  const manifest = join(candidate, "progress.json");
  const control = await controlManifest(root);
  assert.equal(await main(["init", "--atlas", atlas, "--output", manifest, "--skeleton", skeleton, "--control-manifest", control, "--character", "虎"]), 0);
  return { root, atlas, skeleton, candidate, manifest, control, names };
}

/** 冻结统一暗黑合同，保证后续测试走正式生产前置门。 */
async function freezeContract(value) {
  const contract = join(value.root, "visual-contract.json");
  await writeFile(contract, JSON.stringify({ character: "虎", direction: "dark", palette: { primary_armor: "#16181D", secondary_structure: "#3A2C24", dark_mechanical: "#080A0D", glow: "#FF7A1A", accent: "#8E1B2C", effects: "#4B2A70" }, material_language: "matte black metal", light_direction: "upper-left" }));
  assert.equal(await main(["freeze-contract", "--manifest", value.manifest, "--contract", contract]), 0);
}

/** 导入一个批次计划。 */
async function plan(value, batches) {
  const path = join(value.root, "batches.json");
  await writeFile(path, JSON.stringify({ batches }));
  return main(["plan-batches", "--manifest", value.manifest, "--plan", path]);
}

/** 生成和登记一个当前批 Cell。 */
async function generate(value, cellId, color = [220, 30, 20, 255], size = [2, 2]) {
  const path = join(value.candidate, "generated", `${cellId.replaceAll(":", "-")}.png`);
  await mkdir(join(value.candidate, "generated"), { recursive: true });
  await image(path, size[0], size[1], color);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", cellId, "--status", "generating"]), 0);
  return { path, status: await main(["mark", "--manifest", value.manifest, "--cell", cellId, "--status", "generated", "--image", path]) };
}

/** 正式流程要求先生成当前批源参考板，再允许 Cell 进入 generating。 */
async function prepare(value, batchId) {
  assert.equal(await main(["batch", "prepare", "--manifest", value.manifest, "--batch", batchId]), 0);
}

/** 在所有当前批 Cell generated 后生成唯一审阅图。 */
async function review(value, batchId) {
  assert.equal(await main(["batch", "review", "--manifest", value.manifest, "--batch", batchId]), 0);
  return JSON.parse(await readFile(value.manifest, "utf8"));
}

/** 返回字节哈希，用于构造运行报告。 */
async function sha(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

/** 写入只改变一个 alpha 像素的候选图，用于回归结构合同而非颜色细节。 */
async function partialImage(path) {
  const data = Buffer.alloc(2 * 2 * 4, 255);
  data[3] = 0;
  await sharp(data, { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(path);
}

test("failed 状态不能直接绕过当前批次生成门，恢复后才可 generated", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "failed", "--error", "生成器超时"]), 0);
  const imagePath = join(value.candidate, "generated", "retry.png");
  await mkdir(join(value.candidate, "generated"), { recursive: true });
  await image(imagePath, 2, 2, [220, 30, 20, 255]);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generated", "--image", imagePath]), 2);
  await prepare(value, "b1");
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generating"]), 0);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generated", "--image", imagePath]), 0);
});

test("alpha 结构合同在 strict palette 和显式 constrained-redraw 下分别生效", async () => {
  const strict = await fixture();
  await freezeContract(strict);
  await plan(strict, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(strict, "b1");
  const strictImage = join(strict.candidate, "generated", "partial.png");
  await mkdir(join(strict.candidate, "generated"), { recursive: true });
  await partialImage(strictImage);
  await main(["mark", "--manifest", strict.manifest, "--cell", "p0:body", "--status", "generating"]);
  await main(["mark", "--manifest", strict.manifest, "--cell", "p0:body", "--status", "generated", "--image", strictImage]);
  const strictEvidence = join(strict.candidate, "evidence", "strict.txt");
  await mkdir(join(strict.candidate, "evidence"), { recursive: true });
  await writeFile(strictEvidence, "strict");
  assert.equal(await main(["validate", "--manifest", strict.manifest, "--cell", "p0:body", "--evidence", strictEvidence]), 2);

  const constrained = await fixture();
  await freezeContract(constrained);
  await plan(constrained, [{ id: "b1", regions: [{ id: "p0:body", mode: "constrained-redraw", alpha_lock: false }] }]);
  await prepare(constrained, "b1");
  const constrainedImage = join(constrained.candidate, "generated", "partial.png");
  await mkdir(join(constrained.candidate, "generated"), { recursive: true });
  await partialImage(constrainedImage);
  await main(["mark", "--manifest", constrained.manifest, "--cell", "p0:body", "--status", "generating"]);
  await main(["mark", "--manifest", constrained.manifest, "--cell", "p0:body", "--status", "generated", "--image", constrainedImage]);
  const constrainedEvidence = join(constrained.candidate, "evidence", "constrained.txt");
  await mkdir(join(constrained.candidate, "evidence"), { recursive: true });
  await writeFile(constrainedEvidence, "constrained");
  assert.equal(await main(["validate", "--manifest", constrained.manifest, "--cell", "p0:body", "--evidence", constrainedEvidence]), 0);
});

test("Skeleton 审计输出统计、Atlas 映射和 Mesh 顶点/三角形/UV 哈希", async () => {
  const value = await fixture({ names: ["mesh"] });
  const audit = await auditSkeleton(value.skeleton, { cells: [{ name: "mesh" }] }, "3.8");
  assert.equal(audit.stats.bone_count, 1);
  assert.equal(audit.stats.slot_count, 1);
  assert.equal(audit.stats.skin_count, 1);
  assert.equal(audit.stats.attachment_count, 1);
  assert.equal(audit.stats.mesh_count, 1);
  assert.deepEqual(audit.stats.animation_names, ["Attack", "Idle"]);
  assert.equal(audit.missing_atlas_regions.length, 0);
  assert.match(audit.mesh_signatures[0].mesh_sha256, /^[0-9a-f]{64}$/);
  const arraySkeleton = join(value.root, "array-skins.json");
  const arrayValue = JSON.parse(await readFile(value.skeleton, "utf8"));
  arrayValue.skins = [{ name: "default", attachments: arrayValue.skins.default }];
  await writeFile(arraySkeleton, JSON.stringify(arrayValue));
  const arrayAudit = await auditSkeleton(arraySkeleton, { cells: [{ name: "mesh" }] }, "3.8");
  assert.equal(arrayAudit.stats.attachment_count, 1);
  assert.equal(arrayAudit.stats.mesh_count, 1);
});

/** 回归 Creator 3.8 中可选 3.8/4.2 Runtime 分支的明确目标语义。 */
test("Spine Runtime 目标跟随所选 sp.SPINE_VERSION 分支", async () => {
  const value = await fixture({ version: "4.2.12" });
  const audit = await auditSkeleton(value.skeleton, { cells: [{ name: "body" }] }, "4.2");
  assert.equal(audit.runtime_compatible, true);
  assert.equal(audit.requires_upgrade, false);
  const legacyBranch = await auditSkeleton(value.skeleton, { cells: [{ name: "body" }] }, "3.8");
  assert.equal(legacyBranch.runtime_compatible, false);
  assert.equal(legacyBranch.requires_upgrade, true);
});

test("低版本 Skeleton 需要外部升级候选，升级结构漂移被阻断", async () => {
  const value = await fixture({ version: "3.8.99" });
  assert.equal(JSON.parse(await readFile(value.manifest, "utf8")).skeleton_audit.requires_upgrade, true);
  await freezeContract(value);
  const batchPlan = await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  assert.equal(batchPlan, 2);
  const candidate = join(value.root, "upgraded.json");
  const original = JSON.parse(await readFile(value.skeleton, "utf8"));
  original.skeleton.spine = "3.8.98";
  await writeFile(candidate, JSON.stringify(original));
  const runtimeEvidence = join(value.root, "runtime-parse-evidence.json");
  const runtimeLog = join(value.candidate, "runtime-parse.log");
  await writeFile(runtimeLog, "Cocos Creator 3.8 runtime parsed candidate SkeletonData");
  await writeFile(runtimeEvidence, JSON.stringify({ report_version: "cocos-spine-runtime-parse/2.0", producer: "cocos-mcp-server-runtime-check", runtime_owner: "Cocos Creator", creator_version: "3.8.6", creator_version_source: "project_get_project_info.cocosVersion", runtime_version_source: "sp.SPINE_VERSION", runtime_version: "3.8", command: "project-runtime-spine-parse", target_runtime: "3.8", parsed: true, candidate_skeleton_sha256: await sha(candidate), log_path: "runtime-parse.log", log_sha256: await sha(runtimeLog) }));
  assert.equal(await main(["upgrade-check", "--manifest", value.manifest, "--candidate-skeleton", candidate, "--runtime-evidence", runtimeEvidence]), 0);
  assert.equal(await plan(value, [{ id: "b1", regions: ["p0:body"] }]), 0);
  const drift = JSON.parse(JSON.stringify(original));
  drift.bones.push({ name: "unexpected" });
  const driftPath = join(value.root, "drift.json");
  await writeFile(driftPath, JSON.stringify(drift));
  const second = await fixture({ version: "3.8.99" });
  const driftEvidence = join(value.root, "drift-runtime-evidence.json");
  const driftLog = join(second.candidate, "runtime-parse.log");
  await writeFile(driftLog, "Creator runtime rejected structural drift");
  await writeFile(driftEvidence, JSON.stringify({ report_version: "cocos-spine-runtime-parse/2.0", producer: "cocos-mcp-server-runtime-check", runtime_owner: "Cocos Creator", creator_version: "3.8.6", creator_version_source: "project_get_project_info.cocosVersion", runtime_version_source: "sp.SPINE_VERSION", runtime_version: "3.8", command: "project-runtime-spine-parse", target_runtime: "3.8", parsed: true, candidate_skeleton_sha256: await sha(driftPath), log_path: "runtime-parse.log", log_sha256: await sha(driftLog) }));
  assert.equal(await main(["upgrade-check", "--manifest", second.manifest, "--candidate-skeleton", driftPath, "--runtime-evidence", driftEvidence]), 2);
});

test("批次覆盖、重复和越序生成 fail closed", async () => {
  const value = await fixture({ names: ["body", "head"] });
  await freezeContract(value);
  assert.equal(await plan(value, [{ id: "b1", regions: ["p0:body", "p0:body"] }]), 2);
  assert.equal(await plan(value, [{ id: "b1", regions: ["p0:body"] }]), 2);
  assert.equal(await plan(value, [{ id: "b1", regions: ["p0:body"] }, { id: "b2", regions: ["p0:head"] }]), 0);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:head", "--status", "generating"]), 2);
  await prepare(value, "b1");
  assert.equal(await generate(value, "p0:body").then((result) => result.status), 0);
});

test("完整或简短人工确认无需提供审阅图 SHA，alpha lock 仍约束当前批次", async () => {
  const value = await fixture({ names: ["body", "head"] });
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }, { id: "b2", regions: ["p0:head"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  let document = await review(value, "b1");
  const reviewSha = document.batches[0].review_board.sha256;
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", reviewSha, "--user-text", " "]), 2);
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", reviewSha, "--user-text", "同意第1批"]), 2);
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", "bad", "--fingerprint", "stale", "--user-text", "确认第1批"]), 0);
  document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(document.batches[0].status, "ACCEPTED");
  assert.equal(document.batches[0].locked, true);
  assert.equal(document.batches[0].acceptance.review_board_sha256, reviewSha);

  await prepare(value, "b2");
  await generate(value, "p0:head", [20, 220, 30, 255]);
  document = await review(value, "b2");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b2", "--user-text", " 确认 "]), 0);
  document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(document.batches[1].status, "ACCEPTED");
  assert.equal(document.batches[1].locked, true);
});

test("连续特效批次缺失颜色/亮度/轮廓/发光指标时不能导入", async () => {
  const value = await fixture();
  await freezeContract(value);
  assert.equal(await plan(value, [{ id: "fx", regions: ["p0:body"], effect_sequence: { order: ["p0:body"] } }]), 0);
  await prepare(value, "fx");
  await generate(value, "p0:body");
  const document = JSON.parse(await readFile(value.manifest, "utf8"));
  const reportPath = join(value.candidate, "evidence", "effect-report.json");
  await mkdir(join(value.candidate, "evidence"), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ report_version: "spine-effect-sequence/1.0", batch_id: "fx", revision: 0, candidate_fingerprint: candidateFingerprint(document.batches[0], [document.cells[0]]), color_consistency: { result: "PASS", metric: 1 }, brightness_continuity: { result: "PASS", metric: 1 }, contour_smoothness: { result: "PASS", metric: 1 }, glow_direction: { result: "PASS", metric: 1 } }));
  assert.equal(await main(["batch", "review", "--manifest", value.manifest, "--batch", "fx", "--effect-report", reportPath]), 0);
  const reviewed = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "fx", "--review-sha", reviewed.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
});

test("PNG、正向 Region 尺寸和 alpha lock 合同拒绝错误 Cell", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body", [220, 30, 20, 255], [1, 1]);
  await review(value, "b1");
  const document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 2);
});

test("Atlas 序列化不在同 Page Header/Region 之间插入空行，仅分隔 Page", async () => {
  const value = await fixture({ names: ["body", "head"] });
  const parsed = await parseAtlas(value.atlas);
  const document = { atlas: { pages: parsed.pages.map((page) => ({ ...page, output_name: page.name })) }, cells: parsed.cells };
  const output = atlasText(document).split("\n");
  assert.equal(output[1].startsWith("size:"), true);
  assert.equal(output[output.indexOf("page.png") + 6], "body");
  assert.equal(output.slice(0, -1).filter((line) => line === "").length, 0);
});

test("无摘要的人工回执和实际运行证据可完成验收，缺失报告仍拒绝", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas")]), 2);
  const document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas")]), 0);
  assert.equal(await main(["finalize", "--manifest", value.manifest]), 2);
  const evidenceDir = join(value.candidate, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const desktop = join(evidenceDir, "desktop.png");
  const mobile = join(evidenceDir, "mobile-390.png");
  await image(desktop, 4, 4, [1, 2, 3, 255]);
  await image(mobile, 4, 4, [1, 2, 3, 255]);
  const log = join(evidenceDir, "browser.log");
  await writeFile(log, "all animations switched");
  const report = join(value.candidate, "runtime-validation.json");
  const packedDocument = JSON.parse(await readFile(value.manifest, "utf8"));
  const validationRunId = "run-1";
  await writeFile(report, JSON.stringify({ report_version: "cocos-spine-runtime-validation/2.0", validation_run_id: validationRunId, build_binding: packedDocument.build.runtime_binding, sp_skeleton_instance: { component_type: "sp.Skeleton", node_uuid: "node-uuid-from-mcp", skeleton_data_uuid: "skeleton-data-uuid-from-mcp", enabled: true }, animation_source: "sp.Skeleton.skeletonData", target_runtime: "3.8", target_runtime_parse: { passed: true, parsed: true, report_version: "cocos-spine-runtime-parse/2.0", producer: "cocos-mcp-server-runtime-check", runtime_owner: "Cocos Creator", creator_version: "3.8.6", creator_version_source: "project_get_project_info.cocosVersion", runtime_version_source: "sp.SPINE_VERSION", runtime_version: "3.8", target_runtime: "3.8", command: "Creator runtime diagnostic", log_path: "evidence/browser.log", log_sha256: await sha(log), validation_run_id: validationRunId }, default_animation: "Idle", animations: [{ name: "Idle", found: true, switch_passed: true, loop: true }, { name: "Attack", found: true, switch_passed: true, loop: false }], summary: { bone: 1, slot: 1, animation: 2, atlas_page: 1, atlas_region: 1 }, checks: { texture_missing: false, anchor_drift: false, mesh_stretch: false, flicker: false, bad_crop: false }, url: "/spine-validation.html", viewports: { desktop: { width: 1280, height: 720 }, mobile_390: { width: 390, height: 844 } }, screenshots: { desktop: { path: "evidence/desktop.png", sha256: await sha(desktop), validation_run_id: validationRunId }, mobile_390: { path: "evidence/mobile-390.png", sha256: await sha(mobile), validation_run_id: validationRunId } }, browser_log: { path: "evidence/browser.log", sha256: await sha(log), validation_run_id: validationRunId } }));
  const baseRuntimeReport = JSON.parse(await readFile(report, "utf8"));
  const obsoleteGameObjectEvidence = structuredClone(baseRuntimeReport);
  delete obsoleteGameObjectEvidence.sp_skeleton_instance;
  obsoleteGameObjectEvidence.cocos_spine_game_object = true;
  await writeFile(report, JSON.stringify(obsoleteGameObjectEvidence));
  assert.equal(await main(["runtime-validate", "--manifest", value.manifest, "--runtime-report", report]), 2);
  const unknownCreatorVersion = structuredClone(baseRuntimeReport);
  unknownCreatorVersion.target_runtime_parse.creator_version = "Unknown";
  await writeFile(report, JSON.stringify(unknownCreatorVersion));
  assert.equal(await main(["runtime-validate", "--manifest", value.manifest, "--runtime-report", report]), 2);
  const hardcodedStatusVersion = structuredClone(baseRuntimeReport);
  hardcodedStatusVersion.target_runtime_parse.creator_version_source = "/status.creatorVersion";
  await writeFile(report, JSON.stringify(hardcodedStatusVersion));
  assert.equal(await main(["runtime-validate", "--manifest", value.manifest, "--runtime-report", report]), 2);
  const validCreatorVersion = structuredClone(baseRuntimeReport);
  validCreatorVersion.target_runtime_parse.creator_version = "3.8.6";
  await writeFile(report, JSON.stringify(validCreatorVersion));
  // 模拟人工验收前尚未维护任何摘要；实际资源、任务身份和运行结果必须足够。
  const withoutDigests = (value) => Array.isArray(value) ? value.map(withoutDigests)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:sha(?:1|256)|fingerprint)/i.test(key)).map(([key, item]) => [key, withoutDigests(item)])) : value;
  await writeFile(value.manifest, JSON.stringify(withoutDigests(packedDocument)));
  await writeFile(report, JSON.stringify(withoutDigests(JSON.parse(await readFile(report, "utf8")))));
  assert.equal(await main(["runtime-validate", "--manifest", value.manifest, "--runtime-report", report]), 0);
  assert.equal(await main(["finalize", "--manifest", value.manifest]), 0);
  const verification = join(value.candidate, "verification.json");
  await writeFile(verification, JSON.stringify({ runtime_validation: "PASS", automated_tests: "PASS", typecheck: { status: "NOT_APPLICABLE", reason: "当前技能无独立类型检查脚本" }, build: { status: "NOT_APPLICABLE", reason: "候选资源由脚本直接重建，无独立构建步骤" } }));
  assert.equal(await main(["report", "--manifest", value.manifest, "--output", join(value.candidate, "final-report.json"), "--verification", verification]), 0);
  await writeFile(value.manifest, JSON.stringify(withoutDigests(JSON.parse(await readFile(value.manifest, "utf8")))));
  assert.equal(await main(["verify", "--manifest", value.manifest]), 0);
  await writeFile(log, "tampered runtime log");
  assert.equal(await main(["verify", "--manifest", value.manifest]), 0);
  await rm(log);
  assert.equal(await main(["verify", "--manifest", value.manifest]), 1);
});

test("锁回收只允许已退出 PID", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(shouldReclaimLock({ pid: process.pid }, 0), false);
  assert.equal(shouldReclaimLock({ pid: 2147483647 }, 0), true);
  assert.equal(ALPHA_CONTRACT_THRESHOLDS.palette_refresh_max_mask_mismatch, 0);
});

test("同一 Cell 的并发 mark 由清单锁串行化且不丢失更新", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  const generating = await Promise.all([main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generating"]), main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generating"])]);
  assert.deepEqual(generating.sort(), [0, 0]);
  const generated = join(value.candidate, "generated", "parallel.png");
  await mkdir(join(value.candidate, "generated"), { recursive: true });
  await image(generated, 2, 2, [220, 30, 20, 255]);
  const results = await Promise.all([main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generated", "--image", generated]), main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generated", "--image", generated])]);
  assert.deepEqual(results.sort(), [0, 0]);
  assert.equal(JSON.parse(await readFile(value.manifest, "utf8")).cells[0].status, "generated");
});

test("多 Page 重建保持 Page 顺序、PNG 和空白透明区域", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-pages-v3-"));
  await image(join(root, "page-a.png"), 6, 4, [0, 0, 0, 255]);
  await image(join(root, "page-b.png"), 6, 4, [0, 0, 0, 255]);
  const atlas = join(root, "multi.atlas");
  const n = String.fromCharCode(10);
  await writeFile(atlas, ["page-a.png", "size: 6, 4", "format: RGBA8888", "", "a", "xy: 0, 0", "size: 2, 2", "", "page-b.png", "size: 6, 4", "format: RGBA8888", "", "b", "xy: 1, 1", "size: 2, 2", ""].join(n));
  const skeleton = join(root, "s.json");
  await writeFile(skeleton, JSON.stringify({ skeleton: { spine: "3.8.98" }, bones: [{ name: "root" }], slots: [{ name: "a-slot", bone: "root" }, { name: "b-slot", bone: "root" }], skins: { default: { "a-slot": { a: { type: "region", path: "a" } }, "b-slot": { b: { type: "region", path: "b" } } } }, animations: { Idle: {} } }));
  const value = { root, atlas, skeleton, candidate: join(root, "candidate"), manifest: join(root, "candidate", "progress.json") };
  const control = await controlManifest(root);
  assert.equal(await main(["init", "--atlas", atlas, "--output", value.manifest, "--skeleton", skeleton, "--control-manifest", control]), 0);
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:a"] }, { id: "b2", regions: ["p1:b"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:a", [220, 30, 20, 255]);
  let document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
  await prepare(value, "b2");
  await generate(value, "p1:b", [20, 220, 30, 255]);
  document = await review(value, "b2");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b2", "--review-sha", document.batches[1].review_board.sha256, "--user-text", "确认第2批"]), 0);
  const output = join(value.candidate, "atlas");
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", output]), 0);
  const outputAtlas = await readFile(join(output, "multi.atlas"), "utf8");
  assert.ok(outputAtlas.indexOf("page-a.png") < outputAtlas.indexOf("page-b.png"));
  assert.equal((await sharp(join(output, "page-a.png")).metadata()).format, "png");
  assert.equal((await sharp(join(output, "page-b.png")).metadata()).format, "png");
});

test("输出目录祖先保护、源漂移和非零 padding/extrusion 都阻断 pack", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  let document = await review(value, "b1");
  await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", value.candidate, "--force"]), 2);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "bad-padding"), "--padding", "1", "--extrusion", "0"]), 2);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "bad-extrusion") , "--padding", "1", "--extrusion", "2"]), 2);
  await writeFile(value.skeleton, "tampered");
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas-2")]), 2);
});

test("Atlas 初始化拒绝重复、重叠、越界和非法 orig/offset", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-atlas-v3-"));
  await image(join(root, "page.png"), 8, 8, [0, 0, 0, 255]);
  const skeleton = join(root, "s.json");
  await writeFile(skeleton, JSON.stringify({ skeleton: { spine: "3.8.98" }, bones: [{ name: "root" }], slots: [{ name: "slot", bone: "root" }], skins: { default: { slot: { a: { type: "region", path: "a" } } } }, animations: { Idle: {} } }));
  const rejected = async (text, index) => { const atlas = join(root, `bad-${index}.atlas`); await writeFile(atlas, text); assert.equal(await main(["init", "--atlas", atlas, "--output", join(root, `candidate-${index}`, "progress.json"), "--skeleton", skeleton]), 2); };
  await rejected("page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 1, 1\n\na\nxy: 2, 0\nsize: 1, 1\n", "duplicate");
  await rejected("page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 2, 2\n\nb\nxy: 1, 1\nsize: 2, 2\n", "overlap");
  await rejected("page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 7, 7\nsize: 2, 2\n", "bounds");
  await rejected("page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 2, 2\norig: 2, 2\noffset: 2, 0\n", "offset");
});

test("实际生成图损坏仍使 verify 失败", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  const generated = await generate(value, "p0:body");
  const document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas")]), 0);
  await writeFile(generated.path, "tampered");
  assert.equal(await main(["verify", "--manifest", value.manifest]), 1);
});

test("确认后的 validating Cell 在 recover 后保持 ACCEPTED+locked 并可继续 pack", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  let document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
  assert.equal(await main(["recover", "--manifest", value.manifest]), 0);
  document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(document.cells[0].status, "validating");
  assert.equal(document.batches[0].status, "ACCEPTED");
  assert.equal(document.batches[0].locked, true);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas")]), 0);
});

test("返工只重开当前批，必须重新 prepare 并可使用简短确认文本", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  let document = await review(value, "b1");
  assert.equal(await main(["batch", "reopen", "--manifest", value.manifest, "--batch", "b1"]), 0);
  document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(document.batches[0].status, "REWORK");
  assert.equal(document.batches[0].revision, 1);
  assert.equal(document.cells[0].status, "pending");
  const imagePath = join(value.candidate, "generated", "rework.png");
  await mkdir(join(value.candidate, "generated"), { recursive: true });
  await image(imagePath, 2, 2, [20, 30, 220, 255]);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generating"]), 2);
  await prepare(value, "b1");
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generating"]), 0);
  assert.equal(await main(["mark", "--manifest", value.manifest, "--cell", "p0:body", "--status", "generated", "--image", imagePath]), 0);
  document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认"]), 0);
});

test("pack 阶段 I/O 失败会恢复为 validating 且保留批次锁，可重试", async () => {
  const value = await fixture();
  await freezeContract(value);
  await plan(value, [{ id: "b1", regions: ["p0:body"] }]);
  await prepare(value, "b1");
  await generate(value, "p0:body");
  let document = await review(value, "b1");
  assert.equal(await main(["batch", "accept", "--manifest", value.manifest, "--batch", "b1", "--review-sha", document.batches[0].review_board.sha256, "--user-text", "确认第1批"]), 0);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas-failed"), "--atlas-name", "page.png"]), 2);
  document = JSON.parse(await readFile(value.manifest, "utf8"));
  assert.equal(document.cells[0].status, "validating");
  assert.equal(document.batches[0].status, "ACCEPTED");
  assert.equal(document.batches[0].locked, true);
  assert.equal(await main(["pack", "--manifest", value.manifest, "--output-dir", join(value.candidate, "atlas-retry")]), 0);
});

test("控制面 manifest 漂移会阻断后续批次命令", async () => {
  const value = await fixture();
  await freezeContract(value);
  await writeFile(value.control, JSON.stringify({ workItemId: "changed-work-item", production_contract: { contract_version: "spine-production/1.0", status: "PASS" }, visual_human_approval: { status: "PASS", evidence: { path: "v2-approval.txt", sha256: await sha(join(value.root, "v2-approval.txt")) }, evidence_sha256: await sha(join(value.root, "v2-approval.txt")) } }));
  const planPath = join(value.root, "drifted-control-plan.json");
  await writeFile(planPath, JSON.stringify({ batches: [{ id: "b1", regions: ["p0:body"] }] }));
  assert.equal(await main(["plan-batches", "--manifest", value.manifest, "--plan", planPath]), 2);
});

test("资源目录发现支持独立资产和 Cocos sp.SkeletonData 确定性导出", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-assets-discovery-v3-"));
  await image(join(root, "page.png"), 2, 2, [0, 0, 0, 255]);
  const skeletonValue = { skeleton: { spine: "3.8.98" }, bones: [{ name: "root" }], slots: [{ name: "body-slot", bone: "root" }], skins: { default: { "body-slot": { body: { type: "region", path: "body" } } } }, animations: { Idle: {} } };
  const atlasValue = "page.png\nsize: 2, 2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nbody\nrotate: false\nxy: 0, 0\nsize: 2, 2\norig: 2, 2\noffset: 0, 0\nindex: -1\n";
  const independentSkeleton = join(root, "character.json");
  const independentAtlas = join(root, "character.atlas");
  await writeFile(independentSkeleton, JSON.stringify(skeletonValue));
  await writeFile(independentAtlas, atlasValue);
  const independent = await discoverSpineAsset(root);
  assert.equal(independent.format, "independent");
  const cocosRoot = await mkdtemp(join(tmpdir(), "spine-cocos-assets-v3-"));
  const cocosPage = join(cocosRoot, "page.png");
  const cocosContainer = join(cocosRoot, "bundle.json");
  await image(cocosPage, 2, 2, [0, 0, 0, 255]);
  await writeFile(cocosContainer, JSON.stringify([{ _atlasText: atlasValue, _skeletonJson: JSON.stringify(skeletonValue), _textures: ["page.png"] }]));
  const before = await sha(cocosContainer);
  const discovered = await discoverSpineAsset(cocosRoot);
  assert.equal(discovered.format, "cocos-skeleton-data");
  const normalized = join(cocosRoot, "normalized");
  const exported = await prepareSpineAsset(cocosRoot, normalized);
  assert.equal(await sha(cocosContainer), before);
  assert.ok(exported.atlas_path.endsWith("normalized-spine.atlas"));
  assert.ok(exported.skeleton_path.endsWith("normalized-spine.json"));
  assert.equal((await stat(join(normalized, "page.png"))).isFile(), true);
  const control = await controlManifest(cocosRoot);
  const manifest = join(cocosRoot, "candidate", "progress.json");
  assert.equal(await main(["init", "--asset-dir", cocosRoot, "--normalized-dir", join(cocosRoot, "candidate", "normalized-source"), "--output", manifest, "--control-manifest", control, "--character", "虎"]), 0);
  const normalizedManifest = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(normalizedManifest.asset_input.format, "cocos-skeleton-data");
  assert.equal(normalizedManifest.asset_input.source_container_sha256, before);
  assert.equal(await main(["inspect", "--asset-dir", cocosRoot, "--normalized-dir", join(cocosRoot, "inspect-normalized")]), 0);
});
