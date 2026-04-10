# Developer Machine Setup

System prerequisites for working on is-app. These are one-time installs.

---

## Node.js 22+ (via nvm)

We recommend using `nvm` to manage Node.js versions.

**Mac:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22
```

**Windows:**

Install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases) (download and run the latest `nvm-setup.exe`), then:
```bash
nvm install 22
nvm use 22
```

After install: `node --version` should show v22.x or later.

## Docker Desktop

Required for the local Supabase stack (Postgres, Auth, Studio).

Install from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).

**Windows:** Use the WSL 2 backend (default on modern installs). Allocate at least 7 GB RAM (Settings → Resources → Memory).

**Mac:** Works out of the box. Allocate at least 7 GB RAM (Settings → Resources → Memory). OrbStack is a lighter alternative to Docker Desktop.

Docker Desktop must be **running** before `npm run dev` — the dev script starts Supabase containers automatically.

## Git

**Windows:** Install from [git-scm.com](https://git-scm.com/). Includes Git Bash.

**Mac:** Included with Xcode Command Line Tools (`xcode-select --install`).

## Editor

No specific editor is required. VS Code and JetBrains IDEs both work well with this stack.

## Claude Code

We use [Claude Code](https://claude.ai/code) as our AI coding assistant, configured with Claude Opus 4.6 at medium or high reasoning effort. Available as a CLI, desktop app, or IDE extension.

---

Once the prerequisites above are installed, clone the repo and run `npm install` followed by `npm run setup` to generate your local `.env.local` with the deterministic local Supabase defaults. Then `npm run dev`. See the [README](../README.md) for the full walkthrough.
