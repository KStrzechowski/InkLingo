// Writes frontend/.env.production from the three deployed stacks'
// CloudFormation outputs. Run after FrontendStack + AuthStack + ApiStack
// all exist, before `npm run build` in frontend/. Reused as-is by CI
// (Phase 4) once the stacks are already deployed there too.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const region = 'eu-central-1'

function stackOutputs (stackName) {
  let json
  try {
    json = execSync(
      `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query "Stacks[0].Outputs" --output json`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch {
    console.error(`${stackName} isn't deployed yet in ${region} — deploy it first.`)
    process.exit(1)
  }
  const outputs = JSON.parse(json)
  return Object.fromEntries(outputs.map((o) => [o.OutputKey, o.OutputValue]))
}

const frontendOutputs = stackOutputs('InkLingo-FrontendStack')
const authOutputs = stackOutputs('InkLingo-AuthStack')
const apiOutputs = stackOutputs('InkLingo-ApiStack')

const env = {
  VITE_API_BASE_URL: apiOutputs.ApiUrl.replace(/\/$/, ''),
  VITE_COGNITO_USER_POOL_ID: authOutputs.UserPoolId,
  VITE_COGNITO_CLIENT_ID: authOutputs.UserPoolClientId,
  VITE_COGNITO_DOMAIN: authOutputs.CognitoHostedUiDomain,
  VITE_COGNITO_REDIRECT_URI: `https://${frontendOutputs.CloudFrontDomain}/callback`,
  VITE_COGNITO_REGION: region
}

const contents = Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
const outPath = path.join(__dirname, '..', '..', 'frontend', '.env.production')
writeFileSync(outPath, contents)

console.log(`Wrote ${outPath}`)
