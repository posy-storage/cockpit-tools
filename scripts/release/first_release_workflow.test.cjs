const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n');
const preserveName = '💾 Preserve previous legacy latest.json';
const stageName = '🚀 Create or update staged release';
function step(name) {
  const marker = '      - name: ' + name + '\n';
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next < 0 ? undefined : next);
}
function script(name) {
  const text = step(name).split('        run: |\n')[1];
  assert.ok(text);
  return text.split('\n').map(line => line.replace(/^          /, '')).join('\n')
    .replaceAll('$' + '{{ steps.app_version.outputs.VERSION }}', '1.3.59');
}
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  const git = spawnSync('git', ['--exec-path'], {encoding:'utf8'});
  assert.equal(git.status, 0);
  return path.resolve(git.stdout.trim(), '../../..', 'bin/bash.exe');
}
const ghStub = [
  'gh() {',
  '  printf "%s\\n" "$*" >> calls.log',
  '  case "$1 $2" in',
  '    "release list") printf "%s\\n" "$TEST_PREVIOUS" ;;',
  '    "release download")',
  '      if [ "$TEST_DOWNLOAD_FAIL" = "true" ]; then return 1; fi',
  '      mkdir -p previous-release',
  '      printf "%s\\n" "{\"version\":\"1.3.58\",\"platforms\":{}}" > previous-release/latest.json ;;',
  '    "release view")',
  '      if [ ! -f release-exists ]; then return 1; fi',
  '      if [[ "$*" == *"--json isDraft"* ]]; then printf "%s\\n" "$TEST_DRAFT"; fi ;;',
  '    "release create") touch release-exists ;;',
  '    "release edit"|"release upload") return 0 ;;',
  '    *) return 2 ;;',
  '  esac',
  '}',
].join('\n');
function run(name, {previous = '', legacy = false, exists = false, draft = true, failDownload = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-first-release-'));
  try {
    fs.writeFileSync(path.join(dir, 'release-notes.md'), 'Release notes');
    if (legacy) fs.writeFileSync(path.join(dir, 'legacy-latest.json'), 'previous-manifest');
    if (exists) fs.writeFileSync(path.join(dir, 'release-exists'), '');
    const result = spawnSync(bashPath(), ['-euo', 'pipefail', '-c', ghStub + '\n' + script(name)], {
      cwd: dir, encoding: 'utf8',
      env: {...process.env, GITHUB_REF_NAME: 'v1.3.59',
        GITHUB_OUTPUT: path.join(dir, 'output').replaceAll('\\', '/'),
        TEST_PREVIOUS: previous, TEST_DOWNLOAD_FAIL: String(failDownload),
        TEST_DRAFT: String(draft), HAS_LEGACY_MANIFEST: String(legacy)},
    });
    if (result.error) throw result.error;
    const read = name => fs.existsSync(path.join(dir,name)) ? fs.readFileSync(path.join(dir,name),'utf8') : null;
    return {status: result.status, stderr: result.stderr, calls: read('calls.log') || '',
      output: read('output'), legacy: read('legacy-latest.json'), latest: read('latest.json')};
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
}

test('first release succeeds without inventing a previous updater manifest', () => {
  const result = run(preserveName);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /available=false/);
  assert.equal(result.legacy, null);
  assert.doesNotMatch(result.calls, /release download/);
});
test('an upgrade still requires and preserves its previous manifest', () => {
  const result = run(preserveName, {previous:'v1.3.58'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /available=true/);
  assert.ok(result.legacy);
  assert.match(result.calls, /release download v1.3.58/);
});
test('failure to download an existing release manifest remains an error', () => {
  const result = run(preserveName, {previous:'v1.3.58', failDownload:true});
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.output || '', /available=false/);
});
test('a new or retried first release stays draft until finalization', () => {
  for (const exists of [false,true]) {
    const result = run(stageName, {exists});
    assert.equal(result.status, 0, result.stderr);
    if (!exists) assert.match(result.calls, /release create v1.3.59 --draft/);
    assert.doesNotMatch(result.calls, /--draft=false|release upload/);
    assert.equal(result.latest, null);
  }
});
test('an upgrade retains the existing early publication behavior', () => {
  const result = run(stageName, {legacy:true});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.latest, 'previous-manifest');
  assert.match(result.calls, /release upload v1.3.59 latest.json --clobber/);
  assert.match(result.calls, /--draft=false/);
});
test('rerunning an already published first release never overwrites latest.json', () => {
  const result = run(stageName, {exists:true,draft:false});
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.calls, /release upload/);
  assert.equal(result.latest, null);
});
test('draft releases skip only early public checks; final verification and triggers remain', () => {
  for (const name of [
    '🚀 Ensure staged release is published',
    '🔍 Verify published Windows updater manifests',
    '🔍 Verify published macOS Apple Silicon updater manifest',
    '🔍 Verify published macOS Intel updater manifest',
    '🔍 Verify published Linux updater manifests',
  ]) assert.match(step(name), /if: needs\.prepare-release\.outputs\.has_legacy_manifest == 'true'/);
  const final = workflow.slice(workflow.indexOf('  finalize-legacy-latest:'));
  assert.match(final, /- build-windows/);
  assert.match(final, /- build-macos-aarch64/);
  assert.match(final, /- build-macos-x86_64/);
  assert.match(final, /- build-macos-universal/);
  assert.match(final, /- build-linux/);
  assert.match(final, /--draft=false/);
  assert.match(final, /Verify complete published updater state/);
  assert.ok(workflow.includes('on:\n  push:\n    tags:\n      - "v*"\n  workflow_dispatch:\n'));
});
