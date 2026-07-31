# InkLingo extension

Firefox (Manifest V3) extension for the capture → translate → save flow:
type a word or phrase, get AI translation variants with IPA phonetics and
bilingual example sentences, pick one of each, save it into a collection.

Independent npm project, like `backend/` and `frontend/` — install and
build it separately.

## Setup

```sh
npm install
cp .env.example .env.production    # then fill in the three values
npm run build                      # output lands in dist/
```

Which env file a build reads follows Vite's mode, so it decides which
backend the extension talks to:

| command | mode | env file | targets |
| --- | --- | --- | --- |
| `npm run build` | production | `.env.production` | the deployed API |
| `npm run dev` | development | `.env.development` | `http://localhost:3000` (`cd backend && npm run dev`) |

`npm run dev` is `vite build --watch`: it rebuilds `dist/` on change, which
Firefox picks up when you hit Reload in `about:debugging`.

The values come from the `InkLingo-AuthStack`/`InkLingo-ApiStack` outputs —
the same ones `infra/scripts/write-frontend-env.mjs` writes into
`frontend/.env.production`.

## Loading it in Firefox

1. `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Pick `dist/manifest.json`.
3. The extension icon appears in the toolbar; click it to open the popup.

Temporary add-ons are removed when Firefox restarts, so repeat after a
restart. The pinned add-on ID (below) means everything else — the OAuth
redirect URL, the stored tokens — survives a reload.

## Auth

The web app's redirect + `localStorage` flow doesn't work in a popup, so
this uses `browser.identity.launchWebAuthFlow` with authorization code +
PKCE against the **same** Cognito App Client the web app uses. Tokens live
in `browser.storage.local`; the ID token is refreshed based on its `exp`
claim before each API call.

Firefox derives the OAuth redirect URI from
`browser_specific_settings.gecko.id` in `manifest.json`:

| gecko id | redirect URI (`identity.getRedirectURL()`) |
| --- | --- |
| `inklingo@inklingo.app` | `https://93a911258e4a993c21556e53c55150e3aed6b44e.extensions.allizom.org/` |

It is `https://<sha1(id)>.extensions.allizom.org/` — **not** a
`moz-extension://` URL, whose UUID is regenerated on every install and so
can't be registered anywhere. That exact redirect URI is registered as a
Cognito callback URL in `infra/lib/stacks/auth-stack.ts`, which recomputes
it from the same ID. **Changing the gecko id means redeploying
`InkLingo-AuthStack`.**

## Why the backend calls live in the background script

`src/background.ts` owns every API call. Requests it issues run under
`manifest.json`'s `host_permissions` and skip the page-level CORS
preflight a popup `fetch()` would trigger — which is why the API Gateway's
single-origin CORS allowlist
(`infra/lib/constructs/api-construct.ts`) needs no extension entry. The
popup talks to it over `browser.runtime.sendMessage`; the contract is in
`src/messages.ts`.

## host_permissions are generated per build

The checked-in `manifest.json` lists regional wildcards
(`https://*.execute-api.eu-central-1.amazonaws.com/*` and the matching
`amazoncognito.com` host). Those are **placeholders, not what ships** — a
wildcard grant would cover every AWS account's API Gateway and every Cognito
hosted UI in the region, far more than this extension calls.

`vite.config.ts`'s `write-manifest` plugin rewrites `host_permissions` at the
end of every build, narrowing it to the two concrete origins derived from the
same `VITE_*` values `src/config.ts` reads:

| build | resulting `host_permissions` |
| --- | --- |
| `npm run build` | the `ApiUrl` origin + the Cognito hosted-UI origin |
| `npm run dev` | `http://localhost:3000/*` + the Cognito hosted-UI origin |

If no `.env.<mode>` file is present, the build warns and falls back to the
checked-in wildcards so `dist/` still loads — check the build output if the
extension is asking for more than you expect.

Firefox grants manifest-declared host permissions at install time (127+); on
older builds you may have to enable them from the extension's permissions
panel.
