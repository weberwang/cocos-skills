import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DPR,
  DPR_POLICY,
  IMAGE_PRODUCTION_DPR,
  RUNTIME_MAX_DPR,
  isDeviceDprInput,
  isImageProductionDpr,
  isWorkflowDpr,
  parseDeviceDpr,
  validateImageProductionDpr,
  validateWorkflowDpr,
} from "./workflow-dpr-contract.mjs";

test("统一真源区分运行时封顶与图片生产基线", () => {
  assert.equal(RUNTIME_MAX_DPR, 2);
  assert.equal(IMAGE_PRODUCTION_DPR, 1);
  assert.equal(DEFAULT_DPR, 1);
  assert.equal(DPR_POLICY, "dynamic-capped-2");
  assert.equal(isImageProductionDpr(1), true);
  assert.equal(isImageProductionDpr(1.5), false);
  assert.equal(isImageProductionDpr(2), false);
});

test("运行时设备 DPR 动态解析并封顶", () => {
  for (const [input, expected] of [[undefined, 1], [null, 1], [0.5, 0.5], [1, 1], [1.5, 1.5], [2, 2], [3, 2]]) {
    assert.equal(parseDeviceDpr(input), expected, `deviceDpr=${String(input)}`);
  }
  for (const input of [0, -1, NaN, Infinity, "2", "1.5"]) assert.equal(parseDeviceDpr(input), DEFAULT_DPR, `deviceDpr=${String(input)}`);
});

test("有效 DPR 声明只允许正有限数且不超过 2", () => {
  for (const value of [0.5, 1, 1.25, 1.5, 2]) {
    assert.equal(isWorkflowDpr(value), true);
    assert.equal(validateWorkflowDpr(value), null);
  }
  for (const value of [0, -1, 2.0001, 3, NaN, Infinity, "2", undefined]) {
    assert.equal(isWorkflowDpr(value), false);
    assert.match(validateWorkflowDpr(value), /正有限数字且不超过 2/);
  }
});

test("原始设备值与图片生产基线校验职责分离", () => {
  assert.equal(isDeviceDprInput(3), true);
  assert.equal(isDeviceDprInput(0), false);
  assert.equal(validateImageProductionDpr(1), null);
  assert.match(validateImageProductionDpr(1.5), /图片生产基线 1/);
  assert.match(validateImageProductionDpr(2), /图片生产基线 1/);
});
