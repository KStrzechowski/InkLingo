import * as cdk from 'aws-cdk-lib/core';

export interface StackRegistry {
  // Keyed by stack name. Lazy factories so unselected stacks are never
  // constructed at all (no Lambda asset staging, no unrelated resources
  // entering the synth) — see bin/infra.ts for why this matters.
  factories: Record<string, () => cdk.Stack>;
  // name -> the stacks it depends on. Only needed when a stack reads
  // another one's output via a non-live channel (e.g. SSM Parameter
  // Store) that CDK can't auto-detect as a cross-stack reference —
  // without this, a combined `cdk deploy --all` has no guaranteed order.
  dependencies?: Record<string, string[]>;
}

// Reusable across multiple CDK apps (e.g. a second bin/*.ts entrypoint
// for an unrelated set of stacks) — same "-c stack=<Name> builds only
// that one, omit it to build everything with correct dependency order"
// behavior everywhere it's used.
export function buildSelectedStacks (app: cdk.App, registry: StackRegistry): void {
  const { factories, dependencies = {} } = registry;
  const selected: string | undefined = app.node.tryGetContext('stack');

  if (selected) {
    const factory = factories[selected];
    if (!factory) {
      throw new Error(`Unknown stack "${selected}" — known stacks: ${Object.keys(factories).join(', ')}`);
    }
    factory();
    return;
  }

  const built: Record<string, cdk.Stack> = {};
  for (const [name, factory] of Object.entries(factories)) {
    built[name] = factory();
  }
  for (const [name, deps] of Object.entries(dependencies)) {
    for (const dep of deps) {
      built[name]?.addDependency(built[dep]);
    }
  }
}
