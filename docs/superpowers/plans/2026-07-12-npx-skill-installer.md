# Cocos Skills npx 安装器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过 `npx -y github:weberwang/cocos-skills` 将仓库内全部有效 Skill 覆盖安装到当前项目的 `.agents/skills/`。

**Architecture:** 仓库根目录作为无依赖 npm 可执行包。npx 运行 `scripts/install-skills.mjs`，该脚本从包内 `skills/` 发现一级 Skill 目录，并仅替换当前工作目录 `.agents/skills/` 中的同名目录。Node 内置测试通过临时目录调用导出的安装接口并验证 CLI 入口。

**Tech Stack:** Node.js 18+、ESM、`node:fs/promises`、`node:test`、npm/npx。

## Global Constraints

- 唯一对外安装命令必须是 `npx -y github:weberwang/cocos-skills`。
- 不增加第三方运行时依赖。
- 只将 `skills/` 的一级、包含 `SKILL.md` 的子目录视为有效 Skill。
- 覆盖范围仅限 `<项目>/.agents/skills/<技能名>/`；不得删除父目录或未托管 Skill。
- 源 Skill 为空时必须失败，且不得创建目标 `.agents/skills/`。
- 安装器文件和函数使用简体中文注释说明不直观的安全边界。
- 当前仓库的 Git 提交与推送必须在全部工作完成后、获得用户 `1：仅提交` 或 `2：提交并推送` 的明确选择后执行。

---

## 文件结构

- 新建 `package.json`：定义包元数据、Node 版本下限、唯一 bin 入口和测试命令。
- 新建 `scripts/install-skills.mjs`：发现、校验、覆盖复制和 CLI 错误处理。
- 新建 `tests/install-skills.test.mjs`：Node 内置测试，覆盖发现、覆盖边界、空源失败和入口执行。
- 新建 `README.md`：提供唯一安装命令与覆盖语义。

### Task 1: 建立可执行包与失败测试

**Files:**
- Create: `package.json`
- Create: `tests/install-skills.test.mjs`

**Interfaces:**
- Consumes: 仓库现有 `skills/cocos-orchestrate-web-workflow/SKILL.md`。
- Produces: `npm test` 以及后续任务要实现的 `discoverSkillDirectories(sourceRoot)`、`installSkills({ sourceRoot, projectRoot, log })`、`resolveManagedTarget(targetRoot, skillName)`。

- [ ] **Step 1: 写入失败测试和包配置**

在 `package.json` 创建无依赖 ESM 包，并将 bin 名称映射到安装脚本：

```json
{
  "name": "cocos-skills",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "bin": { "cocos-skills": "scripts/install-skills.mjs" },
  "scripts": { "test": "node --test tests/install-skills.test.mjs" }
}
```

在测试文件导入尚不存在的接口，并构造临时目录；至少写入以下断言：

```js
const names = await discoverSkillDirectories(sourceRoot);
assert.deepEqual(names, ["alpha", "beta"]);

const installed = await installSkills({ sourceRoot, projectRoot, log: () => {} });
assert.deepEqual(installed, ["alpha", "beta"]);
assert.equal(await readFile(join(projectRoot, ".agents", "skills", "alpha", "marker.txt"), "utf8"), "new");
assert.equal(await readFile(join(projectRoot, ".agents", "skills", "custom", "keep.txt"), "utf8"), "keep");
```

另写入空源和越界名称的断言：

```js
await assert.rejects(
  installSkills({ sourceRoot: emptySourceRoot, projectRoot, log: () => {} }),
  /未发现有效 Skill/,
);
assert.equal(await exists(join(projectRoot, ".agents", "skills")), false);
assert.throws(() => resolveManagedTarget(targetRoot, "../escape"), /非法 Skill 目录名/);
```

- [ ] **Step 2: 运行测试，确认失败原因是模块尚不存在**

Run: `rtk npm test`

Expected: FAIL，报错 `ERR_MODULE_NOT_FOUND`，路径为 `scripts/install-skills.mjs`。

- [ ] **Step 3: 暂不提交**

本仓库约束要求等待用户在全部任务完成后选择 Git 操作；本任务只保留工作区改动。

### Task 2: 实现安全覆盖安装器

**Files:**
- Create: `scripts/install-skills.mjs`
- Modify: `tests/install-skills.test.mjs`

**Interfaces:**
- Consumes: `discoverSkillDirectories(sourceRoot)` 返回排序后的 `string[]`；`installSkills` 接收绝对或相对源、项目路径。
- Produces: `installSkills({ sourceRoot, projectRoot, log }): Promise<string[]>`，成功时返回已安装 Skill 名；CLI 成功退出 0、失败退出 1。

- [ ] **Step 1: 实现目录发现与受控目标解析**

在 `scripts/install-skills.mjs` 导出以下实现：

