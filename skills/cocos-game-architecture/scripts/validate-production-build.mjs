#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

/** 只读检查解包后的公开目录；不跟随符号链接，也不修改候选产物。 */
export function validateProductionBuild(directory) {
  const root = resolve(directory);
  const violations = [];
  let checkedFiles = 0;

  /** 逐文件检查实际发布字节，包含渠道复制文件和预压缩副本。 */
  function inspect(path) {
    const name = relative(root, path).replaceAll('\\', '/') || '.';
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      violations.push({ file: name, reason: '符号链接无法证明最终发布字节，请先解引用打包后检查' });
      return;
    }
    if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) inspect(join(path, child));
      return;
    }
    if (!stat.isFile()) {
      violations.push({ file: name, reason: '不是可检查的普通文件' });
      return;
    }
    checkedFiles++;
    if (/\.map(?:\.(?:gz|br))?$/i.test(name)) {
      violations.push({ file: name, reason: '公开产物包含 Source Map 文件' });
      return;
    }
    // 压缩副本可能与原文件不同，必须解码实际内容，不能只检查未压缩入口。
    let bytes = readFileSync(path);
    try {
      if (/\.gz$/i.test(name)) bytes = gunzipSync(bytes);
      else if (/\.br$/i.test(name)) bytes = brotliDecompressSync(bytes);
    } catch {
      violations.push({ file: name, reason: '预压缩副本无法解码' });
      return;
    }
    const contents = bytes.toString('utf8');
    if (/(?:\/\/[#@]|\/\*[#@]|<!--[#@])\s*sourceMappingURL\s*=/i.test(contents)
      || /^\s*(?:SourceMap|X-SourceMap)\s*:/im.test(contents)) {
      violations.push({ file: name, reason: '包含外部或内联 Source Map 引用' });
    }
  }

  if (!lstatSync(root).isDirectory()) throw new Error('检查目标必须是已解包的公开产物目录');
  inspect(root);
  if (checkedFiles === 0) violations.push({ file: '.', reason: '公开目录为空，不能证明已生成发布候选' });
  return { ok: violations.length === 0, directory: root, checkedFiles, violations };
}

/** 命令行可同时核对 Web 输出和已解包渠道资源，失败时保留逐文件原因。 */
function main(args) {
  if (!args.length || args.some((arg) => arg.startsWith('-'))) throw new Error('用法：node validate-production-build.mjs <公开目录> [渠道资源目录 ...]');
  const results = args.map(validateProductionBuild);
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

// npm bin 和模块导入共用同一入口，导入时不读取产物或执行外部命令。
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
