import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { validateArtExperienceAcceptance, ART_EXPERIENCE_SCENARIOS } from './art-experience-acceptance-contract.mjs';

/** 生成通过的最小合同对象，供合同层边界测试复用。 */
function validAcceptance(recordingFile) {
  return {
    schemaVersion: 'cocos-art-experience-acceptance/1.0',
    workItemId: 'WI-1',
    candidateId: 'V4-1',
    sceneId: 'play',
    status: 'passed',
    confirmedAt: '2026-10-01T12:00:00.000Z',
    userOriginalText: '用户确认本次持续游玩美术体验通过',
    viewingContext: '手机竖屏下的连续关卡游玩',
    checks: Object.fromEntries(['themeFit', 'audienceFit', 'readability', 'comfort', 'craft'].map((dimension) => [dimension, { status: 'passed', reason: '与当前项目目标一致' }])),
    scenarios: [
      { kind: 'normal-play', applicability: 'required', reason: '常态游玩必测', recordingFile, startSeconds: 2, endSeconds: 20, triggerCount: 18, peakConcurrent: 1, observation: '持续游玩时核心目标清楚，特效不抢视线。' },
      ...ART_EXPERIENCE_SCENARIOS.slice(1).map((kind) => ({ kind, applicability: 'not-applicable', reason: '该玩法没有对应事件', recordingFile: null, startSeconds: null, endSeconds: null, triggerCount: null, peakConcurrent: null, observation: null })),
    ],
  };
}

/** 创建合同需要的项目录屏测试文件。 */
function makeProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cocos-art-acceptance-'));
  mkdirSync(join(projectRoot, 'evidence'), { recursive: true });
  writeFileSync(join(projectRoot, 'evidence', 'play.test-recording'), 'synthetic recording bytes\n');
  return { projectRoot, recordingFile: 'evidence/play.test-recording' };
}

test('验收合同接受当前 V4 身份、完整五维人工判断与合法不适用项', () => {
  const project = makeProject();
  const acceptance = validAcceptance(project.recordingFile);
  assert.deepEqual(validateArtExperienceAcceptance(acceptance, {
    workItemId: 'WI-1', candidateId: 'V4-1', sceneId: 'play',
  }, project), []);
});

test('不适用事件不要求录屏，但不能附带伪造观看字段', () => {
  const project = makeProject();
  const acceptance = validAcceptance(project.recordingFile);
  acceptance.scenarios[1] = { ...acceptance.scenarios[1], recordingFile: 'evidence/play.test-recording' };
  const errors = validateArtExperienceAcceptance(acceptance, {
    workItemId: 'WI-1', candidateId: 'V4-1', sceneId: 'play',
  }, project);
  assert(errors.some((message) => message.includes('必须为 null')));
});
