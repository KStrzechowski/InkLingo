# infra/lib dependency graph

> Generated: `node scripts/depcruise.mjs --focus "^infra/lib" --exclude "node_modules" --output-type mermaid`
> Source of truth is `infra-graph.mmd`; this file exists so the graph renders in VS Code / GitHub.

```mermaid
flowchart LR

0["path"]
1["crypto"]
subgraph 2["infra"]
subgraph 3["bin"]
4["infra.ts"]
end
subgraph 5["lib"]
6["stack-selector.ts"]
subgraph 7["stacks"]
8["api-stack.ts"]
C["auth-stack.ts"]
E["frontend-stack.ts"]
G["github-oidc-stack.ts"]
end
subgraph 9["constructs"]
A["api-construct.ts"]
D["auth-construct.ts"]
F["frontend-construct.ts"]
H["github-oidc-construct.ts"]
end
B["cdk-ssm-params.ts"]
end
end
4-->6
4-->8
4-->C
4-->E
4-->G
8-->A
A-->B
A-->0
C-->B
C-->D
C-->1
E-->B
E-->F
F-->0
G-->H

style 6 fill:lime,color:black
style 8 fill:lime,color:black
style A fill:lime,color:black
style B fill:lime,color:black
style C fill:lime,color:black
style D fill:lime,color:black
style E fill:lime,color:black
style F fill:lime,color:black
style G fill:lime,color:black
style H fill:lime,color:black```
