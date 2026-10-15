import { schemaContract, schemaEnum, schemaRequired } from './schema-contract.mjs';
import { hasResponsiveDeclaration, isResponsiveWorkItem, validateResponsiveContract, validateResponsiveEvidenceManifest, validateResponsiveEvidenceRecord } from '../responsive-viewport-contract.mjs';

const APPROVAL_FIELDS = schemaRequired('approval-ledger.schema.json', ['properties', 'approvals', 'items']);
const DELEGATION_SCHEMA = schemaContract('delegation-package.schema.json');
const EVIDENCE_REQUIRED = schemaRequired('evidence-manifest.schema.json');
const PACKAGE_SCHEMA = schemaContract('implementation-package.schema.json');
const CHANGE_REQUIRED = schemaRequired('change-request.schema.json');
const APPROVAL_ACTION_LEVELS = schemaEnum('approval-ledger.schema.json', ['properties', 'approvals', 'items', 'properties', 'actionLevel']);
const DELEGATION_ACTION_LEVELS = schemaEnum('delegation-package.schema.json', ['properties', 'actionLevel']);
const EVIDENCE_VERDICTS = schemaEnum('evidence-manifest.schema.json', ['properties', 'verdict']);
const CHANGE_STATUSES = schemaEnum('change-request.schema.json', ['properties', 'status']);
const STAGE_PATTERN = /^V[1-4]$/;

