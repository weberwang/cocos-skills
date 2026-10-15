import assert from 'node:assert/strict';
import test from 'node:test';
import { renderResult, resultRecord } from './output.mjs';

/** 验证统一结果始终使用固定字段顺序和紧凑中文摘要。 */
test('统一结果字段稳定且默认文本紧凑', () => {
  const record = resultRecord({
    status: 'BLOCKED', stage: 'G1/REVIEW', changed: ['x', 'x'], blocking: ['唯一根因'], next: '运行 check',
    metadata: { planFingerprint: `sha256:${'a'.repeat(64)}`, disposition: 'repair' },
  });
  assert.deepEqual(Object.keys(record), ['status', 'stage', 'changed', 'blocking', 'next', 'metadata']);
  assert.equal(record.changed.length, 1);
  assert.equal(renderResult(record).split('\n').filter(Boolean).length <= 20, true);
});

/** 验证 --json 对同一结果产生单对象、单行输出。 */
test('--json 结果可直接被自动化消费', () => {
  const record = resultRecord({ status: 'READY', stage: 'G0/INTAKE', next: '运行 run' });
  assert.equal(JSON.stringify(record).split('\n').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});
