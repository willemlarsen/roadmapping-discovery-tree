# Snapshot contract

The interface between a product repo and the share site is the published snapshot, not the repository that builds the kit. The roadmap kit builds the snapshot, the site validates it, and this page is the contract between them. The site is the authority on what it accepts. This contract describes roadmap kit 0.1.1.

## Snapshot (schemaVersion 1)

`schemaVersion`: `1`. Top-level fields, as `buildSnapshot` in `src/share/snapshot.js` writes them:

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1` for this kit. |
| `productId` | The product the snapshot belongs to. The publish key must be minted for it. |
| `sourceRevision` | The commit of the roadmap the snapshot was built from. |
| `generatedAt` | When the kit built the snapshot. |
| `sourceCommittedAt` | When that commit was made. |
| `goal` | The roadmap's goal. |
| `nodes` | One entry per problem: `id`, `parent`, `problem`, `status`, `order`, `doneOn`. |
| `forecast` | One entry per problem pace forecast: `id`, `p95Hours` (one decimal, capped at 10000). |

Nothing else leaves the product repo: no paths, notes or decision text.

## Upgrade policy

The kit prints the schemaVersion it writes (`roadmap-kit --version`). When the schema changes, a new schemaVersion is accepted alongside the old one for at least one kit release, so a product repo can upgrade its kit in its own time. To upgrade, copy in the new kit and change its pinned hash in the same pull request.

## Publish responses

Each site response maps to one exit code and one line, from `RULES` in `src/share/publish-contract.js`. Auth is one key per product: `401` means the key is revoked or wrong, `403` means it is for another product. Every publish carries an idempotency key, so a retry never double-publishes; `409:conflict` means the key was reused with a different snapshot, and `409:stale` means the site already has a newer snapshot.

| Response | Exit code | Retryable | Line |
|---|---|---|---|
| `200:stored` | 0 | no | published |
| `400:bad_request` | 1 | no | bad request (product id, idempotency key or body); this is a bug in the publisher, report it |
| `401:unauthorized` | 1 | no | publish key revoked or wrong; mint a new one |
| `403:forbidden` | 1 | no | publish key is for another product; use the key minted for this product |
| `409:conflict` | 1 | no | idempotency key was reused with a different snapshot; run again |
| `409:stale` | 0 | no | site already has a newer snapshot; nothing was changed |
| `413:payload_too_large` | 1 | no | snapshot is too large (limit 256 KB); trim the roadmap |
| `422:invalid_snapshot` | 1 | no | invalid snapshot: &lt;the fields the site names&gt; |
| `429:rate_limited` | 1 | yes | rate limited; wait a minute and run again |
| `503:unavailable` | 1 | yes | publish failed (server unavailable); run again, it is safe to repeat |

Any other response prints `unexpected response (status <code>)` and exits 1; it is retryable when the status is 5xx. A network error prints `publish failed (network); run again, it is safe to repeat`.

## Local exit codes

Every kit command run exits with one of three codes, so a workflow step can tell a fault in the roadmap or the publish from a fault in how the kit was called.

| Exit code | Meaning |
|---|---|
| 0 | ok |
| 1 | roadmap unreadable or invalid, decisions unreadable, no key, snapshot invalid, or a publish failure |
| 2 | usage, or a bad `--url` |

## Failure behaviour

- What is retried: 429, 503, any unrecognised 5xx, and network errors.
- The kit makes at most 4 attempts in total. Between attempts it waits with exponential backoff and jitter, capped at 8000 ms; when the site sends `Retry-After`, it waits that long plus jitter, still capped at 8000 ms.
- Every other 4xx fails fast with its fixed line and no retry.
- Publishing runs staging first. If staging fails, production does not run, and the job log names the stage that failed.

## Using the kit in a product repo

A product repo keeps its roadmap under `roadmaps/<product id>/` and runs the kit from its own CI. Nothing in the product repo calls the kit's source repository.

1. In this repository, run `npm run kit`. It builds `dist/roadmap-kit/` and prints the kit hash.
2. Copy `dist/roadmap-kit/` to `tools/roadmap-kit/` in the product repo, and copy `kit/roadmap.yml` to `.github/workflows/roadmap.yml`. Commit both in one pull request.
3. Set the settings below: `node kit/repo-settings.mjs apply <owner/repo>` creates the environments (see Permission scopes), and the operator sets the values. To upgrade later, repeat steps 1 and 2: remove `dist/roadmap-kit/` before `npm run kit` (the build refuses to write over an existing kit), then copy the whole folder, replacing `tools/roadmap-kit/` so no file from the old kit is left behind, and copy `kit/roadmap.yml` again. Change `ROADMAP_KIT_SHA256` in the same pull request.

Settings:

- `ROADMAP_KIT_SHA256` is a repository variable, set by a repo admin to the kit hash. It is repo-level, not per environment, because every job that runs kit code reads it: the validate job and each publish job check the kit against it before any kit step runs. A pull request cannot change it, so a pull request that changes the kit cannot also change the hash it is checked against.
- `SHARE_URL` is a variable set per environment (`staging` and `production`): the base URL of that environment's share site.
- `SHARE_PUBLISH_KEY` is a secret set per environment (`staging` and `production`), one key minted for this product. Each environment has a deployment branch rule that allows only the repo's default branch, so runs from pull requests and other branches never receive the key.

The roadmap validate job is never a required status check. The workflow has a paths filter, so it only runs when a roadmap, the kit or the workflow changes; on any other pull request a required check would never run and would stay stuck at "expected", blocking the merge.

Roadmap folder names must match the product id the site accepts, a slug matching `^[a-z0-9][a-z0-9-]{0,63}$`: the publish job sends the folder name as the product id. A folder whose name starts with `-` would be read as a flag.

Output streams: publish prints only its result line on stdout (the line from the table above, including failures); its log and error lines go to stderr. The validate and pace failure lines go to stderr; their success lines go to stdout.

### Known limits

- A `|| true` regression is untested. Added to a validate or pace line, it would hide that step's failure and let the publish jobs run. The template relies on bash stopping at the first failing command, and no test checks that a failing step stops publish.
- The template needs Node 24.2 or later: the kit's entry uses `import.meta.main`. The template pins Node 24.11.0.

## Permission scopes

`kit/repo-settings.mjs` declares a product repo's publish settings in one versioned file: the environments, their default-branch rule, and the names of the secret and variables above.

- `node kit/repo-settings.mjs apply <owner/repo>` needs repo admin, so only an operator runs it, never CI. It creates the `staging` and `production` environments, each limited to the repo's default branch, and sets no secret or variable value. It deletes every branch policy it does not declare, so `check` after `apply` is clean. It refuses an environment with protection rules it does not declare (required reviewers, a wait timer, or any other rule), printing `repo-settings: refused to change <environment>: ...`, and an environment that does not let admins bypass its protection rules, printing `repo-settings: refused to change <environment>: it does not let admins bypass its protection rules`, and then changes no environment. It matches environment names whatever their case, so a live `Staging` is checked as `staging`. It refuses a branch policy id gh returns that is not a positive integer, printing `repo-settings: refused a value gh returned`, before it deletes any policy. For an environment already on custom branch policies, that id check runs before any write. For an environment not yet on custom branch policies, apply's own PUT happens before the id check, because apply reads its policies only after switching it to custom branch policies: a refusal then leaves that environment on custom branch policies, and any environment applied before it stays applied. It retries a gh read or the environment PUT that fails with HTTP 429, a 5xx or a network error (HTTP 500, 502, 503 or 504; a timeout, a connection reset or refused, or a host it could not resolve) up to 4 attempts in all, waiting 1, 2 and 4 seconds and printing only `repo-settings: retrying gh (attempt <n> of 4)`, and fails at once on any other error. A POST or DELETE is never retried: a rerun converges instead, because a stopped run is safe to rerun: apply converges.
- `node kit/repo-settings.mjs check <owner/repo>` needs read-only access, so an operator or CI with a read token can run it. It reads names, branch rules and presence only, never values, and exits 1 with one line per difference, including a branch policy `apply` did not declare.
- `SHARE_PUBLISH_KEY` can publish snapshots for one product only. It is stored per environment, rotated by minting a new key and setting it again, and revoked with the site's publish-key tool.
