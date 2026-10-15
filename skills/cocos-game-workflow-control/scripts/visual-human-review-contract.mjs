#!/usr/bin/env node

/** 视觉对象审阅字段禁用合同。 */

/** 判断是否为普通对象。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断值是否为去除空白后仍有内容的字符串。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断 evidence 是否包含可复核内容；空对象、空数组和 null 不能绕过人工审阅。 */
export function isReviewEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 从视觉确认对象中读取身份摘要，错误信息不会泄露为裸 reviewer 字符串。 */
export function reviewerSummary(review) {
  if (!isObject(review)) return "missing";
  const type = review.reviewer_type ?? "missing-type";
  const id = review.reviewer_id ?? "missing-id";
  const status = review.status ?? "missing-status";
  return `${String(type)}/${String(id)}/${String(status)}`;
}

/**
 * 机器/AI 审阅允许使用的结构化身份类型。
 *
 * 场景视觉流程使用 V2 拆解图确认；后续阶段的检查可以由机器或 AI
 * 产出，但仍必须带可追溯身份和证据，不能把裸 PASS 当作审阅记录。
 */
export const STRUCTURED_REVIEWER_TYPES = Object.freeze([
  "human",
  "ai",
  "agent",
  "model",
  "automated",
]);

/** 旧式 V2 审批字段不再允许参与场景视觉证据。 */
const VISUAL_APPROVAL_REVIEWER_FIELDS = Object.freeze([
  "reviewer_type",
  "reviewerType",
  "reviewer_id",
  "reviewerId",
  "reviewer",
  "human_review",
  "humanReview",
]);

/**
 * V2 拆解确认后不再创建任何新的视觉复核身份或复核工件。
 *
 * 这些字段曾被 V3/F2 当成第二套人工/AI 审阅入口；现在它们会掩盖
 * 已冻结的 V2 拆解方案并造成重复确认，因此由共享门统一 fail closed。机器
 * 验证只能写入明确的确定性事实，例如文件 SHA、运行消费和 fidelity case。
 */
export const VISUAL_POST_APPROVAL_REVIEW_FIELDS = Object.freeze([
  "reviewer",
  "reviewer_type",
  "reviewerType",
  "reviewer_id",
  "reviewerId",
  "review_id",
  "reviewId",
  "reviewed_at",
  "reviewedAt",
  "human_review",
  "humanReview",
]);

/** V3/V4 禁止重复生成的视觉复核工件名称。 */
export const VISUAL_POST_APPROVAL_REVIEW_ARTIFACTS = Object.freeze([
  "f2_review",
  "f2_reviews",
  "f2Review",
  "f2Reviews",
  "visual_fidelity_review",
  "visualFidelityReview",
  "production_contract_review",
  "productionContractReview",
  "component_reviews",
  "componentReviews",
]);

/** 计算视觉问题最早应退回的阶段。 */
export function earliestVisualReturnStage(stage, fallback = "V1/PROPOSAL") {
  const normalized = String(stage ?? "V1").toUpperCase();
  if (normalized === "V1" || normalized === "V2") return "V1/PROPOSAL";
  if (normalized === "V3") return "V2/V3";
  if (normalized === "F2") return "V3/F2";
  return fallback;
}

