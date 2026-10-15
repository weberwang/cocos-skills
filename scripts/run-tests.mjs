import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { constants as osConstants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 测试运行器使用的默认超时时间，覆盖完整测试集的常规运行时长。 */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** setTimeout 可安全接受的最大整数，避免超大配置被 Node 静默截断。 */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** 测试运行器的超时配置环境变量。 */
export const TIMEOUT_ENV_NAME = "COCOS_TEST_TIMEOUT_MS";

/** 超时终止时使用的约定退出码。 */
export const TIMEOUT_EXIT_CODE = 124;

/** 向 Unix 进程组发送 TERM 后，等待其自行退出的宽限时间。 */
export const TERMINATION_GRACE_MS = 1000;

/** Unix 进程组收到 KILL 后用于确认后代退出的最长等待时间。 */
export const PROCESS_GROUP_SETTLE_MS = 1000;

/** 强制终止后等待直接测试进程退出的最长时间。 */
export const FORCED_EXIT_WAIT_MS = 2000;

/** 等待 taskkill 命令本身完成的最长时间。 */
export const TERMINATION_COMMAND_TIMEOUT_MS = 2000;

const TEMP_ENV_NAMES = new Set(["temp", "tmp", "tmpdir"]);
const NODE_TEST_CONTEXT_ENV = "node_test_context";
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM"];

/**
 * 将环境变量中的超时文本解析成可用于定时器的正整数。
 *
 * 只接受毫秒整数，拒绝零、负数、小数和超出 Node 定时器范围的值，
 * 避免配置错误导致测试立即超时或被 Node 转换成不可预期的短延迟。
 *
 * @param {string|number|undefined} value 待读取的超时值
 * @param {number} fallback 未提供值时使用的默认值
 * @returns {number} 经过校验的毫秒数
 * @throws {Error} 配置格式或范围不合法时抛出带错误码的异常
 */
export function parseTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  if (value === undefined) return fallback;

  const text = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    const error = new Error(`${TIMEOUT_ENV_NAME} 必须是正整数毫秒数`);
    error.code = "ERR_TEST_RUNNER_CONFIG";
    throw error;
  }

  const timeoutMs = Number(text);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
    const error = new Error(`${TIMEOUT_ENV_NAME} 必须不超过 ${MAX_TIMEOUT_MS} 毫秒`);
    error.code = "ERR_TEST_RUNNER_CONFIG";
    throw error;
  }
  return timeoutMs;
}

/**
 * 为本次测试构造隔离环境，清除大小写不同的旧临时目录键后统一覆盖三种约定。
 * 同时移除 Node 测试 worker 的上下文标记，避免从测试文件嵌套调用运行器时被 Node
 * 误判为递归 test runner 而跳过 fixture。
 *
 * @param {string} tempRoot 本次运行专属临时根目录
 * @param {NodeJS.ProcessEnv} baseEnv 基础环境变量
 * @returns {NodeJS.ProcessEnv} 供子进程继承的环境变量
 */
export function buildChildEnv(tempRoot, baseEnv = process.env) {
  if (typeof tempRoot !== "string" || tempRoot.length === 0) {
    throw new TypeError("测试临时根目录必须是非空字符串");
  }

  const childEnv = { ...baseEnv };
  for (const key of Object.keys(childEnv)) {
    if (TEMP_ENV_NAMES.has(key.toLowerCase())) delete childEnv[key];
    if (key.toLowerCase() === NODE_TEST_CONTEXT_ENV) delete childEnv[key];
  }

  childEnv.TEMP = tempRoot;
  childEnv.TMP = tempRoot;
  childEnv.TMPDIR = tempRoot;
  return childEnv;
}

/**
 * 将子进程的退出状态转换为运行器最终退出码，同时保留正常测试返回的原始数值。
 *
 * @param {{code: number|null, signal: string|null, error?: Error|null}} result 子进程结果
 * @param {{kind?: string, signal?: string}|null} termination 主动终止原因
 * @returns {number} 运行器退出码
 */
