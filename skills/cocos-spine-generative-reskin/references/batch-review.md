# 批次计划与人工锁定

批次计划是 schema v3 清单中的不可变生产顺序。每个 Batch 显式包含唯一 `id`、`order`、Region 精确列表、列表顺序、mode、`alpha_lock`，连续特效批次还包含 `effect_sequence` 和四项机器指标：颜色一致性、亮度连续性、轮廓平滑度、发光方向。

计划导入时必须证明：Region 无重复、无遗漏、全集覆盖 Atlas Region；Mesh 只能是 `mesh-safe` 且 `alpha_lock=true`；`constrained-redraw` 必须显式 `alpha_lock=false`。任何时候只有第一个未 `ACCEPTED+locked` 的批次可生成，后批命令 fail closed。

正式停止门固定为：

```text
batch prepare → 当前批源参考板 → 生成当前批 Cell → batch review → 唯一审阅图 → STOP
→ 用户确认 → batch accept → Cell validating → 当前批 ACCEPTED+locked
```

源参考板和审阅图都绑定批次、revision、Region 名称和顺序，名称/顺序写入同名 JSON sidecar。`spine_batch_acceptance` 记录人工确认及实际审阅文件，摘要仅作可选追踪；不要求 `--review-sha` 或 fingerprint 校验。当前批次刚展示且由 `--batch` 指定时，确认文本可使用简短“确认”，也可使用当前 revision 对应的完整句（初始批次 `确认第N批`，返工 revision `确认重启版第N批`）；空白、无关或否定文本仍拒绝。revision、批次顺序和真实产物检查保留。`batch reopen` 只清理当前批候选并增加 revision，已接受批次和后批不允许修改。

该回执是 V3 正式资源生产中的局部锁定，不写入全局 Approval Ledger，也不替代场景 V2 的拆解与布局确认。
