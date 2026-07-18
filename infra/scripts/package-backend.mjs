// Docker-free Lambda packaging for the Fastify backend.
//
// Deliberately not using aws-cdk-lib/aws-lambda-nodejs's NodejsFunction:
// it esbuild-bundles into a single file, which breaks @fastify/autoload's
// filesystem directory scan (the same reason Cloudflare Workers was ruled
// out in context/foundation/infrastructure.md).
//
// Instead we stage a plain npm-installable package and let
// lambda.Code.fromAsset() zip it up as-is.
import { execSync } from 'node:child_process'
import { cpSync, chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const infraRoot = path.join(__dirname, '..')
const backendRoot = path.join(infraRoot, '..', 'backend')
const stagingDir = path.join(infraRoot, '.build', 'lambda')

if (!existsSync(path.join(backendRoot, 'dist', 'server.js'))) {
  console.error('backend/dist/server.js not found — run `npm run build:ts` in backend/ first.')
  process.exit(1)
}

rmSync(stagingDir, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })

cpSync(path.join(backendRoot, 'package.json'), path.join(stagingDir, 'package.json'))
cpSync(path.join(backendRoot, 'package-lock.json'), path.join(stagingDir, 'package-lock.json'))
cpSync(path.join(backendRoot, 'dist'), path.join(stagingDir, 'dist'), { recursive: true })
cpSync(path.join(backendRoot, 'run.sh'), path.join(stagingDir, 'run.sh'))

// Windows/git doesn't preserve the Unix execute bit, so LWA (which execs
// run.sh directly) needs it set explicitly at staging time.
chmodSync(path.join(stagingDir, 'run.sh'), 0o755)

// Isolated from backend/node_modules on purpose: only production deps
// end up in the deployed artifact, dev tooling never does.
execSync('npm ci --omit=dev', { cwd: stagingDir, stdio: 'inherit' })

console.log(`Lambda package staged at ${stagingDir}`)
