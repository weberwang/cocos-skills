import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

/** 控制面输入错误；由 CLI 统一转换为稳定的拒绝结果。 */
export class WorkflowInputError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'WorkflowInputError';
    this.code = code;
  }
}

/** 将命令行解析为支持重复选项的键值对象。 */
export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h') {
      result.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    if (result[key] === undefined) result[key] = value;
    else result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
  }
  return result;
}

/** 将单值或重复参数统一为去空格的字符串数组。 */
export function list(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 读取 JSON 并把语法或文件错误转换为控制面输入错误。 */
export function readJson(path, label) {
  return readJsonWithIdentity(path, label).value;
}

/** 读取 JSON 及其同一次读取对应的字节身份，供事务提交执行严格 CAS。 */
export function readJsonWithIdentity(path, label) {
  if (!path || path === true) throw new WorkflowInputError(`缺少 ${label} 路径`);
  try {
    const target = resolve(String(path));
    recoverPendingJsonTransactions(target);
    const text = readFileSync(target, 'utf8');
    return { value: JSON.parse(text), identity: { path: target, exists: true, hash: transactionHash(text) } };
  } catch (error) {
    throw new WorkflowInputError(`无法读取 ${label}：${error.message}`);
  }
}

/** 捕获单个事务目标的当前字节身份；不存在的目标也会明确记录为 exists=false。 */
export function captureJsonIdentity(path) {
  const target = resolve(String(path));
  recoverPendingJsonTransactions(target);
  const exists = existsSync(target);
  const text = exists ? readFileSync(target, 'utf8') : null;
  return { path: target, exists, hash: text === null ? null : transactionHash(text) };
}

/**
 * 以同目录临时文件+原子 rename 写入文本。
 * 临时文件和目标文件必须在同一目录，避免跨卷 rename 退化为复制并留下半写文件。
 */
export function writeTextAtomically(path, text) {
  const target = resolve(String(path));
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx');
    writeFileSync(descriptor, String(text), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* 清理阶段不覆盖原始错误。 */ }
    }
    try { unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw new WorkflowInputError(`原子写入失败：${error.message}`);
  }
}

