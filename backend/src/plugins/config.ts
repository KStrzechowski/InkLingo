import fp from 'fastify-plugin'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

export interface ConfigPluginOptions {
  // Specify Config plugin options here
}

export interface AppConfig {
  neonDatabaseUrl: string
  anthropicApiKey: string
  cognitoUserPoolId: string
  cognitoClientId: string
  allowedOrigin: string
}

async function loadFromSsm (): Promise<Pick<AppConfig, 'neonDatabaseUrl' | 'anthropicApiKey'>> {
  const client = new SSMClient({})

  const [neon, anthropic] = await Promise.all([
    client.send(new GetParameterCommand({ Name: '/ink-lingo/neon-database-url', WithDecryption: true })),
    client.send(new GetParameterCommand({ Name: '/ink-lingo/anthropic-api-key', WithDecryption: true }))
  ])

  if (!neon.Parameter?.Value || !anthropic.Parameter?.Value) {
    throw new Error('Missing required SSM parameters under /ink-lingo/*')
  }

  return {
    neonDatabaseUrl: neon.Parameter.Value,
    anthropicApiKey: anthropic.Parameter.Value
  }
}

function loadFromEnv (): Pick<AppConfig, 'neonDatabaseUrl' | 'anthropicApiKey'> {
  const neonDatabaseUrl = process.env.NEON_DATABASE_URL
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY

  if (!neonDatabaseUrl || !anthropicApiKey) {
    throw new Error('Missing NEON_DATABASE_URL or ANTHROPIC_API_KEY environment variables')
  }

  return { neonDatabaseUrl, anthropicApiKey }
}

// Runs once per Lambda cold start (LWA keeps the process warm across
// invocations), so SSM is never called on the per-request hot path.
export default fp<ConfigPluginOptions>(async (fastify) => {
  const runningInLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  const secrets = runningInLambda ? await loadFromSsm() : loadFromEnv()

  const config: AppConfig = {
    ...secrets,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
    cognitoClientId: process.env.COGNITO_CLIENT_ID ?? '',
    allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*'
  }

  fastify.decorate('config', config)
}, { name: 'config' })

declare module 'fastify' {
  export interface FastifyInstance {
    config: AppConfig;
  }
}
