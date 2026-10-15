import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRegionDefinitionSha256 } from "../../cocos-game-asset-integration/scripts/effect_image_annotation_core.mjs";
import { decodePngRgba, encodePngRgba } from "../../cocos-game-asset-integration/scripts/effect_image_raster.mjs";
import { buildDecompositionElements } from "../../cocos-game-asset-integration/scripts/decomposition-elements.mjs";
import { buildVisualConfirmationAuthorityByRegion, computeVisualAnnotationIdentitySha256, computeVisualAnnotationMetadataSha256, computeVisualConfirmationSha256, computeVisualUserMessageSha256, validateFixedVisualProductionMethod, validateVisualDecompositionConfirmationBinding, validateVisualDecompositionConfirmationRecord, validateVisualDecompositionConfirmations } from "./visual-decomposition-confirmation.mjs";
import { validateVisualConfirmationReferences, visualConfirmationAuthority } from "./visual-confirmation-authority.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
/** 与控制面相同的规范化 JSON，测试用来生成 ledger/entry 自身哈希。 */
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
/** 为测试决定记录生成稳定身份，排除写入顺序影响。 */
function canonicalSha(value, field) { const copy = { ...value }; delete copy[field]; return `sha256:${createHash("sha256").update(canonicalJson(copy)).digest("hex")}`; }
/** 构造前置文件集合身份，验证任务绑定而不伪造用户确认。 */
function prerequisiteSha(files) { return `sha256:${createHash("sha256").update(canonicalJson([...new Set(files)].sort())).digest("hex")}`; }
/** 在确认工件写入后冻结 Git 基线，模拟控制面先落盘再开放实施。 */
function freezeBaseline(projectRoot) {
  execFileSync("git", ["-C", projectRoot, "init", "-q"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "workflow@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Workflow Test"]);
  // 全局 Git 忽略规则可能屏蔽控制目录；测试必须显式把 ledger/receipt 纳入冻结基线。
  execFileSync("git", ["-C", projectRoot, "add", "."]);
  execFileSync("git", ["-C", projectRoot, "add", "-f", "--", ".workflow-control"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-qm", "freeze visual confirmation baseline"]);
  return execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

/** 构造已在拆解时明确不采用九宫格的固定比例按钮，测试继续聚焦确认身份。 */
function decompositionRegion(overrides = {}) {
  const region = {
    id: "region-buttons",
    annotation_number: 2,
    scene_id: "main-gameplay",
    state_id: "default",
    owner_type: "fixed-production-visual",
    production_origin: "bitmap-decomposition",
    production_method: "image-generation",
    delivery_kind: "raster-image",
    image_generation_required: true,
    bounds: { x: 0, y: 0, width: 2, height: 1 },
    decomposition_elements: [{ element_id: "button-element", element_type: "component", role: "button", bounds: { x: 0, y: 0, width: 2, height: 1 }, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整按钮图形在该区域独立布局" }, ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "HIT_TARGET" }, component_id: "button-1", placement_id: "button-placement", empty_container: false }],
    implementation_plan: { mode: "generate-now" },
    component_inventory: {
      components: [{ component_id: "button-1", state_coverage: [{ state_id: "default" }] }],
    },
    atomic_image_requirements: [{ requirement_id: "req-button-1", component_id: "button-1", state_id: "default" }],
    ...overrides,
  };
  region.decomposition_elements[0].nine_slice = { mode: "not-applicable", reason: "测试按钮图案保持固定比例" };
  return region;
}

/** 构造新版本人工确认记录，确认区域定义和原子需求身份。 */
function confirmationFor(region, overrides = {}) {
  const acceptedAt = overrides.accepted_at ?? new Date(Date.now() - 60_000).toISOString();
  return {
    confirmation_schema: "visual-decomposition-confirmation/1.0",
    confirmation_id: "confirm-buttons-1",
    confirmation_sha256: HASH,
    status: "accepted",
    confirmation_mode: "manual",
    proposal_id: "proposal-buttons-1",
    proposal_sha256: HASH,
    proposal_file: "evidence/visual/buttons-proposal.json",
    annotation_file: "evidence/visual/buttons-annotated.png",
    annotation_sha256: HASH,
    annotation_mime: "image/png",
    annotation_width: 2,
    annotation_height: 1,
    annotation_schema: "effect-image-annotation/png/1",
    annotation_layout: "image-plus-right-panel",
    annotation_metadata_sha256: HASH,
    annotation_identity_sha256: HASH,
    decision_record_file: "evidence/visual/buttons-decision.json",
    decision_record_sha256: HASH,
    user_decision_receipt_file: "evidence/visual/buttons-user-decision-receipt.json",
    user_decision_receipt_sha256: HASH,
    target_sha256: HASH,
    production_origin: region.production_origin,
    production_method: region.production_method,
    delivery_kind: region.delivery_kind,
    production_label: "新建图片资产",
    asset_ids: [],
    scene_id: region.scene_id,
    state_id: region.state_id,
    annotation_number: region.annotation_number,
    region_id: region.id,
    region_definition_sha256: computeRegionDefinitionSha256(region),
    component_ids: ["button-1"],
    state_ids: ["default"],
    asset_requirement_ids: ["req-button-1"],
    user_original_text: "确认按原子按钮拆解并进入图片生产。",
    user_message_sha256: HASH,
    accepted_at: acceptedAt,
    work_item_id: "work-item-1",
    candidate_version: "candidate-1",
    candidate_sha256: HASH,
    user_message_sha256: computeVisualUserMessageSha256("确认按原子按钮拆解并进入图片生产。"),
    ...overrides,
  };
}

/** 创建带真实 PNG、提案和决定文件的权威确认夹具。 */
function confirmedFixture(region) {
  const projectRoot = mkdtempSync(join(tmpdir(), "visual-confirmation-"));
  const evidenceDir = join(projectRoot, "evidence", "visual");
  const resolutionDir = join(projectRoot, ".workflow-control", "user-resolutions");
  mkdirSync(evidenceDir, { recursive: true }); mkdirSync(resolutionDir, { recursive: true });
  const acceptedAt = new Date(Date.now() - 60_000).toISOString();
  const createdAt = new Date(Date.now() - 120_000).toISOString();
  const decompositionElements = buildDecompositionElements([region]);
  const annotationFile = join(evidenceDir, "buttons-annotated.png");
  const snapshot = {
    annotation_number: region.annotation_number,
    region_id: region.id,
    scene_id: region.scene_id,
    state_id: region.state_id,
    region_definition_sha256: computeRegionDefinitionSha256(region),
    production_origin: region.production_origin,
    production_method: region.production_method,
    delivery_kind: region.delivery_kind,
    production_label: "新建图片资产",
    component_ids: ["button-1"],
    state_ids: ["default"],
    asset_requirement_ids: ["req-button-1"],
    asset_ids: [],
  };
  const metadataSnapshot = { ...snapshot, decomposition_elements: decompositionElements };
  const metadata = { schema: "effect-image-annotation/png/1", layout: "image-plus-right-panel", width: 2, height: 1, original_width: 2, original_height: 1, panel_content_complete: true, original_sha256: HASH, regions: [metadataSnapshot] };
  const annotationBytes = encodePngRgba(2, 1, Buffer.from([20, 30, 40, 255, 50, 60, 70, 200]), metadata);
  writeFileSync(annotationFile, annotationBytes);
  const annotationSha = `sha256:${createHash("sha256").update(annotationBytes).digest("hex")}`;
  const metadataSha = computeVisualAnnotationMetadataSha256(metadata);
  const annotationIdentity = computeVisualAnnotationIdentitySha256(annotationSha, 2, 1, metadataSha, metadata.schema, metadata.layout);
  const technicalRegion = { annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), bounds: region.bounds, decomposition_elements: decompositionElements };
  const proposal = {
    proposal_id: "proposal-buttons-1",
    target_sha256: HASH,
    annotation_file: "evidence/visual/buttons-annotated.png",
    annotation_sha256: annotationSha,
    created_at: createdAt,
    decomposition_elements: decompositionElements,
    regions: [snapshot],
    technical_analysis: { schema_version: "1", decomposition_elements: decompositionElements, regions: [technicalRegion] },
  };
  const proposalBytes = Buffer.from(JSON.stringify(proposal));
  writeFileSync(join(evidenceDir, "buttons-proposal.json"), proposalBytes);
  const proposalSha = `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`;
  const userText = "确认按原子按钮拆解并进入图片生产。";
  const decision = {
    status: "accepted",
    confirmation_mode: "manual",
    confirmation_id: "confirm-buttons-1",
    proposal_id: "proposal-buttons-1",
    proposal_sha256: proposalSha,
    user_statement: userText,
    user_message_sha256: computeVisualUserMessageSha256(userText),
    accepted_at: acceptedAt,
    target_sha256: HASH,
    work_item_id: "work-item-1",
    candidate_version: "candidate-1",
    candidate_sha256: HASH,
    regions: [snapshot],
  };
  const decisionBytes = Buffer.from(JSON.stringify(decision));
  writeFileSync(join(evidenceDir, "buttons-decision.json"), decisionBytes);
  const decisionSha = `sha256:${createHash("sha256").update(decisionBytes).digest("hex")}`;
  const receipt = {
    message_id: "message-1",
    thread_id: "thread-1",
    author_role: "user",
    user_message_sha256: computeVisualUserMessageSha256(userText),
    decision_record_sha256: decisionSha,
    accepted_at: acceptedAt,
    work_item_id: "work-item-1",
    candidate_version: "candidate-1",
    candidate_sha256: HASH,
    target_sha256: HASH,
    scene_id: region.scene_id,
    state_id: region.state_id,
    resolution_id: "resolution-1",
    resolution_status: "resolved",
    resolved_from: "USER_INPUT_REQUIRED",
    user_statement: userText,
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  const receiptFileName = ".workflow-control/user-resolutions/buttons-receipt.json";
  writeFileSync(join(projectRoot, receiptFileName), receiptBytes);
  const receiptSha = `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`;
  const record = confirmationFor(region, {
    accepted_at: acceptedAt,
    proposal_sha256: proposalSha,
    annotation_sha256: annotationSha,
    annotation_width: 2,
    annotation_height: 1,
    annotation_metadata_sha256: metadataSha,
    annotation_identity_sha256: annotationIdentity,
    decision_record_sha256: decisionSha,
    user_decision_receipt_file: receiptFileName,
    user_decision_receipt_sha256: receiptSha,
  });
  record.confirmation_sha256 = computeVisualConfirmationSha256(record);
  const ledgerFileName = ".workflow-control/user-resolutions/buttons-ledger.json";
  const entry = { ...receipt, receipt_id: "receipt-buttons-1", receipt_file: receiptFileName, receipt_sha256: receiptSha, entry_sha256: HASH, annotation_file: "evidence/visual/buttons-annotated.png", annotation_sha256: annotationSha, annotation_width: 2, annotation_height: 1, annotation_schema: metadata.schema, annotation_layout: metadata.layout, annotation_metadata_sha256: metadataSha, annotation_identity_sha256: annotationIdentity, proposal_id: "proposal-buttons-1", proposal_file: "evidence/visual/buttons-proposal.json", proposal_sha256: proposalSha, decision_record_file: "evidence/visual/buttons-decision.json" };
  entry.entry_sha256 = canonicalSha(entry, "entry_sha256");
  const ledger = { schema: "user-resolution-ledger/1.0", ledger_id: "ledger-buttons-1", ledger_sha256: HASH, work_item_id: "work-item-1", entries: [entry] };
  ledger.ledger_sha256 = canonicalSha(ledger, "ledger_sha256");
  writeFileSync(join(projectRoot, ledgerFileName), JSON.stringify(ledger));
  const baselineHash = freezeBaseline(projectRoot);
  const prerequisiteFiles = [ledgerFileName, receiptFileName];
  const manifest = { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH }, reference_target: { target_sha256: HASH, frozen_at: new Date(Date.now() - 180_000).toISOString() } };
  const work = { workItemId: "work-item-1", baselineHash, visualConfirmationPrerequisiteFiles: prerequisiteFiles, visualConfirmationPrerequisiteFilesSha256: prerequisiteSha(prerequisiteFiles), visualConfirmationAuthorityRefs: [{ scene_id: region.scene_id, state_id: region.state_id, ledger_file: ledgerFileName, receipt_id: entry.receipt_id, receipt_sha256: receiptSha }] };
  const authority = visualConfirmationAuthority(work, manifest, { projectRoot, checkFiles: true });
  return {
    record,
    work,
    manifest,
    projectRoot,
    ledger,
    options: { ...authority, sceneId: region.scene_id, stateId: region.state_id, annotationNumber: region.annotation_number, regionId: region.id, regionDefinitionSha256: computeRegionDefinitionSha256(region), authority, allRegions: [region], authorityByRegion: buildVisualConfirmationAuthorityByRegion({ coverage_audit: { regions: [region] } }, authority) },
  };
}

/** 在同一冻结基线中写入第二套独立 scene/state 确认工件。 */
function appendConfirmedGroup(valid, region, prefix) {
  const evidenceDir = join(valid.projectRoot, "evidence", "visual");
  const acceptedAt = new Date(Date.now() - 60_000).toISOString(); const createdAt = new Date(Date.now() - 120_000).toISOString();
  const decompositionElements = buildDecompositionElements([region]);
  const snapshot = { annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: region.production_origin, production_method: region.production_method, delivery_kind: region.delivery_kind, production_label: "新建图片资产", component_ids: ["button-1"], state_ids: [region.state_id], asset_requirement_ids: ["req-button-1"], asset_ids: [] };
  const metadataSnapshot = { ...snapshot, decomposition_elements: decompositionElements };
  const metadata = { schema: "effect-image-annotation/png/1", layout: "image-plus-right-panel", width: 2, height: 1, original_width: 2, original_height: 1, panel_content_complete: true, original_sha256: HASH, regions: [metadataSnapshot] };
  const annotationFile = `evidence/visual/${prefix}-annotated.png`; const annotationBytes = encodePngRgba(2, 1, Buffer.from([80, 90, 100, 255, 110, 120, 130, 200]), metadata); writeFileSync(join(valid.projectRoot, annotationFile), annotationBytes);
  const annotationSha = `sha256:${createHash("sha256").update(annotationBytes).digest("hex")}`; const metadataSha = computeVisualAnnotationMetadataSha256(metadata); const annotationIdentity = computeVisualAnnotationIdentitySha256(annotationSha, 2, 1, metadataSha, metadata.schema, metadata.layout);
  const proposalFile = `evidence/visual/${prefix}-proposal.json`; const technicalRegion = { annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), bounds: region.bounds, decomposition_elements: decompositionElements }; const proposal = { proposal_id: `${prefix}-proposal`, target_sha256: HASH, annotation_file: annotationFile, annotation_sha256: annotationSha, created_at: createdAt, decomposition_elements: decompositionElements, regions: [snapshot], technical_analysis: { schema_version: "1", decomposition_elements: decompositionElements, regions: [technicalRegion] } }; const proposalBytes = Buffer.from(JSON.stringify(proposal)); writeFileSync(join(valid.projectRoot, proposalFile), proposalBytes); const proposalSha = `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`;
  const userText = `确认 ${region.scene_id}/${region.state_id} 的独立拆解并进入图片生产。`; const decisionFile = `evidence/visual/${prefix}-decision.json`; const decision = { status: "accepted", confirmation_mode: "manual", confirmation_id: `${prefix}-confirmation`, proposal_id: proposal.proposal_id, proposal_sha256: proposalSha, user_statement: userText, user_message_sha256: computeVisualUserMessageSha256(userText), accepted_at: acceptedAt, target_sha256: HASH, work_item_id: "work-item-1", candidate_version: "candidate-1", candidate_sha256: HASH, regions: [snapshot] }; const decisionBytes = Buffer.from(JSON.stringify(decision)); writeFileSync(join(valid.projectRoot, decisionFile), decisionBytes); const decisionSha = `sha256:${createHash("sha256").update(decisionBytes).digest("hex")}`;
  const receiptFile = `.workflow-control/user-resolutions/${prefix}-receipt.json`; const receipt = { message_id: `${prefix}-message`, thread_id: `${prefix}-thread`, author_role: "user", user_message_sha256: computeVisualUserMessageSha256(userText), decision_record_sha256: decisionSha, accepted_at: acceptedAt, work_item_id: "work-item-1", candidate_version: "candidate-1", candidate_sha256: HASH, target_sha256: HASH, scene_id: region.scene_id, state_id: region.state_id, resolution_id: `${prefix}-resolution`, resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", user_statement: userText }; const receiptBytes = Buffer.from(JSON.stringify(receipt)); writeFileSync(join(valid.projectRoot, receiptFile), receiptBytes); const receiptSha = `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`;
  const record = confirmationFor(region, { confirmation_id: `${prefix}-confirmation`, proposal_id: proposal.proposal_id, proposal_file: proposalFile, proposal_sha256: proposalSha, annotation_file: annotationFile, annotation_sha256: annotationSha, annotation_width: 2, annotation_height: 1, annotation_metadata_sha256: metadataSha, annotation_identity_sha256: annotationIdentity, decision_record_file: decisionFile, decision_record_sha256: decisionSha, user_decision_receipt_file: receiptFile, user_decision_receipt_sha256: receiptSha, user_original_text: userText, user_message_sha256: computeVisualUserMessageSha256(userText), accepted_at: acceptedAt, component_ids: ["button-1"], state_ids: [region.state_id] }); record.confirmation_sha256 = computeVisualConfirmationSha256(record);
  const entry = { ...receipt, receipt_id: `${prefix}-receipt`, receipt_file: receiptFile, receipt_sha256: receiptSha, entry_sha256: HASH, annotation_file: annotationFile, annotation_sha256: annotationSha, annotation_width: 2, annotation_height: 1, annotation_schema: metadata.schema, annotation_layout: metadata.layout, annotation_metadata_sha256: metadataSha, annotation_identity_sha256: annotationIdentity, proposal_id: proposal.proposal_id, proposal_file: proposalFile, proposal_sha256: proposalSha, decision_record_file: decisionFile }; entry.entry_sha256 = canonicalSha(entry, "entry_sha256");
  const ledgerFile = `.workflow-control/user-resolutions/${prefix}-ledger.json`; const ledger = { schema: "user-resolution-ledger/1.0", ledger_id: `${prefix}-ledger`, ledger_sha256: HASH, work_item_id: "work-item-1", entries: [entry] }; ledger.ledger_sha256 = canonicalSha(ledger, "ledger_sha256"); writeFileSync(join(valid.projectRoot, ledgerFile), JSON.stringify(ledger));
  return { record, entry, ledger, ledgerFile, receiptFile };
}

/** 生成 Implementation Package 分组中的完整确认快照。 */
function packageGroup(region, record, entry, manifest) {
  return { scene_id: region.scene_id, state_id: region.state_id, ledger_file: entry.receipt_file.replace(/-receipt\.json$/, "-ledger.json"), receipt_id: entry.receipt_id, receipt_sha256: entry.receipt_sha256, confirmation_id: record.confirmation_id, confirmation_sha256: record.confirmation_sha256, proposal_id: record.proposal_id, proposal_sha256: record.proposal_sha256, proposal_file: record.proposal_file, annotation_file: record.annotation_file, annotation_sha256: record.annotation_sha256, annotation_width: record.annotation_width, annotation_height: record.annotation_height, annotation_schema: record.annotation_schema, annotation_layout: record.annotation_layout, annotation_metadata_sha256: record.annotation_metadata_sha256, annotation_identity_sha256: record.annotation_identity_sha256, decision_record_file: record.decision_record_file, decision_record_sha256: record.decision_record_sha256, user_decision_receipt_file: record.user_decision_receipt_file, user_decision_receipt_sha256: record.user_decision_receipt_sha256, target_sha256: manifest.reference_target.target_sha256, work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: manifest.candidate_identity.sha256, regions: [{ annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: region.production_origin, production_method: region.production_method, delivery_kind: region.delivery_kind, production_label: record.production_label, component_ids: record.component_ids, state_ids: record.state_ids, asset_requirement_ids: record.asset_requirement_ids, asset_ids: record.asset_ids, confirmation_id: record.confirmation_id, confirmation_sha256: record.confirmation_sha256 }] };
}

test("拆解分析图必须由人工 accepted 确认，AUTO、pending 和旧记录拒绝", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  assert.deepEqual(validateVisualDecompositionConfirmationRecord(valid.record, region, { stage: "V3" }, valid.options), []);
  for (const overrides of [{ confirmation_mode: "auto" }, { status: "pending" }, { mode: "USER_DECISION" }, { confirmation_schema: "legacy-confirmation/1.0" }]) {
    const errors = validateVisualDecompositionConfirmationRecord({ ...valid.record, ...overrides }, region, { stage: "V3" }, valid.options);
    assert(errors.length > 0, JSON.stringify(overrides));
  }
});

test("真实确认文件门拒绝旧 proposal 复用时的语义理由变更", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  const proposalPath = join(valid.projectRoot, valid.record.proposal_file);
  const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
  proposal.decomposition_elements[0].semantic_grouping.rationale = "未重新确认的旧提案理由";
  writeFileSync(proposalPath, JSON.stringify(proposal));
  const errors = validateVisualDecompositionConfirmationRecord(valid.record, region, { stage: "V3" }, valid.options);
  assert(errors.some((message) => message.includes("SHA-256") || message.includes("语义元素")));
});

test("真实确认文件门在更新全部 SHA 后仍拒绝 PNG 缺失 decomposition_elements", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  const annotationPath = join(valid.projectRoot, valid.record.annotation_file);
  const annotation = decodePngRgba(readFileSync(annotationPath));
  delete annotation.metadata.regions[0].decomposition_elements;
  const annotationBytes = encodePngRgba(annotation.width, annotation.height, annotation.pixels, annotation.metadata);
  writeFileSync(annotationPath, annotationBytes);
  const annotationSha = `sha256:${createHash("sha256").update(annotationBytes).digest("hex")}`;
  const metadataSha = computeVisualAnnotationMetadataSha256(annotation.metadata);
  const annotationIdentity = computeVisualAnnotationIdentitySha256(annotationSha, annotation.width, annotation.height, metadataSha, annotation.metadata.schema, annotation.metadata.layout);

  const proposalPath = join(valid.projectRoot, valid.record.proposal_file);
  const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
  proposal.annotation_sha256 = annotationSha;
  const proposalBytes = Buffer.from(JSON.stringify(proposal));
  writeFileSync(proposalPath, proposalBytes);
  const proposalSha = `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`;
  const decisionPath = join(valid.projectRoot, valid.record.decision_record_file);
  const decision = JSON.parse(readFileSync(decisionPath, "utf8"));
  decision.proposal_sha256 = proposalSha;
  const decisionBytes = Buffer.from(JSON.stringify(decision));
  writeFileSync(decisionPath, decisionBytes);
  const decisionSha = `sha256:${createHash("sha256").update(decisionBytes).digest("hex")}`;
  const receiptPath = join(valid.projectRoot, valid.record.user_decision_receipt_file);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.decision_record_sha256 = decisionSha;
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  writeFileSync(receiptPath, receiptBytes);
  const receiptSha = `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`;
  Object.assign(valid.record, { annotation_sha256: annotationSha, annotation_metadata_sha256: metadataSha, annotation_identity_sha256: annotationIdentity, proposal_sha256: proposalSha, decision_record_sha256: decisionSha, user_decision_receipt_sha256: receiptSha });
  valid.record.confirmation_sha256 = computeVisualConfirmationSha256(valid.record);

  const entry = valid.ledger.entries[0];
  Object.assign(entry, { annotation_sha256: annotationSha, annotation_metadata_sha256: metadataSha, annotation_identity_sha256: annotationIdentity, proposal_sha256: proposalSha, receipt_sha256: receiptSha, decision_record_sha256: decisionSha });
  entry.entry_sha256 = canonicalSha(entry, "entry_sha256");
  valid.ledger.ledger_sha256 = canonicalSha(valid.ledger, "ledger_sha256");
  writeFileSync(join(valid.projectRoot, valid.work.visualConfirmationAuthorityRefs[0].ledger_file), JSON.stringify(valid.ledger));
  valid.work.visualConfirmationAuthorityRefs[0].receipt_sha256 = receiptSha;
  // 此用例只验证内容绑定，先冻结新的测试基线，避免被更早的 Git blob 漂移检查截断。
  valid.work.baselineHash = freezeBaseline(valid.projectRoot);
  const authority = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert.deepEqual(authority.loaderErrors ?? [], []);
  const options = { ...valid.options, ...authority, authority, allRegions: [region], authorityByRegion: buildVisualConfirmationAuthorityByRegion({ coverage_audit: { regions: [region] } }, authority) };
  const errors = validateVisualDecompositionConfirmationRecord(valid.record, region, { stage: "V3" }, options);
  assert(errors.some((message) => message.includes("annotation-meta.regions.decomposition_elements") || message.includes("语义元素")), errors.join("；"));
});

test("人工确认必须绑定当前编号、区域定义事实、原子部件/状态/资产需求", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  const manifest = { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH }, reference_target: { target_sha256: HASH, frozen_at: "2026-08-15T00:00:00Z" }, coverage_audit: { regions: [{ ...region, confirmation: valid.record }] } };
  assert.deepEqual(validateVisualDecompositionConfirmations(manifest, { stage: "V3", requireManualConfirmation: true, ...valid.options }), []);
  const shallow = { ...valid.options }; delete shallow.authorityByRegion;
  assert(validateVisualDecompositionConfirmations(manifest, { stage: "V3", requireManualConfirmation: true, ...shallow }).some((item) => item.includes("authority.sceneId")), "聚合校验缺少逐区域权威 scene/state 时必须返回 decision gap");
  const drift = structuredClone(manifest);
  drift.coverage_audit.regions[0].component_inventory.components[0].component_id = "button-2";
  assert(validateVisualDecompositionConfirmations(drift, { stage: "V4", requireManualConfirmation: true, ...valid.options }).some((item) => item.includes("component_ids")));
  const missing = structuredClone(manifest);
  missing.coverage_audit.regions[0].confirmation.component_ids = [];
  assert(validateVisualDecompositionConfirmations(missing, { stage: "V3", requireManualConfirmation: true, ...valid.options }).some((item) => item.includes("component_ids")));
});

