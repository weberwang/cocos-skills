import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ReskinError } from "./spine_atlas.mjs";

/** 递归排序控制面对象，避免 JSON.stringify 的 replacer 只排序顶层而丢失嵌套字段。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** 以递归稳定键顺序计算控制面对象指纹，绑定合同和唯一 V2 审批内容。 */
function stableHash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }

/** 解析控制面中允许的内嵌或文件型证据引用。 */
async function evidenceReference(value, basePath, label) {
  if (!value) throw new ReskinError(`控制面缺少 ${label}`);
  const pathValue = typeof value === "string" ? value : value.path ?? value.file;
  if (!pathValue) return { path: null, sha256: stableHash(value), inline: true };
  const path = isAbsolute(pathValue) ? pathValue : resolve(dirname(basePath), pathValue);
  try { if (!(await stat(path)).isFile()) throw new Error("not a file"); } catch { throw new ReskinError(`${label} 证据文件不存在：${path}`); }
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  return { path, sha256: actual, inline: false };
}

/** 从控制面 Work Item 提取最小 Spine 绑定，不写入全局 Approval Ledger。 */
export async function readSpineControlBinding(path) {
  const controlPath = resolve(path);
  let control;
  try { control = JSON.parse(await readFile(controlPath, "utf8")); } catch (error) { throw new ReskinError(`无法读取控制面 manifest：${error.message}`); }
  const workItemId = control.workItemId ?? control.work_item_id;
  const contract = control.production_contract ?? control.productionContract ?? control.production_contract_audit ?? control.productionContractAudit ?? control.sceneReconstructionContract ?? control.scene_reconstruction_contract;
  const approval = control.visual_human_approval ?? control.visualHumanApproval;
  if (typeof workItemId !== "string" || !workItemId) throw new ReskinError("控制面 manifest 必须包含 workItemId");
  if (!contract || typeof contract !== "object") throw new ReskinError("控制面 manifest 缺少 production contract");
  if (!approval || !["PASS", "passed"].includes(String(approval.status))) throw new ReskinError("控制面 manifest 缺少唯一 V2 visual_human_approval PASS");
  const contractEvidence = await evidenceReference(contract, controlPath, "production contract");
  const approvalEvidence = await evidenceReference(approval.evidence, controlPath, "V2 approval");
  const approvalSha = approval.evidence_sha256 ?? approvalEvidence.sha256;
  // 摘要只作为追踪记录；验收依赖真实证据和人工确认，不要求用户补齐或核对 SHA。
  if (!approval.evidence) throw new ReskinError("V2 approval 必须包含 evidence");
  const controlSha = createHash("sha256").update(await readFile(controlPath)).digest("hex");
  return { control_manifest_path: controlPath, control_manifest_sha256: controlSha, work_item_id: workItemId, production_contract_sha256: contractEvidence.sha256, production_contract_path: contractEvidence.path, visual_human_approval_sha256: stableHash(approval), visual_human_approval_evidence_sha256: approvalSha, visual_human_approval_evidence_path: approvalEvidence.path };
}

/** 重新读取控制面的工作项及证据路径，保持任务归属而不比较验收摘要。 */
export async function assertSpineControlBinding(document) {
  const binding = document.control_binding;
  if (!binding?.control_manifest_path) throw new ReskinError("缺少 Spine 控制面 manifest 绑定");
  const current = await readSpineControlBinding(binding.control_manifest_path);
  const fields = ["work_item_id", "production_contract_path", "visual_human_approval_evidence_path"];
  for (const field of fields) if (current[field] !== binding[field]) throw new ReskinError(`控制面绑定漂移：${field}`);
  return current;
}
