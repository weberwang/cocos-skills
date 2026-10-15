import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { captureJsonIdentity, isTransactionLockStale, readJson, sameTransactionLockIdentity, transactionJournalPathForLedger, WorkflowInputError, writeJson, writeJsonTransaction } from './io.mjs';

/** 创建测试专用临时目录，并在用例结束时完整清理。 */
function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cocos-workflow-io-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** 生成与事务日志相同的文本身份。 */
function textHash(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** 创建可由 readJson 恢复的双文件事务日志。 */
function writePreparedJournal(root, entries) {
  const journalPath = join(root, '.workflow-control', 'transactions', 'approval-WI-TEST.json');
  mkdirSync(dirname(journalPath), { recursive: true });
  const journalEntries = entries.map(({ path, beforeText, afterText }) => ({
    path,
    beforeExists: true,
    beforeHash: textHash(beforeText),
    afterText,
    afterHash: textHash(afterText),
  }));
  writeFileSync(journalPath, `${JSON.stringify({ schema: 'cocos-json-transaction/1.0', state: 'PREPARED', entries: journalEntries }, null, 2)}\n`, 'utf8');
  return journalPath;
}

/** 启动独立 Node 进程，使用同一读取时快照竞争双文件事务提交。 */
function runTransactionWorker(ioModule, workPath, ledgerPath, journalPath, expectedWork, expectedLedger, approvalId) {
  const script = `
const { writeJsonTransaction } = await import(${JSON.stringify(pathToFileURL(ioModule).href)});
const [workPath, ledgerPath, journalPath, expectedWorkText, expectedLedgerText, approvalId] = process.argv.slice(1);
try {
  writeJsonTransaction([
    { path: workPath, value: { approvalRecord: approvalId }, expected: JSON.parse(expectedWorkText) },
    { path: ledgerPath, value: { approvals: [{ approvalId }] }, expected: JSON.parse(expectedLedgerText) },
  ], journalPath);
  process.stdout.write('committed');
} catch (error) {
  process.stderr.write(String(error?.message ?? error));
  process.exitCode = 2;
}`;
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, workPath, ledgerPath, journalPath, JSON.stringify(expectedWork), JSON.stringify(expectedLedger), approvalId], { encoding: 'utf8' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => resolveResult({ status: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
}

test('writeJson 使用同目录原子替换且不遗留临时文件', (t) => {
  const root = temporaryDirectory(t);
  const target = join(root, 'nested', 'state.json');

  writeJson(target, { state: 'READY' });

  assert.deepEqual(readJson(target, '状态'), { state: 'READY' });
  assert.deepEqual(readdirSync(dirname(target)).filter((name) => name.includes('.tmp-')), []);
});

test('writeJsonTransaction 同步提交 Work Item 与 Ledger 并清理日志', (t) => {
  const root = temporaryDirectory(t);
  const workPath = join(root, 'work-item.json');
  const ledgerPath = join(root, '.workflow-control', 'approvals', 'ledger.json');
  const journalPath = transactionJournalPathForLedger(ledgerPath, 'WI-TEST', workPath);
  writeJson(workPath, { approvalRecord: null });
  writeJson(ledgerPath, { approvals: [] });

  writeJsonTransaction([
    { path: workPath, value: { approvalRecord: 'APR-1' } },
    { path: ledgerPath, value: { approvals: [{ approvalId: 'APR-1' }] } },
  ], journalPath);

  assert.deepEqual(readJson(workPath, 'Work Item'), { approvalRecord: 'APR-1' });
  assert.deepEqual(readJson(ledgerPath, 'Approval Ledger'), { approvals: [{ approvalId: 'APR-1' }] });
  assert.equal(existsSync(journalPath), false);
  assert.equal(normalize(journalPath), normalize(join(root, '.workflow-control', 'transactions', 'approval-WI-TEST.json')));
});

test('readJson 发现半提交事务时补齐全部 after 内容', (t) => {
  const root = temporaryDirectory(t);
  const workPath = join(root, 'work-item.json');
  const ledgerPath = join(root, '.workflow-control', 'approvals', 'ledger.json');
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const workBefore = `${JSON.stringify({ approvalRecord: null }, null, 2)}\n`;
  const workAfter = `${JSON.stringify({ approvalRecord: 'APR-2' }, null, 2)}\n`;
  const ledgerBefore = `${JSON.stringify({ approvals: [] }, null, 2)}\n`;
  const ledgerAfter = `${JSON.stringify({ approvals: [{ approvalId: 'APR-2' }] }, null, 2)}\n`;
  writeFileSync(workPath, workAfter, 'utf8');
  writeFileSync(ledgerPath, ledgerBefore, 'utf8');
  const journalPath = writePreparedJournal(root, [
    { path: workPath, beforeText: workBefore, afterText: workAfter },
    { path: ledgerPath, beforeText: ledgerBefore, afterText: ledgerAfter },
  ]);

  assert.deepEqual(readJson(workPath, 'Work Item'), { approvalRecord: 'APR-2' });
  assert.equal(readFileSync(ledgerPath, 'utf8'), ledgerAfter);
  assert.equal(existsSync(journalPath), false);
});

test('事务恢复检测到外部漂移时拒绝覆盖未知内容', (t) => {
  const root = temporaryDirectory(t);
  const workPath = join(root, 'work-item.json');
  const ledgerPath = join(root, '.workflow-control', 'approvals', 'ledger.json');
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const workBefore = `${JSON.stringify({ approvalRecord: null }, null, 2)}\n`;
  const workAfter = `${JSON.stringify({ approvalRecord: 'APR-3' }, null, 2)}\n`;
  const ledgerBefore = `${JSON.stringify({ approvals: [] }, null, 2)}\n`;
  const ledgerAfter = `${JSON.stringify({ approvals: [{ approvalId: 'APR-3' }] }, null, 2)}\n`;
  writeFileSync(workPath, `${JSON.stringify({ approvalRecord: 'EXTERNAL' }, null, 2)}\n`, 'utf8');
  writeFileSync(ledgerPath, ledgerBefore, 'utf8');
  const journalPath = writePreparedJournal(root, [
    { path: workPath, beforeText: workBefore, afterText: workAfter },
    { path: ledgerPath, beforeText: ledgerBefore, afterText: ledgerAfter },
  ]);

  assert.throws(() => readJson(ledgerPath, 'Approval Ledger'), (error) => error instanceof WorkflowInputError && /外部修改/.test(error.message));
  assert.deepEqual(JSON.parse(readFileSync(workPath, 'utf8')), { approvalRecord: 'EXTERNAL' });
  assert.equal(existsSync(journalPath), true);
});

test('事务提交使用读取时身份 CAS，外部变化时拒绝且不留下锁', (t) => {
  const root = temporaryDirectory(t);
  const workPath = join(root, 'work-item.json');
  const ledgerPath = join(root, 'ledger.json');
  const journalPath = join(root, 'transactions', 'approval-WI-TEST.json');
  writeJson(workPath, { approvalRecord: null });
  writeJson(ledgerPath, { approvals: [] });
  const expectedWork = captureJsonIdentity(workPath);
  const expectedLedger = captureJsonIdentity(ledgerPath);
  writeJson(workPath, { approvalRecord: 'EXTERNAL' });

  assert.throws(() => writeJsonTransaction([
    { path: workPath, value: { approvalRecord: 'APR-CAS' }, expected: expectedWork },
    { path: ledgerPath, value: { approvals: [{ approvalId: 'APR-CAS' }] }, expected: expectedLedger },
  ], journalPath), (error) => error instanceof WorkflowInputError && /CAS 冲突/.test(error.message));
  assert.deepEqual(readJson(ledgerPath, 'Approval Ledger'), { approvals: [] });
  assert.deepEqual(JSON.parse(readFileSync(workPath, 'utf8')), { approvalRecord: 'EXTERNAL' });
  assert.equal(existsSync(`${journalPath}.lock`), false);
  assert.equal(existsSync(journalPath), false);
});

test('事务提交：两个独立进程竞争同一 expected 快照时一个成功一个拒绝', async (t) => {
  const root = temporaryDirectory(t);
  const workPath = join(root, 'work-item.json');
  const ledgerPath = join(root, 'ledger.json');
  const journalPath = join(root, 'transactions', 'approval-WI-RACE.json');
  writeJson(workPath, { approvalRecord: null });
  writeJson(ledgerPath, { approvals: [] });
  const expectedWork = captureJsonIdentity(workPath);
  const expectedLedger = captureJsonIdentity(ledgerPath);
  const ioModule = join(import.meta.dirname, 'io.mjs');
  const [first, second] = await Promise.all([
    runTransactionWorker(ioModule, workPath, ledgerPath, journalPath, expectedWork, expectedLedger, 'APR-RACE-1'),
    runTransactionWorker(ioModule, workPath, ledgerPath, journalPath, expectedWork, expectedLedger, 'APR-RACE-2'),
  ]);

  assert.deepEqual([first.status, second.status].sort((left, right) => left - right), [0, 2]);
  const work = readJson(workPath, 'Work Item');
  const ledger = readJson(ledgerPath, 'Approval Ledger');
  assert.equal(ledger.approvals.length, 1);
  assert.equal(work.approvalRecord, ledger.approvals[0].approvalId);
  assert.deepEqual(readdirSync(dirname(journalPath)).filter((name) => name.endsWith('.json') || name.endsWith('.lock')), []);
});

test('陈旧锁回收保护：token 或文件身份轮换后不得视为同一锁', () => {
  const original = { journalPath: 'C:/repo/transactions/approval-WI-1.json', token: 'pid-1-token', dev: 1, ino: 2, size: 128, mtimeMs: 100 };
  assert.equal(sameTransactionLockIdentity(original, { ...original }), true);
  assert.equal(sameTransactionLockIdentity(original, { ...original, token: 'pid-2-token' }), false);
  assert.equal(sameTransactionLockIdentity(original, { ...original, ino: 3 }), false);
  assert.equal(sameTransactionLockIdentity(original, { ...original, journalPath: 'C:/repo/transactions/approval-WI-2.json' }), false);
});

test('陈旧锁判断使用最终身份：初始旧 age 遇到新鲜轮换身份不可回收', () => {
  const now = 100_000;
  const initialIdentity = { mtimeMs: now - 120_000, token: 'pid-1-token' };
  const rotatedIdentity = { mtimeMs: now - 1_000, token: 'pid-2-token' };
  assert.equal(isTransactionLockStale(initialIdentity, now), true);
  assert.equal(isTransactionLockStale(rotatedIdentity, now), false);
});
