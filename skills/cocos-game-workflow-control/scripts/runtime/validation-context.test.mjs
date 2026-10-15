import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationContext } from './validation-context.mjs';

/** 构造可观察校验次数的命令级上下文，验证缓存只在同一输入身份下复用。 */
function makeFixture() {
  const calls = { manifest: 0, authority: 0, package: 0 };
  const deps = {
    readJson: () => ({ source: 'json' }),
    validateWorkItem: (value) => value,
    loadVisualManifestSnapshot: (pkg) => {
      calls.manifest += 1;
      return { manifest: { file: pkg.visualManifestFile, version: 1 }, errors: [] };
    },
    visualConfirmationAuthority: (work, manifest, options) => ({
      call: calls.authority += 1,
      workItemId: work.workItemId,
      manifest,
      packageId: options.implementationPackage.packageId,
    }),
    validateImplementationPackage: (pkg) => ({ call: calls.package += 1, packageId: pkg.packageId }),
  };
  const context = new ValidationContext(process.cwd(), deps);
  const work = {
    workItemId: 'WI-1',
    stageId: 'G1',
    baselineHash: 'sha256:baseline',
    allowedPaths: ['src'],
  };
  const pkg = {
    packageId: 'PKG-1',
    workItemId: 'WI-1',
    visualManifestFile: 'docs/manifest.json',
    visualManifestSha256: 'sha256:manifest',
    executionUnits: [{ unitId: 'UNIT-1', ownedPaths: ['src'] }],
  };
  const delegation = {
    workItemId: 'WI-1',
    assignedAgent: 'worker-1',
    ownership: ['src'],
    allowedPaths: ['src'],
  };
  return { calls, context, work, pkg, delegation };
}

test('ValidationContext 对完整相同输入复用包、authority 和 manifest 校验结果', () => {
  const fixture = makeFixture();
  const first = fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  const second = fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);

  assert.strictEqual(first, second);
  assert.equal(fixture.calls.package, 1);
  assert.equal(fixture.calls.authority, 1);
  assert.equal(fixture.calls.manifest, 1);
  assert.strictEqual(fixture.context.authorityFor(fixture.pkg, fixture.work, [fixture.delegation]), fixture.context.authorityFor(fixture.pkg, fixture.work, [fixture.delegation]));
  assert.equal(fixture.calls.authority, 1);
});

test('Work Item 范围、Implementation Package 或委派变化都会生成新校验身份', () => {
  const fixture = makeFixture();
  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  const baselineCalls = fixture.calls.package;

  const changedWork = { ...fixture.work, allowedPaths: ['src/changed'] };
  fixture.context.validateImplementationPackage(fixture.pkg, changedWork, [fixture.delegation]);
  assert.equal(fixture.calls.package, baselineCalls + 1);

  const changedPackage = { ...fixture.pkg, executionUnits: [{ ...fixture.pkg.executionUnits[0], ownedPaths: ['src/other'] }] };
  fixture.context.validateImplementationPackage(changedPackage, fixture.work, [fixture.delegation]);
  assert.equal(fixture.calls.package, baselineCalls + 2);

  const changedDelegation = { ...fixture.delegation, allowedPaths: ['src/other'] };
  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [changedDelegation]);
  assert.equal(fixture.calls.package, baselineCalls + 3);
  assert.equal(fixture.calls.authority, 4);
});

test('只有 manifest 摘要字段不会触发视觉 manifest 验收', () => {
  const fixture = makeFixture();
  delete fixture.pkg.visualManifestFile;
  fixture.pkg.visualManifestSha256 = 17;

  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  assert.equal(fixture.calls.manifest, 0);
});

test('replaceJson 和 invalidate 会清理派生校验缓存，旧结果不能继续复用', () => {
  const fixture = makeFixture();
  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  assert.equal(fixture.calls.package, 1);

  fixture.context.replaceJson('work-item.json', { ...fixture.work, marker: 'replacement' });
  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  assert.equal(fixture.calls.package, 2);

  fixture.context.invalidate('implementation-package.json');
  fixture.context.validateImplementationPackage(fixture.pkg, fixture.work, [fixture.delegation]);
  assert.equal(fixture.calls.package, 3);
  assert.equal(fixture.calls.authority, 3);
});

test('authorityFor 的 manifest 输入变化时必须重新计算 authority', () => {
  const fixture = makeFixture();
  const firstManifest = { manifest: { version: 1 }, errors: [] };
  const secondManifest = { manifest: { version: 2 }, errors: [] };
  fixture.context.authorityFor(fixture.pkg, fixture.work, [fixture.delegation], firstManifest);
  fixture.context.authorityFor(fixture.pkg, fixture.work, [fixture.delegation], secondManifest);
  assert.equal(fixture.calls.authority, 2);
});
