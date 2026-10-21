import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import test from 'node:test';
import { validateProductionBuild } from './validate-production-build.mjs';

/** 每个用例只创建并清理自己的系统临时目录，候选目录不受影响。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'production-build-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

/** 保留渠道包的真实嵌套路径与二进制字节。 */
function write(root, path, bytes) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

/** 干净的 Web 与预压缩资源可通过，普通映射变量名不应误报。 */
test('接受无源码映射的真实文件与压缩副本', (t) => {
  const root = fixture(t);
  const js = 'const sourceMappingURL = "ordinary-data"; console.log(sourceMappingURL);';
  write(root, 'index.html', '<script src="assets/app.js"></script>');
  write(root, 'assets/app.js', js);
  write(root, 'assets/app.js.gz', gzipSync(js));
  write(root, 'assets/app.js.br', brotliCompressSync(Buffer.from(js)));
  assert.deepEqual(validateProductionBuild(root), { ok: true, directory: root, checkedFiles: 4, violations: [] });
});

/** hidden 映射及其压缩版本即使没有 JS 引用也必须拒绝。 */
test('拒绝渠道内的映射文件和预压缩映射', (t) => {
  const root = fixture(t);
  for (const file of ['web/app.js.map', 'worker/chunk.MAP.gz', 'vendor/engine.js.map.br']) write(root, file, '{}');
  const result = validateProductionBuild(root);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 3);
});

/** JS、CSS、内联映射、服务头文件以及压缩副本均检查实际内容。 */
test('拒绝源码映射注释与头部引用', (t) => {
  const root = fixture(t);
  write(root, 'app.js', '//# sourceMappingURL=app.js.map');
  write(root, 'style.css', '/*# sourceMappingURL=style.css.map */');
  write(root, 'worker.js.gz', gzipSync('//@ sourceMappingURL=data:application/json;base64,e30='));
  write(root, 'engine.js.br', brotliCompressSync(Buffer.from('//# sourceMappingURL=remote.map')));
  write(root, '_headers', '/assets/*\n  SourceMap: /hidden.map');
  assert.equal(validateProductionBuild(root).violations.length, 5);
});

/** 损坏和空候选不能被当成干净的生产输出。 */
test('拒绝无法读取的压缩候选、空目录和错误入口', (t) => {
  const root = fixture(t);
  assert.equal(validateProductionBuild(root).ok, false);
  write(root, 'broken.js.gz', 'not-gzip');
  assert.equal(validateProductionBuild(root).ok, false);
  assert.throws(() => validateProductionBuild(join(root, 'missing')));
  assert.throws(() => validateProductionBuild(join(root, 'broken.js.gz')));
});

/** CLI 的失败退出码用于阻断构建流水线，不能只有报告而返回成功。 */
test('命令行支持多目录且遇到映射返回非零', (t) => {
  const root = fixture(t);
  const clean = join(root, 'clean');
  const dirty = join(root, 'dirty');
  write(clean, 'index.html', '<main>game</main>');
  write(dirty, 'app.js.map', '{}');
  const cli = new URL('./validate-production-build.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(cli), clean, dirty], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).results.length, 2);
});