test("Implementation Package 必须冻结全部拆解编号的同一确认身份", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  const confirmed = { ...region, confirmation: valid.record };
  const manifest = { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [confirmed] } };
  const group = { scene_id: region.scene_id, state_id: region.state_id, ledger_file: valid.work.visualConfirmationAuthorityRefs[0].ledger_file, receipt_id: valid.work.visualConfirmationAuthorityRefs[0].receipt_id, receipt_sha256: valid.work.visualConfirmationAuthorityRefs[0].receipt_sha256, confirmation_id: valid.record.confirmation_id, confirmation_sha256: valid.record.confirmation_sha256, proposal_id: valid.record.proposal_id, proposal_sha256: valid.record.proposal_sha256, proposal_file: valid.record.proposal_file, annotation_file: valid.record.annotation_file, annotation_sha256: valid.record.annotation_sha256, annotation_width: valid.record.annotation_width, annotation_height: valid.record.annotation_height, annotation_schema: valid.record.annotation_schema, annotation_layout: valid.record.annotation_layout, annotation_metadata_sha256: valid.record.annotation_metadata_sha256, annotation_identity_sha256: valid.record.annotation_identity_sha256, decision_record_file: valid.record.decision_record_file, decision_record_sha256: valid.record.decision_record_sha256, user_decision_receipt_file: valid.record.user_decision_receipt_file, user_decision_receipt_sha256: valid.record.user_decision_receipt_sha256, target_sha256: HASH, work_item_id: "work-item-1", candidate_version: "candidate-1", candidate_sha256: HASH, regions: [{ annotation_number: 2, region_id: "region-buttons", scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: region.production_origin, production_method: region.production_method, delivery_kind: region.delivery_kind, production_label: "新建图片资产", component_ids: ["button-1"], state_ids: ["default"], asset_requirement_ids: ["req-button-1"], asset_ids: [], confirmation_id: valid.record.confirmation_id, confirmation_sha256: valid.record.confirmation_sha256 }] };
  const pkg = { visualDecompositionConfirmations: [group] };
  const bindingOptions = { projectRoot: valid.options.projectRoot, checkFiles: true, authority: valid.options.authority };
  assert.deepEqual(validateVisualDecompositionConfirmationBinding(pkg, manifest, bindingOptions), []);
  const staleCandidate = structuredClone(pkg);
  staleCandidate.visualDecompositionConfirmations[0].candidate_sha256 = `sha256:${"b".repeat(64)}`;
  assert.deepEqual(validateVisualDecompositionConfirmationBinding(staleCandidate, manifest, bindingOptions), []);
  const omitted = structuredClone(pkg);
  omitted.visualDecompositionConfirmations[0].regions = [];
  assert(validateVisualDecompositionConfirmationBinding(omitted, manifest, bindingOptions).some((item) => item.includes("漏绑确认编号")));
});

