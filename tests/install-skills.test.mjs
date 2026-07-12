import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  discoverSkillDirectories,
  installSkills,
  resolveManagedTarget,
} from "../scripts/install-skills.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = join(repositoryRoot, "scripts", "install-skills.mjs");

/** 创建测试专用临时目录，并在子测试结束后清理。 */
async function createTemporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "cocos-skills-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** 写入一个满足安装器识别条件的最小 Skill 目录。 */
async function createSkill(sourceRoot, name, marker) {
  const skillRoot = join(sourceRoot, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `# ${name}\n`);
  await writeFile(join(skillRoot, "marker.txt"), marker);
}

/** 判断路径是否存在，供安装结果断言使用。 */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** 创建目录链接以验证安装器不会沿 .agents 链接删除项目外文件。 */
async function createDirectoryLink(target, linkPath) {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/** 在 Windows 上通过 cmd 显式调用 npm.cmd 或 npx.cmd，避免 Node 为 shell: true 发出 DEP0190 警告。 */
function runNpmCommand(command, args, options) {
  if (process.platform !== "win32") {
    return spawnSync(command, args, options);
  }

  const escapedArguments = args.map((argument) => (
    /[\s"]/u.test(argument) ? `"${argument.replaceAll('"', '""')}"` : argument
  ));
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${command}.cmd ${escapedArguments.join(" ")}`], options);
}

test("发现一级且包含 SKILL.md 的 Skill，并按名称排序", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const sourceRoot = join(temporaryDirectory, "skills");
  await createSkill(sourceRoot, "beta", "beta");
  await createSkill(sourceRoot, "alpha", "alpha");
  await mkdir(join(sourceRoot, "not-a-skill"), { recursive: true });

  const names = await discoverSkillDirectories(sourceRoot);

  assert.deepEqual(names, ["alpha", "beta"]);
});

test("覆盖同名 Skill 时清理遗留文件并保留未托管的 Skill", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const sourceRoot = join(temporaryDirectory, "source-skills");
  const projectRoot = join(temporaryDirectory, "project");
  await createSkill(sourceRoot, "beta", "beta");
  await createSkill(sourceRoot, "alpha", "new");
  await mkdir(join(projectRoot, ".agents", "skills", "alpha"), { recursive: true });
  await writeFile(join(projectRoot, ".agents", "skills", "alpha", "marker.txt"), "old");
  await writeFile(join(projectRoot, ".agents", "skills", "alpha", "legacy.txt"), "legacy");
  await mkdir(join(projectRoot, ".agents", "skills", "custom"), { recursive: true });
  await writeFile(join(projectRoot, ".agents", "skills", "custom", "keep.txt"), "keep");

  const installed = await installSkills({ sourceRoot, projectRoot, log: () => {} });

  assert.deepEqual(installed, ["alpha", "beta"]);
  assert.equal(await readFile(join(projectRoot, ".agents", "skills", "alpha", "marker.txt"), "utf8"), "new");
  assert.equal(await exists(join(projectRoot, ".agents", "skills", "alpha", "legacy.txt")), false);
  assert.equal(await readFile(join(projectRoot, ".agents", "skills", "custom", "keep.txt"), "utf8"), "keep");

  await writeFile(join(projectRoot, ".agents", "skills", "alpha", "legacy.txt"), "legacy-again");
  const reinstalled = await installSkills({ sourceRoot, projectRoot, log: () => {} });

  assert.deepEqual(reinstalled, ["alpha", "beta"]);
  assert.equal(await exists(join(projectRoot, ".agents", "skills", "alpha", "legacy.txt")), false);
  assert.equal(await readFile(join(projectRoot, ".agents", "skills", "custom", "keep.txt"), "utf8"), "keep");
});

test("源目录没有有效 Skill 时不创建目标目录", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const emptySourceRoot = join(temporaryDirectory, "empty-source");
  const projectRoot = join(temporaryDirectory, "project");
  await mkdir(emptySourceRoot, { recursive: true });

  await assert.rejects(
    installSkills({ sourceRoot: emptySourceRoot, projectRoot, log: () => {} }),
    /未发现有效 Skill/,
  );
  assert.equal(await exists(join(projectRoot, ".agents", "skills")), false);
});

test("拒绝越过受控根目录的 Skill 名称", () => {
  const targetRoot = join(tmpdir(), "cocos-skills-target");

  for (const skillName of [
    "../escape",
    String.raw`..\escape`,
    resolve(tmpdir(), "absolute-skill"),
    String.raw`C:\absolute-skill`,
    ".",
    "..",
  ]) {
    assert.throws(() => resolveManagedTarget(targetRoot, skillName), /非法 Skill 目录名/);
  }
});

test("拒绝指向项目外的 .agents 目录链接且不触碰外部同名 Skill", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const sourceRoot = join(temporaryDirectory, "source-skills");
  const projectRoot = join(temporaryDirectory, "project");
  const externalAgentsRoot = join(temporaryDirectory, "external-agents");
  await createSkill(sourceRoot, "alpha", "new");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(join(externalAgentsRoot, "skills", "alpha"), { recursive: true });
  await writeFile(join(externalAgentsRoot, "skills", "alpha", "marker.txt"), "external-old");
  await createDirectoryLink(externalAgentsRoot, join(projectRoot, ".agents"));

  assert.equal((await lstat(join(projectRoot, ".agents"))).isSymbolicLink(), true);
  await assert.rejects(
    installSkills({ sourceRoot, projectRoot, log: () => {} }),
    /链接|重解析点/,
  );
  assert.equal(
    await readFile(join(externalAgentsRoot, "skills", "alpha", "marker.txt"), "utf8"),
    "external-old",
  );
});

test("拒绝指向项目外的 .agents/skills 目录链接", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const sourceRoot = join(temporaryDirectory, "source-skills");
  const projectRoot = join(temporaryDirectory, "project");
  const externalSkillsRoot = join(temporaryDirectory, "external-skills");
  await createSkill(sourceRoot, "alpha", "new");
  await mkdir(join(projectRoot, ".agents"), { recursive: true });
  await mkdir(join(externalSkillsRoot, "alpha"), { recursive: true });
  await writeFile(join(externalSkillsRoot, "alpha", "marker.txt"), "external-old");
  await createDirectoryLink(externalSkillsRoot, join(projectRoot, ".agents", "skills"));

  assert.equal((await lstat(join(projectRoot, ".agents", "skills"))).isSymbolicLink(), true);
  await assert.rejects(
    installSkills({ sourceRoot, projectRoot, log: () => {} }),
    /链接|重解析点/,
  );
  assert.equal(await readFile(join(externalSkillsRoot, "alpha", "marker.txt"), "utf8"), "external-old");
});

test("CLI 将包内有效 Skill 安装到执行目录", async (t) => {
  const projectRoot = await createTemporaryDirectory(t);
  const expectedSkillNames = await discoverSkillDirectories(join(repositoryRoot, "skills"));

  const result = spawnSync(process.execPath, [installerPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`已覆盖安装 ${expectedSkillNames.length} 个 Skill`));
  for (const skillName of expectedSkillNames) {
    assert.equal(await exists(join(projectRoot, ".agents", "skills", skillName, "SKILL.md")), true);
  }
});

test("npx 通过本地包路径运行后安装包内 Skill", async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t);
  const packageDirectory = join(temporaryDirectory, "package");
  const projectRoot = join(temporaryDirectory, "project");
  const expectedSkillNames = await discoverSkillDirectories(join(repositoryRoot, "skills"));
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  // Windows npm 不会将本地目录或 file URL 自动解析为 bin；先打成临时包，再以绝对包路径验证 npx 的真实安装入口。
  const packResult = runNpmCommand("npm", ["pack", "--pack-destination", packageDirectory, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(packResult.status, 0, `${packResult.stderr}\n${packResult.stdout}`);

  const [{ filename }] = JSON.parse(packResult.stdout);
  const packagePath = join(packageDirectory, filename);
  const result = runNpmCommand("npx", ["-y", "--package", packagePath, "cocos-skills"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: join(temporaryDirectory, ".npm-cache") },
  });

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, new RegExp(`已覆盖安装 ${expectedSkillNames.length} 个 Skill`));
  for (const skillName of expectedSkillNames) {
    assert.equal(await exists(join(projectRoot, ".agents", "skills", skillName, "SKILL.md")), true);
  }
});