/** 写入稳定格式 JSON，并确保控制目录存在。 */
export function writeJson(path, value) {
  writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 根据 Approval Ledger 路径生成事务日志路径。
 * 标准 .workflow-control/approvals/ledger.json 保持既有 transactions 位置；
 * 显式账本与 Work Item 分离时，日志放在两者最近公共目录的 transactions，
 * 这样 readJson 从任一目标恢复时都能沿祖先目录发现同一日志。
 */
export function transactionJournalPathForLedger(ledgerPath, workItemId, workItemPath = null) {
  const ledger = resolve(String(ledgerPath));
  const ledgerDirectory = dirname(ledger);
  const standardLedger = basename(ledgerDirectory).toLowerCase() === 'approvals'
    && basename(dirname(ledgerDirectory)).toLowerCase() === '.workflow-control';
  const controlDirectory = standardLedger ? dirname(ledgerDirectory) : ledgerDirectory;
  const workDirectory = workItemPath ? dirname(resolve(String(workItemPath))) : null;
  let transactionRoot = join(controlDirectory, 'transactions');
  if (workDirectory && !standardLedger) {
    const commonDirectory = nearestCommonDirectory(controlDirectory, workDirectory);
    if (commonDirectory) transactionRoot = join(commonDirectory, 'transactions');
  }
  const safeWorkItemId = String(workItemId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(transactionRoot, `approval-${safeWorkItemId}.json`);
}

/** 计算两个目标目录最近的公共祖先；跨盘符时返回 null，避免猜测共享路径。 */
function nearestCommonDirectory(first, second) {
  const visited = new Set();
  let current = resolve(first);
  while (true) {
    visited.add(process.platform === 'win32' ? current.toLowerCase() : current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  current = resolve(second);
  while (true) {
    const key = process.platform === 'win32' ? current.toLowerCase() : current;
    if (visited.has(key)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** 返回 JSON 文本哈希；事务恢复用它区分自身中断与他人并发修改。 */
function transactionHash(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

const TRANSACTION_LOCK_STALE_MS = 60_000;

/** 事务日志使用同名 .lock，确保并发审批只竞争自身 Work Item 的提交槽位。 */
function transactionLockPath(journalPath) {
  return `${resolve(String(journalPath))}.lock`;
}

/** 读取锁文件年龄；锁消失时返回 null，让获取者重新尝试而不是删除未知文件。 */
function transactionLockAge(lockPath) {
  try { return Date.now() - statSync(lockPath).mtimeMs; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** 读取锁内容与文件身份，陈旧回收必须同时校验 token 和 inode，避免误删轮换后的锁。 */
function readTransactionLockIdentity(lockPath) {
  try {
    const stats = statSync(lockPath);
    const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!payload.journalPath || !payload.token) return null;
    return { journalPath: payload.journalPath, token: payload.token, dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

/** 判断两次锁观测是否仍指向同一个具体锁文件；身份变化时调用方必须放弃删除。 */
export function sameTransactionLockIdentity(left, right) {
  return Boolean(left && right)
    && left.journalPath === right.journalPath
    && left.token === right.token
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

/** 只依据传入身份判断陈旧性，避免使用较早的 stat 年龄误回收刚轮换的新锁。 */
export function isTransactionLockStale(identity, now = Date.now(), staleMs = TRANSACTION_LOCK_STALE_MS) {
  return Number.isFinite(identity?.mtimeMs) && now - identity.mtimeMs > staleMs;
}

/** 获取事务日志的跨进程排他锁，并只回收超过上限的同一锁文件。 */
function acquireTransactionLock(journalPath) {
  const normalizedJournal = resolve(String(journalPath));
  const lockPath = transactionLockPath(normalizedJournal);
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let descriptor = null;
    let created = false;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      descriptor = openSync(lockPath, 'wx');
      created = true;
      const payload = `${JSON.stringify({ schema: 'cocos-transaction-lock/1.0', journalPath: normalizedJournal, pid: process.pid, token, createdAt: new Date().toISOString() })}\n`;
      writeFileSync(descriptor, payload, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      return { lockPath, token, journalPath: normalizedJournal };
    } catch (error) {
      if (descriptor !== null) {
        try { closeSync(descriptor); } catch { /* 锁清理阶段不覆盖原始错误。 */ }
      }
      if (created) {
        try { unlinkSync(lockPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
        throw new WorkflowInputError(`事务锁创建失败：${error.message}`);
      }
      if (error.code !== 'EEXIST') throw new WorkflowInputError(`事务锁创建失败：${error.message}`);
      const age = transactionLockAge(lockPath);
      if (age === null) continue;
      if (age <= TRANSACTION_LOCK_STALE_MS) throw new WorkflowInputError(`JSON 事务并发冲突：事务锁已被占用（${normalizedJournal}）`);
      const staleIdentity = readTransactionLockIdentity(lockPath);
      if (!staleIdentity) throw new WorkflowInputError(`JSON 事务并发冲突：陈旧事务锁身份不可确认（${normalizedJournal}）`);
      // 初始 age 与身份读取并非同一时刻；最终身份新鲜时必须立即拒绝，不能沿用旧 age 删除新锁。
      if (!isTransactionLockStale(staleIdentity)) throw new WorkflowInputError(`JSON 事务并发冲突：事务锁已被轮换（${normalizedJournal}）`);
      // stat 判旧后重新读取 token/inode；锁被其他进程轮换时只重试，绝不删除新锁。
      const confirmedIdentity = readTransactionLockIdentity(lockPath);
      if (!sameTransactionLockIdentity(staleIdentity, confirmedIdentity)) continue;
      if (!isTransactionLockStale(confirmedIdentity)) throw new WorkflowInputError(`JSON 事务并发冲突：事务锁已被轮换（${normalizedJournal}）`);
      const finalIdentity = readTransactionLockIdentity(lockPath);
      if (!sameTransactionLockIdentity(staleIdentity, finalIdentity)) continue;
      if (!isTransactionLockStale(finalIdentity)) throw new WorkflowInputError(`JSON 事务并发冲突：事务锁已被轮换（${normalizedJournal}）`);
      // 只删除精确的、身份未变化且已超过生命周期的锁；下次循环用 wx 重新建立排他锁。
      try { unlinkSync(lockPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    }
  }
  throw new WorkflowInputError(`JSON 事务并发冲突：无法获取事务锁（${resolve(String(journalPath))}）`);
}

/** 仅由持有相同 token 的进程释放锁，避免超时回收后误删新事务的锁。 */
function releaseTransactionLock(lock) {
  if (!lock?.lockPath) return;
  const firstIdentity = readTransactionLockIdentity(lock.lockPath);
  if (!firstIdentity || firstIdentity.journalPath !== lock.journalPath || firstIdentity.token !== lock.token) return;
  const secondIdentity = readTransactionLockIdentity(lock.lockPath);
  if (!sameTransactionLockIdentity(firstIdentity, secondIdentity) || secondIdentity.journalPath !== lock.journalPath || secondIdentity.token !== lock.token) return;
  // 删除前再做一次完整身份确认，轮换期间宁可遗留可回收锁，也不能误删新持有者的锁。
  const finalIdentity = readTransactionLockIdentity(lock.lockPath);
  if (!sameTransactionLockIdentity(secondIdentity, finalIdentity) || finalIdentity.journalPath !== lock.journalPath || finalIdentity.token !== lock.token) return;
  try { unlinkSync(lock.lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** 读取控制目录中的事务日志，恢复包含指定目标的未完成 JSON 事务。 */
function recoverPendingJsonTransactions(target) {
  const normalizedTarget = resolve(target);
  let current = dirname(normalizedTarget);
  while (current) {
    const roots = [
      resolve(current, '.workflow-control', 'transactions'),
      resolve(current, 'transactions'),
    ];
    for (const transactionRoot of roots) {
      if (!existsSync(transactionRoot)) continue;
      for (const name of readdirSync(transactionRoot).filter((item) => item.endsWith('.json')).sort()) {
        const journalPath = resolve(transactionRoot, name);
        let journal;
        try { journal = JSON.parse(readFileSync(journalPath, 'utf8')); } catch (error) {
          throw new WorkflowInputError(`工作流事务日志损坏：${journalPath}：${error.message}`);
        }
        if (!Array.isArray(journal.entries) || !journal.entries.some((entry) => resolve(entry.path) === normalizedTarget)) continue;
        const lock = acquireTransactionLock(journalPath);
        try {
          // 获取锁后重新读取日志，防止扫描目录期间另一进程已完成或替换同一事务。
          if (!existsSync(journalPath)) continue;
          const currentJournal = JSON.parse(readFileSync(journalPath, 'utf8'));
          if (!Array.isArray(currentJournal.entries) || !currentJournal.entries.some((entry) => resolve(entry.path) === normalizedTarget)) continue;
          recoverJsonTransaction(journalPath, currentJournal);
        } finally {
          releaseTransactionLock(lock);
        }
      }
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
}

/** 读取事务目标当前身份；恢复只允许 before 或 after 两种已知内容。 */
function readTransactionState(entry, target) {
  const exists = existsSync(target);
  const text = exists ? readFileSync(target, 'utf8') : null;
  const hash = exists ? transactionHash(text) : null;
  return {
    exists,
    hash,
    isBefore: entry.beforeExists ? exists && hash === entry.beforeHash : !exists,
    isAfter: exists && hash === entry.afterHash,
  };
}

/** 应用事务日志中的 after 内容；检测外部漂移后拒绝覆盖，保持共享工作区安全。 */
function recoverJsonTransaction(journalPath, journal) {
  if (!Array.isArray(journal.entries) || journal.entries.length < 2) throw new WorkflowInputError(`工作流事务日志缺少有效 entries：${journalPath}`);
  const states = journal.entries.map((entry) => {
    const target = resolve(entry.path);
    const state = readTransactionState(entry, target);
    if (!state.isBefore && !state.isAfter) {
      throw new WorkflowInputError(`工作流事务恢复检测到文件已被外部修改：${target}`);
    }
    return { entry, target };
  });
  // 先一次性确认所有目标仍处于 before/after 状态，再写入缺失的 after，避免漂移检查中途留下半提交。
  for (const { entry, target } of states) {
    // 预检和实际写入之间可能有其他进程改动，写前再次核对，禁止覆盖未知内容。
    const state = readTransactionState(entry, target);
    if (!state.isBefore && !state.isAfter) throw new WorkflowInputError(`工作流事务恢复检测到文件已被外部修改：${target}`);
    if (state.isAfter) continue;
    writeTextAtomically(target, entry.afterText);
  }
  // 最后再次确认全部目标确实落在 after 身份；若写入期间发生外部漂移，保留日志并拒绝把半提交当成成功。
  for (const { entry, target } of states) {
    const state = readTransactionState(entry, target);
    if (!state.isAfter) {
      if (!state.isBefore) throw new WorkflowInputError(`工作流事务恢复检测到文件已被外部修改：${target}`);
      throw new WorkflowInputError(`工作流事务恢复未完成：${target}`);
    }
  }
  try { unlinkSync(journalPath); } catch (error) {
    // after 内容已经完整落盘时，日志清理失败不应让调用方重试并重复写入；下次读取会再次安全清理。
    if (error.code !== 'ENOENT') return { completed: true, cleanupError: error };
  }
  return { completed: true };
}

/**
 * 对多个 JSON 文件执行带锁、带 CAS 且可恢复的提交。
 * expected 由调用方在读取目标时捕获；缺省时仅为底层测试/工具保留锁内快照行为。
 */
export function writeJsonTransaction(entries, journalPath) {
  if (!Array.isArray(entries) || entries.length < 2) throw new WorkflowInputError('JSON 事务至少需要两个目标文件');
  const transactionFile = resolve(String(journalPath));
  const lock = acquireTransactionLock(transactionFile);
  try {
    if (existsSync(transactionFile)) throw new WorkflowInputError(`JSON 事务日志已存在，拒绝覆盖未完成事务：${transactionFile}`);
    const normalizedEntries = entries.map((entry) => {
      const target = resolve(String(entry.path));
      const expected = entry.expected ?? captureJsonIdentity(target);
      if (expected.path && resolve(String(expected.path)) !== target) throw new WorkflowInputError(`JSON 事务 expected 路径不一致：${target}`);
      const beforeExists = expected.exists === true;
      const beforeHash = beforeExists ? expected.hash : null;
      if (beforeExists && !beforeHash) throw new WorkflowInputError(`JSON 事务缺少目标文件身份：${target}`);
      const afterText = `${JSON.stringify(entry.value, null, 2)}\n`;
      return { path: target, beforeExists, beforeHash, afterText, afterHash: transactionHash(afterText) };
    });
    if (new Set(normalizedEntries.map((entry) => entry.path)).size !== normalizedEntries.length) throw new WorkflowInputError('JSON 事务目标文件不得重复');
    // 锁内再次验证全部 before 身份，确保审批读取后的旧快照不能覆盖并发提交的新快照。
    for (const entry of normalizedEntries) {
      const current = readTransactionState(entry, entry.path);
      if (!current.isBefore) throw new WorkflowInputError(`JSON 事务 CAS 冲突：目标已发生变化（${entry.path}）`);
    }
    const journal = { schema: 'cocos-json-transaction/1.0', state: 'PREPARED', createdAt: new Date().toISOString(), entries: normalizedEntries };
    writeTextAtomically(transactionFile, `${JSON.stringify(journal, null, 2)}\n`);
    try {
      for (let index = 0; index < normalizedEntries.length; index += 1) {
        const entry = normalizedEntries[index];
        // 每次原子替换前再次校验 before，避免锁外工具或异常恢复悄悄改变目标。
        const current = readTransactionState(entry, entry.path);
        if (current.isAfter) continue;
        if (!current.isBefore) throw new WorkflowInputError(`JSON 事务提交检测到文件已被外部修改：${entry.path}`);
        writeTextAtomically(entry.path, entry.afterText);
        journal.state = index === normalizedEntries.length - 1 ? 'COMMITTED' : `WRITTEN_${index + 1}`;
        writeTextAtomically(transactionFile, `${JSON.stringify(journal, null, 2)}\n`);
      }
      unlinkSync(transactionFile);
    } catch (error) {
      try {
        // 恢复成功表示所有 after 已落盘，不应让调用方重试并重复追加审批。
        recoverJsonTransaction(transactionFile, journal);
        return;
      } catch (recoveryError) {
        throw new WorkflowInputError(`JSON 事务提交失败且恢复失败：${error.message}；${recoveryError.message}`);
      }
    }
  } finally {
    releaseTransactionLock(lock);
  }
}

/** 校验对象必填字段，避免每个控制命令重复实现相同边界。 */
export function requireFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkflowInputError(`${label} 必须为对象`);
  const missing = fields.filter((field) => value[field] === undefined);
  if (missing.length) throw new WorkflowInputError(`${label} 缺少字段：${missing.join('、')}`);
}

/** 校验字符串数组。 */
export function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new WorkflowInputError(`${label} 必须为字符串数组`);
}

/** 校验 SHA-256 标识格式。 */
export function requireHash(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) throw new WorkflowInputError(`${label} 必须为 sha256:<64 位小写十六进制>`);
}

/** 基线使用不可变 Git commit/tree 或 SHA-256 文件身份。 */
export function requireBaselineHash(value, label) {
  if (!/^(?:sha256:[a-f0-9]{64}|[a-f0-9]{40}(?:[a-f0-9]{24})?)$/.test(value ?? '')) throw new WorkflowInputError(`${label} 必须为 sha256 文件身份或完整 Git commit/tree 对象 ID`);
}
