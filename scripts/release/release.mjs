#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ReleaseClient, release } from 'nx/release';
import semver from 'semver';

const cwd = process.cwd();
const mode = process.env.RELEASE_MODE;
const rawRefName =
  process.env.RELEASE_REF ||
  process.env.GITHUB_REF_NAME ||
  runOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const branch = normalizeRef(rawRefName);
const remote = process.env.GIT_REMOTE ?? 'origin';
const stableBranch = process.env.RELEASE_STABLE_BRANCH ?? 'main';
const representativePackagePath =
  process.env.RELEASE_VERSION_PACKAGE ??
  'packages/react-native-harness/package.json';
const versionPlansDir = path.join(cwd, '.nx', 'version-plans');

if (!['stable', 'rc', 'canary'].includes(mode)) {
  fail('RELEASE_MODE must be set to stable, rc, or canary');
}

function normalizeRef(ref) {
  return ref.replace(/^refs\/heads\//, '').trim();
}

function isReleaseBranch(ref) {
  return /^release\/v\d+\.\d+(?:\.\d+)?$/.test(ref);
}

function parseReleaseBranchVersion(ref) {
  const match = ref.match(/^release\/v(\d+)\.(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return null;
  }

  return `${match[1]}.${match[2]}.${match[3] ?? '0'}`;
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function runOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  }).trim();
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function ensureCleanWorktree() {
  const status = runOutput('git', ['status', '--porcelain']);

  if (status.length > 0) {
    fail('working tree must be clean before running release automation');
  }
}

function ensureRemoteBranch() {
  if (
    !commandSucceeds('git', [
      'ls-remote',
      '--exit-code',
      '--heads',
      remote,
      branch,
    ])
  ) {
    fail(`branch ${branch} must exist on ${remote}`);
  }
}

function ensureGithubToken() {
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    fail('GITHUB_TOKEN or GH_TOKEN must be set');
  }
}

function ensureNpmToken() {
  if (!process.env.NODE_AUTH_TOKEN) {
    fail('NODE_AUTH_TOKEN must be set');
  }
}

function readVersion() {
  const filePath = path.join(cwd, representativePackagePath);
  const packageJson = JSON.parse(readFileSync(filePath, 'utf8'));

  if (
    typeof packageJson.version !== 'string' ||
    packageJson.version.length === 0
  ) {
    fail(`could not read version from ${representativePackagePath}`);
  }

  return packageJson.version;
}

function getVersionPlans() {
  if (!existsSync(versionPlansDir)) {
    return [];
  }

  return readdirSync(versionPlansDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => path.join(versionPlansDir, fileName));
}

function deleteVersionPlans(versionPlans) {
  for (const versionPlan of versionPlans) {
    rmSync(versionPlan, { force: true });
  }
}

function stageReleaseFiles() {
  run('git', [
    'add',
    '-A',
    '.nx/version-plans',
    'packages',
    'CHANGELOG.md',
    'pnpm-lock.yaml',
  ]);

  const staged = runOutput('git', ['diff', '--cached', '--name-only']);

  if (staged.length === 0) {
    fail('no release files were staged for commit');
  }
}

function commitVersionChanges(version) {
  stageReleaseFiles();
  run('git', ['commit', '-m', `chore: release v${version}`]);
}

function createTag(version) {
  const tag = `v${version}`;

  if (commandSucceeds('git', ['rev-parse', '--verify', `refs/tags/${tag}`])) {
    fail(`tag ${tag} already exists locally`);
  }

  if (
    commandSucceeds('git', [
      'ls-remote',
      '--exit-code',
      '--tags',
      remote,
      `refs/tags/${tag}`,
    ])
  ) {
    fail(`tag ${tag} already exists on ${remote}`);
  }

  run('git', ['tag', tag]);
}

function pushBranchAndTag(version) {
  run('git', ['push', remote, `HEAD:${branch}`]);
  run('git', ['push', remote, `refs/tags/v${version}`]);
}