/** 创建控制面记录校验器，集中维护审批、委派、证据、实施包和变更请求边界。 */
export function createRecordValidators({
  gates, states, automaticActions, actionLevels, requireFields, requireStringArray,
  validateCocosAction, actionLevelFor, validateExecutionPlan, validateVisualImplementationPackage,
  validateVisualChangeRequest, pathMatches, fail,
}) {
  /** 校验审批记录类型、枚举和权限范围。 */
  function validateApproval(approval) {
    requireFields(approval, APPROVAL_FIELDS, `审批 ${approval?.approvalId ?? '<unknown>'}`);
    validateCocosAction(approval.actionType, approval.actionLevel, 'Approval Ledger.actionType');
    requireStringArray(approval.moduleIds, '审批.moduleIds');
    if (!approval.moduleIds.length || new Set(approval.moduleIds).size !== approval.moduleIds.length || JSON.stringify(approval.moduleIds) !== JSON.stringify([...approval.moduleIds].sort())) fail('审批 moduleIds 必须非空、唯一且已排序');
    if (!APPROVAL_ACTION_LEVELS.includes(approval.actionLevel) || !gates.includes(approval.gate)) fail('操作审批只能使用 A4-A6 与有效 F 门');
    if (!states.includes(approval.pendingState) || !approval.pendingContext) fail('审批未绑定 pending 全局状态与上下文');
    for (const field of ['impactSummary', 'fileScope', 'services', 'invalidatedWhen']) requireStringArray(approval[field], `审批.${field}`);
    if (!approval.impactSummary.length || approval.impactSummary.some((item) => !item.trim())) fail('审批 impactSummary 必须为非空影响列表');
    if (approval.externalTargets !== undefined) requireStringArray(approval.externalTargets, '审批.externalTargets');
    for (const field of ['allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release']) if (typeof approval[field] !== 'boolean') fail(`审批.${field} 必须为布尔值`);
    if (Number.isNaN(Date.parse(approval.approvedAt))) fail('审批 approvedAt 必须为有效时间');
    return approval;
  }

  /** 校验委派包结构与基础类型。 */
  function validateDelegation(delegation) {
    requireFields(delegation, DELEGATION_SCHEMA.required, 'Delegation Package');
    const extra = Object.keys(delegation).filter((field) => !DELEGATION_SCHEMA.fields.includes(field));
    if (extra.length) fail(`Delegation Package 包含 Schema 禁止字段：${extra.join('、')}`);
    for (const field of ['ownership', 'allowedActions', 'forbiddenActions', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands']) requireStringArray(delegation[field], `Delegation Package.${field}`);
    if (!delegation.ownership.length || !delegation.acceptanceCommands.length) fail('委派 ownership 和验收命令不能为空');
    for (const action of [...delegation.allowedActions, ...delegation.forbiddenActions]) validateCocosAction(action, null, 'Delegation Package 动作');
    if (!actionLevels.includes(delegation.actionLevel) || !DELEGATION_ACTION_LEVELS.includes(delegation.actionLevel)) fail('Delegation Package 只能委派 A0-A3 Cocos 动作');
    if ([...delegation.allowedActions, ...delegation.forbiddenActions].some((action) => !automaticActions.has(action))) fail('Delegation Package 动作只能包含 A0-A3 Cocos 动作');
    if (delegation.allowedActions.some((action) => actionLevelFor(action) !== delegation.actionLevel)) fail('Delegation Package.allowedActions 与 actionLevel 不一致');
    if (delegation.actionLevel === 'A3') {
      requireStringArray(delegation.executionUnitIds, 'Delegation Package.executionUnitIds');
      if (!delegation.executionUnitIds.length || new Set(delegation.executionUnitIds).size !== delegation.executionUnitIds.length || !Object.hasOwn(delegation, 'parallelGroup')) fail('A3 委派必须携带非空唯一 executionUnitIds 和 parallelGroup');
      if (delegation.parallelGroup !== null && (typeof delegation.parallelGroup !== 'string' || !delegation.parallelGroup.trim())) fail('A3 Delegation Package.parallelGroup 必须为非空字符串或 null');
    } else if (Object.hasOwn(delegation, 'executionUnitIds') || Object.hasOwn(delegation, 'parallelGroup')) fail('A0-A2 委派不得携带 executionUnitIds/parallelGroup');
    if (delegation.preserveOthersChanges !== true) fail('委派包必须明确不得覆盖他人修改');
    return delegation;
  }

  /** 校验证据清单的结构化字段。 */
  function validateEvidence(evidence) {
    requireFields(evidence, EVIDENCE_REQUIRED, 'Evidence Manifest');
    for (const field of ['dataSources', 'files', 'uncoveredItems', 'completedOutputs', 'completedUnitIds', 'satisfiedExitCriteria']) requireStringArray(evidence[field], `Evidence.${field}`);
    if (Number.isNaN(Date.parse(evidence.recordedAt))) fail('Evidence.recordedAt 必须为有效时间');
    if (!Array.isArray(evidence.commands) || !evidence.commands.length) fail('Evidence.commands 必须为非空数组');
    if (!EVIDENCE_VERDICTS.includes(evidence.verdict)) fail('Evidence.verdict 无效');
    requireFields(evidence.gateResults, gates.slice(0, 4), 'Evidence.gateResults');
    const evidenceStage = String(evidence.currentStage ?? evidence.current_stage ?? '').toUpperCase();
    if (evidenceStage === 'V4' || evidence.responsiveEvidence !== undefined || evidence.responsiveRuntimeEvidence !== undefined) {
      const contract = evidence.responsiveViewportContract ?? evidence.responsiveContract;
      const options = { stage: evidenceStage || 'V4' };
      const records = evidence.responsiveEvidence ?? evidence.responsiveRuntimeEvidence;
      // 独立清单结构校验尚无项目方向上下文；方向矩阵由后续绑定 Work Item/实施包的门复核。
      const responsiveErrors = contract
        ? validateResponsiveEvidenceManifest(evidence, contract, options)
        : !Array.isArray(records) || records.length === 0 ? ['V4 缺少真实响应式运行证据数组']
          : records.flatMap((record) => validateResponsiveEvidenceRecord(record, null, options));
      if (responsiveErrors.length) fail(responsiveErrors[0]);
    }
    return evidence;
  }

  /** 校验 Implementation Package 独立结构。 */
  function validateImplementationPackageShape(pkg, options = {}) {
    // 范围说明和停止条件是可选元数据；缺失时归一为空数组，关键标识、路径和完成定义仍由 Schema/下方规则强制。
    if (pkg && typeof pkg === 'object' && !Array.isArray(pkg)) {
      pkg.outOfScope ??= [];
      pkg.stopConditions ??= [];
    }
    requireFields(pkg, PACKAGE_SCHEMA.required, 'Implementation Package');
    const extra = Object.keys(pkg).filter((field) => !PACKAGE_SCHEMA.fields.includes(field));
    if (extra.length) fail(`Implementation Package 包含 Schema 禁止字段：${extra.join('、')}`);
    for (const field of ['approvedRequirements', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'definitionOfDone', 'stopConditions']) requireStringArray(pkg[field], `Implementation Package.${field}`);
    if (!pkg.approvedRequirements.length || !pkg.allowedPaths.length || !pkg.testScope.length || !pkg.definitionOfDone.length) fail('Implementation Package 的需求、路径、测试和完成定义不能为空');
    if (!pkg.fileOwnership || typeof pkg.fileOwnership !== 'object' || Array.isArray(pkg.fileOwnership) || !Object.keys(pkg.fileOwnership).length || Object.entries(pkg.fileOwnership).some(([path, owner]) => !path || typeof owner !== 'string' || !owner)) fail('Implementation Package.fileOwnership 必须为非空路径到所有者映射');
    validateExecutionPlan(pkg, pathMatches, fail);
    if (options.deferVisualValidation !== true) {
      const visualErrors = validateVisualImplementationPackage(pkg, { ...options, allowedPaths: pkg.allowedPaths, pathMatches });
      if (visualErrors.length) fail(visualErrors[0]);
    }
    const visualFields = ['visualContractVersion', 'candidateVersion', 'visualManifestFile', 'visualProductionUnits'];
    if (visualFields.some((field) => Object.hasOwn(pkg, field)) && visualFields.some((field) => pkg[field] === undefined)) fail('视觉 Implementation Package 必须同时提供 visualContractVersion、candidateVersion、visualManifestFile、visualProductionUnits');
    if (!pkg.packageId || !pkg.workItemId || !pkg.baselineVersion || !pkg.compatibilityStrategy || !pkg.approvedArchitecture) fail('Implementation Package 标识、版本、兼容策略或架构结论不能为空');
    const packageStage = String(options.stage ?? pkg.currentStage ?? pkg.current_stage ?? '').toUpperCase();
    const responsiveRequired = options.requireResponsive === true || STAGE_PATTERN.test(packageStage) || hasResponsiveDeclaration(pkg);
    if (responsiveRequired) {
      const identityFields = ['responsiveContractVersion', 'layoutContractVersion', 'visualBaselineVersion'];
      requireFields(pkg, identityFields, 'Implementation Package 响应式身份');
      if (identityFields.some((field) => typeof pkg[field] !== 'string' || !pkg[field].trim())) fail('Implementation Package 响应式合同、布局合同和视觉基线版本必须为非空字符串');
      const responsiveErrors = validateResponsiveContract(pkg, { stage: packageStage || 'V1', scope: pkg.packageId });
      if (responsiveErrors.length) fail(responsiveErrors[0]);
      for (const unit of pkg.executionUnits.filter((item) => ['SCENE', 'DISPLAY_LAYER'].includes(item?.unitType) && hasResponsiveDeclaration(item))) {
        const unitErrors = validateResponsiveContract(unit.responsiveContract ?? unit.responsiveViewportContract ?? unit, { stage: packageStage || 'V1', scope: unit.displayLayerId ?? unit.sceneId ?? unit.unitId });
        if (unitErrors.length) fail(unitErrors[0]);
      }
    }
    return pkg;
  }

  /** 校验 Change Request 独立结构。 */
  function validateChangeRequestShape(change) {
    requireFields(change, CHANGE_REQUIRED, 'Change Request');
    for (const field of ['affectedModules', 'invalidatedApprovalIds', 'newAcceptance']) requireStringArray(change[field], `Change Request.${field}`);
    if (!change.changeRequestId || !change.workItemId || !change.change || !change.reason || !change.newRisk || !change.userDecisionRequest || !change.affectedModules.length || !change.newAcceptance.length) fail('Change Request 标识、内容、原因、模块、风险、验收与决策请求不能为空');
    if (!CHANGE_STATUSES.includes(change.status)) fail('Change Request 状态只能为 PENDING/ACCEPTED/REJECTED；它记录用户决定而非审批');
    const productionErrors = validateVisualChangeRequest(change, { workItemId: change.workItemId, candidateVersion: change.candidateVersion });
    if (productionErrors.length) fail(productionErrors[0]);
    return change;
  }

  /** 校验 Change Request 与 Work Item 绑定。 */
  function validateChangeRequest(change, work) {
    validateChangeRequestShape(change);
    if (change.workItemId !== work.workItemId) fail('Change Request 工作项无效');
    return change;
  }

  /** 为 evidence-check 提供绑定当前 Work Item/实施单元的二次响应式门。 */
  function validateResponsiveEvidence(evidence, contract = null, options = {}) {
    const errors = validateResponsiveEvidenceManifest(evidence, contract, options);
    if (errors.length) fail(errors[0]);
    return evidence;
  }

  return { validateApproval, validateDelegation, validateEvidence, validateResponsiveEvidence, validateImplementationPackageShape, validateChangeRequestShape, validateChangeRequest };
}
