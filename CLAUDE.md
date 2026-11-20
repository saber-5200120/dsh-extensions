# CLAUDE.md

Guidance for Claude (or any coding agent) working in this repository.

## What this repo is

Extensions for **DeepSeek Harness / DSH Desktop** that bring Cursor-Agent-style features to DSH:

- `cursor-kit/` — a Cordis plugin: per-turn checkpoints in a shadow git repo, `/checkpoints`, `/rewind [#n] [files…]`, and lint-after-edit feedback.
- `skills/review/SKILL.md` — the `/review` code-review skill (read-only, reports by severity).
- `presets/scientific-evidence-v4/` — a modified agent preset. **Original by DSH Desktop contributors (MIT).** Keep its `LICENSE`, `SOURCE.md` and the credits in both READMEs intact.

User-facing text (command output, READMEs, docs) is Chinese first; `README.en.md` mirrors `README.md` in shorter form. Keep both in sync.

## Commands

```bash
cd cursor-kit && npm test          # node --test tests/*.test.mjs — fake DSH context, needs git + bash
./cursor-kit/install.sh            # install plugin + /review into the real DSH Desktop (macOS)
./cursor-kit/uninstall.sh          # remove; --purge also deletes checkpoints
```

Tests set `DSH_CURSOR_KIT_HOME` to a temp dir so they never touch real checkpoints. `install.sh` / `uninstall.sh` honour `DSH_HOME` and `DSH_CURSOR_KIT_HOME`; use them to dry-run against a fake directory before touching the real DSH install.

## How it is wired into DSH

- DSH home: `~/Library/Application Support/dsh-desktop/harness`.
- `install.sh` copies the plugin to `~/.dsh-cursor-kit/` and appends a `# dsh-cursor-kit begin … end` block to **every** `profiles/*/cordis.patch.yml` (0.13 used `profiles/web`, 0.14+ uses `profiles/desktop`). DSH runs that copy, not the repo — after editing `cursor-kit/index.mjs`, rerun `install.sh` and restart DSH.
- Skills load from `harness/skills/<name>/SKILL.md` and hot-reload (no restart needed).
- Restart DSH from its menu: **DSH Desktop → 重启**. Quitting DSH can install a pending auto-update; warn the user first.

### DSH internals the plugin depends on (alpha APIs — check these first when an update breaks it)

| Hook / API | Used for |
|---|---|
| `ctx.on("session/event")`, event `turn/start` with `data.turn` | snapshot before each top-level turn |
| `ctx.on("tools/pre-execute", (exec, next))` | wait for the snapshot before any tool runs |
| `ctx.on("tools/post-execute", (exec, result, next))` returning `{ kind: "accept", content }` | append lint output to `write` / `edit` results |
| `write` / `edit` tool argument `file_path` | which file to lint |
| `ctx.commands.register({ definitionId, name, description, input: { hint }, handler })`, handler returns `{ kind, text }` | `/checkpoints`, `/rewind` |
| `session.header.cwd`, `origin`, `delegationDepth`, `session.id` | working dir; skip subagent sessions |

Reference sources live inside the app: `/Applications/DSH Desktop.app/Contents/Resources/app.asar` → `node_modules/@deepseek-ai/dsh-*` (each package has a `README.zh.md`). The asar can be read with a small Python script (8-byte pickle header, then JSON index).

## Testing in the real DSH

1. Run `npm test`, then `install.sh`, then restart DSH.
2. In a DSH session (default workspace: `~/Documents/deepseek-harness/default-workspace`): ask the agent to edit two files → `/checkpoints` → `/rewind <one file>` → confirm only that file reverted. Write a broken JSON file to see lint feedback. Try `/review <file>`.
3. Debug: session logs are `harness/sessions/*/*/session.v4.jsonl.zstd` (`zstd -dc`). DSH 0.14 no longer writes `~/Library/Logs/DSH Desktop/harness.log`; use the menu item “显示 Harness 日志”.
4. Clean up test files afterwards.

## When DSH releases a new version

1. Check `/checkpoints` still exists; if not, rerun `install.sh` (profile dir may have moved).
2. Do the real-DSH test above — `npm test` cannot detect DSH API changes.
3. If broken, compare the hooks in the table above against the new `app.asar` sources.
4. Update the “测试环境 / Tested on” versions in both READMEs; tag a GitHub release for notable changes.

## Conventions

- Never touch a user project's own `.git`; checkpoints stay in `~/.dsh-cursor-kit/checkpoints/`.
- Lint must not leave files in the user's project (e.g. ruff runs with `--no-cache`).
- Don't bundle third-party content (e.g. Nature Skills) — link to it and credit the authors.
- Don't commit personal paths, emails or machine-specific data.
