import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { assertCompletedUnits, assertUnitReady, completeExecutionUnit, createExecutionState, executionStatePath, scopedDiffFingerprint, loadExecutionState, executionPlanFingerprint, initializeExecutionState } from './execution-unit-control.mjs';

const BASELINE_HASH = `sha256:${'a'.repeat(64)}`;

/** 写入测试用 JSON，保持与控制面原子写入后的内容形状一致。 */
function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 计算测试文件的 SHA-256。 */
function fileHash(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 计算控制面使用的文本 SHA-256。 */
function textHash(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** 创建带基线提交的临时 Git 仓库，隔离执行状态回归测试的文件证据。 */
function createRepository(t) {
  const repo = mkdtempSync(join(tmpdir(), 'cocos-execution-validation-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const value = 1;\n', 'utf8');
  writeFileSync(join(repo, 'src', 'module.js'), 'export const moduleValue = 1;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  return { repo, head };
}

/** 创建只含工程单元的最小实施包，绕过视觉门以聚焦状态复用行为。 */
function makePackage() {
  return {
    packageId: 'PKG-EXECUTION-1',
    workItemId: 'WI-EXECUTION-1',
    baselineVersion: '1',
    baselineHash: BASELINE_HASH,
    executionUnits: [
      { unitId: 'UNIT-1', unitType: 'SHARED', scopeId: 'shared', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/main.js'], stateOwnership: ['shared-state'], acceptanceCommands: ['node --test'], highFidelityPrerequisite: null },
      { unitId: 'UNIT-2', unitType: 'MODULE', scopeId: 'module', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/module.js'], stateOwnership: ['module-state'], acceptanceCommands: ['node --test'], highFidelityPrerequisite: null },
    ],
  };
}

/** 为执行校验测试构造 Work Item、Execution State、Result 和可计数 IO。 */
function makeFixture(t) {
  const { repo, head } = createRepository(t);
  const work = { workItemId: 'WI-EXECUTION-1', globalState: 'IMPLEMENTING', stageId: 'G1', baselineId: head, baselineVersion: '1', baselineHash: BASELINE_HASH, evidenceRoot: '.workflow-control/evidence/WI-EXECUTION-1', visualStage: null, visualStageState: null };
  const pkg = makePackage();
  const unitsRoot = resolve(repo, work.evidenceRoot, 'units');
  mkdirSync(unitsRoot, { recursive: true });
  let directoryReads = 0;
  const io = {
    repo,
    git: (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }),
    fileHash,
    hashText: textHash,
    resolve,
    existsSync,
    readFileSync,
    readdirSync: (...args) => { directoryReads += 1; return readdirSync(...args); },
    normalizeRepoPath: (cwd, path) => relative(resolve(cwd), resolve(cwd, path)).replaceAll('\\', '/'),
  };
  const state = createExecutionState(work, pkg, io, '2026-09-05T00:00:00.000Z');
  writeJson(resolve(repo, executionStatePath(work)), state);
  const results = new Map();
  for (const unit of pkg.executionUnits) {
    const outputPath = join(unitsRoot, `${unit.unitId}-output.txt`);
    const relativeOutput = `${work.evidenceRoot}/units/${unit.unitId}-output.txt`;
    writeFileSync(outputPath, `${unit.unitId} passed\n`, 'utf8');
    const result = {
      resultId: `RESULT-${unit.unitId}`,
      workItemId: work.workItemId,
      packageId: pkg.packageId,
      unitId: unit.unitId,
      baselineHash: work.baselineHash,
      codeFingerprint: `git:${head}`,
      diffFingerprint: scopedDiffFingerprint(repo, work.baselineId, unit.ownedPaths, io),
      completedAt: '2026-09-05T00:01:00.000Z',
      commands: [{ command: 'node --test', exitCode: 0, outputFile: relativeOutput, outputHash: fileHash(outputPath) }],
      files: [relativeOutput],
      fileHashes: { [relativeOutput]: fileHash(outputPath) },
      verdict: 'PASS',
    };
    const resultPath = join(unitsRoot, `${unit.unitId}.json`);
    writeJson(resultPath, result);
    results.set(unit.unitId, { unit, result, resultPath });
  }
  return { repo, work, pkg, io, results, get directoryReads() { return directoryReads; } };
}

/** 按预设顺序完成若干执行单元，生成经过真实 Result 校验的状态。 */
function completeUnits(fixture, unitIds) {
  for (const unitId of unitIds) {
    const entry = fixture.results.get(unitId);
    completeExecutionUnit(fixture.work, fixture.pkg, entry.unit, entry.result, entry.resultPath, fixture.repo, fixture.io);
  }
}

test('READY 复用已校验 Execution State，不再扫描 Result 目录', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1']);
  fixture.io.readdirSync = () => { throw new Error('READY 校验不应重新扫描 Result 目录'); };

  assert.doesNotThrow(() => assertUnitReady(fixture.pkg.executionUnits[1], fixture.work, fixture.pkg, fixture.repo, fixture.io));
  assert.equal(fixture.directoryReads, 0);
});

test('完成状态仍复核 Result 文件与实质状态，但不以 Result 摘要漂移拒绝', (t) => {
  const missing = makeFixture(t);
  completeUnits(missing, ['UNIT-1', 'UNIT-2']);
  rmSync(missing.results.get('UNIT-2').resultPath);
  assert.throws(() => assertCompletedUnits({ completedUnitIds: ['UNIT-1', 'UNIT-2'] }, missing.work, missing.pkg, missing.repo, missing.io), /结果文件不存在/);

  const tampered = makeFixture(t);
  completeUnits(tampered, ['UNIT-1', 'UNIT-2']);
  const resultEntry = tampered.results.get('UNIT-2');
  writeJson(resultEntry.resultPath, { ...resultEntry.result, verdict: 'FAIL' });
  assert.throws(() => assertCompletedUnits({ completedUnitIds: ['UNIT-1', 'UNIT-2'] }, tampered.work, tampered.pkg, tampered.repo, tampered.io), /只有 PASS/);
});

test('有效的已校验 Result 不因完成证据检查再次触发目录读取', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1', 'UNIT-2']);
  fixture.io.readdirSync = () => { throw new Error('完成证据检查不应重新扫描 Result 目录'); };

  assert.doesNotThrow(() => assertCompletedUnits({ completedUnitIds: ['UNIT-1', 'UNIT-2'] }, fixture.work, fixture.pkg, fixture.repo, fixture.io));
  assert.equal(fixture.directoryReads, 0);
});

test('单元证据不因其他模块提交或本单元摘要漂移失效', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1']);
  writeFileSync(join(fixture.repo, 'src/module.js'), 'export const moduleValue = 2;\n');
  execFileSync('git', ['add', 'src/module.js'], { cwd: fixture.repo });
  execFileSync('git', ['commit', '-qm', '修改另一个模块'], { cwd: fixture.repo });
  assert.doesNotThrow(() => assertUnitReady(fixture.pkg.executionUnits[1], fixture.work, fixture.pkg, fixture.repo, fixture.io));
  writeFileSync(join(fixture.repo, 'src/main.js'), 'export const value = 3;\n');
  assert.doesNotThrow(() => assertUnitReady(fixture.pkg.executionUnits[1], fixture.work, fixture.pkg, fixture.repo, fixture.io));
});

test('真实完成状态入口接受缺失与陈旧摘要，但继续校验 Result 归属、文件和成功命令', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1']);
  const completed = fixture.results.get('UNIT-1');
  const statePath = resolve(fixture.repo, executionStatePath(fixture.work));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  delete state.units[0].resultFingerprint;
  state.baselineHash = 'sha256:stale';
  state.executionPlanFingerprint = 'sha256:stale';
  writeJson(statePath, state);

  const result = JSON.parse(readFileSync(completed.resultPath, 'utf8'));
  delete result.baselineHash;
  delete result.diffFingerprint;
  delete result.codeFingerprint;
  delete result.fileHashes;
  delete result.commands[0].outputHash;
  writeJson(completed.resultPath, result);

  assert.doesNotThrow(() => assertUnitReady(fixture.pkg.executionUnits[1], fixture.work, fixture.pkg, fixture.repo, fixture.io));

  const failedCommand = { ...result, commands: [{ ...result.commands[0], exitCode: 1 }] };
  writeJson(completed.resultPath, failedCommand);
  assert.throws(() => assertUnitReady(fixture.pkg.executionUnits[1], fixture.work, fixture.pkg, fixture.repo, fixture.io), /命令失败或字段无效/);
});

test('阶段切换不因基线 commit 摘要改变拒绝已完成的旧序列', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1', 'UNIT-2']);
  writeFileSync(join(fixture.repo, 'src', 'next-stage.txt'), 'next stage\n', 'utf8');
  execFileSync('git', ['add', 'src/next-stage.txt'], { cwd: fixture.repo });
  execFileSync('git', ['commit', '-qm', '阶段基线变化'], { cwd: fixture.repo });
  const nextWork = { ...fixture.work, baselineId: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.repo, encoding: 'utf8' }).trim() };
  const nextPackage = { ...fixture.pkg, packageId: 'PKG-EXECUTION-2' };
  fixture.io.writeJson = writeJson;

  const initialized = initializeExecutionState(nextWork, nextPackage, fixture.repo, fixture.io, { replaceExisting: true, previousWork: fixture.work, previousPackage: fixture.pkg });
  assert.equal(initialized.state.packageId, nextPackage.packageId);
  assert.equal(initialized.state.workItemId, fixture.work.workItemId);
});

test('调整未完成单元计划时复用已完成证据，读检查不写状态文件', (t) => {
  const fixture = makeFixture(t);
  completeUnits(fixture, ['UNIT-1']);
  const path = resolve(fixture.repo, executionStatePath(fixture.work));
  const before = readFileSync(path, 'utf8');
  fixture.pkg.executionUnits[1].ownedPaths = ['src/module.js', 'src/new-module.js'];
  fixture.pkg.executionUnits[1].acceptanceCommands = ['node --test module.test.mjs'];
  const { state } = loadExecutionState(fixture.work, fixture.pkg, fixture.repo, fixture.io);
  assert.equal(state.units[0].state, 'COMPLETE');
  assert.equal(state.executionPlanFingerprint, executionPlanFingerprint(fixture.pkg, fixture.io));
  assert.equal(readFileSync(path, 'utf8'), before);
  fixture.pkg.executionUnits[0].acceptanceCommands = ['node --test changed.test.mjs'];
  assert.throws(() => loadExecutionState(fixture.work, fixture.pkg, fixture.repo, fixture.io), /验收命令与单元不一致/);
});
