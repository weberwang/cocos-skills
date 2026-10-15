/** 实施单元全局顺序与场景/显示层包边界的定向测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutionPlan } from './parallel-plan.mjs';

/** 构造覆盖指定全局阶段的最小合法实施包。 */
function makeOrderedPackage(unitTypes = ['SHARED', 'MODULE', 'SCENE', 'INTEGRATION']) {
  const unit = (unitId, unitType, ownedPath, overrides = {}) => ({
    unitId, unitType, scopeId: unitId.toLowerCase(), moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null,
    owner: 'worker', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: [ownedPath], stateOwnership: [unitId.toLowerCase()],
    acceptanceCommands: ['node --test'], serializationReason: '按全局阶段顺序串行', highFidelityPrerequisite: unitType === 'SCENE'
      ? { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', displayLayerId: null, hostSceneId: null, targetSha256: 'sha256:' + 'a'.repeat(64), candidateSha256: 'sha256:' + 'b'.repeat(64), diffFingerprint: 'sha256:scene-v2-diff', evidenceFile: 'docs/scene-v2-plan.json', evidenceSha256: 'sha256:' + 'c'.repeat(64) }
      : unitType === 'DISPLAY_LAYER'
        ? { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', displayLayerId: 'pause', hostSceneId: 'play', targetSha256: 'sha256:' + 'a'.repeat(64), candidateSha256: 'sha256:' + 'b'.repeat(64), diffFingerprint: 'sha256:scene-v2-diff', evidenceFile: 'docs/scene-v2-plan.json', evidenceSha256: 'sha256:' + 'c'.repeat(64) }
        : null, ...overrides,
  });
  const executionUnits = unitTypes.map((unitType, index) => {
    const unitId = `${unitType}-${index + 1}`;
    const path = `src/${unitType.toLowerCase()}`;
    if (unitType === 'SCENE') return unit(unitId, unitType, path, { sceneId: 'play' });
    if (unitType === 'DISPLAY_LAYER') return unit(unitId, unitType, path, { displayLayerId: 'pause', hostSceneId: 'play' });
    return unit(unitId, unitType, path);
  });
  return {
    allowedPaths: executionUnits.map((item) => item.ownedPaths[0]), forbiddenPaths: [], expectedAddedFiles: [], expectedDeletedFiles: [],
    fileOwnership: Object.fromEntries(executionUnits.map((item) => [item.ownedPaths[0], item.owner])), executionUnits,
  };
}

/** 使用与控制面一致的精确测试路径匹配器执行计划校验。 */
function validate(pkg) {
  return validateExecutionPlan(pkg, (value, pattern) => value === pattern, (message) => { throw new Error(message); });
}

test('SCENE 与 DISPLAY_LAYER 必须拆分为独立实施包', () => {
  assert.doesNotThrow(() => validate(makeOrderedPackage()));
  assert.doesNotThrow(() => validate(makeOrderedPackage(['SHARED', 'MODULE', 'DISPLAY_LAYER', 'INTEGRATION'])));

  const mixed = makeOrderedPackage(['SHARED', 'MODULE', 'SCENE', 'DISPLAY_LAYER', 'INTEGRATION']);
  assert.throws(() => validate(mixed), /SCENE 与 DISPLAY_LAYER.*同一 Implementation Package/);
});

test('DISPLAY_LAYER 保留 displayLayerId/hostSceneId 必填及身份匹配', () => {
  const pkg = makeOrderedPackage(['SHARED', 'MODULE', 'DISPLAY_LAYER', 'INTEGRATION']);
  const displayLayer = pkg.executionUnits.find((unit) => unit.unitType === 'DISPLAY_LAYER');
  const missing = structuredClone(pkg); delete missing.executionUnits.find((unit) => unit.unitType === 'DISPLAY_LAYER').hostSceneId;
  assert.throws(() => validate(missing), /缺少 hostSceneId|displayLayerId/);
  const mismatched = structuredClone(pkg);
  const mismatchedUnit = mismatched.executionUnits.find((unit) => unit.unitType === 'DISPLAY_LAYER');
  mismatchedUnit.highFidelityPrerequisite.hostSceneId = 'menu';
  assert.throws(() => validate(mismatched), /scene\/layer\/host 身份必须与宿主单元一致/);
  assert.equal(displayLayer.hostSceneId, 'play');
});

test('独立 DISPLAY_LAYER 可包含多个互不冲突的显示层单元', () => {
  const pkg = makeOrderedPackage(['SHARED', 'MODULE', 'DISPLAY_LAYER', 'DISPLAY_LAYER', 'INTEGRATION']);
  const layers = pkg.executionUnits.filter((unit) => unit.unitType === 'DISPLAY_LAYER');
  layers[1].displayLayerId = 'settings';
  layers[1].ownedPaths = ['src/display-settings'];
  layers[1].stateOwnership = ['display_layer_settings'];
  for (const layer of layers) {
    layer.parallelMode = 'PARALLEL';
    layer.parallelGroup = 'DISPLAY-LAYERS';
    layer.serializationReason = null;
  }
  pkg.allowedPaths.push('src/display-settings');
  pkg.fileOwnership['src/display-settings'] = 'worker';
  layers[1].highFidelityPrerequisite.displayLayerId = 'settings';
  assert.doesNotThrow(() => validate(pkg));

  layers[1].stateOwnership = [...layers[0].stateOwnership];
  assert.throws(() => validate(pkg), /状态所有权冲突/);
});

test('正式实施包的场景块和显示层块均遵循 SHARED→MODULE→视觉单元→INTEGRATION', () => {
  const pkg = makeOrderedPackage(['SHARED', 'MODULE', 'SCENE', 'INTEGRATION']);
  pkg.executionUnits = [pkg.executionUnits[0], pkg.executionUnits[2], pkg.executionUnits[1], pkg.executionUnits[3]];
  assert.throws(() => validate(pkg), /类型顺序非法/);

  const displayPkg = makeOrderedPackage(['SHARED', 'MODULE', 'DISPLAY_LAYER', 'INTEGRATION']);
  displayPkg.executionUnits = [displayPkg.executionUnits[0], displayPkg.executionUnits[2], displayPkg.executionUnits[1], displayPkg.executionUnits[3]];
  assert.throws(() => validate(displayPkg), /类型顺序非法/);
});
