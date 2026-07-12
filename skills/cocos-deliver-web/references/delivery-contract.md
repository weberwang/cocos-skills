# Web Mobile 交付契约

## 输入一致性

`entry_mode=build` 需要有效的验证报告；`entry_mode=package` 需要有效的构建报告。二者都必须绑定并核对：

- `project-profile.yaml.content_hash` 与任务输入一致；平台为 `web-mobile`，方向/设计分辨率仍为冻结值。
- 视觉方向 `version` 与 `sha256:` `content_hash` 与任务及上游证据一致。
- 需求、实现/集成、验证的基线未被更改或标记为 `stale`。

不一致时禁止构建或打包。配置、需求、视觉方向、代码、资源、场景、构建配置任一变化都会使旧的验证、构建和交付证据失效。

## 构建产物

构建目录由编排任务指定，推荐结构如下：

```text
delivery/
├── web-build/
├── build-manifest.json
├── checksums.sha256
├── build-report.md
├── web-build.zip                 # 仅 package 模式
├── delivery-report.md            # 仅 package 模式
└── known-issues.md               # 仅 package 模式
```

`build-manifest.json` 至少包含 `schema_version`、`project_id`、`entry_mode`、`baseline_revision`、冻结输入版本/哈希、`build_root`、`entry_file`、`files`、`created_at`。`files` 每项包含安全的相对 `path`、`bytes` 和 `sha256`；按路径排序。`checksums.sha256` 覆盖同一文件集。

压缩包只包含 `web-build/` 内文件，禁止绝对路径、`..` 条目、符号链接越界或把 `.cocos-workflow/`、源代码、凭据和开发缓存打入包内。

## 本地冒烟证据

构建和打包都要保存：

```yaml
local_preview:
  url: http://127.0.0.1:<port>/
  bind_address: 127.0.0.1
  start_command: <实际命令>
  stop_method: <实际停止方式>
  entry_loaded: true
  first_scene_loaded: true
  required_assets: passed
  console: reports/chrome/delivery-console.json
  network: reports/chrome/delivery-network.json
  screenshot: reports/chrome/delivery-smoke.png
```

Chrome 证据须来自实际本地 URL。若上游验证定义了冻结方向和标准手机视口，冒烟使用同一方向和视口；不得用桌面浏览器或文件系统探测替代。

## 门禁和结果

构建失败、入口/资源缺失、哈希不一致、压缩包不安全、冒烟失败均为 P0。P1 默认阻断，除非总控持有绑定检查与工件哈希的有效人工豁免；P2 默认报告。

`delivery-report.md` 记录构建和验证追溯、版本、文件/压缩包哈希、冒烟、质量结论、已知问题和最终人工门禁状态。该状态必须是 `pending`，直到总控获得显式人工批准；本 Skill 绝不能将其设为 `passed`。
