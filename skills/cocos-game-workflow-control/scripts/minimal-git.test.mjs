import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const TEMPLATE = readFileSync(new URL('../assets/minimal-project.gitignore', import.meta.url), 'utf8');

/** 创建隔离 Git 夹具，避免全局忽略规则或换行设置干扰提交集断言。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cocos-minimal-git-'));
  t.after(() => {
    // 只删除本用例创建的绝对临时路径，不操作共享仓库或用户目录。
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  const excludes = join(root, '.git', 'test-excludes');
  writeFileSync(excludes, '');
  execFileSync('git', ['config', 'core.excludesFile', excludes], { cwd: root });
  writeFileSync(join(root, '.gitignore'), TEMPLATE);
  return root;
}

/** 写入夹具文件，同时创建真实的目录层级。 */
function write(root, path, contents = 'fixture\n') {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/** 读取 Git 对未跟踪文件的最终忽略判定，避免把命令错误当成未忽略。 */
function ignored(root, path) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', path], { cwd: root });
  assert.ifError(result.error);
  assert([0, 1].includes(result.status), String(result.stderr));
  return result.status === 0;
}

/** 用精确路径例外模拟当前工作项的引用选择，不放行整批产物。 */
function allow(root, paths) {
  const entries = paths.map((path) => `!/${path.replace(/[\\*?\[\]]/g, '\\$&')}`).join('\n');
  writeFileSync(join(root, '.gitignore'), TEMPLATE.replace('# 工作流必要文件结束', `${entries}\n# 工作流必要文件结束`));
}

test('保留 Creator 正式资源与工程源配置，并忽略生成目录和本地秘密', (t) => {
  const root = fixture(t);
  const tracked = [
    'assets/scenes/Main.scene',
    'assets/scenes/Main.scene.meta',
    'assets/ui/button.png',
    'assets/ui/button.png.meta',
    'settings/v2/packages/project.json',
    'profiles/v2/packages/builder.json',
    'native/engine/ios/Plugin.mm',
    'native/engine/ios/Config.xcconfig',
    'extensions/game-tools/package.json',
    'package.json',
    'package-lock.json',
    'tests/workflow.test.mjs',
    '.env.example',
    '.gitignore',
  ];
  for (const path of tracked) {
    if (path !== '.gitignore') write(root, path);
    assert.equal(ignored(root, path), false, path);
  }

  for (const path of [
    'node_modules/pkg/index.js',
    'library/imported/asset.bin',
    'temp/build-cache/file.json',
    'local/editor-state.json',
    'build/web/index.html',
    'cache/asset-db.json',
    '.cache/tool/cache.bin',
    'dist/index.html',
    '.env',
    '.env.local',
    'secrets/store.json',
    'native/keys/release.jks',
  ]) {
    write(root, path);
    assert.equal(ignored(root, path), true, path);
  }
});

test('默认忽略未选中的文档、候选产物、人工证据和控制记录', (t) => {
  const root = fixture(t);
  for (const path of [
    'output/intermediate/WI-1/V3/try-1/frame.png',
    'output/candidates/WI-1/V3/candidate-1/hero.png',
    'docs/TDD.md',
    'docs/confirmed/scenes/battle/layout-target/v1/layout.png',
    'evidence/WI-1/reviews/V2/candidate-1/review.html',
    'evidence/WI-1/validation/V4/run-1/screenshot.png',
    'assets-source/scenes/battle/hero/r1/source.png',
    '.workflow-control/work-items/WI-1.json',
    '.workflow-control/evidence/WI-1/execution-state.json',
    '.workflow-control/user-resolutions/WI-1-ledger.json',
  ]) {
    write(root, path);
    assert.equal(ignored(root, path), true, path);
  }
});

