import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { auditSkeleton } from "./spine_skeleton.mjs";
import { ReskinError } from "./spine_atlas.mjs";
import { isMatchingCreatorSpineRuntimeEvidence } from "./spine_runtime.mjs";

/** 判断路径是否位于指定目录内，防止升级日志通过相对路径逃出候选目录。 */
function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`.${process.platform === "win32" ? "\\" : "/"}`));
}

/** 创建 Skeleton 审计完整性检查器，集中维护源投影和外部 Runtime 证据硬门。 */
export function createSkeletonAuditIntegrity({ isFile }) {
  /** 重新计算源/升级候选投影，防止直接手改清单绕过生产硬门。 */
  return async function assertSkeletonAuditIntegrity(document) {
    const atlas = { cells: document.cells, pages: document.atlas.pages };
    const source = await auditSkeleton(document.skeletons[0].path, atlas, document.target_runtime);
    // 只核对实际 Runtime 能力和附件映射；SHA 复核留给最终人工验收后的处理。
    const auditFields = (value) => JSON.stringify({ runtime_compatible: value.runtime_compatible, requires_upgrade: value.requires_upgrade, stats: value.stats, atlas_region_mapping: value.atlas_region_mapping, missing_atlas_regions: value.missing_atlas_regions, unused_atlas_regions: value.unused_atlas_regions, duplicate_atlas_regions: value.duplicate_atlas_regions });
    if (auditFields(source) !== auditFields(document.skeleton_audit) || document.source_audit && auditFields(source) !== auditFields(document.source_audit)) throw new ReskinError("Skeleton Runtime 兼容性或 Atlas 映射不一致，禁止继续生产");
    if (document.skeleton_upgrade?.status !== "PASSED") return;
    const candidatePath = resolve(document.skeleton_upgrade.candidate_path);
    if (!await isFile(candidatePath)) throw new ReskinError("升级后 Skeleton 候选缺失");
    const candidate = await auditSkeleton(candidatePath, atlas, document.target_runtime);
    if (candidate.runtime_compatible !== true || candidate.missing_atlas_regions.length || candidate.unused_atlas_regions.length || candidate.duplicate_atlas_regions.length) throw new ReskinError("升级后 Skeleton Atlas 映射或目标 Runtime 不满足要求");
    const evidenceValue = document.skeleton_upgrade.runtime_parse_evidence_path;
    const evidenceRoot = resolve(document.candidate_dir ?? dirname(candidatePath));
    const evidencePath = evidenceValue ? resolve(evidenceRoot, evidenceValue) : null;
    if (!evidencePath || !await isFile(evidencePath)) throw new ReskinError("目标 Runtime 解析证据缺失");
    let evidence;
    try { evidence = JSON.parse(await readFile(evidencePath, "utf8")); } catch (error) { throw new ReskinError(`目标 Runtime 解析证据不是 JSON：${error.message}`); }
    const logPath = evidence?.log_path ? resolve(evidenceRoot, evidence.log_path) : null;
    if (!isMatchingCreatorSpineRuntimeEvidence(evidence, document.target_runtime) || !logPath || !isWithin(evidenceRoot, logPath) || !await isFile(logPath)) throw new ReskinError("目标 Runtime 解析证据未绑定实际 Creator Runtime，或实际日志缺失");
  };
}
