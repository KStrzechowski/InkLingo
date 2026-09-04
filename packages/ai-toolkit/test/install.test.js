import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { install } from '../install.js';
import { uninstall } from '../uninstall.js';

function makeConsumerRoot() {
  return mkdtempSync(join(tmpdir(), 'ai-toolkit-test-'));
}

test('install() creates the skill directory, the sentinel block, and the manifest', () => {
  const root = makeConsumerRoot();
  try {
    install(root);

    assert.ok(existsSync(join(root, '.claude', 'skills', 'code-review', 'SKILL.md')));

    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /<!-- BEGIN @kstrzechowski\/ai-toolkit -->/);
    assert.match(claudeMd, /<!-- END @kstrzechowski\/ai-toolkit -->/);

    const manifest = JSON.parse(readFileSync(join(root, '.claude', '.ai-toolkit-manifest.json'), 'utf8'));
    assert.equal(typeof manifest.version, 'string');
    assert.deepEqual(manifest.installedFiles, [join('.claude', 'skills', 'code-review')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second install() call updates the block and manifest in place without duplicating them', () => {
  const root = makeConsumerRoot();
  try {
    install(root);
    install(root);

    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    const beginCount = claudeMd.split('<!-- BEGIN @kstrzechowski/ai-toolkit -->').length - 1;
    const endCount = claudeMd.split('<!-- END @kstrzechowski/ai-toolkit -->').length - 1;
    assert.equal(beginCount, 1);
    assert.equal(endCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install() against a CLAUDE.md with unrelated content leaves that content untouched outside the sentinel markers', () => {
  const root = makeConsumerRoot();
  try {
    writeFileSync(join(root, 'CLAUDE.md'), '# My Project\n\nSome pre-existing rule.\n');

    install(root);

    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /# My Project/);
    assert.match(claudeMd, /Some pre-existing rule\./);
    assert.match(claudeMd, /<!-- BEGIN @kstrzechowski\/ai-toolkit -->/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uninstall() removes exactly what the manifest recorded and leaves CLAUDE.md with no trace of the sentinel block', () => {
  const root = makeConsumerRoot();
  try {
    writeFileSync(join(root, 'CLAUDE.md'), '# My Project\n\nSome pre-existing rule.\n');
    install(root);

    uninstall(root);

    assert.equal(existsSync(join(root, '.claude', 'skills', 'code-review')), false);
    assert.equal(existsSync(join(root, '.claude', '.ai-toolkit-manifest.json')), false);

    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claudeMd, /@kstrzechowski\/ai-toolkit/);
    assert.match(claudeMd, /# My Project/);
    assert.match(claudeMd, /Some pre-existing rule\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install() exits cleanly without throwing when it hits a filesystem error', () => {
  const root = makeConsumerRoot();
  try {
    // A plain file at .claude means mkdirSync(.claude/skills/...) fails with ENOTDIR.
    writeFileSync(join(root, '.claude'), '');

    assert.doesNotThrow(() => install(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uninstall() exits cleanly without throwing when there is nothing to uninstall', () => {
  const root = makeConsumerRoot();
  try {
    assert.doesNotThrow(() => uninstall(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
