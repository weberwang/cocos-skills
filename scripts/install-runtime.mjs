import { cp, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** 按 Node 的依赖搜索目录定位包根，原生包可以完全不导出默认 JS 入口。 */
async function packageRootFor(name, requireFrom) {
  for (const searchPath of requireFrom.resolve.paths(name) ?? []) {
    const directory = join(searchPath, name);
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) return { directory: await realpath(directory), manifest };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw Object.assign(new Error(`找不到运行依赖的包根：${name}`), { code: "MODULE_NOT_FOUND" });
}

/** 复制已安装的 Sharp 依赖闭包，安装后各技能可共用，且不修改目标游戏依赖。 */
export async function prepareSkillRuntime(stageRoot, { requireFrom = createRequire(import.meta.url) } = {}) {
  const target = join(stageRoot, "cocos-game-workflow-control", "node_modules");
  const installed = new Map();

  /** 保留 npm 的嵌套版本布局；缺少当前平台可选二进制时跳过，必需依赖必须存在。 */
  async function copyDependency(name, requireFrom, modulesRoot, optional = false) {
    let source;
    try {
      source = await packageRootFor(name, requireFrom);
    } catch (error) {
      if (optional && error.code === "MODULE_NOT_FOUND") return;
      throw error;
    }
    const previous = installed.get(name);
    if (previous === source.directory) return;
    const destination = join(previous ? modulesRoot : target, name);
    installed.set(name, source.directory);
    await mkdir(dirname(destination), { recursive: true });
    // 不复制源码包内的 node_modules，按已解析依赖逐包复制，避免带入无关开发工具。
    await cp(source.directory, destination, {
      recursive: true,
      dereference: true,
      filter: (path) => path === source.directory || !path.slice(source.directory.length + 1).split(/[\\/]/u).includes("node_modules"),
    });
    const requireChild = createRequire(join(source.directory, "package.json"));
    const nestedRoot = join(destination, "node_modules");
    for (const dependency of Object.keys(source.manifest.dependencies ?? {})) {
      await copyDependency(dependency, requireChild, nestedRoot);
    }
    for (const dependency of Object.keys(source.manifest.optionalDependencies ?? {})) {
      await copyDependency(dependency, requireChild, nestedRoot, true);
    }
  }

  if (!(await stat(resolve(stageRoot, "cocos-game-workflow-control"))).isDirectory()) {
    throw new Error("工作流控制技能缺失，无法安装图片运行依赖。");
  }
  await copyDependency("sharp", requireFrom, target);
}
