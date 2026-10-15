#!/usr/bin/env node
import { open, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 图片递归补帧规划的稳定输出 schema。 */
const PLAN_SCHEMA = "cocos-image-inbetween-plan/1";
/** 限制本地规划的最大槽位数，避免异常 CLI 输入触发超大数组与递归工作量。 */
const MAX_FRAME_COUNT = 100_000;

/** 校验配置输入为不含数组的普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 规范正有限数字，阻止 NaN、无穷值和隐式字符串进入时间计算。 */
function positiveFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} 必须是大于 0 的有限数字`);
  }
  return value;
}

/** 将量化后帧槽位换算为从动画起点开始的游戏时间。 */
function timeForFrame(index, fps) {
  return index * 1000 / fps;
}

/**
 * 根据动画时长、帧率和关键帧槽位，生成可逐步执行的中间帧依赖计划。
 * 循环动画把 index=N 作为闭合参考端点，保留闭合时间但排除在播放帧数外。
 */
export function createImageInbetweenPlan(input = {}) {
  if (!isObject(input)) throw new TypeError("图片补帧配置必须是对象");
  const { durationMs, fps, loop = false, keyframes = [] } = input;
  positiveFiniteNumber(durationMs, "durationMs");
  positiveFiniteNumber(fps, "fps");
  if (typeof loop !== "boolean") throw new TypeError("loop 必须是布尔值");
  if (!Array.isArray(keyframes)) throw new TypeError("keyframes 必须是帧索引数组");

  const exactFrameCount = durationMs * fps / 1000;
  const frameCount = Math.round(exactFrameCount);
  if (!Number.isSafeInteger(frameCount) || frameCount < 2 || frameCount > MAX_FRAME_COUNT) {
    throw new RangeError(`量化后的帧数必须位于 2..${MAX_FRAME_COUNT}`);
  }
  const playbackDurationMs = timeForFrame(frameCount, fps);
  // 输入各自有限仍可能在量化除法中溢出，不能把 Infinity 写成 JSON null。
  if (!Number.isFinite(playbackDurationMs)) throw new RangeError("量化播放时长必须是有限数字");
  const halfFrameMs = 500 / fps;
  if (Math.abs(playbackDurationMs - durationMs) > halfFrameMs + Number.EPSILON * Math.max(durationMs, playbackDurationMs)) {
    throw new RangeError("时长量化误差不得超过半帧");
  }

  const tailIndex = loop ? frameCount : frameCount - 1;
  const normalizedKeyframes = [];
  const seen = new Set();
  for (const index of keyframes) {
    const lastPlayableKeyframe = loop ? frameCount - 1 : frameCount - 2;
    if (!Number.isSafeInteger(index) || index < 1 || index > lastPlayableKeyframe) {
      throw new RangeError(`关键帧索引必须位于 1..${lastPlayableKeyframe} 的播放槽位中`);
    }
    if (seen.has(index)) throw new RangeError(`关键帧索引重复：${index}`);
    seen.add(index);
    normalizedKeyframes.push(index);
  }
  normalizedKeyframes.sort((first, second) => first - second);

  const steps = [];
  /** 以统一字段布局追加一步，避免端点、关键帧和中点偏离公开结构。 */
  const addStep = (index, kind, parents, referenceOnly = false) => {
    steps.push({
      index,
      game_time_ms: timeForFrame(index, fps),
      kind,
      parents,
      reference_only: referenceOnly,
    });
  };

  // 首尾端点优先制作；循环尾端只用于观察闭合，不占图集播放槽位。
  addStep(0, "endpoint", []);
  addStep(tailIndex, "endpoint", [0], loop);

  // 阶段关键帧使用已经确定的首尾快照，避免关键帧之间形成隐式顺序依赖。
  for (const index of normalizedKeyframes) addStep(index, "keyframe", [0, tailIndex]);

  // 每轮只细分当前已知相邻锚点区间，确保父帧在计划顺序中先于子帧。
  let intervals = [];
  const anchors = [0, ...normalizedKeyframes, tailIndex];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    intervals.push([anchors[index], anchors[index + 1]]);
  }
  while (intervals.length > 0) {
    const nextIntervals = [];
    for (const [left, right] of intervals) {
      if (right - left <= 1) continue;
      const middle = Math.floor((left + right) / 2);
      addStep(middle, "inbetween", [left, right]);
      nextIntervals.push([left, middle], [middle, right]);
    }
    intervals = nextIntervals;
  }

  return {
    schema: PLAN_SCHEMA,
    duration_ms: durationMs,
    fps,
    loop,
    frame_count: frameCount,
    playback_duration_ms: playbackDurationMs,
    steps,
  };
}

/** 解析独立规划 CLI 参数，并拒绝不完整或互相冲突的选项。 */
export function parseImageInbetweenPlanArgs(argv) {
  const values = new Map();
  let loopFlag;
  let help = false;
  const valueFlags = new Set(["--duration-ms", "--fps", "--keyframes", "--output-plan"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (flag === "--loop" || flag === "--no-loop") {
      if (loopFlag !== undefined) throw new TypeError("--loop 与 --no-loop 只能指定一个");
      loopFlag = flag === "--loop";
      continue;
    }
    if (!valueFlags.has(flag)) throw new TypeError(`未知参数：${flag}`);
    if (values.has(flag)) throw new TypeError(`参数不能重复：${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError(`${flag} 缺少参数值`);
    values.set(flag, value);
    index += 1;
  }
  if (help) return { help: true };

  for (const flag of ["--duration-ms", "--fps", "--output-plan"]) {
    if (!values.has(flag)) throw new TypeError(`必须提供 ${flag}`);
  }
  /** 将 CLI 数字选项解析为有限数值，保留字段级错误名。 */
  const numberFrom = (flag) => {
    const value = values.get(flag);
    if (value.trim() === "") throw new TypeError(`${flag} 必须是数字`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new TypeError(`${flag} 必须是有限数字`);
    return parsed;
  };
  let keyframes = [];
  if (values.has("--keyframes")) {
    const raw = values.get("--keyframes");
    if (raw.trim() === "") throw new TypeError("--keyframes 不能为空");
    keyframes = raw.split(",").map((part) => {
      if (!/^\d+$/u.test(part.trim())) throw new TypeError("--keyframes 必须是逗号分隔的非负整数");
      return Number(part.trim());
    });
  }
  const outputPlan = values.get("--output-plan");
  if (outputPlan.trim() === "") throw new TypeError("--output-plan 必须是非空路径");
  return {
    help: false,
    outputPlan: resolve(outputPlan),
    options: {
      durationMs: numberFrom("--duration-ms"),
      fps: numberFrom("--fps"),
      loop: loopFlag ?? false,
      keyframes,
    },
  };
}

