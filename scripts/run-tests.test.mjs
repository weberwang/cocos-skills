import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildChildEnv,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  parseTimeout,
  TIMEOUT_ENV_NAME,
} from "./run-tests.mjs";

const RUNNER = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ENV_MARKER = "RUN_TESTS_ENV:";

/**
 * 创建一个只用于测试运行器的临时测试文件，并在回调结束后删除其目录。
 *
 * @param {string} source 测试文件源码
 * @param {(testFile: string, fixtureRoot: string) => void} callback 执行测试的回调
 * @returns {void} 回调结束后返回
 */
function withFixture(source, callback) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "run-tests-fixture-"));
  const testFile = join(fixtureRoot, "fixture.test.mjs");
  writeFileSync(testFile, source, "utf8");
  try {
    callback(testFile, fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

/**
 * 调用 CLI 测试运行器并捕获其输出，测试中只传入刚创建的 fixture 文件。
 *
 * @param {string} testFile 要执行的测试文件
 * @param {NodeJS.ProcessEnv} [extraEnv] 覆盖运行器环境的键值
 * @returns {import("node:child_process").SpawnSyncReturns<string>} 子进程结果
 */
function runFixture(testFile, extraEnv = {}) {
  return spawnSync(process.execPath, [RUNNER, testFile], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 30_000,
  });
}

/**
 * 从 Node 测试报告中读取 fixture 打印的临时环境信息。
 *
 * @param {string} output 运行器标准输出
 * @returns {{temp: string, tmp: string, tmpdir: string}} 三个临时目录变量
 */
function readTempEnvironment(output) {
  const line = output.split(/\r?\n/).find((item) => item.includes(ENV_MARKER));
  assert.ok(line, `测试输出缺少 ${ENV_MARKER}`);
  return JSON.parse(line.slice(line.indexOf(ENV_MARKER) + ENV_MARKER.length));
}

/**
 * 检查 fixture 记录的测试进程 PID 是否仍然存在，用于确认超时回收确实生效。
 *
 * @param {number} pid fixture 测试进程 PID
 * @returns {boolean} 进程仍存在时返回 true
 */
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

test("超时解析只接受范围内的正整数", () => {
  assert.equal(parseTimeout(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(parseTimeout("2500"), 2500);
  assert.throws(() => parseTimeout("0"), /正整数/);
  assert.throws(() => parseTimeout("-1"), /正整数/);
  assert.throws(() => parseTimeout("1.5"), /正整数/);
  assert.throws(() => parseTimeout(String(MAX_TIMEOUT_MS + 1)), /不超过/);
});

test("子进程临时环境会覆盖所有大小写形式的旧变量", () => {
  const childEnv = buildChildEnv("isolated-temp-root", {
    TEMP: "old-temp",
    Temp: "old-temp-mixed-case",
    TMP: "old-tmp",
    TMPDIR: "old-tmpdir",
    NODE_TEST_CONTEXT: "child-v8",
    KEEP_ME: "kept",
  });
  assert.equal(childEnv.TEMP, "isolated-temp-root");
  assert.equal(childEnv.TMP, "isolated-temp-root");
  assert.equal(childEnv.TMPDIR, "isolated-temp-root");
  assert.equal(childEnv.KEEP_ME, "kept");
  assert.equal("NODE_TEST_CONTEXT" in childEnv, false);
  assert.equal(Object.keys(childEnv).some((key) => /^temp$|^tmp$|^tmpdir$/i.test(key) && childEnv[key] !== "isolated-temp-root"), false);
});

test("正常测试透传退出码与输出并清理专属临时根", () => {
  withFixture(
    `import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test("正常退出", () => {
  const values = { temp: process.env.TEMP, tmp: process.env.TMP, tmpdir: process.env.TMPDIR };
  writeFileSync(join(values.temp, "normal-sentinel.txt"), "normal");
  console.log("${ENV_MARKER}" + JSON.stringify(values));
});
`,
    (testFile) => {
      const result = runFixture(testFile);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.match(result.stdout, /正常退出/);
      const values = readTempEnvironment(result.stdout);
      assert.equal(values.temp, values.tmp);
      assert.equal(values.temp, values.tmpdir);
      assert.equal(existsSync(values.temp), false);
    },
  );
});

test("失败测试透传非零退出码并清理专属临时根", () => {
  withFixture(
    `import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test("失败退出", () => {
  const values = { temp: process.env.TEMP, tmp: process.env.TMP, tmpdir: process.env.TMPDIR };
  writeFileSync(join(values.temp, "failure-sentinel.txt"), "failure");
  console.log("${ENV_MARKER}" + JSON.stringify(values));
  assert.equal("实际值", "预期值");
});
`,
    (testFile) => {
      const result = runFixture(testFile);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.notEqual(result.status, 0, JSON.stringify(result));
      assert.match(result.stdout, /失败退出/);
      const values = readTempEnvironment(result.stdout);
      assert.equal(values.temp, values.tmp);
      assert.equal(values.temp, values.tmpdir);
      assert.equal(existsSync(values.temp), false);
    },
  );
});

test("超时终止测试进程并清理专属临时根", () => {
  withFixture(
    `import { writeFileSync } from "node:fs";
import { test } from "node:test";

writeFileSync(process.env.RUN_TESTS_FIXTURE_MARKER, JSON.stringify({
  pid: process.pid,
  temp: process.env.TEMP,
  tmp: process.env.TMP,
  tmpdir: process.env.TMPDIR,
}));
// 保持活动，确保运行器只能通过超时终止这次测试进程。
setInterval(() => {}, 1000);
test("保持活动", () => {});
`,
    (testFile, fixtureRoot) => {
      const markerPath = join(fixtureRoot, "timeout-marker.json");
      const result = runFixture(testFile, {
        [TIMEOUT_ENV_NAME]: "500",
        RUN_TESTS_FIXTURE_MARKER: markerPath,
      });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.status, 124, JSON.stringify(result));
      assert.equal(existsSync(markerPath), true);
      assert.equal(existsSync(fixtureRoot), true);

      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      assert.equal(marker.temp, marker.tmp);
      assert.equal(marker.temp, marker.tmpdir);
      assert.equal(existsSync(marker.temp), false);
      assert.equal(processExists(marker.pid), false);
    },
  );
});

test("非法超时配置在创建临时根前拒绝", () => {
  withFixture(
    `import { test } from "node:test";
test("不应执行", () => { throw new Error("不应启动测试子进程"); });
`,
    (testFile) => {
      const result = runFixture(testFile, { [TIMEOUT_ENV_NAME]: "not-a-timeout" });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2);
      assert.match(result.stderr, new RegExp(TIMEOUT_ENV_NAME));
    },
  );
});
