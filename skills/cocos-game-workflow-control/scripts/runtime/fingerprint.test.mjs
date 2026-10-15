import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { computePlanFingerprint } from './fingerprint.mjs';

/** 构造不含业务副作用的最小计划输入。 */
function makeInput(repo, timestamp) {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'input.js'), 'input');
  return {
    work: {
      workItemId: 'WI-1', projectId: 'P-1', moduleIds: ['core'], domain: 'code', stageId: 'G1', globalState: 'REVIEW',
      baselineId: 'a'.repeat(40), baselineVersion: '1', baselineHash: `sha256:${'b'.repeat(64)}`,
      objective: '实现功能', inScope: ['core'], userOriginalText: '实现功能',
      allowedPaths: ['src'], changeRequestFiles: [],
    },
    implementationPackage: { packageId: 'PKG-1', candidate: 'candidate-1', format: 'png', generatedAt: timestamp, recorded_at: timestamp },
    repo, extraPaths: ['src/input.js'],
  };
}

/** 验证时间戳不参与指纹，普通业务字段仍参与计划身份。 */
test('计划指纹区分业务身份并排除时间字段', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-plan-fingerprint-'));
  const first = computePlanFingerprint(makeInput(repo, '2026-01-01T00:00:00.000Z'));
  const same = computePlanFingerprint(makeInput(repo, '2027-01-01T00:00:00.000Z'));
  assert.equal(first, same);
  const candidateChanged = makeInput(repo, '2027-01-01T00:00:00.000Z');
  candidateChanged.implementationPackage.candidate = 'candidate-2';
  assert.notEqual(first, computePlanFingerprint(candidateChanged));
  const formatChanged = makeInput(repo, '2027-01-01T00:00:00.000Z');
  formatChanged.implementationPackage.format = 'svg';
  assert.notEqual(first, computePlanFingerprint(formatChanged));
  const releaseDateChanged = makeInput(repo, '2027-01-01T00:00:00.000Z');
  releaseDateChanged.implementationPackage.releaseDate = '2028-01-01';
  assert.notEqual(first, computePlanFingerprint(releaseDateChanged));
  const timeoutTimeChanged = makeInput(repo, '2027-01-01T00:00:00.000Z');
  timeoutTimeChanged.implementationPackage.timeoutTime = '10s';
  assert.notEqual(first, computePlanFingerprint(timeoutTimeChanged));
  const scopeChanged = makeInput(repo, '2027-01-01T00:00:00.000Z');
  scopeChanged.work.allowedPaths = ['src/changed'];
  assert.notEqual(first, computePlanFingerprint(scopeChanged));
});

/** 验证只有显式 --input 文件进入哈希，范围目录变化不会触发递归扫描。 */
test('计划指纹只绑定显式关键输入文件', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-plan-input-'));
  const input = makeInput(repo, '2026-01-01T00:00:00.000Z');
  const first = computePlanFingerprint(input);
  writeFileSync(join(repo, 'src', 'unlisted.js'), 'not-input');
  assert.equal(first, computePlanFingerprint(input));
  writeFileSync(join(repo, 'src', 'input.js'), 'changed');
  assert.notEqual(first, computePlanFingerprint(input));
});

test('V2 确认输入直接绑定工作项并随文件内容变化更新计划身份', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-plan-confirmation-'));
  const input = makeInput(repo, '2026-01-01T00:00:00.000Z');
  input.extraPaths = [];
  input.work.visualConfirmationPrerequisiteFiles = ['src/input.js'];
  const first = computePlanFingerprint(input);
  writeFileSync(join(repo, 'src/input.js'), '确认方案发生变化');
  assert.notEqual(first, computePlanFingerprint(input));
});
