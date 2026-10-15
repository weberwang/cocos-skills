import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import test from "node:test";
import { ImageFrameSourceError, imageFrameTimeMatches, readImageFrameSource, validateImageFrameSource } from "./image-frame-source.mjs";

/** 为来源测试生成不依赖真实素材的透明合成 PNG。 */
async function createPng(width = 2, height = 2, color = [220, 60, 40, 255]) {
  return sharp({ create: { width, height, channels: 4, background: { r: color[0], g: color[1], b: color[2], alpha: color[3] / 255 } } }).png().toBuffer();
}

/** 计算来源合同使用的可复核 SHA-256 身份。 */
function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 将夹具文件写入临时项目，并返回其声明文件身份。 */
async function writeFixtureFile(root, file, bytes) {
  const absolutePath = join(root, file);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return { file, sha256: digest(bytes) };
}

/** 创建两帧或三帧的最小图片来源清单，全部字节均为本地合成数据。 */
async function createSourceFixture({ loop = false, middleFrame = false } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "image-frame-source-"));
  const sourceFrames = [];
  const count = middleFrame ? 3 : 2;
  const fps = middleFrame ? 3 : 2;
  const imageRefs = [];
  for (let index = 0; index < count + (loop ? 1 : 0); index += 1) {
    imageRefs.push(await writeFixtureFile(projectRoot, `art/${index}.png`, await createPng()));
  }

  const frameCount = count;
  for (let index = 0; index < frameCount + (loop ? 1 : 0); index += 1) {
    let kind = "endpoint";
    let parents = [];
    if (index === 0) {
      parents = [];
    } else if (loop && index === frameCount) {
      parents = [{ index: 0, ...imageRefs[0] }];
    } else if (!loop && index === frameCount - 1) {
      parents = [{ index: 0, ...imageRefs[0] }];
    } else {
      kind = "inbetween";
      parents = [{ index: 0, ...imageRefs[0] }, { index: loop ? frameCount : frameCount - 1, ...imageRefs[loop ? frameCount : frameCount - 1] }];
    }
    const frameImage = imageRefs[index];
    const record = {
      prompt: `生成第 ${index} 帧`,
      reference_images: parents.map(({ file, sha256 }) => ({ file, sha256 })),
      output_image: frameImage,
    };
    const recordRef = await writeFixtureFile(projectRoot, `records/${index}.json`, Buffer.from(`${JSON.stringify(record)}\n`, "utf8"));
    sourceFrames.push({
      index,
      game_time_ms: index * 1000 / fps,
      kind,
      parents,
      source_image: frameImage,
      image: frameImage,
      generation_record: recordRef,
    });
  }

  const source = {
    schema: "cocos-image-frame-source/1",
    canvas: { width: 2, height: 2 },
    duration_ms: 1000,
    fps,
    loop,
    frames: sourceFrames,
  };
  const manifestFile = join(projectRoot, "source.json");
  await writeFile(manifestFile, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  return { projectRoot, manifestFile, source };
}

/** 验证乱序清单仍按帧索引完成覆盖检查，并返回可供打包复用的原始字节。 */
test("接受乱序来源并返回已读取的文件字节", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  fixture.source.frames.reverse();
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");

  assert.deepEqual(validateImageFrameSource(fixture.source), []);
  const loaded = await readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot });
  assert.equal(loaded.source.frames[0].index, 1, "读取结果保留来源清单次序，调用方可按 index 排序");
  assert.equal(loaded.manifestPath, fixture.manifestFile);
  assert.equal(loaded.manifestSha256, digest(await readFile(fixture.manifestFile)));
  assert.ok(loaded.files instanceof Map);
  assert.ok(loaded.files.has("records/0.json"));
  const loadedImage = loaded.files.get("art/0.png");
  assert.ok(Buffer.isBuffer(loadedImage.bytes));
  assert.equal(loadedImage.sha256, undefined, "文件记录不把验收摘要暴露为可信身份");
  assert.equal(loadedImage.absolutePath, join(fixture.projectRoot, "art", "0.png"));
});

/** 验证非整数毫秒槽位按六位小数保存时，不会被当成时间轴漂移。 */
test("接受 3 FPS 游戏时间的六位小数序列化", async (t) => {
  const fixture = await createSourceFixture({ middleFrame: true });
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  for (const frame of fixture.source.frames) {
    frame.game_time_ms = Number(frame.game_time_ms.toFixed(6));
  }
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");

  assert.deepEqual(validateImageFrameSource(fixture.source), []);
  const loaded = await readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot });
  assert.equal(loaded.source.frames[1].game_time_ms, 333.333333);

  const shifted = structuredClone(fixture.source);
  shifted.frames[1].game_time_ms += 0.001;
  assert.match(validateImageFrameSource(shifted).join("\n"), /量化游戏时间/u);
});

