import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const MARKER_NAME = '@kstrzechowski/ai-toolkit';
const BEGIN_MARKER = `<!-- BEGIN ${MARKER_NAME} -->`;
const END_MARKER = `<!-- END ${MARKER_NAME} -->`;
const SKILL_REL_PATH = join('.claude', 'skills', 'code-review');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertBlock(existingContent, block) {
  const blockRegex = new RegExp(`${escapeRegex(BEGIN_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`);
  if (blockRegex.test(existingContent)) {
    return existingContent.replace(blockRegex, block);
  }
  const trimmed = existingContent.replace(/\s+$/, '');
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

export function install(consumerRoot) {
  try {
    const skillSrc = join(PACKAGE_ROOT, 'skills', 'code-review');
    const skillDest = join(consumerRoot, SKILL_REL_PATH);
    rmSync(skillDest, { recursive: true, force: true });
    mkdirSync(dirname(skillDest), { recursive: true });
    cpSync(skillSrc, skillDest, { recursive: true });

    const rulesContent = readFileSync(join(PACKAGE_ROOT, 'rules', 'CLAUDE.md'), 'utf8').replace(/\s+$/, '');
    const block = `${BEGIN_MARKER}\n\n${rulesContent}\n\n${END_MARKER}`;
    const claudeMdPath = join(consumerRoot, 'CLAUDE.md');
    const existingContent = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
    writeFileSync(claudeMdPath, upsertBlock(existingContent, block));

    const manifestDir = join(consumerRoot, '.claude');
    mkdirSync(manifestDir, { recursive: true });
    const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const manifest = { version, installedFiles: [SKILL_REL_PATH] };
    writeFileSync(join(manifestDir, '.ai-toolkit-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    console.error('[ai-toolkit] install failed:', error);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    install(process.env.INIT_CWD ?? process.cwd());
  } catch (error) {
    console.error('[ai-toolkit] install failed:', error);
  }
  process.exit(0);
}