export function getExitCode(result, termination = null) {
  if (termination?.kind === "timeout") return TIMEOUT_EXIT_CODE;
  if (termination?.kind === "signal") {
    const signalNumber = osConstants.signals?.[termination.signal] ?? 1;
    return 128 + signalNumber;
  }
  if (Number.isInteger(result?.code)) return result.code;
  if (result?.signal) {
    const signalNumber = osConstants.signals?.[result.signal] ?? 1;
    return 128 + signalNumber;
  }
  return 1;
}

/**
 * 观察子进程的 close 事件，确保标准输出关闭且退出状态已经可读取。
 *
 * @param {import("node:child_process").ChildProcess} child 测试子进程
 * @returns {Promise<{code: number|null, signal: string|null, error: Error|null}>} 子进程结果
 */
function waitForChild(child) {
  return new Promise((resolveResult) => {
    let spawnError = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };

    child.once("error", (error) => {
      spawnError = error;
      // spawn 失败时没有 close 事件可等待，立即结束观察；已有 PID 时仍等待 close。
      if (child.pid == null) finish({ code: null, signal: null, error });
    });
    child.once("close", (code, signal) => finish({ code, signal, error: spawnError }));
  });
}

/**
 * 为进程退出等待增加上限，避免终止工具失效时运行器永久挂起。
 *
 * @param {Promise<unknown>} promise 待等待的退出 Promise
 * @param {number} timeoutMs 最长等待时间
 * @param {string} description 超时错误中的上下文
 * @returns {Promise<unknown>} 原 Promise 的结果
 * @throws {Error} 等待超过上限时抛出带错误码的异常
 */
function waitForPromiseWithin(promise, timeoutMs, description) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      const error = new Error(`${description}超过 ${timeoutMs} 毫秒仍未完成`);
      error.code = "ERR_TEST_PROCESS_TERMINATION_TIMEOUT";
      rejectPromise(error);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

/**
 * 等待一小段时间，让被终止的进程释放句柄后再进行目录删除或二次检查。
 *
 * @param {number} milliseconds 等待毫秒数
 * @returns {Promise<void>} 延迟完成的 Promise
 */
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * 在 Unix 上检查由 detached 子进程创建的进程组是否仍存在。
 *
 * @param {number} pid 进程组组长 PID
 * @returns {boolean} 进程组仍可访问时返回 true
 */
function unixProcessGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

/**
 * 在有限时间内等待 Unix 进程组消失，避免孙进程仍持有临时目录时提前清理。
 *
 * @param {number} pid 进程组组长 PID
 * @param {number} timeoutMs 最长等待时间
 * @returns {Promise<void>} 进程组消失或达到等待上限后结束
 */