/** 验证来源模块可在没有 Sharp 的项目目录中静态导入供合同工具复用。 */
test("静态导入图片来源合同不要求安装 Sharp", async (t) => {
  const isolatedDirectory = await mkdtemp(join(tmpdir(), "image-source-no-sharp-"));
  t.after(async () => rm(isolatedDirectory, { recursive: true, force: true }));
  const isolatedModule = join(isolatedDirectory, "image-frame-source.mjs");
  await copyFile(new URL("./image-frame-source.mjs", import.meta.url), isolatedModule);
  const moduleUrl = pathToFileURL(isolatedModule).href;
  const program = `import { IMAGE_FRAME_SOURCE_SCHEMA } from ${JSON.stringify(moduleUrl)}; process.stdout.write(IMAGE_FRAME_SOURCE_SCHEMA);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], { encoding: "utf8", timeout: 10_000 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "cocos-image-frame-source/1");
});

/** 验证循环来源必须保留额外闭合参考，但它不增加播放槽位。 */
test("接受 index=N 闭合参考并验证其父图身份", async (t) => {
  const fixture = await createSourceFixture({ loop: true });
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));

  assert.deepEqual(validateImageFrameSource(fixture.source), []);
  const loaded = await readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot });
  assert.equal(loaded.source.frames.length, 3);
  assert.equal(loaded.source.frames.find(({ index }) => index === 2).game_time_ms, 1000);
});

/** 验证结构接口可报告缺槽、越侧父图与循环依赖等可定位错误。 */
test("来源结构校验拒绝缺槽、越侧父图和循环依赖", async (t) => {
  const fixture = await createSourceFixture({ middleFrame: true });
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));

  const missing = structuredClone(fixture.source);
  missing.frames.pop();
  assert.match(validateImageFrameSource(missing).join("\n"), /缺少帧槽位|覆盖/u);

  const missingParent = structuredClone(fixture.source);
  missingParent.frames.find(({ index }) => index === 1).parents[1].index = 3;
  assert.match(validateImageFrameSource(missingParent).join("\n"), /父帧|父图|不存在/u);

  const sideParent = structuredClone(fixture.source);
  const middle = sideParent.frames.find(({ index }) => index === 1);
  middle.parents = [middle.parents[0], { index: 1, ...middle.image }];
  assert.match(validateImageFrameSource(sideParent).join("\n"), /位于目标两侧|父图/u);

  const cycle = structuredClone(fixture.source);
  cycle.frames.find(({ index }) => index === 0).parents = [{ index: 2, ...cycle.frames.find(({ index }) => index === 2).image }];
  assert.match(validateImageFrameSource(cycle).join("\n"), /依赖环|循环依赖/u);
});

/** 验证极大但仍属安全整数的 N 会迅速失败，不遍历不存在的槽位。 */
test("来源结构校验快速拒绝过大的槽位数", () => {
  const errors = validateImageFrameSource({
    schema: "cocos-image-frame-source/1",
    canvas: { width: 2, height: 2 },
    duration_ms: 1_000_000_000_000_000,
    fps: 1,
    loop: false,
    frames: [],
  });
  assert.match(errors.join("\n"), /100000/u);
});

/** 验证量化时长溢出时直接拒绝来源，避免无穷误差阈值放行错误时间轴。 */
test("来源拒绝量化播放时长溢出", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  fixture.source.duration_ms = 1.6e308;
  fixture.source.fps = 1e-305;
  fixture.source.frames[1].game_time_ms = 1e308;

  assert.match(validateImageFrameSource(fixture.source).join("\n"), /量化.*有限/u);
});

/** 验证比较基准无效时不会让 Infinity <= Infinity 等边界误判为时间相同。 */
test("时间比较拒绝非有限或负数基准", () => {
  for (const expected of [Number.POSITIVE_INFINITY, Number.NaN, -1e-7]) {
    assert.equal(imageFrameTimeMatches(0, expected), false);
  }
});

/** 验证生成记录内容必须含有非空提示词并绑定真实输出原图。 */
test("拒绝缺少 prompt 的生成记录", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  const frame = fixture.source.frames.find(({ index }) => index === 1);
  const record = JSON.parse(await readFile(join(fixture.projectRoot, frame.generation_record.file), "utf8"));
  record.prompt = " ";
  frame.generation_record = await writeFixtureFile(
    fixture.projectRoot,
    frame.generation_record.file,
    Buffer.from(`${JSON.stringify(record)}\n`, "utf8"),
  );
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");

  await assert.rejects(readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot }), /prompt/u);
});

/** 验证 SHA 摘要缺失、错误或陈旧不替代路径、图片解码与尺寸检查。 */
test("来源图片摘要缺失或陈旧不阻断真实文件读取", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  await writeFile(join(fixture.projectRoot, "art", "0.png"), await createPng(2, 2, [1, 2, 3, 255]));
  for (const frame of fixture.source.frames) {
    delete frame.image.sha256;
    delete frame.source_image.sha256;
    frame.generation_record.sha256 = "not-a-sha";
  }
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");
  const loaded = await readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot });
  assert.ok(loaded.files.get("art/0.png").bytes.length > 0);
});

/** 验证修图快照必须从真实原图连续连接到最终图，不能只声明两个不同端点。 */
test("拒绝断裂的修图快照链", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  const frame = fixture.source.frames[0];
  const wrongStart = await writeFixtureFile(fixture.projectRoot, "art/wrong-start.png", await createPng(2, 2, [30, 50, 70, 255]));
  const after = await writeFixtureFile(fixture.projectRoot, "art/after.png", await createPng(2, 2, [1, 2, 3, 255]));
  const recordBytes = Buffer.from(`问题：边缘残留\n方法：清理透明边缘\n${wrongStart.file} ${wrongStart.sha256}\n${after.file} ${after.sha256}\n`, "utf8");
  const repairRecord = await writeFixtureFile(fixture.projectRoot, "records/repair.md", recordBytes);
  frame.image = after;
  frame.repairs = [{ before: wrongStart, after, record: repairRecord }];
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");

  await assert.rejects(readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot }), ImageFrameSourceError);
});

/** 验证所有进入图集的最终图都严格保持来源清单声明的固定画布。 */
test("拒绝最终图片偏离固定画布", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  const drifted = await writeFixtureFile(fixture.projectRoot, "art/0.png", await createPng(3, 2));
  const frame = fixture.source.frames.find(({ index }) => index === 0);
  frame.source_image = drifted;
  frame.image = drifted;
  const record = JSON.parse(await readFile(join(fixture.projectRoot, frame.generation_record.file), "utf8"));
  record.output_image = drifted;
  frame.generation_record = await writeFixtureFile(fixture.projectRoot, frame.generation_record.file, Buffer.from(`${JSON.stringify(record)}\n`, "utf8"));
  const otherFrame = fixture.source.frames.find(({ index }) => index === 1);
  otherFrame.parents = [{ index: 0, ...drifted }];
  const otherRecord = JSON.parse(await readFile(join(fixture.projectRoot, otherFrame.generation_record.file), "utf8"));
  otherRecord.reference_images = [{ file: drifted.file, sha256: drifted.sha256 }];
  otherFrame.generation_record = await writeFixtureFile(fixture.projectRoot, otherFrame.generation_record.file, Buffer.from(`${JSON.stringify(otherRecord)}\n`, "utf8"));
  await writeFile(fixture.manifestFile, `${JSON.stringify(fixture.source, null, 2)}\n`, "utf8");

  await assert.rejects(readImageFrameSource(fixture.manifestFile, { projectRoot: fixture.projectRoot }), /画布|尺寸/u);
});

/** 验证目录跳转路径和指向项目外的 Windows junction 均无法读取来源文件。 */
test("拒绝目录逃逸与 junction 逃逸", async (t) => {
  const fixture = await createSourceFixture();
  t.after(async () => rm(fixture.projectRoot, { recursive: true, force: true }));
  const traversal = structuredClone(fixture.source);
  traversal.frames[0].image.file = "../outside.png";
  assert.match(validateImageFrameSource(traversal).join("\n"), /相对路径|目录跳转|项目目录/u);

  const outside = await mkdtemp(join(tmpdir(), "image-frame-outside-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "0.png"), await createPng());
  const junctionPath = join(fixture.projectRoot, "linked-art");
  try {
    await symlink(outside, junctionPath, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`当前运行环境不能创建 junction：${error.code}`);
      return;
    }
    throw error;
  }
  const escaped = structuredClone(fixture.source);
  const sourceFrame = escaped.frames.find(({ index }) => index === 0);
  sourceFrame.source_image.file = "linked-art/0.png";
  sourceFrame.image.file = "linked-art/0.png";
  const escapedRecord = JSON.parse(await readFile(join(fixture.projectRoot, sourceFrame.generation_record.file), "utf8"));
  escapedRecord.output_image.file = "linked-art/0.png";
  await writeFile(join(fixture.projectRoot, sourceFrame.generation_record.file), `${JSON.stringify(escapedRecord)}\n`, "utf8");
  sourceFrame.generation_record.sha256 = digest(await readFile(join(fixture.projectRoot, sourceFrame.generation_record.file)));
  const childFrame = escaped.frames.find(({ index }) => index === 1);
  childFrame.parents[0].file = "linked-art/0.png";
  const childRecord = JSON.parse(await readFile(join(fixture.projectRoot, childFrame.generation_record.file), "utf8"));
  childRecord.reference_images[0].file = "linked-art/0.png";
  await writeFile(join(fixture.projectRoot, childFrame.generation_record.file), `${JSON.stringify(childRecord)}\n`, "utf8");
  childFrame.generation_record.sha256 = digest(await readFile(join(fixture.projectRoot, childFrame.generation_record.file)));
  await writeFile(join(fixture.projectRoot, "source.json"), `${JSON.stringify(escaped, null, 2)}\n`, "utf8");

  await assert.rejects(
    readImageFrameSource(join(fixture.projectRoot, "source.json"), { projectRoot: fixture.projectRoot }),
    (error) => error instanceof ImageFrameSourceError && /symlink\/junction|逃逸/u.test(error.message),
  );
});
