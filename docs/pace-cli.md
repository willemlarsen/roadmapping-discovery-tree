# pace CLI contract

`node scripts/pace.mjs [--roadmap <dir>] [--git <dir>]` (also `npm run pace -- ...`)

Writes a forecast file, `pace.json`, beside a roadmap's `roadmap.json`.
`scripts/publish-share.mjs` already reads `pace.json` from the directory that
holds the roadmap it publishes, so a pace file written for any roadmap
directory is picked up without a publish change.

## Flags

| Flag | Meaning | Default |
|---|---|---|
| `--roadmap <dir>` | The roadmap directory, relative to the repo root. It holds `roadmap.json`; `pace.json` is written there. | `roadmap` |
| `--git <dir>` | The directory `git log` runs in, resolved against the repo root (an absolute path stays absolute). | the repo root |

Both flags are optional and may appear in either order. A value may contain
spaces (quote it in the shell). With no flags the output is byte-for-byte what
the script wrote before the flags existed: `roadmap/pace.json`, from the
repo root's git history.

## Outcomes

Success: exit 0, one line on stdout, `pace file written: <status>`. Too few
usable commits is not a failure: the file is written with status
`insufficient`, a reason and no results, and the page shows no forecast.

Every failure: exit 1, one line on stderr, `pace file not written: <code>`
(sometimes with a detail in brackets), and **nothing is written**; an existing
`pace.json` is left untouched. The message never contains a local path.

| Situation | Code |
|---|---|
| An unknown flag, or a flag without a value | `usage` (the line names the accepted flags) |
| `--roadmap` resolves outside the repo root (`..`, an absolute path, or a symlink that leads out) | `roadmap_dir_outside_repo` |
| `--git` is not an existing directory (missing, or a file) | `git_dir_missing` |
| `git log` cannot run, the directory is not a git repository, or it has no commits | `git_unavailable` |
| The git log cannot be parsed | `log_invalid` |
| The roadmap directory or its `roadmap.json` is absent, or not JSON | `roadmap_unreadable` |
| `roadmap.json` fails validation | `roadmap_invalid` |
| A card the forecast refuses | `input_invalid` |
| The file cannot be written | `write_failed` |

Both directory checks run before git, before the roadmap is read and before
anything is written. Git always runs through `execFileSync` with an argument array, never a shell
string. The script never writes outside the resolved roadmap directory.