test("固定视觉图片禁止 Cocos Graphics、runtime-program 和 authored-svg 替代", () => {
  for (const [production_method, delivery_kind] of [["cocos-graphics", "runtime-drawing"], ["runtime-program", "runtime-program"], ["authored-svg", "vector-image"]]) {
    const errors = validateFixedVisualProductionMethod(decompositionRegion({ production_method, delivery_kind, image_generation_required: false }), { stage: "V4" });
    assert(errors.length > 0, `${production_method} 必须拒绝`);
  }
  assert.deepEqual(validateFixedVisualProductionMethod(decompositionRegion({ production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false }), { stage: "V4" }), []);
  const svgOutput = decompositionRegion({ production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", expected_assets: [{ asset_id: "button-1", component_id: "button-1", state_id: "default", source_file: "art/button.svg", runtime_file: "public/button.svg" }] });
  assert(validateFixedVisualProductionMethod(svgOutput, { stage: "V3" }).some((item) => item.includes("PNG/JPG")));
  const programComponent = decompositionRegion({ production_method: "authored-raster", delivery_kind: "raster-image", component_inventory: { components: [{ component_id: "button-1", production_method: "cocos-graphics" }] } });
  assert(validateFixedVisualProductionMethod(programComponent, { stage: "V4" }).some((item) => item.includes("component_id=button-1")), "component 不能使用 Cocos Graphics 伪装图片");
  const programActual = decompositionRegion({ production_method: "authored-raster", delivery_kind: "raster-image", actual_assets: [{ component_id: "button-1", state_id: "default", method: "runtime-program", file: "public/button-1.png" }] });
  assert(validateFixedVisualProductionMethod(programActual, { stage: "V4" }).some((item) => item.includes("程序绘制图片")), "actual asset 不能使用 runtime-program");
  const programExpected = decompositionRegion({ production_method: "authored-raster", delivery_kind: "raster-image", expected_assets: [{ asset_id: "button-1", component_id: "button-1", state_id: "default", production_method: "cocos-graphics", delivery_kind: "runtime-drawing", source_file: "art/button-1.png", runtime_file: "public/button-1.png" }] });
  assert(validateFixedVisualProductionMethod(programExpected, { stage: "V3" }).some((item) => item.includes("程序绘制图片")), "expected asset 不能使用 Cocos Graphics");
});

test("确认文件门拒绝浅层调用、真实用户原文漂移和路径逃逸，但忽略摘要", () => {
  const region = decompositionRegion();
  const valid = confirmedFixture(region);
  assert(validateVisualDecompositionConfirmationRecord(valid.record, region, { stage: "V3" }, { targetSha: HASH, workItemId: "work-item-1", candidateVersion: "candidate-1", candidateSha: HASH }).some((item) => item.includes("decision gap") || item.includes("authority.projectRoot")));
  const arbitrary = { ...valid.record, confirmation_sha256: `sha256:${"b".repeat(64)}` };
  assert.deepEqual(validateVisualDecompositionConfirmationRecord(arbitrary, region, { stage: "V4" }, valid.options), []);
  const userDrift = { ...valid.record, user_original_text: "不同的用户决定" };
  assert(validateVisualDecompositionConfirmationRecord(userDrift, region, { stage: "V4" }, valid.options).some((item) => item.includes("user_statement")));
  const escaped = { ...valid.record, proposal_file: "../../outside.json" };
  assert(validateVisualDecompositionConfirmationRecord(escaped, region, { stage: "V4" }, valid.options).some((item) => item.includes("路径越界") || item.includes("proposal_file")));
});

test("Work Item 伪内嵌 receipt、manifest A/B 分裂和 ledger ownedPaths 必须拒绝", () => {
  assert(validateVisualConfirmationReferences({ userDecisionReceipt: { author_role: "user" } }).some((item) => item.includes("禁止内嵌")));
  assert.deepEqual(validateVisualConfirmationReferences({ visualConfirmationPrerequisiteFiles: [".workflow-control/user-resolutions/fake.json"] }), []);
  const region = decompositionRegion(); const valid = confirmedFixture(region);
  const splitManifest = { ...valid.manifest, candidateVersion: "candidate-split" };
  const split = visualConfirmationAuthority(valid.work, splitManifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert(split.loaderErrors?.some((item) => item.includes("candidate_version")), "manifest candidate 与 ledger 分裂必须失败");
  const covered = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true, implementationPackage: { visualProductionUnits: [{ ownedPaths: [valid.work.visualConfirmationAuthorityRefs[0].ledger_file] }] } });
  assert(covered.loaderErrors?.some((item) => item.includes("不得被 Implementation Package")), "ledger 被 ownedPaths 覆盖必须失败");
  const delegated = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true, delegations: [{ ownership: [valid.work.visualConfirmationAuthorityRefs[0].ledger_file] }] });
  assert(delegated.loaderErrors?.some((item) => item.includes("不得被 Implementation Package") || item.includes("委派动作覆盖")), "ledger 被 delegation 覆盖必须失败");
  const wildcardCases = [
    { implementationPackage: { executionUnits: [{ ownedPaths: ["**"] }] } },
    { implementationPackage: { visualProductionUnits: [{ outputPaths: ["**"] }] } },
    { implementationPackage: { visualProductionUnits: [{ outputPaths: { path: "**/user-resolutions/**" } }] } },
    { implementationPackage: { visualProductionUnits: [{ outputPaths: [".workflow-*/**"] }] } },
    { delegations: [{ ownership: ["**"] }] },
  ];
  for (const options of wildcardCases) {
    const blocked = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true, ...options });
    assert(blocked.loaderErrors?.some((item) => item.includes("不得被 Implementation Package") || item.includes("委派动作覆盖")), JSON.stringify(options));
  }
  const disjoint = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true, implementationPackage: { executionUnits: [{ ownedPaths: ["src/**"] }], visualProductionUnits: [{ outputPaths: [{ path: "public/**" }] }] }, delegations: [{ ownership: ["docs/**"] }] });
  assert(!disjoint.loaderErrors, disjoint.loaderErrors?.join("\n"));
});

