import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { auditSkeleton, verifyUpgradeCandidate } from "./spine_skeleton.mjs";
import { ReskinError } from "./spine_atlas.mjs";
import { isMatchingCreatorSpineRuntimeEvidence } from "./spine_runtime.mjs";
import { assertCurrentBatch, acceptanceFingerprint, batchCells, candidateFingerprint, createReviewBoard, createSourceBoard, currentBatch, readBatchPlan, validateBatchPlan, validateEffectSequence } from "./spine_batch.mjs";

/**
 * 判断批次确认文本是否有效。
 *
 * 简短“确认”只在调用方已经锁定当前批次和停止审阅态后使用；
 * revision 与实际审阅文件仍由 batch accept 后续流程校验。
 */
export function isBatchConfirmationText(userText, expectedText) {
  if (typeof userText !== "string" || typeof expectedText !== "string") return false;
  const normalizedText = userText.trim();
  const normalizedExpectedText = expectedText.trim();
  if (!normalizedText || !normalizedExpectedText) return false;
  return normalizedText === "确认" || normalizedText === normalizedExpectedText;
}

/** 检查正式批次前必须冻结的视觉合同和 Skeleton 升级门。 */
export function assertProductionReady(document, options = {}) {
  const contract = document.visual_contract;
  const palette = contract?.palette ?? {};
  const colors = ["primary_armor", "secondary_structure", "dark_mechanical", "glow", "accent", "effects"];
  if (contract?.frozen !== true || colors.some((key) => typeof palette[key] !== "string" || !palette[key].trim()) || typeof contract.material_language !== "string" || !contract.material_language.trim() || typeof contract.light_direction !== "string" || !contract.light_direction.trim()) throw new ReskinError("正式批次生成前必须冻结完整 visual_contract（六项色板、材质语言、光向）");
  const upgrade = document.skeleton_upgrade;
  // 冻结视觉合同是前置设计动作，允许在外部 Skeleton 升级前完成；plan/prepare/pack 仍必须经过升级门。
  if (options.skipUpgrade !== true && document.skeleton_audit?.requires_upgrade === true && upgrade?.status !== "PASSED") throw new ReskinError("Skeleton 低于目标 Runtime，必须先通过外部升级候选和目标 Runtime 解析证据");
  if (upgrade?.status === "PASSED" && !upgrade.runtime_parse_evidence_path) throw new ReskinError("升级状态缺少结构化 Runtime 解析证据绑定");
}

