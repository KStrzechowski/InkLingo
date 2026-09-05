import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER_NAME = '@kstrzechowski/ai-toolkit';
const BEGIN_MARKER = `<!-- BEGIN ${MARKER_NAME} -->`;
const END_MARKER = `<!-- END ${MARKER_NAME} -->`;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripBlock(content) {
  const blockRegex = new RegExp(`\\n*${escapeRegex(BEGIN_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n*`);
  return content.replace(blockRegex, '');
}

function removeEmptyAncestors(startDir, stopAt) {
  let current = startDir;
  while (current !== stopAt && current.startsWith(stopAt) && existsSync(current)) {
    if (readdirSync(current).length > 0) {
      break;
    }
    rmSync(current, { recursive: true, force: true });
    current = dirname(current);
  }
}

export function uninstall(consumerRoot) {
  try {
    const manifestPath = join(consumerRoot, '.claude', '.ai-toolkit-manifest.json');
    if (!existsSync(manifestPath)) {
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const relPath of manifest.installedFiles ?? []) {
      const fullPath = join(consumerRoot, relPath);
      rmSync(fullPath, { recursive: true, force: true });
      removeEmptyAncestors(dirname(fullPath), consumerRoot);
    }

    const claudeMdPath = join(consumerRoot, 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
      const stripped = stripBlock(readFileSync(claudeMdPath, 'utf8'));
      if (stripped.trim().length === 0) {
        rmSync(claudeMdPath, { force: true });
      } else {
        writeFileSync(claudeMdPath, stripped);
      }
    }

    rmSync(manifestPath, { force: true });
    removeEmptyAncestors(dirname(manifestPath), consumerRoot);
  } catch (error) {
    console.error('[ai-toolkit] uninstall failed:', error);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    uninstall(process.env.INIT_CWD ?? process.cwd());
  } catch (error) {
    console.error('[ai-toolkit] uninstall failed:', error);
  }
  process.exit(0);
}
