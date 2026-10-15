#!/usr/bin/env node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CORE_TEMPLATES, OPTIONAL_TEMPLATES } from "./project_doc_templates.mjs";

/** 表示命令行输入或授权不满足初始化约束。 */
class InitializationError extends Error {}

/** 解析可选交付物名称，并拒绝未知名称。 */
export function parseIncludeList(value) {
  const names = [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))]; const unknown = names.filter((name) => !(name in OPTIONAL_TEMPLATES)).sort();
  if (unknown.length) throw new InitializationError(`不支持的交付物：${unknown.join("、")}。可选值：${Object.keys(OPTIONAL_TEMPLATES).join("、")}。`); return names;
}

/** 解析项目目录、可选交付物和覆盖授权。 */
function parseArgs(argv) {
  const args = { force: false }; const flags = new Set(["--project-root", "--work-item", "--ledger", "--object", "--include"]);
  for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (token === "--force") { args.force = true; continue; } if (!flags.has(token) || index + 1 >= argv.length) throw new InitializationError(`不支持或缺少值的参数：${token}`); const value = argv[++index]; args[{ "--project-root": "projectRoot", "--work-item": "workItem", "--ledger": "ledger", "--object": "object", "--include": "include" }[token]] = value; }
  const requiredArguments = {
    projectRoot: "--project-root",
    workItem: "--work-item",
    object: "--object",
  };
  for (const [key, flag] of Object.entries(requiredArguments)) {
    if (!args[key]) throw new InitializationError(`缺少必需参数：${flag}`);
  }
  if (args.include) args.include = parseIncludeList(args.include); return args;
}

/** 拒绝文件系统根目录和不存在的项目目录。 */
export function validateProjectRoot(projectRoot) {
  const resolved = resolve(projectRoot); if (resolved === parse(resolved).root) throw new InitializationError("项目目录不能是文件系统根目录。"); if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new InitializationError(`项目目录不存在或不是目录：${resolved}`); return resolved;
}

/** 选择核心模板，或合并 include 对应的多个文件。 */
export function selectTemplates(include) {
  if (include == null) return { ...CORE_TEMPLATES }; const selected = {}; for (const name of include) Object.assign(selected, OPTIONAL_TEMPLATES[name]); return selected;
}

/** 在统一检查覆盖冲突后写入已批准文档。 */
export function initializeDocuments(projectRoot, templates, force) {
  const targets = Object.keys(templates).map((filename) => filename.startsWith(".workflow-control/") ? resolve(projectRoot, filename) : resolve(projectRoot, "docs", filename)); const existing = targets.filter(existsSync); if (existing.length && !force) throw new InitializationError(`拒绝覆盖已有文档：${existing.map((path) => path.split(/[\\/]/).at(-1)).join("、")}。如确需覆盖，请显式传入 --force。`);
  for (let index = 0; index < targets.length; index += 1) { mkdirSync(resolve(targets[index], ".."), { recursive: true }); writeFileSync(targets[index], templates[Object.keys(templates)[index]], "utf8"); } return targets;
}

/** 调用唯一控制 CLI 验证 A1 Work Item 范围；Ledger 仅在调用方显式提供时传递。 */
export function runPreflight(projectRoot, workItem, ledger, approvalObject, templates) {
  const cli = resolve(import.meta.dirname, "../../cocos-game-workflow-control/scripts/workflow-control.mjs"); if (!existsSync(cli)) throw new InitializationError(`找不到全局控制 CLI：${cli}`); const command = [cli, "preflight", "--repo", projectRoot, "--work-item", resolve(workItem), "--action-level", "A1", "--action-type", "cocos-spec-candidate", "--gate", "F0", "--object", approvalObject]; for (const filename of Object.keys(templates)) command.push("--path", `docs/${filename}`);
  if (ledger) command.push("--ledger", resolve(ledger));
  const result = spawnSync(process.execPath, command, { encoding: "utf8" }); if (result.status !== 0) throw new InitializationError(`A1 preflight 未通过：${result.stderr.trim() || result.stdout.trim()}`);
}

/** 执行初始化并输出可审计的写入结果。 */
export function main(argv = process.argv.slice(2)) {
  try { const args = parseArgs(argv); const root = validateProjectRoot(args.projectRoot); const templates = selectTemplates(args.include); runPreflight(root, args.workItem, args.ledger, args.object, templates); const written = initializeDocuments(root, templates, args.force); console.log("已初始化项目交付物："); for (const path of written) console.log(path); return 0; }
  catch (error) { console.error(`初始化失败：${error instanceof Error ? error.message : String(error)}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
