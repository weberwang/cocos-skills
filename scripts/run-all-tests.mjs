import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runTests } from "./run-tests.mjs";

/** 从技能与仓库工具中发现实际测试文件，新增模块无需维护一份重复路径清单。 */
async function collectTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(path));
    else if (entry.name.endsWith(".test.mjs")) files.push(path);
  }
  return files;
}

// 安装器的打包/npx 验证保留独立入口，避免每个领域测试重复安装依赖。
const files = [...await collectTests("scripts"), ...await collectTests("skills")].sort();
process.exitCode = await runTests(files);