/** 创建命令处理器，主进度文件只保留状态机和 CLI 解析，避免职责膨胀。 */
export function createBatchCommands(deps) {
  const { withManifestLock, readManifest, writeJsonAtomic, sha256, now, touch, resolveArtifact, relativePath, isFile, isWithin, validateCellArtifact, transition, record, assertSkeletonAuditIntegrity, assertControlBinding } = deps;

  async function commandUpgradeCheck(args) {
    if (!args.manifest || !args.candidateSkeleton) throw new ReskinError("upgrade-check 需要 --manifest 与 --candidate-skeleton");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      if (!args.runtimeEvidence) throw new ReskinError("upgrade-check 必须提供 --runtime-evidence 结构化目标 Runtime 解析证据");
      const candidatePath = resolve(args.candidateSkeleton);
      const candidateSha = await sha256(candidatePath);
      const runtimeEvidencePath = resolve(args.runtimeEvidence);
      if (!await isFile(runtimeEvidencePath)) throw new ReskinError(`Runtime 解析证据不存在：${runtimeEvidencePath}`);
      let runtimeEvidence;
      try { runtimeEvidence = JSON.parse(await readFile(runtimeEvidencePath, "utf8")); } catch (error) { throw new ReskinError(`Runtime 解析证据不是 JSON：${error.message}`); }
      const runtimeLogPath = runtimeEvidence?.log_path ? resolve(dirname(path), runtimeEvidence.log_path) : null;
      const runtimeLogSha = runtimeEvidence?.log_sha256;
      const runtimeLogValid = Boolean(runtimeLogPath && isWithin(dirname(path), runtimeLogPath) && await isFile(runtimeLogPath));
      const runtimeEvidenceValid = isMatchingCreatorSpineRuntimeEvidence(runtimeEvidence, document.target_runtime) && runtimeLogValid;
      const result = await verifyUpgradeCandidate(document.skeletons[0].path, candidatePath, { cells: document.cells, pages: document.atlas.pages }, document.target_runtime);
      const passed = result.passed && runtimeEvidenceValid;
      document.skeleton_upgrade = { status: passed ? "PASSED" : "BLOCKED", source_sha256: document.skeletons[0].sha256, target_runtime: document.target_runtime, candidate_path: candidatePath, candidate_sha256: candidateSha, before_sha256: result.before.structure_sha256, after_sha256: result.after.structure_sha256, comparison: result.comparison, runtime_parse_evidence: runtimeEvidenceValid, runtime_parse_evidence_path: relativePath(runtimeEvidencePath, dirname(path)), runtime_parse_evidence_sha256: await sha256(runtimeEvidencePath), runtime_parse_evidence_log_path: runtimeLogPath ? relativePath(runtimeLogPath, dirname(path)) : null, runtime_parse_evidence_log_sha256: runtimeLogValid ? runtimeLogSha : null, checked_at: now() };
      document.upgraded_skeleton = result.after;
      touch(document);
      await writeJsonAtomic(path, document);
      if (!passed) throw new ReskinError(`Skeleton 升级候选未通过：${result.comparison.unknown_changes.join(", ") || (runtimeEvidenceValid ? "目标 Runtime 解析失败" : "缺少真实 Runtime 解析证据")}`);
      console.log(JSON.stringify({ passed: true, before: result.before.stats, after: result.after.stats, comparison: result.comparison }, null, 2));
      return 0;
    });
  }

  async function commandFreezeContract(args) {
    if (!args.manifest || !args.contract) throw new ReskinError("freeze-contract 需要 --manifest 与 --contract");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      if (document.visual_contract?.frozen === true) throw new ReskinError("visual_contract 已冻结，不能覆盖");
      let contract;
      try { contract = JSON.parse(await readFile(resolve(args.contract), "utf8")); } catch (error) { throw new ReskinError(`无法读取 visual_contract：${error.message}`); }
      const merged = { ...document.visual_contract, ...contract, palette: { ...document.visual_contract.palette, ...(contract.palette ?? {}) }, frozen: true, frozen_at: now() };
      // 视觉合同可以先冻结；真正开始批次生产时仍由 assertProductionReady 阻断未完成的 Skeleton 升级。
      assertProductionReady({ ...document, visual_contract: merged }, { skipUpgrade: true });
      document.visual_contract = merged;
      document.character = merged.character ?? document.character;
      touch(document);
      await writeJsonAtomic(path, document);
      console.log(`visual_contract 已冻结：${path}`);
      return 0;
    });
  }

  async function commandPlanBatches(args) {
    if (!args.manifest || !args.plan) throw new ReskinError("plan-batches 需要 --manifest 与 --plan");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      await assertSkeletonAuditIntegrity(document);
      assertProductionReady(document);
      if (document.cells.some((cell) => cell.status !== "pending")) throw new ReskinError("批次计划必须在所有 Cell 仍为 pending 时导入");
      const plan = validateBatchPlan(document, await readBatchPlan(resolve(args.plan)));
      for (const batch of plan.batches) validateEffectSequence(batch);
      document.batches = plan.batches;
      document.batch_plan_sha256 = await sha256(resolve(args.plan));
      for (const batch of document.batches) for (const region of batch.regions) {
        const cell = document.cells.find((item) => `p${item.page_index}:${item.name}` === region.id);
        cell.batch_id = batch.id;
        cell.mode = region.mode;
        cell.alpha_lock = region.alpha_lock;
      }
      document.current_batch_id = document.batches[0].id;
      touch(document);
      await writeJsonAtomic(path, document);
      console.log(`已导入 ${document.batches.length} 个批次，Region 覆盖 ${document.cells.length}`);
      return 0;
    });
  }

  async function commandBatchPrepare(args) {
    if (!args.manifest || !args.batch) throw new ReskinError("batch prepare 需要 --manifest 与 --batch");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      await assertSkeletonAuditIntegrity(document);
      assertProductionReady(document);
      const batch = assertCurrentBatch(document, args.batch);
      if (!["pending", "REWORK"].includes(batch.status)) throw new ReskinError(`批次 ${batch.id} 当前状态 ${batch.status} 不能 prepare`);
      const cells = batchCells(document, batch);
      const boardDir = resolve(args.outputDir ?? join(dirname(path), "batches", batch.id));
      const board = await createSourceBoard(document, path, batch, cells, join(boardDir, `source-board-r${batch.revision}.png`), resolveArtifact);
      batch.source_board = board;
      batch.status = "PREPARED";
      batch.prepared_at = now();
      document.current_batch_id = batch.id;
      for (const cell of cells) record(document, cell, "batch_prepared", { batch_id: batch.id, revision: batch.revision });
      await writeJsonAtomic(path, document);
      console.log(`批次 ${batch.id} 已准备，源参考板：${board.path}`);
      return 0;
    });
  }

  async function commandBatchReview(args) {
    if (!args.manifest || !args.batch) throw new ReskinError("batch review 需要 --manifest 与 --batch");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      await assertSkeletonAuditIntegrity(document);
      const batch = assertCurrentBatch(document, args.batch);
      if (batch.status !== "PREPARED") throw new ReskinError(`批次 ${batch.id} 必须先为当前 revision 执行 prepare，当前为 ${batch.status}`);
      const cells = batchCells(document, batch);
      if (cells.some((cell) => cell.status !== "generated")) throw new ReskinError(`批次 ${batch.id} 必须全部 generated 才能生成审阅图`);
      const boardDir = resolve(args.outputDir ?? join(dirname(path), "batches", batch.id));
      const board = await createReviewBoard(document, path, batch, cells, join(boardDir, `review-board-r${batch.revision}.png`), resolveArtifact);
      batch.review_board = board;
      if (batch.effect_sequence) {
        if (!args.effectReport) throw new ReskinError(`连续特效批次 ${batch.id} 审阅必须提供 --effect-report`);
        const effectPath = resolve(args.effectReport);
        if (!isWithin(dirname(path), effectPath) || !await isFile(effectPath)) throw new ReskinError(`连续特效机器报告必须位于候选目录内：${effectPath}`);
        let report;
        try { report = JSON.parse(await readFile(effectPath, "utf8")); } catch (error) { throw new ReskinError(`连续特效机器报告不是 JSON：${error.message}`); }
        const expectedFingerprint = candidateFingerprint(batch, cells, board);
        if (report?.report_version !== "spine-effect-sequence/1.0" || report.batch_id !== batch.id || Number(report.revision) !== batch.revision) throw new ReskinError(`连续特效机器报告未绑定批次 ${batch.id} 当前 revision`);
        validateEffectSequence({ ...batch, effect_sequence: { ...batch.effect_sequence, report } }, true);
        batch.effect_sequence.machine_report = { path: relativePath(effectPath, dirname(path)), sha256: await sha256(effectPath), candidate_fingerprint: expectedFingerprint, report_version: report.report_version };
      }
      batch.status = "REVIEW_READY";
      batch.review_stop = true;
      batch.reviewed_at = now();
      touch(document);
      await writeJsonAtomic(path, document);
      console.log(`批次 ${batch.id} 审阅图已冻结并停止：${board.path}`);
      return 0;
    });
  }

  async function commandBatchAccept(args) {
    if (!args.manifest || !args.batch || !args.userText) throw new ReskinError("batch accept 需要 --manifest、--batch 和 --user-text");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      await assertSkeletonAuditIntegrity(document);
      const batch = assertCurrentBatch(document, args.batch);
      if (batch.status !== "REVIEW_READY" || batch.review_stop !== true) throw new ReskinError(`批次 ${batch.id} 尚未进入停止审阅态`);
      const expectedText = `${batch.revision > 0 ? "确认重启版" : "确认"}第${batch.order + 1}批`;
      if (!isBatchConfirmationText(args.userText, expectedText)) throw new ReskinError(`确认文本无效：请回复“确认”或完整确认句“${expectedText}”`);
      const cells = batchCells(document, batch);
      // 核对真实候选、审阅图和报告；返回的摘要只作追踪，用户无需提供或比较。
      const fingerprint = await acceptanceFingerprint(document, path, batch, cells, batch.review_board, sha256, resolveArtifact);
      for (const cell of cells) {
        cell.validation_evidence = [{ path: batch.review_board.path, sha256: batch.review_board.sha256 }];
        await validateCellArtifact(document, path, cell, 0);
        transition(document, cell, "validating");
      }
      batch.status = "ACCEPTED";
      batch.locked = true;
      batch.review_stop = false;
      batch.acceptance = { decision: "ACCEPTED", user_text: args.userText, review_board_sha256: batch.review_board.sha256, candidate_fingerprint: fingerprint, accepted_at: now() };
      batch.locked_at = now();
      document.current_batch_id = currentBatch(document)?.id ?? null;
      touch(document);
      await writeJsonAtomic(path, document);
      console.log(`批次 ${batch.id} 已 ACCEPTED+locked；下一批：${document.current_batch_id ?? "无"}`);
      return 0;
    });
  }

  async function commandBatchReopen(args) {
    if (!args.manifest || !args.batch) throw new ReskinError("batch reopen 需要 --manifest 与 --batch");
    const path = resolve(args.manifest);
    return withManifestLock(path, async () => {
      const document = await readManifest(path);
      await assertControlBinding(document);
      const index = document.batches.findIndex((batch) => batch.id === args.batch);
      if (index < 0) throw new ReskinError(`找不到批次：${args.batch}`);
      if (document.batches.slice(index + 1).some((batch) => batch.status !== "pending")) throw new ReskinError("已有后批开始生产，不能回退当前批次");
      const batch = document.batches[index];
      if (!["ACCEPTED", "REVIEW_READY", "PREPARED"].includes(batch.status)) throw new ReskinError(`批次 ${batch.id} 当前不能 reopen：${batch.status}`);
      for (const cell of batchCells(document, batch)) {
        if (cell.status !== "pending") transition(document, cell, "pending", "批次返工");
        cell.generated_image = null;
        cell.result_sha256 = null;
        cell.validation_evidence = [];
      }
      batch.revision += 1;
      batch.status = "REWORK";
      batch.locked = false;
      batch.acceptance = null;
      batch.source_board = null;
      batch.review_board = null;
      batch.review_stop = false;
      batch.reopened_at = now();
      document.current_batch_id = batch.id;
      touch(document);
      await writeJsonAtomic(path, document);
      console.log(`批次 ${batch.id} 已重开为 revision ${batch.revision}`);
      return 0;
    });
  }

  return { commandUpgradeCheck, commandFreezeContract, commandPlanBatches, commandBatchPrepare, commandBatchReview, commandBatchAccept, commandBatchReopen };
}