```js
export async function discoverSkillDirectories(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isDirectory() && await exists(join(sourceRoot, entry.name, "SKILL.md"))) {
      names.push(entry.name);
    }
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export function resolveManagedTarget(targetRoot, skillName) {
  if (skillName === "." || skillName === ".." || basename(skillName) !== skillName) {
    throw new Error(`非法 Skill 目录名：${skillName}`);
  }
  const target = resolve(targetRoot, skillName);
  const relative = relative(targetRoot, target);
  if (!relative || relative.startsWith(`..${sep}`) || isAbsolute(relative)) {
    throw new Error(`非法 Skill 目录名：${skillName}`);
  }
  return target;
}
```

实现 `exists(filePath)`，只将 `ENOENT` 视为不存在，其他读取错误继续抛出。为目标路径验证添加简体中文注释，解释这是覆盖删除前的边界保护。

- [ ] **Step 2: 实现覆盖复制与 CLI 入口**

以如下顺序实现 `installSkills`：先发现所有 Skill；为空时抛出 `未发现有效 Skill，安装已取消。`；随后创建 `join(projectRoot, ".agents", "skills")`；对每个名称依次解析受控目标、`rm(target, { recursive: true, force: true })`、`cp(join(sourceRoot, name), target, { recursive: true })`。

CLI 使用包脚本所在目录计算包根目录，并以当前工作目录作为项目根目录：

```js
async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(scriptPath), "..");
  const names = await installSkills({
    sourceRoot: join(packageRoot, "skills"),
    projectRoot: process.cwd(),
    log: (message) => console.log(message),
  });
  console.log(`已覆盖安装 ${names.length} 个 Skill 到 ${join(process.cwd(), ".agents", "skills")}`);
}

main().catch((error) => {
  console.error(`安装失败：${error.message}`);
  process.exitCode = 1;
});
```

在每个完成的 Skill 后打印 `已安装：<名称>`，便于用户定位覆盖结果。

- [ ] **Step 3: 扩充 CLI 入口测试**

在测试中通过 `spawnSync(process.execPath, [installerPath], { cwd: projectRoot, encoding: "utf8" })` 调用真实脚本，并断言：

```js
assert.equal(result.status, 0);
assert.match(result.stdout, /已覆盖安装 1 个 Skill/);
assert.equal(await exists(join(projectRoot, ".agents", "skills", "cocos-orchestrate-web-workflow", "SKILL.md")), true);
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `rtk npm test`

Expected: PASS，所有 Node test 子测试通过。

- [ ] **Step 5: 暂不提交**

保留改动，等待用户在最终交付后的 Git 选项。

### Task 3: 编写面向用户的安装说明并验证 npx 包入口

**Files:**
- Create: `README.md`
- Modify: `tests/install-skills.test.mjs`

**Interfaces:**
- Consumes: `package.json` 的 `cocos-skills` bin 和 `scripts/install-skills.mjs` CLI。
- Produces: 使用者可复制的唯一远程命令，以及本地包入口验证。

- [ ] **Step 1: 写入 README 安装说明**

README 的安装章节只展示此命令：

```powershell
npx -y github:weberwang/cocos-skills
```

随后用简体中文明确：在目标 Cocos 项目根目录执行；安装所有仓库 Skill；目标为 `.agents/skills/`；同名 Skill 目录会被覆盖；其他已存在 Skill 不会被删除；需 Node.js 18+；远程命令只有在本仓库推送到 GitHub 后可用。

- [ ] **Step 2: 添加本地 npx 包入口测试**

在临时项目目录执行：

```js
const packageUrl = pathToFileURL(repositoryRoot).href;
const result = spawnSync("npx", ["-y", packageUrl], {
  cwd: projectRoot,
  encoding: "utf8",
  shell: process.platform === "win32",
});
assert.equal(result.status, 0, result.stderr);
assert.equal(await exists(join(projectRoot, ".agents", "skills", "cocos-orchestrate-web-workflow", "SKILL.md")), true);
```

如果本机 npm 不支持 file URL，则以 `npx -y <仓库绝对路径>` 作为等价本地包测试，并在测试注释中说明远程 GitHub URL 的验证要等首次推送完成。

- [ ] **Step 3: 运行完整测试和人工检查**

Run: `rtk npm test`

Expected: PASS。

Run: `rtk proxy powershell -NoProfile -Command "Get-Content -Raw README.md"`

Expected: 唯一安装命令为 `npx -y github:weberwang/cocos-skills`，没有其他 npx 安装命令。

- [ ] **Step 4: 暂不提交**

完成后汇总测试证据并让用户选择 `1：仅提交`、`2：提交并推送` 或 `3：忽略`；若选择 `2`，推送成功后在临时 Cocos 项目目录执行远程 npx 命令作端到端验证。

## 计划自检

- 规格覆盖：唯一命令（Task 3）、无依赖 npx 入口（Task 1、2）、全部有效 Skill（Task 2）、同名覆盖与边界保护（Task 2）、README（Task 3）、测试与远程验证条件（Task 1、3）。
- 占位符检查：没有占位标记、待补充说明或未定义接口。
- 接口一致性：Task 1 定义的三个导出函数均在 Task 2 实现，并由 Task 3 的 CLI/npx 测试使用。