/** 生成包含场景、区域、资产和人工身份的视觉审阅错误。 */
export function humanReviewError(context = {}, message, details = {}) {
  const stage = context.stage ?? "V1";
  const scene = context.scene_id ?? context.sceneId ?? "*";
  const state = context.state_id ?? context.stateId ?? "*";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "*";
  const region = context.region_id ?? context.regionId ?? "*";
  const component = context.component_id ?? context.componentId ?? "*";
  const asset = context.asset_id ?? context.assetId ?? "*";
  const expected = details.expected ?? "reviewer_type=human, reviewer_id, reviewed_at, evidence, status";
  const actual = details.actual ?? reviewerSummary(details.review ?? context.review);
  const returnStage = details.returnStage ?? context.returnStage ?? earliestVisualReturnStage(stage);
  const rootCause = details.rootCause ?? (String(returnStage).startsWith("V1") ? "方案缺失" : "验收问题");
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${region} component_id=${component} asset_id=${asset} 根因=${rootCause} 预期 human reviewer=${expected} 实际 reviewer=${actual} ${message} 应退回阶段=${returnStage}`;
}

/** 校验一个结构化人工审阅身份。 */
export function validateHumanReview(review, context = {}, options = {}) {
  const errors = [];
  const fail = (message, expected, actual = reviewerSummary(review)) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  if (!isObject(review)) {
    fail("缺少结构化人工审阅身份", "reviewer_type=human, reviewer_id, reviewed_at, evidence, status", "missing");
    return errors;
  }
  if (review.reviewer_type !== "human") fail("reviewer_type 必须为 human，自动/AI/agent/model reviewer 不得通过", "reviewer_type=human", reviewerSummary(review));
  if (!nonEmptyString(review.reviewer_id)) fail("缺少非空 reviewer_id；仅 reviewer 字符串不能作为人工身份", "reviewer_id=non-empty", reviewerSummary(review));
  if (!nonEmptyString(review.reviewed_at) || Number.isNaN(Date.parse(review.reviewed_at))) fail("缺少可解析 reviewed_at", "reviewed_at=ISO-8601", reviewerSummary(review));
  if (!isReviewEvidence(review.evidence)) fail("缺少有效人工审阅 evidence", "evidence=non-empty path/object/list", reviewerSummary(review));
  if (!["passed", "PASS", "failed", "FAIL"].includes(String(review.status))) fail("人工审阅 status 必须为 passed 或 failed", "status=passed|failed", reviewerSummary(review));
  if (options.requirePassed === true && !["passed", "PASS"].includes(String(review.status))) fail("人工审阅必须通过", "status=passed", reviewerSummary(review));
  return errors;
}

/** 校验不要求真人的机器/AI 结构化检查；身份和证据字段仍不可省略。 */
export function validateStructuredReview(review, context = {}, options = {}) {
  const errors = [];
  const fail = (message, expected, actual = reviewerSummary(review)) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  if (!isObject(review)) {
    fail("缺少结构化机器/AI 审阅记录", "reviewer_type、reviewer_id、reviewed_at、evidence、status", "missing");
    return errors;
  }
  if (!STRUCTURED_REVIEWER_TYPES.includes(review.reviewer_type)) fail("reviewer_type 必须为 human|ai|agent|model|automated", "reviewer_type=human|ai|agent|model|automated");
  if (!nonEmptyString(review.reviewer_id)) fail("缺少非空 reviewer_id；机器审阅也必须可追溯", "reviewer_id=non-empty");
  if (!nonEmptyString(review.reviewed_at) || Number.isNaN(Date.parse(review.reviewed_at))) fail("缺少可解析 reviewed_at", "reviewed_at=ISO-8601");
  if (!isReviewEvidence(review.evidence)) fail("缺少有效结构化审阅 evidence", "evidence=non-empty path/object/list");
  if (!["passed", "PASS", "failed", "FAIL"].includes(String(review.status))) fail("结构化审阅 status 必须为 passed 或 failed", "status=passed|failed");
  if (options.requirePassed === true && !["passed", "PASS"].includes(String(review.status))) fail("结构化审阅必须通过", "status=passed");
  return errors;
}

/** 已废弃的旧视觉人工审批入口；新流程只接受 V2 拆解图确认。 */
export function validateVisualHumanApproval(approval, binding = {}, context = {}, options = {}) {
  void binding;
  return [humanReviewError({ ...context, review: approval }, "旧式视觉人工审批已移除；V2 必须使用拆解图、技术 JSON 与生产方案确认", {
    expected: "visual-decomposition-confirmation/1.0",
    actual: reviewerSummary(approval),
    review: approval,
    returnStage: options.returnStage ?? "V2",
    rootCause: options.rootCause,
  })];
}

/** 校验人工审阅中显式记录的工作项、候选版本和场景身份。 */
export function validateHumanReviewIdentity(review, identity = {}, context = {}, options = {}) {
  const errors = [];
  if (!isObject(review)) return errors;
  const fail = (message, expected, actual) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual: `${reviewerSummary(review)}; binding=${String(actual ?? "missing")}`, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  const reviewed = review.reviewed_identity ?? review.reviewedIdentity ?? {};
  const pairs = [
    ["workItemId", identity.workItemId ?? identity.work_item_id, review.workItemId ?? review.work_item_id ?? reviewed.workItemId ?? reviewed.work_item_id],
    ["candidateId", identity.candidateId ?? identity.candidate_id, review.candidateId ?? review.candidate_id ?? reviewed.candidateId ?? reviewed.candidate_id],
    ["candidateVersion", identity.candidateVersion ?? identity.candidate_version, review.candidateVersion ?? review.candidate_version ?? reviewed.candidateVersion ?? reviewed.candidate_version],
    ["sceneId", identity.sceneId ?? identity.scene_id, review.sceneId ?? review.scene_id ?? reviewed.sceneId ?? reviewed.scene_id],
    ["stateId", identity.stateId ?? identity.state_id, review.stateId ?? review.state_id ?? reviewed.stateId ?? reviewed.state_id],
  ];
  for (const [field, expected, actual] of pairs) {
    if (nonEmptyString(expected) && nonEmptyString(actual) && actual !== expected) fail(`人工审阅 ${field} 与当前身份不一致`, expected, actual);
  }
  return errors;
}

/**
 * 校验视觉对象没有携带 V2 通过后的重复复核字段或工件。
 *
 * 视觉对象只能保存确定性机器验证事实。递归检查便于同时覆盖
 * manifest、Evidence Manifest、F2 gateResult 和嵌套的 fidelity/asset 记录。
 */
export function validateVisualPostApprovalReviewFields(value, options = {}) {
  const errors = [];
  const stage = options.stage ?? "V3/V4";
  const contextFor = (path) => ({ stage, region_id: path || "*" });
  const walk = (current, path = "") => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (["visual_human_approval", "visualHumanApproval"].includes(key)) {
        errors.push(humanReviewError(contextFor(childPath), `禁止使用旧式视觉方向审批 ${key}；场景 V2 只接受拆解图确认`, { expected: "visual-decomposition-confirmation/1.0", actual: key, returnStage: stage }));
        continue;
      }
      if (VISUAL_POST_APPROVAL_REVIEW_ARTIFACTS.includes(key)) {
        errors.push(humanReviewError(contextFor(childPath), `禁止使用重复视觉复核工件 ${key}；V2 拆解确认后只允许确定性机器验证`, { expected: "无重复复核工件", actual: key, returnStage: stage }));
        continue;
      }
      if (VISUAL_POST_APPROVAL_REVIEW_FIELDS.includes(key)) errors.push(humanReviewError(contextFor(childPath), `禁止使用视觉复核字段 ${key}；拆解确认后不得再次复核`, { expected: "无 reviewer/review/human_review 字段", actual: key, returnStage: stage }));
      walk(child, childPath);
    }
  };
  walk(value);
  return errors;
}
