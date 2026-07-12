# Cocos Skills npx 安装器设计

## 目标

让用户在任意目标 Cocos 项目根目录执行以下命令，将本仓库全部有效 Skill 覆盖安装到项目的 `.agents/skills/`：

```powershell
npx -y github:weberwang/cocos-skills
```

## 范围与约束

- 仓库自身提供一个 Node.js npx 可执行入口，不再依赖外部 `skills` CLI。
- 安装源仅为该 npx 下载的仓库包；执行目录即目标项目根目录。
- 只识别 `skills/` 下直接子目录中含有 `SKILL.md` 的目录。
- 每次安装全部有效 Skill，并以同名目录为边界覆盖已有版本。
- 不删除 `.agents/skills/` 父目录，也不触碰本仓库未提供的其他 Skill。
- 不引入第三方运行时依赖。

## 结构

根目录新增：

- `package.json`：声明单一可执行入口，使 GitHub npx 调用能够运行安装器。
- `scripts/install-skills.mjs`：安装器实现。
- `README.md`：唯一安装命令、目标位置、覆盖语义和运行前提。

安装器的包内源目录为 `skills/`；目标目录为 `path.resolve(process.cwd(), '.agents', 'skills')`。

## 安装流程

1. 读取包内 `skills/` 目录，筛选含 `SKILL.md` 的一级子目录。
2. 若未发现有效 Skill，退出失败且不创建目标目录。
3. 创建 `<项目>/.agents/skills/`。
4. 对每个发现的 Skill，删除且仅删除其同名目标目录，再递归复制该源目录。
5. 输出安装的 Skill 名称和最终目标路径。

复制失败应返回非零退出码。安装器不执行网络请求、不修改项目源码，也不写入 `.cocos-workflow/`。

## 覆盖与安全边界

“覆盖安装”只表示覆盖 `<项目>/.agents/skills/<技能名>/`。目标路径由固定目录和经验证的源目录名组成；实现必须拒绝路径分隔符、`.`、`..` 或解析后越出 `.agents/skills/` 的名称。不得将项目根目录外的任何目录作为删除目标。

当多 Skill 安装中途失败时，已覆盖的 Skill 保持新版本；README 明确该操作按 Skill 目录执行，不承诺跨目录事务性回滚。

## 验证

- 添加 Node 内置测试，使用临时项目目录调用安装器。
- 覆盖：安装全部 Skill、同名旧目录被替换、未托管 Skill 保留、无有效源 Skill 时失败且不创建目标目录。
- 本地以包路径方式验证 npx 入口；远程命令的端到端验证在首次推送到 `origin` 后执行。

## 交付条件

- `npx -y github:weberwang/cocos-skills` 是 README 中唯一的安装命令。
- 本地测试通过，且不产生项目外写入。
- 推送后在临时 Cocos 项目目录执行远程命令，确认全部 Skill 位于 `.agents/skills/`。
