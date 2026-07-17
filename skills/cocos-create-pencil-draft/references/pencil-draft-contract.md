# Pencil 草图契约

每个场景/UI 草图工件位于 `.cocos-workflow/artifacts/pencil-drafts/<scene_id>.md`，以 YAML front matter 保存审批元数据，并用 Markdown 正文说明布局与交互结构。

```yaml
schema_version: 2
status: pending # pending | blocked | rejected | approved | stale
scene_id: home
scene_loop_id: scene-loop-home
requirements_hash: sha256:<hash>
project_profile_hash: sha256:<hash>
visual_direction: {version: 1, content_hash: sha256:<hash>}
pencil_source_path: art/concepts/home/pencil-draft.pen
pencil_source_hash: sha256:<Pencil source binary hash>
preview_path: art/concepts/home/pencil-preview.png
preview_hash: sha256:<preview binary hash>
structural_checks: [] # page-structure, primary-action, ui-hierarchy, navigation-interaction, safe-area
functional_visual_checks: [] # primary-action-identifiable, interaction-regions, hierarchy, state-feedback, text-capacity
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- 源文件与预览必须存在于任务分配的 `art/concepts/<scene_id>/`，且二进制 SHA-256 与记录一致。
- `structural_checks` 必须覆盖页面结构、主操作、UI 层级、导航/交互区域和安全区。
- `functional_visual_checks` 必须覆盖主操作可辨识、交互区域、信息层级、状态反馈位置和文本容量；缺少任一项不得进入高保真效果图阶段。
- `status: approved` 时，全部结构检查通过，且 `approval.subject_hash == pencil_source_hash`。草图源文件、预览、结构或冻结输入变化均使该场景全部下游结果 `stale`。
