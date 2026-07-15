---
name: cocos-deliver-web
description: Use when a verified Cocos Creator 2D Web Mobile project needs a local Web Mobile build or final delivery package, including a local preview smoke test, file hashes, manifest, delivery report, and human-gate-preserving handoff.
---

# Cocos 交付 Web

按 `entry_mode=build` 或 `entry_mode=package` 生成本地 Cocos Web Mobile 交付物。不得上传、发布、Git 提交或推送；不得改写 `workflow.yaml`，也不得绕过最终人工交付门禁。

## 写入边界

只写入编排任务分配的 `.cocos-workflow/artifacts/`、`.cocos-workflow/reports/`、交付目录及结果路径。构建前读取 Cocos 配置；不得修改场景、资源、TypeScript 或项目配置来“修复”构建问题。`workflow.yaml` 仅由总控写入。

## 入口模式

- `entry_mode=build`：仅用于 `building` 阶段。构建 Web Mobile、生成构建清单和哈希、启动本地静态预览并记录冒烟结果；不创建最终压缩包，也不标记交付完成。
- `entry_mode=package`：仅用于 `delivery` 阶段。复核有效且未失效的构建结果，再创建最终压缩包、校验和、交付报告和已知问题清单；保留最终人工交付门禁为待批准状态。

任何其他 `entry_mode` 都返回 `blocked`。

## 执行流程

1. 读取总控的 `workflow-contracts.md`、`state-machine.md`、`mcp-safety-policy.md`，再读取 [delivery-contract.md](references/delivery-contract.md)。确认任务、写入范围、模式、基线和依赖。
2. 核对冻结的 `project-profile.yaml`、视觉方向版本/哈希、需求版本/哈希和上游验证报告。项目配置或视觉输入不匹配时阻断；上游代码、资源、场景、构建配置或验证结果过期时返回 `stale`，不得复用旧构建。
3. 使用已安装且任务允许的 Cocos Creator 构建入口构建 **Web Mobile**。记录 Creator 版本、完整命令/方法、配置、开始/结束时间、退出码和构建日志。构建失败、入口文件缺失或静态资源缺失均为 P0。
4. 为构建目录中的每个文件计算 SHA-256，生成稳定排序的 `build-manifest.json` 和 `checksums.sha256`。清单至少含相对路径、字节数和哈希，且不得包含构建目录外文件。
5. 启动仅绑定本机回环地址的本地静态服务，记录地址、端口、启动命令和停止方式。使用 Chrome 进行本地冒烟：入口可加载、首场景可达、必需静态资源可访问、控制台无新增未批准错误。保存日志和截图；服务结束后清理。
6. 在 `build` 模式输出构建报告并返回总控。在 `package` 模式先复核构建报告和哈希，再创建 `web-build.zip`，重新计算压缩包 SHA-256，写入交付报告、`artifacts/delivery.md` 和已知问题；将最终人工门禁保持为 `pending`，交由总控请求人工批准。

## 禁止事项

- 禁止执行 `git push`、创建发布、上传托管平台、提交代码或修改远程。
- 禁止将 P0、未批准 P1、哈希不一致、失败冒烟或缺失证据标为通过。
- 禁止自行批准最终交付、P1 豁免或变更冻结方向/视觉方向。
- 禁止把非 Web Mobile 构建产物、桌面预览或本地文件存在性替代 Chrome 冒烟。

## 交接

返回总控结果契约所需的基线、冻结输入版本/哈希、产物、检查、证据、问题与交接说明。只有 `build` 模式的构建与冒烟均通过，才能让总控进入 `delivery`；只有 `package` 模式的清单、压缩包、校验和与报告齐全，才能请求最终人工门禁，不能自行完成流程。
