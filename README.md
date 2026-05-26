# UpStage Front End Installation

Do This After Back End Installation and Configuration. See the upstage_backend repo README for details.
https://github.com/upstage-org/upstage_backend

## Setup and Startup Instructions

To generate the necessary environment scripts and start up the application using Docker, follow these steps:

1. Open your terminal and navigate to upstage_frontend

1. Run the following command to generate the environment scripts:

   ```
   ./initial_scripts/generate_environments_script.sh
   ```

1. Once the scripts are generated, start up the application using Docker Compose:

   ```
   ./run_front_end.sh
   ```

1. The application should now be running. You can access it by navigating to `https://{YOUR_DOMAIN}` in your web browser.

Testing:

pnpm e2e:features

# Default (today's behavior): all three phases headed, no replay headless.

PWHEADLESS=0 pnpm e2e:perform

# Just rehearsal: cast walks the script in rehearsal mode, no audience.

PWHEADLESS=0 pnpm e2e:perform:rehearsal

# Just live: cast performs while audience watches; no rehearsal, no replay.

PWHEADLESS=0 pnpm e2e:perform:live

# Just replay: no cast logins. Audience watches the most recent recording.

# Errors clearly if no Performance exists for the stage yet.

PWHEADLESS=0 pnpm e2e:perform:replay

# Arbitrary combos via the env var:

PWHEADLESS=0 E2E_PHASES=live,replay pnpm e2e:perform # skip rehearsal
PWHEADLESS=0 E2E_PHASES=rehearsal,replay pnpm e2e:perform # rare; replay against latest existing recording

# Smoke beats still works on top of any phase selection:

PWHEADLESS=0 E2E_PHASES=live E2E_BEATS=smoke pnpm e2e:perform

E2E_REPLAY still works as a fallback default when E2E_PHASES is unset.

## Local protections (git hooks)

This repo uses [husky](https://typicode.github.io/husky) to run a small
suite of local protections against the same checks that run in CI. They
exist so problems are caught at the developer's machine — before they
hit `main` — and so a `git push --no-verify` bypass is still caught
server-side by `.github/workflows/ci.yml`.

### One-time install

```bash
pnpm install
```

The `prepare` script runs `husky` automatically and installs the hooks
into `.husky/`. If pnpm 10/11 prompts about build scripts, run
`pnpm approve-builds husky` once.

### What runs and when

| Hook         | What it does                                                                             | Typical time |
| ------------ | ---------------------------------------------------------------------------------------- | ------------ |
| `pre-commit` | `lint-staged`: ESLint `--fix` + Prettier `--write` on staged JS/TS/Vue/JSON/MD/SCSS only | < 5 s        |
| `commit-msg` | Light gate: rejects empty / `wip` / `fixup!` / messages shorter than 10 characters       | instant      |
| `pre-push`   | `pnpm typecheck` + `pnpm test` + `pnpm audit:ci` (production deps, fail on `high`+)      | ~30–35 s     |

The `pre-push` hook is intentionally identical to the `verify` script
and to the CI workflow, so a clean local push is a strong signal that
CI will pass.

### Manual run

```bash
pnpm run verify        # typecheck + tests + audit
pnpm run typecheck     # vue-tsc only
pnpm run audit:ci      # production audit, fail on high+
```

### Bypassing for emergencies

Both hooks honour git's standard escape hatch:

```bash
git commit --no-verify -m "hotfix: ..."
git push --no-verify
```

Use sparingly. CI will still run the full verify suite on the pushed
branch and on the PR, so a bypass only delays the failure — it does not
hide it.

### Adding a new check

1. Add a script to `package.json` so it can be run standalone (e.g.
   `pnpm run my-check`).
2. Add the same script to `.husky/pre-push` (and update the `verify`
   script if it should be part of the bundle).
3. Add the matching step to `.github/workflows/ci.yml` so the local
   gate and the server-side gate stay in lockstep.
