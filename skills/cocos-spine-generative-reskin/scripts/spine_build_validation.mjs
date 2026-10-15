import { join } from "node:path";
import sharp from "../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs";
import { parseAtlas } from "./spine_atlas.mjs";
import { decodeRgba, outputPageName } from "./spine_images.mjs";
import { auditSkeleton, COCOS_SPINE_RUNTIME_DEFAULT } from "./spine_skeleton.mjs";

/** 提取运行时使用的 Atlas 几何事实，忽略排版和可选追踪摘要。 */
function atlasFacts(atlas, cells = atlas.cells) {
  return {
    pages: atlas.pages.map((page) => ({ name: page.output_name ?? page.name, width: page.width, height: page.height })),
    cells: cells.map((cell) => ({ name: cell.name, page_index: cell.page_index, xy: cell.xy, size: cell.size, orig: cell.orig, offset: cell.offset, rotate_degrees: cell.rotate_degrees, index: cell.index })),
  };
}

/** 解码实际打包产物；去除摘要验收后，仍拒绝损坏文件和不满足合同的几何事实。 */
export async function validatePackedContent(document, manifestPath, resolveArtifact) {
  const errors = [];
  const build = document.build;
  let atlas;
  try {
    atlas = await parseAtlas(resolveArtifact(manifestPath, build.output_atlas));
    if (JSON.stringify(atlasFacts(atlas)) !== JSON.stringify(atlasFacts(document.atlas, document.cells))) errors.push("重建 Atlas 的 Page/Region 几何事实不符合当前合同");
  } catch (error) {
    errors.push(`重建 Atlas 内容无法解析：${error.message}`);
  }
  try {
    const audit = await auditSkeleton(resolveArtifact(manifestPath, build.output_skeleton), atlas, document.target_runtime ?? COCOS_SPINE_RUNTIME_DEFAULT);
    if (!audit.runtime_compatible || audit.stats.bone_count === 0 || audit.missing_atlas_regions.length > 0 || audit.duplicate_atlas_regions.length > 0) errors.push("重建 Skeleton 的运行版本、骨骼或 Atlas 映射不符合要求");
  } catch (error) {
    errors.push(`重建 Skeleton 内容无法解析：${error.message}`);
  }
  for (const page of document.atlas.pages ?? []) {
    const name = page.output_name ?? outputPageName(page);
    try {
      // 完整解码而非只读文件头，截断 PNG 也不能作为可用打包产物。
      const path = join(resolveArtifact(manifestPath, build.output_dir), name);
      if ((await sharp(path).metadata()).format !== "png") errors.push(`重建 Page 不是实际 PNG：${name}`);
      const image = await decodeRgba(path);
      if (image.width !== page.width || image.height !== page.height) errors.push(`重建 Page 尺寸不符合合同：${name}`);
    } catch (error) {
      errors.push(`重建 Page 内容无法解码：${name}：${error.message}`);
    }
  }
  return errors;
}