/** 返回中文 CLI 帮助，展示循环参考语义及无覆盖写入约定。 */
export function imageInbetweenPlanHelp() {
  return `用法：node image-inbetween-plan.mjs --duration-ms <毫秒> --fps <帧率> --output-plan <plan.json> [选项]

选项：
  --keyframes <索引,...>   指定优先制作的关键帧槽位
  --loop                   增加 index=N 的闭合参考帧（不进入图集）
  --no-loop                明确使用非循环动画
  --help                   显示此说明

输出计划采用 ${PLAN_SCHEMA}；已有输出文件会被拒绝覆盖。`;
}

/** 以独占创建方式写入计划，避免静默覆盖已有设计决策。 */
async function writePlanWithoutOverwrite(outputPath, contents) {
  await mkdir(dirname(outputPath), { recursive: true });
  let handle;
  let created = false;
  try {
    handle = await open(outputPath, "wx");
    created = true;
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    if (created) await rm(outputPath, { force: true }).catch(() => {});
    if (error?.code === "EEXIST") throw new Error(`输出计划已存在，拒绝覆盖：${outputPath}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

/** 执行 CLI 并将输入错误转换为简洁中文诊断。 */
async function runCli(argv) {
  try {
    const parsed = parseImageInbetweenPlanArgs(argv);
    if (parsed.help) {
      process.stdout.write(`${imageInbetweenPlanHelp()}\n`);
      return;
    }
    const plan = createImageInbetweenPlan(parsed.options);
    await writePlanWithoutOverwrite(parsed.outputPlan, `${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write(`已写入计划：${parsed.outputPlan}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli(process.argv.slice(2));
}
