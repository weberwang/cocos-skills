#!/usr/bin/env node

import { cp, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/** 判断文件或目录是否存在；除不存在外的读取错误必须继续暴露。 */
async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 发现源目录中一级且包含 SKILL.md 的有效 Skill，并按名称排序。 */
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

/** 将 Skill 名称限制在受控的 skills 根目录内，避免覆盖删除越过托管边界。 */
export function resolveManagedTarget(targetRoot, skillName) {
  if (
    !skillName
    || skillName === "."
    || skillName === ".."
    || skillName.includes("/")
    || skillName.includes("\\")
    || isAbsolute(skillName)
    || win32.isAbsolute(skillName)
  ) {
    throw new Error(`非法 Skill 目录名：${skillName}`);
  }

  const target = resolve(targetRoot, skillName);
  const targetRelativePath = relative(targetRoot, target);

  // 删除发生在此路径上，必须确保它既不是根目录也不会逃逸到 .agents/skills 之外。
  if (
    !targetRelativePath
    || targetRelativePath === ".."
    || targetRelativePath.startsWith(`..${sep}`)
    || isAbsolute(targetRelativePath)
  ) {
    throw new Error(`非法 Skill 目录名：${skillName}`);
  }

  return target;
}

/**
 * 使用 lstat 检查受控目录，避免跟随符号链接或 Windows junction/reparse point。
 * 这是删除前的安全边界：仅允许安装器在项目自身的真实目录树中覆盖同名 Skill。
 */
async function inspectControlledDirectory(directoryPath) {
  try {
    const entry = await lstat(directoryPath);

    if (entry.isSymbolicLink()) {
      throw new Error(`受控目录不能是链接或重解析点：${directoryPath}`);
    }
    if (!entry.isDirectory()) {
      throw new Error(`受控目录必须是目录：${directoryPath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 逐级验证并创建 .agents/skills；每次创建前后均重新检查，避免 mkdir 跟随链接。 */
async function ensureSafeTargetRoot(projectRoot) {
  const agentsRoot = join(projectRoot, ".agents");
  const targetRoot = join(agentsRoot, "skills");

  let agentsExists = await inspectControlledDirectory(agentsRoot);
  let skillsExists = await inspectControlledDirectory(targetRoot);

  if (!agentsExists) {
    // mkdir 前重新检查两个受控层级，确保不存在的父目录没有被替换为链接。
    await inspectControlledDirectory(agentsRoot);
    await inspectControlledDirectory(targetRoot);
    await mkdir(agentsRoot);
    agentsExists = await inspectControlledDirectory(agentsRoot);
    skillsExists = await inspectControlledDirectory(targetRoot);
  }

  if (!skillsExists) {
    // 第二层创建同样受保护；.agents 必须已是项目内真实目录。
    await inspectControlledDirectory(agentsRoot);
    await inspectControlledDirectory(targetRoot);
    await mkdir(targetRoot);
    await inspectControlledDirectory(agentsRoot);
    skillsExists = await inspectControlledDirectory(targetRoot);
  }

  if (!agentsExists || !skillsExists) {
    throw new Error(`无法创建受控 Skill 目录：${targetRoot}`);
  }
  return targetRoot;
}

/** 删除前确认目标不是链接，防止平台递归删除语义意外触及项目外路径。 */
async function assertManagedTargetIsNotLink(target) {
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) {
      throw new Error(`受控 Skill 目录不能是链接或重解析点：${target}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

/** 覆盖安装全部有效 Skill，只删除目标项目中同名的托管目录。 */
export async function installSkills({ sourceRoot, projectRoot, log }) {
  const names = await discoverSkillDirectories(sourceRoot);

  if (names.length === 0) {
    throw new Error("未发现有效 Skill，安装已取消。");
  }

  const targetRoot = await ensureSafeTargetRoot(projectRoot);

  for (const name of names) {
    const target = resolveManagedTarget(targetRoot, name);
    // 每次 rm 前逐级 lstat，确保不会删除 .agents/skills 之外的目录。
    await inspectControlledDirectory(join(projectRoot, ".agents"));
    await inspectControlledDirectory(targetRoot);
    await assertManagedTargetIsNotLink(target);
    await rm(target, { recursive: true, force: true });
    await cp(join(sourceRoot, name), target, { recursive: true });
    log(`已安装：${name}`);
  }

  return names;
}

/** 以当前执行目录作为目标项目根目录运行安装器。 */
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`安装失败：${error.message}`);
    process.exitCode = 1;
  });
}