test("ledger/receipt 按实际 JSON 结构和路径验收，不依赖 Git baseline 摘要", () => {
  const valid = confirmedFixture(decompositionRegion()); const ledgerPath = join(valid.projectRoot, valid.work.visualConfirmationPrerequisiteFiles[0]);
  writeFileSync(ledgerPath, Buffer.concat([readFileSync(ledgerPath), Buffer.from("\n")]))
  const tampered = visualConfirmationAuthority(valid.work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert.deepEqual(tampered.loaderErrors ?? [], []);
  const forged = visualConfirmationAuthority({ ...valid.work, baselineHash: HASH }, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert.deepEqual(forged.loaderErrors ?? [], []);
});

test("两个 scene/state 使用不同 ledger receipt 时可独立通过", () => {
  const valid = confirmedFixture(decompositionRegion());
  const secondScene = "result-scene"; const secondState = "victory";
  const secondReceiptFile = ".workflow-control/user-resolutions/result-receipt.json";
  const secondLedgerFile = ".workflow-control/user-resolutions/result-ledger.json";
  const secondReceipt = { ...valid.ledger.entries[0], receipt_id: "receipt-result-1", receipt_file: secondReceiptFile, scene_id: secondScene, state_id: secondState };
  delete secondReceipt.entry_sha256; delete secondReceipt.receipt_sha256;
  const secondReceiptBytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(secondReceipt).filter(([key]) => !["receipt_id", "receipt_file", "entry_sha256", "receipt_sha256", "annotation_file", "annotation_sha256", "annotation_width", "annotation_height", "annotation_schema", "annotation_layout", "annotation_metadata_sha256", "annotation_identity_sha256", "proposal_id", "proposal_file", "proposal_sha256", "decision_record_file"].includes(key)))));
  writeFileSync(join(valid.projectRoot, secondReceiptFile), secondReceiptBytes);
  secondReceipt.receipt_sha256 = `sha256:${createHash("sha256").update(secondReceiptBytes).digest("hex")}`;
  secondReceipt.entry_sha256 = canonicalSha(secondReceipt, "entry_sha256");
  const secondLedger = { ...valid.ledger, ledger_id: "ledger-result-1", ledger_sha256: HASH, entries: [secondReceipt] };
  secondLedger.ledger_sha256 = canonicalSha(secondLedger, "ledger_sha256");
  writeFileSync(join(valid.projectRoot, secondLedgerFile), JSON.stringify(secondLedger));
  const prerequisiteFiles = [...valid.work.visualConfirmationPrerequisiteFiles, secondLedgerFile, secondReceiptFile];
  const work = { ...valid.work, visualConfirmationPrerequisiteFiles: prerequisiteFiles, visualConfirmationPrerequisiteFilesSha256: prerequisiteSha(prerequisiteFiles), visualConfirmationAuthorityRefs: [...valid.work.visualConfirmationAuthorityRefs, { scene_id: secondScene, state_id: secondState, ledger_file: secondLedgerFile, receipt_id: secondReceipt.receipt_id, receipt_sha256: secondReceipt.receipt_sha256 }] };
  work.baselineHash = freezeBaseline(valid.projectRoot);
  const authority = visualConfirmationAuthority(work, valid.manifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert(!authority.loaderErrors, authority.loaderErrors?.join("\n"));
  assert.equal(Object.keys(authority.authorityByGroup).length, 2);
});

