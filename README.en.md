# dsh-extensions

Extensions for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH Desktop) that bring a few of Cursor Agent's most useful features to DSH, using your own model API.

[中文](README.md)

| Extension | What it does | Cursor counterpart |
|---|---|---|
| **cursor-kit** | Automatic per-turn checkpoints with `/checkpoints` and `/rewind` (whole turn or single files); runs a linter after every agent edit and feeds problems back so the agent fixes them in the same turn | Restore Checkpoint, lint-fix loop |
| **`/review` skill** | Reviews uncommitted changes or given files, checks them against any assignment/spec in the repo, ranks findings by severity, read-only | Bugbot |
| **Scientific Evidence mode v4** | An improved version of the community "Scientific Evidence mode" agent preset (literature search, citation verification, evidence matrices, reviews), with routing into Nature Skills | — |

Tested on macOS (Apple silicon) with DSH Desktop 0.13.2 and 0.14.0. cursor-kit uses DSH's internal plugin hooks and may need updates after major DSH releases.

## Install cursor-kit and `/review`

Requires `git` (`xcode-select --install`).

```bash
git clone https://github.com/saber-5200120/dsh-extensions.git
cd dsh-extensions
./cursor-kit/install.sh            # add --no-review to skip the /review skill
```

Then choose **DSH Desktop → Restart** from the menu. Uninstall with `./cursor-kit/uninstall.sh` (`--purge` also deletes saved checkpoints).

### Commands

| Command | Effect |
|---|---|
| `/checkpoints` | List this session's checkpoints and the files each turn changed |
| `/rewind` | Undo all file changes from the last turn |
| `/rewind 3` | Restore checkpoint #3 |
| `/rewind stats.py` | Undo only `stats.py`'s changes from the last turn |
| `/rewind 3 src/ a.py` | Restore only `src/` and `a.py` to #3 |
| `/review [files or focus]` | Code review; reports only, then asks what to fix |

Checkpoints live in a separate shadow git repository under `~/.dsh-cursor-kit/checkpoints/`; your project's own `.git` is never touched. Each rewind first records a "before rewind" checkpoint, so rewinds can be undone. Conversation history is not changed.

Per-project linter overrides go in `.dsh/lint.json`, e.g. `{"*.py": "ruff check {file} && mypy {file}", "*.md": null}`.

Run the tests with `cd cursor-kit && npm test`.

## Scientific Evidence mode v4

Import `presets/scientific-evidence-v4/scientific-evidence-en-mode-v4.dshpreset` via **Settings → Agent presets → Import**. See [说明.md](presets/scientific-evidence-v4/说明.md) (Chinese) for the full changelog, components and checksums. Nature Skills is a separate project and is not included here.

## Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek (MIT) — cursor-kit is built on its plugin API.
- The original **Scientific Evidence mode** preset by DSH Desktop contributors, published on the DSH marketplace by `dshdesktop` (preset id `scientific-evidence-mode-3b2c67`, MIT). Its original license and design sources are kept in [`presets/scientific-evidence-v4/`](presets/scientific-evidence-v4/). It draws on [K-Dense Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills) (MIT) and PRISMA reporting concepts.
- [dsh-nature-skills](https://github.com/chanhaoxian5-ship-it/dsh-nature-skills) by chanhaoxian5-ship-it (Apache-2.0), upstream [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) — referenced by the v4 preset, not bundled.
- "Cursor" is a trademark of Anysphere. This project is not affiliated with Cursor or Anysphere.

## License

MIT for this repository's own code and docs ([LICENSE](LICENSE)). The preset under `presets/scientific-evidence-v4/` is a modified version of the original and keeps its MIT license, © DSH Desktop contributors ([LICENSE](presets/scientific-evidence-v4/LICENSE)).
