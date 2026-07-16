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
copy_inventory_path: art/concepts/home/ui-copy.yaml
copy_inventory_hash: sha256:<真实文案清单哈希>
required_component_states: [normal, pressed, disabled, selected]
viewport_previews:
  - {profile_id: mobile-small, path: art/concepts/home/pencil-mobile-small.png, content_hash: sha256:<hash>}
  - {profile_id: mobile-standard, path: art/concepts/home/pencil-mobile-standard.png, content_hash: sha256:<hash>}
  - {profile_id: mobile-large, path: art/concepts/home/pencil-mobile-large.png, content_hash: sha256:<hash>}
structural_checks: [] # page-structure、art-reserve、eye-flow、primary-action、ui-hierarchy、navigation-interaction、touch-target、copy-fit、safe-area
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash>
```

- 源文件与预览必须存在于任务分配的 `art/concepts/<scene_id>/`，且二进制 SHA-256 与记录一致。
- `copy_inventory_path` 必须列出所有可见真实文案、用途和最大长度，不得以 lorem、乱码或未批准占位文案替代。
- `structural_checks` 必须覆盖页面结构、原画保留区、视线动线、主操作、UI 层级、导航/交互区域、触控尺寸、文案适配和安全区。
- `viewport_previews` 必须覆盖项目配置中的全部捕获视口，至少包含 mobile-small、mobile-standard、mobile-large；任一截断、重叠或焦点遮挡均阻塞批准。
- `status: approved` 时，全部结构检查通过，且 `approval.subject_hash == pencil_source_hash`。草图源文件、预览、结构或冻结输入变化均使该场景全部下游结果 `stale`。