async function waitForUnixProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (unixProcessGroupExists(pid) && Date.now() < deadline) {
    await delay(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return !unixProcessGroupExists(pid);
}

/**
 * 创建带 PID 和阶段信息的终止失败错误，便于调用方区分资源未确认回收。
 *
 * @param {number|string} pid 当前运行器创建的进程或进程组 PID
 * @param {string} phase 失败发生的阶段
 * @param {Error} [cause] 底层错误
 * @returns {Error} 带稳定错误码的终止错误
 */
function createTerminationError(pid, phase, cause) {
  const error = new Error(`测试进程树终止失败：PID ${pid} 在${phase}后仍未确认退出`);
  error.code = "ERR_TEST_PROCESS_TERMINATION_TIMEOUT";
  if (cause) error.cause = cause;
  return error;
}

/**
 * 向 Windows 进程树执行 taskkill，并等待 taskkill 自身完成。
 *
 * 只使用已记录的测试子进程 PID，不扫描系统进程，避免误终止用户已有服务。
 *
 * @param {number} pid 测试子进程 PID
 * @returns {Promise<{ok: boolean, error: Error|null}>} taskkill 的执行结果
 */
async function killWindowsProcessTree(pid) {
  const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const resultPromise = waitForChild(killer);
  try {
    const result = await waitForPromiseWithin(resultPromise, TERMINATION_COMMAND_TIMEOUT_MS, "taskkill 命令");
    return {
      ok: result.error == null && result.signal == null && result.code === 0,
      error: result.error ?? null,
    };
  } catch (error) {
    // 终止命令也是本运行器创建的子进程，命令自身卡住时只回收这个 PID。
    if (killer.exitCode == null && killer.signalCode == null) killer.kill();
    return { ok: false, error };
  }
}

/**
 * 只终止本运行器创建的测试进程树，并等待直接子进程完全退出。
 *
 * Windows 使用 taskkill 的 /T 树级终止；Unix 使用 detached 进程组，先 TERM、
 * 再在宽限期后 KILL。PID 来自当前 spawn，绝不通过名称或全局扫描寻找进程。
 *
 * @param {import("node:child_process").ChildProcess} child 测试子进程
 * @param {Promise<{code: number|null, signal: string|null, error: Error|null}>} childExitPromise 子进程退出观察
 * @param {{platform?: string, graceMs?: number}} options 测试选项
 * @returns {Promise<void>} 终止和退出等待完成
 */
export async function terminateOwnedProcessTree(child, childExitPromise, {
  platform = process.platform,
  graceMs = TERMINATION_GRACE_MS,
} = {}) {
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    try {
      await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, "无有效 PID 的测试子进程退出等待");
    } catch (error) {
      throw createTerminationError(pid ?? "unknown", "无有效 PID 的测试进程退出等待", error);
    }
    return;
  }
  // close 前后存在事件循环竞态；已退出的直接子进程不再触碰其可能复用的 PID。
  if (child.exitCode != null || child.signalCode != null) {
    await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, `测试子进程 PID ${pid} 退出等待`);
    return;
  }

  if (platform === "win32") {
    const firstKillResult = await killWindowsProcessTree(pid);
    try {
      await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, `Windows taskkill（PID ${pid}）`);
    } catch (firstWaitError) {
      // 首次 taskkill 失败或未生效时，仅针对同一个已记录 PID 再执行一次树级强杀。
      const secondKillResult = await killWindowsProcessTree(pid);
      try {
        await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, `Windows taskkill 二次收尾（PID ${pid}）`);
      } catch (secondWaitError) {
        throw createTerminationError(pid, "两次 taskkill", secondWaitError ?? secondKillResult.error ?? firstKillResult.error ?? firstWaitError);
      }
    }
    return;
  }

  let firstSignalError = null;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") firstSignalError = error;
  }

  let exitedDuringGrace = false;
  try {
    await waitForPromiseWithin(childExitPromise, graceMs, `Unix TERM（PID ${pid}）`);
    exitedDuringGrace = true;
  } catch (error) {
    if (error?.code !== "ERR_TEST_PROCESS_TERMINATION_TIMEOUT") throw error;
  }

  let firstKillError = null;
  if (!exitedDuringGrace || unixProcessGroupExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") firstKillError = error;
    }
  }

  try {
    await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, `Unix KILL（PID ${pid}）`);
  } catch (firstWaitError) {
    let secondKillError = null;
    // KILL 未生效时再次只针对本次 detached 进程组发信号，然后进行第二段有界等待。
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") secondKillError = error;
    }
    try {
      await waitForPromiseWithin(childExitPromise, FORCED_EXIT_WAIT_MS, `Unix KILL 二次收尾（PID ${pid}）`);
    } catch (secondWaitError) {
      throw createTerminationError(pid, "两次 Unix KILL", secondWaitError ?? firstWaitError ?? secondKillError ?? firstKillError ?? firstSignalError);
    }
  }

  // 子进程可能先退出而其孙进程仍留在组内，终止后再检查一次进程组。
  let firstGroupKillError = null;
  if (unixProcessGroupExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") firstGroupKillError = error;
    }
  }
  if (!(await waitForUnixProcessGroupExit(pid, PROCESS_GROUP_SETTLE_MS))) {
    // 进程组仍存在时再次发送同一组 KILL，并在第二段等待后明确失败。
    let secondGroupKillError = null;
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") secondGroupKillError = error;
    }
    if (!(await waitForUnixProcessGroupExit(pid, PROCESS_GROUP_SETTLE_MS))) {
      throw createTerminationError(pid, "两次 Unix 进程组 KILL", secondGroupKillError ?? firstGroupKillError);
    }
  }
}

