import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createImageInbetweenPlan } from "./image-inbetween-plan.mjs";

/** CLI 子进程始终通过当前测试对应的脚本文件启动。 */
const scriptPath = fileURLToPath(new URL("./image-inbetween-plan.mjs", import.meta.url));

/** 验证六帧时间轴先放端点与关键帧，再按已有父帧递归补齐中点。 */
test("六帧规划覆盖全部槽位并保留可追溯的中点依赖", () => {
  const plan = createImageInbetweenPlan({ durationMs: 1000, fps: 6, keyframes: [2] });

  assert.equal(plan.schema, "cocos-image-inbetween-plan/1");
  assert.equal(plan.duration_ms, 1000);
  assert.equal(plan.fps, 6);
  assert.equal(plan.loop, false);
  assert.equal(plan.frame_count, 6);
  assert.equal(plan.playback_duration_ms, 1000);
  assert.deepEqual(plan.steps.map(({ index }) => index), [0, 5, 2, 1, 3, 4]);
  assert.deepEqual(plan.steps.slice(0, 3).map(({ kind, parents }) => ({ kind, parents })), [
    { kind: "endpoint", parents: [] },
    { kind: "endpoint", parents: [0] },
    { kind: "keyframe", parents: [0, 5] },
  ]);
  assert.deepEqual(plan.steps.slice(3).map(({ index, parents }) => ({ index, parents })), [
    { index: 1, parents: [0, 2] },
    { index: 3, parents: [2, 5] },
    { index: 4, parents: [3, 5] },
  ]);
  for (const step of plan.steps) assert.equal(step.game_time_ms, step.index * 1000 / 6);
});

/** 验证时长按最接近的帧数取整，误差保持在半帧范围内。 */
test("量化播放时长与输入时长最多相差半帧", () => {
  const plan = createImageInbetweenPlan({ durationMs: 550, fps: 5 });
  assert.equal(plan.frame_count, 3);
  assert.equal(plan.playback_duration_ms, 600);
  assert.ok(Math.abs(plan.playback_duration_ms - plan.duration_ms) <= 500 / plan.fps);
});

/** 验证循环闭合图是独立参考帧，且播放帧数与时长仍按 N 个槽位计算。 */
test("循环规划追加不进入图集的 index=N 闭合参考", () => {
  const plan = createImageInbetweenPlan({ durationMs: 1000, fps: 6, loop: true });
  const closure = plan.steps.find(({ index }) => index === 6);

  assert.equal(plan.frame_count, 6);
  assert.equal(plan.playback_duration_ms, 1000);
  assert.deepEqual(closure, {
    index: 6,
    game_time_ms: 1000,
    kind: "endpoint",
    parents: [0],
    reference_only: true,
  });
  assert.equal(plan.steps.find(({ index }) => index === 5).kind, "inbetween");
  assert.equal(plan.steps.filter(({ reference_only }) => !reference_only).length, 6);
});

/** 验证量化后不足两帧、非法帧率和越界或重复关键槽位都会被拒绝。 */
test("拒绝非法时长、帧率和关键帧槽位", () => {
  for (const input of [
    { durationMs: 0, fps: 6 },
    { durationMs: Number.NaN, fps: 6 },
    { durationMs: 1000, fps: 0 },
    { durationMs: 100, fps: 1 },
    { durationMs: 1_000_000_000_000_000, fps: 1 },
    { durationMs: 1000, fps: 6, keyframes: [0] },
    { durationMs: 1000, fps: 6, keyframes: [5] },
    { durationMs: 1000, fps: 6, keyframes: [2, 2] },
    { durationMs: 1000, fps: 6, keyframes: [2.5] },
  ]) {
    assert.throws(() => createImageInbetweenPlan(input));
  }
});

/** 验证有限输入组合仍可能令量化时长溢出，不能将 Infinity 序列化成 null 计划。 */
test("拒绝量化播放时长溢出", () => {
  assert.throws(() => createImageInbetweenPlan({ durationMs: 1.6e308, fps: 1e-305 }), /量化.*有限/u);
});

/** 验证 CLI 帮助可直接读取，且计划输出默认使用独占创建保护已有文件。 */
test("CLI 支持帮助并拒绝覆盖既有计划文件", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "image-plan-cli-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const outputPlan = join(directory, "plan.json");
  const newPlan = join(directory, "new-plan.json");
  await writeFile(outputPlan, "keep existing\n", "utf8");

  const help = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--duration-ms/u);
  assert.match(help.stdout, /--output-plan/u);

  const create = spawnSync(process.execPath, [
    scriptPath,
    "--duration-ms", "1000",
    "--fps", "6",
    "--keyframes", "2",
    "--no-loop",
    "--output-plan", newPlan,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  assert.equal(JSON.parse(await readFile(newPlan, "utf8")).schema, "cocos-image-inbetween-plan/1");

  const result = spawnSync(process.execPath, [
    scriptPath,
    "--duration-ms", "1000",
    "--fps", "6",
    "--no-loop",
    "--output-plan", outputPlan,
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /拒绝覆盖|已存在/u);
  assert.equal(await readFile(outputPlan, "utf8"), "keep existing\n");
});
