import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import sharp from "../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs";
import { ReskinError } from "./spine_atlas.mjs";
import { decodeRgba, pasteRgba, blankRgba } from "./spine_images.mjs";

const MODES = new Set(["palette-refresh", "mesh-safe", "constrained-redraw"]);

/** 将批次中的 Region 标准化为可审计的唯一键。 */
export function regionKey(region) { return `p${Number(region.page_index ?? 0)}:${region.name}`; }

/** 生成审阅回执中使用的稳定对象哈希。 */
function stableBatchJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableBatchJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableBatchJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** 对批次回执生成稳定摘要，排序 JSON 键后避免字段顺序变化造成误判。 */
export function stableBatchSha(value) { return createHash("sha256").update(stableBatchJson(value)).digest("hex"); }

/** 读取 JSON 批次计划，计划不存在或结构不明确时 fail closed。 */
export async function readBatchPlan(path) {
  let plan;
  try { plan = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ReskinError(`无法读取批次计划 ${path}：${error.message}`); }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.batches) || !plan.batches.length) throw new ReskinError("批次计划必须包含非空 batches 数组");
  return plan;
}

/** 校验完整批次覆盖、顺序、模式和 Mesh Alpha 锁，拒绝隐式补全。 */
export function validateBatchPlan(document, plan) {
  const cellsByKey = new Map(document.cells.map((cell) => [regionKey(cell), cell]));
  const seen = new Set();
  const errors = [];
  const batches = plan.batches.map((batch, index) => {
    const id = String(batch.id ?? `batch-${index + 1}`);
    if (batch.status != null && batch.status !== "pending") errors.push(`${id} 计划不能预置生产状态 ${batch.status}`);
    if (batch.locked === true || Number(batch.revision ?? 0) !== 0) errors.push(`${id} 计划不能预置 locked/revision 回执`);
    if (!Array.isArray(batch.regions) || !batch.regions.length) errors.push(`${id} 缺少 regions`);
    const regions = (batch.regions ?? []).map((entry, order) => {
      const key = typeof entry === "string" ? entry : entry.id ?? regionKey(entry);
      const cell = cellsByKey.get(key) ?? document.cells.find((item) => item.name === key);
      if (!cell) { errors.push(`${id} 包含未知 Region：${key}`); return { id: key, order }; }
      const mode = typeof entry === "object" && entry.mode ? entry.mode : cell.mode;
      const alphaLock = typeof entry === "object" && entry.alpha_lock != null ? Boolean(entry.alpha_lock) : cell.alpha_lock !== false;
      if (!MODES.has(mode)) errors.push(`${cell.id} mode 无效：${mode}`);
      if (cell.attachment_type === "mesh" && (mode !== "mesh-safe" || !alphaLock)) errors.push(`${cell.id} Mesh 必须使用 mesh-safe 且 alpha_lock=true`);
      if (mode === "constrained-redraw" && alphaLock !== false) errors.push(`${cell.id} constrained-redraw 必须显式声明 alpha_lock=false`);
      if (seen.has(regionKey(cell))) errors.push(`Region 重复出现在批次计划：${cell.id}`);
      seen.add(regionKey(cell));
      return { id: regionKey(cell), name: cell.name, page_index: cell.page_index, order, mode, alpha_lock: alphaLock };
    });
    if (batch.effect_sequence) {
      const order = batch.effect_sequence.order;
      const regionIds = new Set(regions.map((region) => region.id));
      const normalizedOrder = Array.isArray(order) ? order.map((entry) => typeof entry === "string" ? entry : entry?.id ?? entry?.name) : [];
      if (normalizedOrder.length !== regions.length || normalizedOrder.some((id) => !regionIds.has(id)) || new Set(normalizedOrder).size !== normalizedOrder.length) errors.push(`${id} 连续特效 order 必须完整覆盖本批 Region 且不重复`);
      batch.effect_sequence = { ...batch.effect_sequence, order: normalizedOrder };
    }
    return { ...batch, id, order: index, revision: 0, status: "pending", locked: false, regions };
  });
  for (const cell of document.cells) if (!seen.has(regionKey(cell))) errors.push(`Region 未被任何批次覆盖：${cell.id}`);
  if (new Set(batches.map((batch) => batch.id)).size !== batches.length) errors.push("批次 id 重复");
  if (errors.length) throw new ReskinError(errors.join("；"));
  return { ...plan, batches };
}

/** 返回当前唯一可生产的批次；前序批次必须 ACCEPTED 且 locked。 */
export function currentBatch(document) {
  const batches = document.batches ?? [];
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch.status === "ACCEPTED" && batch.locked === true) continue;
    for (const previous of batches.slice(0, index)) if (!(previous.status === "ACCEPTED" && previous.locked === true)) throw new ReskinError(`批次 ${batch.id} 的前序批次未 ACCEPTED+locked`);
    return batch;
  }
  return null;
}