test("两个 scene/state 的完整确认与 Package 分组可通过，串组和复用必须失败", () => {
  const valid = confirmedFixture(decompositionRegion());
  const firstRegion = { ...decompositionRegion(), confirmation: valid.record };
  const secondBase = decompositionRegion({ id: "region-result", annotation_number: 7, scene_id: "result-scene", state_id: "victory", component_inventory: { components: [{ component_id: "button-1", state_coverage: [{ state_id: "victory" }] }] }, atomic_image_requirements: [{ requirement_id: "req-button-1", component_id: "button-1", state_id: "victory" }] });
  const second = appendConfirmedGroup(valid, secondBase, "result"); const secondRegion = { ...secondBase, confirmation: second.record };
  const manifest = { ...valid.manifest, coverage_audit: { regions: [firstRegion, secondRegion] } };
  const prerequisites = [...valid.work.visualConfirmationPrerequisiteFiles, second.ledgerFile, second.receiptFile];
  const work = { ...valid.work, baselineHash: freezeBaseline(valid.projectRoot), visualConfirmationPrerequisiteFiles: prerequisites, visualConfirmationPrerequisiteFilesSha256: prerequisiteSha(prerequisites), visualConfirmationAuthorityRefs: [...valid.work.visualConfirmationAuthorityRefs, { scene_id: secondBase.scene_id, state_id: secondBase.state_id, ledger_file: second.ledgerFile, receipt_id: second.entry.receipt_id, receipt_sha256: second.entry.receipt_sha256 }] };
  const authority = visualConfirmationAuthority(work, manifest, { projectRoot: valid.projectRoot, checkFiles: true });
  assert(!authority.loaderErrors, authority.loaderErrors?.join("\n"));
  const authorityByRegion = buildVisualConfirmationAuthorityByRegion(manifest, authority);
  const identityOptions = { stage: "V3", requireManualConfirmation: true, projectRoot: valid.projectRoot, checkFiles: true, targetSha: HASH, targetFrozenAt: manifest.reference_target.frozen_at, workItemId: manifest.workItemId, candidateVersion: manifest.candidateVersion, candidateSha: HASH, authority, authorityByRegion };
  assert.deepEqual(validateVisualDecompositionConfirmations(manifest, identityOptions), []);
  const pkg = { visualDecompositionConfirmations: [packageGroup(firstRegion, valid.record, valid.ledger.entries[0], manifest), packageGroup(secondRegion, second.record, second.entry, manifest)] };
  assert.deepEqual(validateVisualDecompositionConfirmationBinding(pkg, manifest, { projectRoot: valid.projectRoot, checkFiles: true, authority }), []);
  const reused = structuredClone(pkg); reused.visualDecompositionConfirmations[1].ledger_file = reused.visualDecompositionConfirmations[0].ledger_file; assert(validateVisualDecompositionConfirmationBinding(reused, manifest, { projectRoot: valid.projectRoot, checkFiles: true, authority }).some((item) => item.includes("ledger_file")));
  const crossWiredWork = { ...work, visualConfirmationAuthorityRefs: work.visualConfirmationAuthorityRefs.map((ref, index) => index ? { ...ref, ledger_file: work.visualConfirmationAuthorityRefs[0].ledger_file, receipt_id: work.visualConfirmationAuthorityRefs[0].receipt_id, receipt_sha256: work.visualConfirmationAuthorityRefs[0].receipt_sha256 } : ref) };
  const crossWiredAuthority = visualConfirmationAuthority(crossWiredWork, manifest, { projectRoot: valid.projectRoot, checkFiles: true }); assert(crossWiredAuthority.loaderErrors?.some((item) => item.includes("不得共享") || item.includes("scene/state")));
});
