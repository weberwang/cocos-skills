import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 计算测试产物的实际摘要，供 Work Item 引用不可变来源文件。 */
function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** 写入阶段证据并返回项目内相对路径及其实际摘要。 */
function writeArtifact(repo, file, value) {
  const path = resolve(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, bytes);
  return { path: file, sha256: hashBytes(bytes) };
}

/** 创建结构有效的 V4 美术体验人工验收记录，供控制流测试复用。 */
function fixtureArtExperienceAcceptance(repo, workItemId, candidateId, sceneId) {
  const recordingFile = 'docs/art-experience-normal-play.test-recording';
  // 自动化夹具只检查录屏文件存在性，不读取或判断录屏的视觉内容。
  writeFileSync(resolve(repo, recordingFile), 'synthetic recording fixture\n');
  return {
    schemaVersion: 'cocos-art-experience-acceptance/1.0',
    workItemId,
    candidateId,
    sceneId,
    status: 'passed',
    confirmedAt: '2026-10-01T00:00:00.000Z',
    userOriginalText: '自动化夹具中的人工验收示例',
    viewingContext: '固定视口下的连续关卡游玩情境',
    checks: Object.fromEntries(['themeFit', 'audienceFit', 'readability', 'comfort', 'craft'].map((dimension) => [dimension, { status: 'passed', reason: '夹具用例已覆盖此项' }])),
    scenarios: [
      { kind: 'normal-play', applicability: 'required', reason: '常态游玩始终适用', recordingFile, startSeconds: 0, endSeconds: 20, triggerCount: 20, peakConcurrent: 1, observation: '连续游玩片段可持续辨认核心对象，视觉表现稳定。' },
      ...['repeated-feedback', 'event-peak', 'overlap-peak'].map((kind) => ({ kind, applicability: 'not-applicable', reason: '此夹具候选不包含该类玩法事件', recordingFile: null, startSeconds: null, endSeconds: null, triggerCount: null, peakConcurrent: null, observation: null })),
    ],
  };
}

/**
 * 在已有 V2 场景夹具上绑定 V3 正式资源和 V4 运行证据。
 * V2/V3/V4 共享场景、候选身份和真实资源文件，不生成中间草图数据。
 */
export function bindVisualEvidenceFixture({ repo, work, pkg }) {
  const v2File = work.visualStageEvidenceRefs.V2.path;
  const plan = JSON.parse(readFileSync(resolve(repo, v2File), 'utf8'));
  const sceneId = plan.sceneId;
  const sceneContract = JSON.parse(readFileSync(resolve(repo, plan.sceneReconstructionContract.file), 'utf8'));
  const targetConditions = sceneContract.target_conditions;
  const candidateVersion = 'candidate-test';
  const sceneMasterBytes = readFileSync(resolve(repo, plan.sceneMaster.file));
  const targetSha = hashBytes(sceneMasterBytes);
  plan.targetSha256 = targetSha;
  plan.sceneMaster.sha256 = targetSha;
  plan.visualDecompositionConfirmation.targetSha256 = targetSha;
  const v2Ref = writeArtifact(repo, v2File, plan);

  const assetFile = 'docs/production-asset.png';
  // 一像素 PNG 只用于证明 V3/V4 路径门读取的是实际存在的资源文件。
  const assetBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=', 'base64');
  writeFileSync(resolve(repo, assetFile), assetBytes);
  const assetSha = hashBytes(assetBytes);
  const candidateIdentity = { sha256: plan.candidateSha256, diffFingerprint: plan.diffFingerprint };
  const manifest = {
    schema_version: '1.5',
    workItemId: work.workItemId,
    candidateVersion,
    reference_target: { original_file: plan.sceneMaster.file, target_sha256: targetSha, scene_ids: [sceneId], state_ids: [targetConditions.state_id] },
    coverage_audit: { canvases: [{ scene_id: sceneId, state_id: targetConditions.state_id, width: targetConditions.viewport.width, height: targetConditions.viewport.height }] },
    candidate_identity: candidateIdentity,
    assets: [{ id: 'test-image', status: 'accepted', sha256: assetSha, runtime_outputs: [assetFile] }],
    production_contract_audit: {
      status: 'passed',
      candidate_version: candidateVersion,
      units: [{ annotation_number: 1, region_id: 'test-image-region', status: 'passed', actual_assets: [{ asset_id: 'test-image', file: assetFile, sha256: assetSha }] }],
    },
  };
  const manifestRef = writeArtifact(repo, 'docs/visual-manifest-v3.json', manifest);
  const common = {
    workItemId: work.workItemId,
    baselineHash: work.baselineHash,
    contentHash: candidateIdentity.sha256,
    diffFingerprint: candidateIdentity.diffFingerprint,
    status: 'PASS',
    candidateIdentity,
    files: [assetFile],
    fileHashes: { [assetFile]: assetSha },
  };
  const v3Ref = writeArtifact(repo, 'docs/v3-acceptance.json', {
    ...common,
    evidenceType: 'v3-formal-acceptance',
    acceptanceId: 'V3-TEST',
    targetSha256: targetSha,
    candidateVersion,
    visualManifestFile: manifestRef.path,
    visualManifestSha256: manifestRef.sha256,
    formalAssets: [{ id: 'test-image', status: 'accepted' }],
    components: [{ id: 'test-component', status: 'accepted' }],
  });

  const sceneFile = 'docs/v4-runtime-scene.png';
  writeFileSync(resolve(repo, sceneFile), assetBytes);
  const candidateId = 'V4-TEST';
  const v4Ref = writeArtifact(repo, 'docs/v4-runtime-candidate.json', {
    ...common,
    candidateId,
    evidenceType: 'v4-runtime-integration-candidate',
    files: [sceneFile],
    fileHashes: { [sceneFile]: assetSha },
    artExperienceAcceptance: fixtureArtExperienceAcceptance(repo, work.workItemId, candidateId, sceneId),
  });

  work.visualStageEvidenceRefs = { V2: v2Ref, V3: v3Ref, V4: v4Ref };
  for (const unit of pkg.executionUnits ?? []) {
    if (unit.highFidelityPrerequisite) {
      Object.assign(unit.highFidelityPrerequisite, {
        targetSha256: targetSha,
        candidateSha256: plan.candidateSha256,
        diffFingerprint: plan.diffFingerprint,
        evidenceSha256: v2Ref.sha256,
      });
    }
  }
  return { targetSha, plan, manifest, refs: work.visualStageEvidenceRefs };
}

/** 将替换实施包重新绑定当前 V2 来源摘要，保持其来源身份与当前场景证据一致。 */
export function bindPackageToVisualEvidenceFixture({ repo, work, pkg }) {
  const plan = JSON.parse(readFileSync(resolve(repo, work.visualStageEvidenceRefs.V2.path), 'utf8'));
  for (const unit of pkg.executionUnits ?? []) {
    if (unit.highFidelityPrerequisite) {
      Object.assign(unit.highFidelityPrerequisite, {
        targetSha256: plan.targetSha256,
        candidateSha256: plan.candidateSha256,
        diffFingerprint: plan.diffFingerprint,
        evidenceSha256: work.visualStageEvidenceRefs.V2.sha256,
      });
    }
  }
}
