import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { parseAtlas } from "./spine_atlas.mjs";
import { validatePackedContent } from "./spine_build_validation.mjs";

/** 建立实际打包文件，不以已有摘要或 PASS 文本代替文件内容。 */
async function packedFixture() {
  const root = await mkdtemp(join(tmpdir(), "spine-packed-content-"));
  const atlasPath = join(root, "packed.atlas");
  await writeFile(atlasPath, "page.png\nsize: 2, 2\nformat: RGBA8888\nbody\nxy: 0, 0\nsize: 2, 2\n");
  await writeFile(join(root, "skeleton.json"), JSON.stringify({ skeleton: { spine: "3.8.98" }, bones: [{ name: "root" }], slots: [{ name: "slot", bone: "root" }], skins: { default: { slot: { body: { type: "region", path: "body" } } } }, animations: { Idle: {} } }));
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(join(root, "page.png"));
  const parsed = await parseAtlas(atlasPath);
  return { root, document: { target_runtime: "3.8", atlas: { pages: parsed.pages }, cells: parsed.cells, build: { output_atlas: "packed.atlas", output_skeleton: "skeleton.json", output_dir: ".", atlas_sha256: 17, skeleton_sha256: "stale", page_sha256: null } } };
}

/** 解析清单内产物路径，与正式入口使用相同的相对路径规则。 */
function resolveArtifact(manifestPath, path) { return resolve(dirname(manifestPath), path); }

test("打包文件按实际内容验收，摘要缺失或错误不影响结果", async () => {
  const { root, document } = await packedFixture();
  try {
    const manifestPath = join(root, "progress.json");
    assert.deepEqual(await validatePackedContent(document, manifestPath, resolveArtifact), []);
    delete document.build.atlas_sha256;
    delete document.build.skeleton_sha256;
    delete document.build.page_sha256;
    assert.deepEqual(await validatePackedContent(document, manifestPath, resolveArtifact), []);
    for (const [file, expected] of [["packed.atlas", /Atlas 内容无法解析/], ["skeleton.json", /Skeleton 内容无法解析/], ["page.png", /Page 内容无法解码/]]) {
      const path = join(root, file);
      const original = await readFile(path);
      await writeFile(path, "");
      assert.ok((await validatePackedContent(document, manifestPath, resolveArtifact)).some((message) => expected.test(message)), file);
      await writeFile(path, original);
    }
    await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toFile(join(root, "page.png"));
    assert.ok((await validatePackedContent(document, manifestPath, resolveArtifact)).some((message) => /Page 尺寸不符合合同/.test(message)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
