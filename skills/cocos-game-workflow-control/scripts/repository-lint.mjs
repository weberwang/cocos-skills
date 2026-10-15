import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 递归收集指定扩展名文件。 */
function collectFiles(root, extension) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(path, extension));
    else if (entry.name.endsWith(extension)) output.push(path);
  }
  return output;
}

/** 检查 Markdown 中的本地文件链接。 */
function checkMarkdownLinks(path, fail) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
    if (!existsSync(resolve(dirname(path), target))) fail(`Markdown 本地链接失效：${path} -> ${target}`);
  }
}

/** 检查仓库所有领域 Skill 接入唯一控制面、Schema 和本地链接。 */
export function repositoryLint(repo, fail) {
  const skillsRoot = join(repo, 'skills');
  const oldSemantics = [/F0.{0,20}(作者|命令|冻结)/, /F1.{0,20}(分诊|选择.*F2)/, /F3.{0,20}(收敛|聚合|非作者)/, /F4.{0,20}(人工|受保护决策)/];
  const unconditionalVisualApproval = [/两道.{0,12}确认.{0,12}(强制|必须)/, /只有.{0,20}用户.{0,12}(通过|确认).{0,20}进入\s*V[23]/, /必须同时绑定.{0,40}低保真.{0,40}高保真/, /V[12].{0,40}(Approval Ledger|显式审批)/i, /(视觉|产品|架构).{0,30}(取舍|选择).{0,30}(Approval Ledger|审批点|显式批准)/i, /A[123].{0,40}(取舍|选择).{0,40}(审批|pending|handoff|approve)/i];
  const oldOutsideControl = [/(GitHub|Git|消息|包管理).{0,20}(属于|进入|作为)\s*A[0-6]/i, /PR[、/]push.{0,20}A5/i];
  for (const name of readdirSync(skillsRoot)) {
    const skillPath = join(skillsRoot, name, 'SKILL.md');
    if (!existsSync(skillPath) || name === 'cocos-game-workflow-control') continue;
    const text = readFileSync(skillPath, 'utf8');
    if (!text.includes('cocos-game-workflow-control')) fail(`${name} 未引用唯一控制面`);
    if (!/(提议|提出)/.test(text) || !/(审查|审阅)/.test(text) || !/(Work Item|工作项范围|A4-A6.{0,20}批准)/.test(text) || !/(回到|回总控|提交给).*?(控制面|cocos-game-workflow-control)/s.test(text)) fail(`${name} 未声明提议/审查/工作项范围内修改/回控制面边界`);
    if (oldSemantics.some((pattern) => pattern.test(text))) fail(`${name} 保留旧 F0-F4 执行者语义`);
    if (unconditionalVisualApproval.some((pattern) => pattern.test(text))) fail(`${name} 保留无条件 V1/V2 人工确认语义`);
    if (oldOutsideControl.some((pattern) => pattern.test(text))) fail(`${name} 错把非 Cocos 操作纳入生命周期控制`);
  }
  const references = join(skillsRoot, 'cocos-game-workflow-control', 'references');
  for (const file of readdirSync(references).filter((name) => name.endsWith('.json'))) JSON.parse(readFileSync(join(references, file), 'utf8'));
  for (const markdown of collectFiles(repo, '.md')) {
    const text = readFileSync(markdown, 'utf8');
    if (oldSemantics.some((pattern) => pattern.test(text))) fail(`仓库保留旧 F0-F4 执行者语义：${markdown}`);
    if (unconditionalVisualApproval.some((pattern) => pattern.test(text))) fail(`仓库保留无条件 V1/V2 人工确认语义：${markdown}`);
    if (oldOutsideControl.some((pattern) => pattern.test(text))) fail(`仓库错把非 Cocos 操作纳入生命周期控制：${markdown}`);
    checkMarkdownLinks(markdown, fail);
  }
}
