# Cocos 工作流闭环加固设计

## 目标

修复评审发现的端到端契约、门禁、失效恢复、截图验证、生产依赖与安装可靠性缺口。

## 决策

- 唯一视觉方向工件为 `.cocos-workflow/artifacts/visual-direction.yaml`。
- 各人工门禁使用统一字段：`status`、`approved_by`、`approved_at`、`subject_hash`；批准哈希必须匹配对应工件。
- 结果证据必须为项目内安全相对路径、真实存在且可选绑定 SHA-256；阶段必需工件必须存在并通过 schema/门禁检查。
- 失效在任意非终态都可触发，记录到 `invalidated`，清除失效工件的结果/门禁，并回退到最早失效阶段 `pending`。
- `cocos-plan-project` 生成 capture manifest；`cocos-verify-game` 对全部冻结手机 profile 执行 Chrome 截图/交互和基线比对。
- 资源许可批准是 production 汇合门禁；代码绑定只能引用已批准资源。
- npx 安装按每个 Skill 暂存、验证后替换；失败时恢复旧目录。

## 验证

新增单元测试覆盖门禁伪造、路径逃逸、缺失工件、回退迁移、方向/分辨率、capture manifest、资源依赖和安装回滚；全量 Python、Node 与 Skill 校验必须通过。
