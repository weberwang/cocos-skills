#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
/** 递归验证源 Skill 是无链接的真实目录，且入口 SKILL.md 是非空普通文件。 */
async function validateSourceSkillDirectory(source) {
  const root = await lstat(source);
  if (root.isSymbolicLink()) {
    throw new Error(`源 Skill 不能是链接或重解析点：${source}`);
  }
  if (!root.isDirectory()) {
    throw new Error(`源 Skill 必须是目录：${source}`);
  }

  const skillFile = join(source, "SKILL.md");
  const skillFileStat = await lstat(skillFile);
  if (skillFileStat.isSymbolicLink() || !skillFileStat.isFile()) {
    throw new Error(`源 Skill 的 SKILL.md 必须是普通文件：${skillFile}`);
  }
  if (!(await readFile(skillFile, "utf8")).trim()) {
    throw new Error(`源 Skill 的 SKILL.md 不能为空：${skillFile}`);
  }

  await validateSourceTree(source);
}

/** 递归检查源目录树中的链接或 Windows 重解析点。 */
async function validateSourceTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`源 Skill 不允许包含链接或重解析点：${entryPath}`);
    }
    if (entryStat.isDirectory()) {
      await validateSourceTree(entryPath);
    }
  }
}

/** 仅允许替换受控的同名目录，防止将普通文件或链接误作安装目标。 */
async function prepareManagedTarget(target) {
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) {
      throw new Error(`受控 Skill 目录不能是链接或重解析点：${target}`);
    }
    if (!entry.isDirectory()) {
      throw new Error(`受控 Skill 目标必须是目录：${target}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 用同卷暂存、验证和可回滚的目录替换完成一次全量覆盖安装。 */
export async function installSkills({ sourceRoot, projectRoot, log, copyDirectory = cp, renameDirectory = rename }) {
  const names = await discoverSkillDirectories(sourceRoot);

  if (names.length === 0) {
    throw new Error("未发现有效 Skill，安装已取消。");
  }

  // 在创建任何目标目录前完成源校验，链接或空入口绝不触碰项目现有安装。
  for (const name of names) {
    await validateSourceSkillDirectory(join(sourceRoot, name));
  }

  const targetRoot = await ensureSafeTargetRoot(projectRoot);
  const transactionId = randomUUID();
  // 暂存根在 .agents/skills 内，保证与最终目录同卷，从而支持目录 rename 的原子替换。
  const stageRoot = join(targetRoot, `.cocos-skills-stage-${transactionId}`);
  const backupRoot = join(targetRoot, `.cocos-skills-backup-${transactionId}`);
  const changed = [];

  try {
    await mkdir(stageRoot);
    for (const name of names) {
      const stagedTarget = join(stageRoot, name);
      await copyDirectory(join(sourceRoot, name), stagedTarget, { recursive: true });
      await validateSourceSkillDirectory(stagedTarget);
    }

    await mkdir(backupRoot);
    for (const name of names) {
      const target = resolveManagedTarget(targetRoot, name);
      await inspectControlledDirectory(join(projectRoot, ".agents"));
      await inspectControlledDirectory(targetRoot);
      const hadOriginal = await prepareManagedTarget(target);
      const backup = join(backupRoot, name);
      const change = { target, backup, hadOriginal };

      if (hadOriginal) {
        await renameDirectory(target, backup);
      }
      changed.push(change);
      await renameDirectory(join(stageRoot, name), target);
    }
  } catch (error) {
    // 复制和暂存验证发生在替换前；若替换阶段失败，则按逆序还原已经移动的旧目录。
    for (const change of changed.reverse()) {
      await assertManagedTargetIsNotLink(change.target);
      await rm(change.target, { recursive: true, force: true });
      if (change.hadOriginal) {
        await renameDirectory(change.backup, change.target);
      }
    }
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }

  for (const name of names) {
    log(`已安装：${name}`);
  }
  log(`安装清单：${JSON.stringify({ skills: names, target_root: targetRoot })}`);

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