/**
 * 递归删除本次运行创建的临时根目录，保留项目路径下的测试证据文件。
 *
 * @param {string} tempRoot 本次运行专属临时根目录
 * @returns {Promise<void>} 删除完成后结束
 */
export async function cleanupTempRoot(tempRoot) {
  await rm(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

/**
 * 启动一次隔离的 Node.js 测试运行，并在所有退出路径执行资源回收。
 *
 * @param {string[]} args 透传给 `node --test` 的文件和选项
 * @param {{timeoutMs?: number}} options 运行器可选配置
 * @returns {Promise<number>} 测试退出码或运行器错误码
 */
export async function runTests(args = process.argv.slice(2), { timeoutMs } = {}) {
  const configuredTimeout = parseTimeout(timeoutMs ?? process.env[TIMEOUT_ENV_NAME]);
  const tempRoot = await mkdtemp(join(tmpdir(), "cocos-test-run-"));
  let child = null;
  let childExitPromise = null;
  let termination = null;
  let terminationPromise = null;
  let timer = null;
  let exitCode = 1;
  let childStarted = false;
  let childExited = true;
  let processTreeConfirmed = true;
  let resolveTerminationRequest;
  const terminationRequest = new Promise((resolveRequest) => {
    resolveTerminationRequest = resolveRequest;
  });

  const requestTermination = (reason) => {
    if (terminationPromise) return terminationPromise;
    termination = reason;
    processTreeConfirmed = false;
    terminationPromise = terminateOwnedProcessTree(child, childExitPromise);
    resolveTerminationRequest(terminationPromise);
    return terminationPromise;
  };

  const signalHandlers = new Map();
  try {
    child = spawn(process.execPath, ["--test", ...args], {
      cwd: process.cwd(),
      env: buildChildEnv(tempRoot),
      stdio: "inherit",
      // Unix 进程组只包含本次 spawn 及其后代，便于精确回收。
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    childStarted = true;
    childExited = false;
    childExitPromise = waitForChild(child).then((result) => {
      childExited = true;
      return result;
    });

    for (const signal of TERMINATION_SIGNALS) {
      const handler = () => {
        if (!terminationPromise) void requestTermination({ kind: "signal", signal });
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    timer = setTimeout(() => {
      if (!terminationPromise) void requestTermination({ kind: "timeout" });
    }, configuredTimeout);

    // 终止请求发生后优先等待有界终止流程，避免直接等待永不退出的子进程。
    const result = await Promise.race([
      childExitPromise,
      terminationRequest.then(() => childExitPromise),
    ]);
    if (terminationPromise) {
      await terminationPromise;
      processTreeConfirmed = true;
    }
    exitCode = getExitCode(result, termination);
    return exitCode;
  } finally {
    if (timer) clearTimeout(timer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    if ((!childStarted || childExited) && processTreeConfirmed) {
      try {
        await cleanupTempRoot(tempRoot);
      } catch (error) {
        // 测试失败时保留原退出码；成功但清理失败则返回运行器错误，避免假报成功。
        console.error(`测试临时目录清理失败：${error.message}`);
        if (!termination && exitCode === 0) return 1;
      }
    } else {
      // 无法确认子进程退出时保留目录，避免活跃子进程继续写入已删除的路径。
      console.error(`测试进程仍未确认退出，临时目录保留：${tempRoot}`);
    }
  }
}

/**
 * CLI 入口，将配置错误与运行时错误转换成稳定的进程退出码。
 *
 * @param {string[]} args 命令行参数
 * @returns {Promise<number>} CLI 退出码
 */
export async function main(args = process.argv.slice(2)) {
  try {
    return await runTests(args);
  } catch (error) {
    console.error(`测试运行器失败：${error.message}`);
    return error?.code === "ERR_TEST_RUNNER_CONFIG" ? 2 : 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === currentFile) {
  process.exitCode = await main();
}