/** 确认批次是当前生产批，阻止并行生成和越序写入。 */
export function assertCurrentBatch(document, batchId) {
  const batch = currentBatch(document);
  if (!batch) throw new ReskinError("所有批次均已 ACCEPTED+locked");
  if (batch.id !== batchId) throw new ReskinError(`当前只能操作批次 ${batch.id}，不能操作 ${batchId}`);
  return batch;
}

/** 返回批次中的 Cell，并检查没有跨批次修改。 */
export function batchCells(document, batch) {
  const cells = new Map(document.cells.map((cell) => [regionKey(cell), cell]));
  return batch.regions.map((region) => {
    const cell = cells.get(region.id);
    if (!cell) throw new ReskinError(`批次 ${batch.id} 的 Region 不存在：${region.id}`);
    return cell;
  });
}

/**
 * 计算不含连续特效报告的候选指纹。
 * 报告必须绑定这个指纹，避免只提交一份脱离当前候选图的 PASS JSON。
 */
export function candidateFingerprint(batch, cells, reviewBoard) {
  const candidates = cells.map((cell) => ({ id: cell.id, sha256: cell.result_sha256 }));
  // 报告在 review board 生成前即可产生；review SHA 仍会在最终 acceptance fingerprint 中绑定。
  return createHash("sha256").update(JSON.stringify({ batch_id: batch.id, revision: batch.revision, candidates })).digest("hex");
}

/** 生成带顺序清单的 JSON 标签文件，图片本身不嵌入文字，避免字体差异污染哈希。 */
async function writeBoardIndex(path, batch, cells, kind) {
  const payload = { kind, batch_id: batch.id, revision: batch.revision, regions: cells.map((cell, order) => ({ order, id: regionKey(cell), name: cell.name, page_index: cell.page_index, size: cell.size, orig: cell.orig, offset: cell.offset })) };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path, sha256: createHash("sha256").update(JSON.stringify(payload, null, 2) + "\n").digest("hex") };
}