test('有效引用可逐文件放行，邻居文件和其他工作项仍保持忽略', (t) => {
  const root = fixture(t);
  const selected = [
    'docs/TDD.md',
    'docs/confirmed/scenes/battle/layout-target/v1/layout.png',
    'evidence/WI-1/reviews/V2/candidate-1/review.html',
    'evidence/WI-1/reviews/V2/candidate-1/layout.png',
    'evidence/WI-1/validation/V4/run-1/screenshot.png',
    'evidence/WI-1/validation/V4/run-1/test.log',
    'output/candidates/WI-1/V3/candidate-1/frame.png',
    '.workflow-control/work-items/WI-1.json',
    '.workflow-control/evidence/WI-1/attachments/V4/run-1/test.log',
    '.workflow-control/user-resolutions/WI-1-ledger.json',
    '.workflow-control/user-resolutions/WI-1-receipt.json',
    'assets-source/scenes/battle/hero/r1/hero [1].png',
  ];
  allow(root, selected);
  for (const path of selected) {
    write(root, path);
    assert.equal(ignored(root, path), false, path);
  }

  for (const path of [
    'docs/unused.md',
    'docs/confirmed/scenes/battle/layout-target/v0/old.png',
    'evidence/WI-1/reviews/V2/candidate-1/unused.png',
    'evidence/WI-2/validation/V4/run-1/screenshot.png',
    'output/candidates/WI-1/V3/candidate-1/unused.png',
    '.workflow-control/work-items/WI-2.json',
    '.workflow-control/evidence/WI-1/attachments/V4/run-1/debug.log',
    '.workflow-control/user-resolutions/WI-1-unreferenced.json',
    'assets-source/scenes/battle/hero/r1/hero 1.png',
  ]) {
    write(root, path);
    assert.equal(ignored(root, path), true, path);
  }
});

test('必要提交快照保留 Creator 资源侧车、原生配置和递归引用媒体', (t) => {
  const root = fixture(t);
  const workPath = '.workflow-control/work-items/WI-1.json';
  const manifestPath = '.workflow-control/evidence/WI-1/manifest.json';
  const attachmentPath = '.workflow-control/evidence/WI-1/attachments/V4/run-1/test.log';
  const ledgerPath = '.workflow-control/user-resolutions/WI-1-ledger.json';
  const layoutPath = 'docs/confirmed/scenes/battle/layout-target/v1/layout.png';
  const reviewPath = 'evidence/WI-1/reviews/V2/candidate-1/review.html';
  const reviewMediaPath = 'evidence/WI-1/reviews/V2/candidate-1/layout.png';
  const screenshotPath = 'evidence/WI-1/validation/V4/run-1/screenshot.png';
  const assetPath = 'assets/ui/button.png';
  const assetMetaPath = `${assetPath}.meta`;
  const settingsPath = 'settings/v2/packages/project.json';
  const profilesPath = 'profiles/v2/packages/builder.json';
  const nativePath = 'native/engine/ios/Config.xcconfig';
  const unusedPath = 'docs/confirmed/scenes/battle/layout-target/v0/layout.png';
  const required = [workPath, manifestPath, attachmentPath, ledgerPath, layoutPath, reviewPath, reviewMediaPath, screenshotPath];
  const creatorFiles = [assetPath, assetMetaPath, settingsPath, profilesPath, nativePath];
  allow(root, required);
  write(root, workPath, JSON.stringify({ evidenceManifest: manifestPath, layout: layoutPath, review: reviewPath, screenshot: screenshotPath, confirmationLedger: ledgerPath }));
  write(root, manifestPath, JSON.stringify({ files: [attachmentPath, ledgerPath] }));
  for (const path of [attachmentPath, ledgerPath, layoutPath, reviewPath, reviewMediaPath, screenshotPath, ...creatorFiles, unusedPath]) write(root, path);

  // literal pathspec 确保实际路径不会被 Git 当作通配符扩大暂存集合。
  execFileSync('git', ['add', '--', ...['.gitignore', ...required, ...creatorFiles].map((path) => `:(literal)${path}`)], { cwd: root });
  const snapshot = join(root, 'snapshot');
  mkdirSync(snapshot);
  execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot.replaceAll('\\', '/')}/`], { cwd: root });
  const work = JSON.parse(readFileSync(join(snapshot, workPath), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(snapshot, work.evidenceManifest), 'utf8'));
  for (const path of [assetPath, assetMetaPath, settingsPath, profilesPath, nativePath, work.layout, work.review, work.screenshot, ...manifest.files]) {
    assert(existsSync(join(snapshot, path)), path);
  }
  assert(existsSync(join(root, unusedPath)), '未入库产物仍留在本地');
  assert.equal(existsSync(join(snapshot, unusedPath)), false, '未引用版本不进入提交快照');
});
