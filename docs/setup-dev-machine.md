# Developer Machine Setup

System prerequisites for working on is-app. These are one-time installs.

---

## Node.js 24 (via nvm)

We recommend using `nvm` to manage Node.js versions. The repo pins Node 24 (the current LTS) via `.nvmrc` and `engines.node` in `package.json`.

**Mac:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24
```
The repo includes an `.nvmrc` file, so running `nvm use` inside the project directory switches to the correct version.

**Windows:**

Install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases) (download and run the latest `nvm-setup.exe`), then:
```bash
nvm install 24
nvm use 24
```
nvm-windows does not read `.nvmrc`, so name the version explicitly with `nvm use 24`.

After install: `node --version` should show v24.x.

## Docker Desktop

Required for the local Supabase stack (Postgres, Auth, Studio).

Install from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).

**Windows:** Use the WSL 2 backend (default on modern installs). Allocate at least 7 GB RAM (Settings → Resources → Memory).

**Mac:** Works out of the box. Allocate at least 7 GB RAM (Settings → Resources → Memory). OrbStack is a lighter alternative to Docker Desktop.

Docker Desktop must be **running** before `npm run dev` — the dev script starts Supabase containers automatically.

### Windows: reserve the local Supabase ports

The local Supabase stack binds a fixed span of 7 ports, `54321–54327` (API gateway, Postgres, Studio, Inbucket, and analytics at `54327`; `54325`/`54326` are unused gaps). On Windows these fall inside the *ephemeral* range (`49152–65535`), so another process can be auto-assigned one — `54321` (the API gateway / Kong) in particular — before Docker binds it. (Nothing else needs reserving: the dev server `3000` and inspector `8083` sit below the ephemeral range — a `3000` clash is instead a visible "port in use" from a server you started — and the shadow DB `54320` and pooler `54329` are in-range but not host-bound.) `supabase start` then health-checks the squatter, gets an `Error status 404`, and rolls the whole stack back. Every container was healthy; the rollback killed them. `--ignore-health-check` does not bypass it (the failing call is in post-start setup, not the health loop).

Reserve the block once so Windows never hands those ports out. With the stack stopped (`npm run dev:db:stop`) and any port holder closed, in an **elevated** PowerShell:

```powershell
netsh int ipv4 add excludedportrange protocol=tcp startport=54321 numberofports=7
```

Verify — `54321 → 54327` should be listed:

```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```

Explicit Docker binds still succeed on reserved ports; only automatic ephemeral hand-out is blocked. The reservation survives reboots, and `npm run setup` re-checks it and reprints this command if it's missing.

**Diagnosing a 404-rollback:** with the stack stopped, `curl http://127.0.0.1:54321/anything` still returning a 404 proves a non-Supabase process owns the port. Identify it with:

```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 54321 -State Listen).OwningProcess
```

**Worktree lanes** shift the span by `N×100` (lane 2 → `54521–54527`, lane 3 → `54621–54627`, …) and each need their own reservation; `npm run make_lane_inside_worktree` prints the exact `netsh` command for the lane. See [strategy-worktree-lanes.md](strategy-worktree-lanes.md).

## Git

**Windows:** Install from [git-scm.com](https://git-scm.com/). Includes Git Bash.

**Mac:** Included with Xcode Command Line Tools (`xcode-select --install`).

## GitHub CLI

Optional — Not required to build or run the app. **Required for GitHub PR / issue workflows from the terminal**, which includes anything driven by Claude Code (Claude can't operate a web browser). The GitHub web UI is the alternative for humans.

**Windows (PowerShell, Command Prompt, or Git Bash):**
```powershell
winget install --id GitHub.cli
```

**Mac:**
```bash
brew install gh
```

After installing, open a **new terminal** so PATH picks up the new binary, then authenticate:
```bash
gh auth login
```
Answer: `GitHub.com` → `HTTPS` → `Y` (manage Git credentials) → `Login with a web browser`. Paste the printed one-time code into the browser tab, then confirm the grant. Success line: `✓ Logged in as <your-username>`.

Verify with `gh --version` and `gh auth status`.

> **Auth scope:** Credentials live in your OS keyring (Windows Credential Manager / macOS Keychain) plus a user-home config file, so one login covers every shell running as the same user — including the VS Code / Claude Code terminal. A different OS user or a WSL shell needs its own login.

**If a new shell still can't find `gh`** (Rare — Usually a stale PATH cache), call it by full path:
- Windows PowerShell: `& "C:\Program Files\GitHub CLI\gh.exe" auth login`
- Windows Git Bash: `"/c/Program Files/GitHub CLI/gh.exe" auth login`
- Mac (brew at /opt/homebrew): `/opt/homebrew/bin/gh auth login`

## Editor

No specific editor is required. VS Code and JetBrains IDEs both work well with this stack.

## Claude Code

We use [Claude Code](https://claude.ai/code) as our AI coding assistant, configured with Claude Opus 4.6 at medium or high reasoning effort. Available as a CLI, desktop app, or IDE extension.

---

Once the prerequisites above are installed, clone the repo and run `npm install` followed by `npm run setup` to prepare the local checkout. Then `npm run dev`. See the [README](../README.md) for the full walkthrough.

`npm run setup` creates `.env.local` with deterministic local Supabase defaults and installs the Playwright Chromium browser binary used by `npm test` and `npm run test:e2e`. That install is safe to re-run; Playwright only downloads when the expected browser is missing or outdated. If the browser install ever fails independently, repair it with:

```bash
npx playwright install chromium
```

Local dev/test entry points also check that `node_modules` is current with `package-lock.json` before invoking dependency binaries such as Biome. The check compares `package-lock.json` against npm's installed copy at `node_modules/.package-lock.json`; if the repo lockfile is newer, run:

```bash
npm install
```