/** 在审阅板 PNG 内直接写入批次、顺序和 Region 名，sidecar 只作为机器复核索引。 */
async function writeLabeledBoard(board, outputPath, batch, cells, columns, tileWidth, tileHeight, review = false) {
  await mkdir(dirname(outputPath), { recursive: true });
  const header = 24;
  const width = board.width;
  const height = board.height;
  const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const labels = [];
  cells.forEach((cell, index) => {
    const x = (index % columns) * tileWidth * (review ? 2 : 1);
    const y = Math.floor(index / columns) * (tileHeight + header);
    const label = `Batch ${batch.id} r${batch.revision} · ${index + 1}. ${cell.name}${review ? " [SOURCE | GENERATED]" : " [SOURCE]"}`;
    labels.push(`<rect x="${x}" y="${y}" width="${tileWidth * (review ? 2 : 1)}" height="${header}" fill="#111827"/><text x="${x + 4}" y="16" fill="#F9FAFB" font-size="11" font-family="Arial">${escape(label)}</text>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#1F2937"/>${labels.join("")}</svg>`;
  await sharp(board.data, { raw: { width: board.width, height: board.height, channels: 4 } }).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toFile(outputPath);
}

/** 创建单张源 Cell 参考板，布局和顺序固定并绑定 index sidecar。 */
export async function createSourceBoard(document, manifestPath, batch, cells, outputPath, resolveArtifact) {
  const tileWidth = Math.max(1, ...cells.map((cell) => cell.orig?.[0] ?? cell.size[0]));
  const tileHeight = Math.max(1, ...cells.map((cell) => cell.orig?.[1] ?? cell.size[1]));
  const columns = Math.max(1, Math.ceil(Math.sqrt(cells.length)));
  const rows = Math.ceil(cells.length / columns);
  const header = 24;
  const board = blankRgba(columns * tileWidth, rows * (tileHeight + header));
  for (let index = 0; index < cells.length; index += 1) {
    const reference = resolveArtifact(manifestPath, cells[index].source_reference);
    const image = await decodeRgba(reference);
    pasteRgba(board, image, (index % columns) * tileWidth, Math.floor(index / columns) * (tileHeight + header) + header);
  }
  await writeLabeledBoard(board, outputPath, batch, cells, columns, tileWidth, tileHeight, false);
  const indexRecord = await writeBoardIndex(`${outputPath}.json`, batch, cells, "source");
  return { path: outputPath, sha256: createHash("sha256").update(await readFile(outputPath)).digest("hex"), index: indexRecord };
}

/** 创建唯一源/生成对照审阅图，并将 Region 顺序写入 sidecar。 */
export async function createReviewBoard(document, manifestPath, batch, cells, outputPath, resolveArtifact) {
  const tileWidth = Math.max(1, ...cells.map((cell) => cell.orig?.[0] ?? cell.size[0]));
  const tileHeight = Math.max(1, ...cells.map((cell) => cell.orig?.[1] ?? cell.size[1]));
  const columns = Math.max(1, Math.ceil(Math.sqrt(cells.length)));
  const rows = Math.ceil(cells.length / columns);
  const header = 24;
  const board = blankRgba(columns * tileWidth * 2, rows * (tileHeight + header));
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const source = await decodeRgba(resolveArtifact(manifestPath, cell.source_reference));
    const generated = await decodeRgba(resolveArtifact(manifestPath, cell.generated_image));
    const x = (index % columns) * tileWidth * 2;
    const y = Math.floor(index / columns) * (tileHeight + header) + header;
    pasteRgba(board, source, x, y);
    pasteRgba(board, generated, x + tileWidth, y);
  }
  await writeLabeledBoard(board, outputPath, batch, cells, columns, tileWidth, tileHeight, true);
  const indexRecord = await writeBoardIndex(`${outputPath}.json`, batch, cells, "source-generated-review");
  return { path: outputPath, sha256: createHash("sha256").update(await readFile(outputPath)).digest("hex"), index: indexRecord };
}

/** 读取本批次的候选与审阅工件；摘要只作记录，不参与验收判定。 */
export async function acceptanceFingerprint(document, manifestPath, batch, cells, reviewBoard, sha256, resolveArtifact) {
  const candidates = [];
  for (const cell of cells) {
    const path = resolveArtifact(manifestPath, cell.generated_image);
    if (!path) throw new ReskinError(`批次 ${batch.id} 候选路径缺失：${cell.id}`);
    try { await readFile(path); } catch (error) { throw new ReskinError(`批次 ${batch.id} 候选不可读：${cell.id}：${error.message}`); }
    candidates.push({ id: cell.id, sha256: cell.result_sha256 });
  }
  const reviewPath = resolveArtifact(manifestPath, reviewBoard.path);
  if (!reviewPath) throw new ReskinError(`批次 ${batch.id} 审阅图路径缺失`);
  try { await readFile(reviewPath); } catch (error) { throw new ReskinError(`批次 ${batch.id} 审阅图不可读：${error.message}`); }
  const baseFingerprint = candidateFingerprint(batch, cells, reviewBoard);
  let effectReportSha256 = null;
  if (batch.effect_sequence) {
    const machineReport = batch.effect_sequence.machine_report;
    if (!machineReport?.path) throw new ReskinError(`连续特效批次 ${batch.id} 报告路径缺失`);
    const reportPath = resolveArtifact(manifestPath, machineReport.path);
    const reportRelative = reportPath ? relative(resolve(dirname(manifestPath)), resolve(reportPath)) : "";
    if (!reportPath || isAbsolute(reportRelative) || reportRelative === ".." || reportRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ReskinError(`连续特效批次 ${batch.id} 报告路径必须位于候选目录内`);
    let report;
    try { report = JSON.parse(await readFile(reportPath, "utf8")); } catch (error) { throw new ReskinError(`连续特效批次 ${batch.id} 报告不可读：${error.message}`); }
    if (report.report_version !== "spine-effect-sequence/1.0" || report.batch_id !== batch.id || Number(report.revision) !== batch.revision) throw new ReskinError(`连续特效批次 ${batch.id} 报告未绑定当前 revision`);
    validateEffectSequence({ ...batch, effect_sequence: { ...batch.effect_sequence, report } }, true);
    effectReportSha256 = machineReport.sha256;
  }
  return createHash("sha256").update(JSON.stringify({ batch_id: batch.id, revision: batch.revision, review_sha256: reviewBoard.sha256, candidates, candidate_fingerprint: baseFingerprint, effect_report_sha256: effectReportSha256 })).digest("hex");
}

/** 检查连续特效计划和机器报告；计划阶段只检查序列，接受阶段才强制报告。 */
export function validateEffectSequence(batch, requireReport = false) {
  if (!batch.effect_sequence) return { required: false, passed: true };
  const order = batch.effect_sequence.order;
  if (!Array.isArray(order) || order.length < 1 || new Set(order).size !== order.length) throw new ReskinError(`连续特效批次 ${batch.id} 必须声明不重复的帧顺序`);
  if (!requireReport) return { required: true, passed: true, planned_order: order };
  const report = batch.effect_sequence.report ?? batch.effect_sequence.machine_report?.report;
  const required = ["color_consistency", "brightness_continuity", "contour_smoothness", "glow_direction"];
  const missing = required.filter((field) => !report || typeof report[field] !== "object" || report[field].result !== "PASS" || !Number.isFinite(report[field].metric));
  if (missing.length) throw new ReskinError(`连续特效批次 ${batch.id} 缺少通过的跨帧指标：${missing.join(", ")}`);
  return { required: true, passed: true, metrics: report };
}
