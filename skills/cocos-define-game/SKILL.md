---
name: cocos-define-game
description: Use when a Cocos Creator Web Mobile project needs its text brief and reference images converted into a reviewable, human-approved requirements document with scope, game loop, page flow, mobile controls, and acceptance criteria.
---

# Cocos Define Game

Convert requirements inputs into reviewable `.cocos-workflow/requirements.md` and return state-change evidence to `cocos-orchestrate-web-workflow`. Do not perform visual direction, planning, coding, editor integration, or delivery.

## Write Boundary

Only write the target project's `.cocos-workflow/requirements.md` and result/report paths explicitly assigned by the orchestrator task. It is forbidden to modify `.cocos-workflow/workflow.yaml`; the orchestrator is its sole writer. It is forbidden to call any Cocos MCP write operation or write scenes, assets, scripts, or project configuration.

Read the frozen screen orientation, design resolution, and adaptation strategy from `.cocos-workflow/project-profile.yaml`, then bind its content hash in `project_profile_hash`. Do not override, initialize, or rewrite orientation, resolution, or adaptation strategy.

## Procedure

1. Read the orchestrator's `workflow-contracts.md`, `state-machine.md`, and `mcp-safety-policy.md`; then read `project-profile.yaml` and [requirements-contract.md](references/requirements-contract.md). Confirm the assigned task, allowed paths, and inputs. When no PRD exists, or an approved requirements document has a decision-changing `decision_change`, require the hash-bound `$grilling` confirmation before writing requirements; otherwise return `blocked`.
2. Preserve the original text requirement and each reference image's path, purpose, and license status. Extract title, genre, audience, verifiable core loop, player goal, mobile controls, scope, page flow, and acceptance criteria.
3. Write scope, playability, or license gaps and conflicts to `unresolved_questions`. Do not assume omitted gameplay, audience, pages, win/loss conditions, or licenses. Write `draft` or `blocked` and list the answers needed to unblock.
4. Before approval, check complete scope, at least one playable core loop, all page-flow fields, and all acceptance-criteria fields. Present only contract-complete content for review.
5. Wait for explicit human approval. Without human approval, keep `approval.status` as `pending`; do not mark the document `approved`.
6. After approval, write the approver and timestamp, calculate a `sha256:` content hash over the front matter and Markdown body, excluding `content_hash` and `approval.subject_hash`, and set `status` to `approved`. Return artifacts, checks, evidence, and open issues through the assigned result/report path for orchestrator acceptance and state transition.

## Blocking Rules

Keep the document `blocked` or `draft` if the frozen `project-profile.yaml` is missing or its hash mismatches; a required `$grilling` confirmation is missing or mismatched; the scope conflicts; the core loop is unverifiable; page or acceptance criteria are incomplete; a reference-image license is unknown; unresolved questions remain; or explicit human approval is missing. Never invent functionality, approvers, timestamps, or hashes to bypass a gate.