function createGitHubRelease(version, notes, prerelease = false) {
  ensureGithubToken();

  const tempDir = mkdtempSync(path.join(tmpdir(), 'release-notes-'));
  const notesPath = path.join(tempDir, 'notes.md');

  writeFileSync(notesPath, notes);

  const args = ['release', 'create', `v${version}`, '--title', `v${version}`];

  if (prerelease) {
    args.push('--prerelease');
  }

  args.push('--notes-file', notesPath, '--target', branch);

  try {
    run('gh', args);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertPublishSucceeded(results) {
  const failedProjects = Object.entries(results)
    .filter(([, result]) => result.code !== 0)
    .map(([project]) => project);

  if (failedProjects.length > 0) {
    fail(`publishing failed for: ${failedProjects.join(', ')}`);
  }
}

function getNextRcVersion(targetVersion, currentVersion) {
  const parsedCurrent = semver.parse(currentVersion);

  if (!parsedCurrent) {
    fail(`current version ${currentVersion} is not valid semver`);
  }

  if (parsedCurrent.version === targetVersion) {
    return `${targetVersion}-rc.0`;
  }

  const prerelease = parsedCurrent.prerelease;
  const stableCurrent = `${parsedCurrent.major}.${parsedCurrent.minor}.${parsedCurrent.patch}`;

  if (stableCurrent === targetVersion && prerelease[0] === 'rc') {
    const nextVersion = semver.inc(currentVersion, 'prerelease', 'rc');

    if (!nextVersion) {
      fail(`could not determine next rc version from ${currentVersion}`);
    }

    return nextVersion;
  }

  return `${targetVersion}-rc.0`;
}

function getCanaryVersion(currentVersion) {
  const parsedCurrent = semver.parse(currentVersion);

  if (!parsedCurrent) {
    fail(`current version ${currentVersion} is not valid semver`);
  }

  const stableCurrent = `${parsedCurrent.major}.${parsedCurrent.minor}.${parsedCurrent.patch}`;
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const shortSha = runOutput('git', ['rev-parse', '--short', 'HEAD']);

  return `${stableCurrent}-canary.${timestamp}.${shortSha}`;
}

async function runStableRelease() {
  if (branch !== stableBranch) {
    fail(`stable releases must run from ${stableBranch}, received ${branch}`);
  }

  ensureRemoteBranch();
  ensureGithubToken();
  ensureNpmToken();

  await release({
    yes: true,
    skipPublish: false,
  });
}

async function runRcRelease() {
  if (branch === stableBranch) {
    fail(`rc releases must not run from ${stableBranch}`);
  }

  if (!isReleaseBranch(branch)) {
    fail(
      `rc releases must run from a release/v<version> branch, received ${branch}`
    );
  }

  ensureRemoteBranch();
  ensureGithubToken();
  ensureNpmToken();

  const versionPlans = getVersionPlans();

  if (versionPlans.length === 0) {
    fail('rc releases require at least one version plan in .nx/version-plans');
  }

  const targetVersion = parseReleaseBranchVersion(branch);

  if (!targetVersion) {
    fail(`could not determine target version from ${branch}`);
  }

  const nextVersion = getNextRcVersion(targetVersion, readVersion());
  const releaseClient = new ReleaseClient({});
  const { workspaceVersion, projectsVersionData, releaseGraph } =
    await releaseClient.releaseVersion({
      specifier: nextVersion,
      gitCommit: false,
      gitTag: false,
      stageChanges: true,
      deleteVersionPlans: false,
    });
  const changelogResult = await releaseClient.releaseChangelog({
    releaseGraph,
    versionData: projectsVersionData,
    version: workspaceVersion ?? nextVersion,
    gitCommit: false,
    gitTag: false,
    gitPush: false,
    stageChanges: true,
    createRelease: false,
    deleteVersionPlans: false,
  });

  deleteVersionPlans(versionPlans);
  commitVersionChanges(nextVersion);
  createTag(nextVersion);
  pushBranchAndTag(nextVersion);

  if (changelogResult.workspaceChangelog?.contents) {
    createGitHubRelease(
      nextVersion,
      changelogResult.workspaceChangelog.contents,
      true
    );
  }

  const publishResults = await releaseClient.releasePublish({
    releaseGraph,
    versionData: projectsVersionData,
    tag: 'rc',
    access: 'public',
    outputStyle: 'static',
  });

  assertPublishSucceeded(publishResults);
}

async function runCanaryRelease() {
  ensureNpmToken();

  const currentVersion = readVersion();
  const canaryVersion = getCanaryVersion(currentVersion);
  const releaseClient = new ReleaseClient({ versionPlans: false });
  const { projectsVersionData, releaseGraph } =
    await releaseClient.releaseVersion({
      specifier: canaryVersion,
      gitCommit: false,
      gitTag: false,
      stageChanges: false,
    });
  const publishResults = await releaseClient.releasePublish({
    releaseGraph,
    versionData: projectsVersionData,
    tag: 'canary',
    access: 'public',
    outputStyle: 'static',
  });

  assertPublishSucceeded(publishResults);
}

ensureCleanWorktree();

if (mode === 'stable') {
  await runStableRelease();
  process.exit(0);
}

if (mode === 'rc') {
  await runRcRelease();
  process.exit(0);
}

await runCanaryRelease();
