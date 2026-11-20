# dsh-extensions

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH Desktop）扩展合集。不开 Cursor 会员，也能在 DSH 里用上 Cursor Agent 最常用的几个功能。

[English](README.en.md)

| 扩展 | 做什么 | 类似 Cursor 的 |
|---|---|---|
| [cursor-kit](#1-cursor-kit检查点回滚--改后自动-lint) | 每轮自动记录检查点，`/rewind` 一键回滚（可以只回滚单个文件）；agent 改完代码自动跑 lint，让它当场修 | Restore Checkpoint、读 lint 错误后自动修 |
| [/review 技能](#2-review代码审查) | 审查未提交的改动或指定文件，按严重程度列出 bug，对照作业或需求说明检查，只报告不修改 | Bugbot |
| [科研证据模式 v4](#3-科研证据模式-v4agent-预设) | 在广场原版「Scientific Evidence mode」上改进的科研 agent 预设：文献检索、引用核验、证据矩阵、综述，并接入 Nature Skills | — |

> 测试环境：macOS（Apple silicon）+ DSH Desktop 0.13.2 / 0.14.0。cursor-kit 用到了 DSH 的内部插件接口，DSH 大版本升级后可能需要更新。

---

## 1. cursor-kit：检查点回滚 + 改后自动 lint

### 安装

需要 `git`（没有的话运行 `xcode-select --install`）。

```bash
git clone https://github.com/saber-5200120/dsh-extensions.git
cd dsh-extensions
./cursor-kit/install.sh
```

然后在 DSH Desktop 菜单里选「DSH Desktop → 重启」。这个脚本会同时安装 `/review` 技能；只想装插件的话用 `./cursor-kit/install.sh --no-review`。

安装脚本做了三件事：
1. 把插件复制到 `~/.dsh-cursor-kit/`；
2. 在 DSH 每个配置档（`profiles/*/cordis.patch.yml`）末尾加一段注册信息，改之前先备份原文件；
3. 把 `/review` 技能复制到 DSH 的技能目录。

### 检查点和回滚

agent 每一轮开始改文件前，插件都会自动给工作目录拍一个快照。快照存在 `~/.dsh-cursor-kit/checkpoints/` 下单独的 git 仓库里，**不会碰你项目自己的 `.git`**；`node_modules`、`.venv`、`dist` 以及 `.gitignore` 里忽略的文件都不会进快照。

| 命令 | 作用 |
|---|---|
| `/checkpoints` | 列出这个会话的检查点，以及每一轮改了哪些文件 |
| `/rewind` | 撤销上一轮的全部文件改动 |
| `/rewind 3` | 回到 #3 检查点 |
| `/rewind stats.py` | **只**撤销 `stats.py` 在上一轮的改动 |
| `/rewind 3 src/ a.py` | 只把 `src` 目录和 `a.py` 回到 #3 |

- 文件名可以只写文件名；有同名文件时会提示你写完整路径。
- 编号是固定的（最早的是 #1），回滚不会让编号变化。
- 回滚本身也能撤销：每次回滚前都会先记一个“回滚前的状态”。
- 只回滚文件，对话记录不变。

### 改后自动 lint

agent 用 `write` / `edit` 改完一个文件后，插件会马上检查这个文件。有问题就把错误附在工具结果里，agent 同一轮就会看到并修复；没问题就什么都不加，不浪费 token。

| 文件 | 默认检查器 |
|---|---|
| `.py` | `ruff check`（没装时用 `python3 -m py_compile`） |
| `.js` `.ts` `.tsx` 等 | 项目装了 eslint 就用 eslint，否则 `.js` 用 `node --check` |
| `.json` | JSON 解析 |
| `.sh` / `.zsh` | `bash -n` / `zsh -n` |
| `.go` `.rb` `.php` | `gofmt -e` / `ruby -wc` / `php -l` |

想给某个项目换检查器，在项目根目录建 `.dsh/lint.json`：

```json
{
  "*.py": "ruff check --output-format concise {file} && mypy {file}",
  "*.ts": "npx tsc --noEmit -p .",
  "*.md": null
}
```

`{file}` 会被替换成被改的文件；`null` 表示这类文件不检查。

### 开关与卸载

- 关闭某个功能：把 `cordis.patch.yml` 里插件配置的 `checkpoints` 或 `lint` 改成 `false`，然后重启 DSH。
- 卸载：`./cursor-kit/uninstall.sh`（加 `--purge` 会连检查点一起删掉），然后重启 DSH。

### 已知限制

- 目前只支持 macOS。
- 工作目录是主目录（`~`）时不记录检查点。
- 子目录里嵌套的另一个 git 仓库只记录引用，不记录它里面的文件内容。
- 只有通过 `write` / `edit` 工具改的文件会触发 lint；agent 用 shell 命令改的文件不会，但这些改动仍然在检查点里，可以回滚。
- DSH 升级时可能会换配置档目录（0.13 → 0.14 就从 `web` 换成了 `desktop`）。如果升级后 `/checkpoints` 不见了，重新运行一次 `install.sh`。

### 开发

```bash
cd cursor-kit
npm test
```

测试会在临时目录里模拟 DSH 运行插件，不会动你真实的检查点。

---

## 2. `/review`：代码审查

在 DSH 输入框里输入 `/review`，agent 会审查代码并按 🔴 严重 / 🟡 一般 / 🔵 轻微 列出问题。它**只报告、不修改**，最后问你要修哪些。

| 写法 | 审查什么 |
|---|---|
| `/review` | 有 git：未提交的改动（没有就审最近一次提交）；没有 git：这次对话里改过的文件 |
| `/review stats.py` | 指定的文件或目录 |
| `/review 重点看边界情况` | 附加审查重点 |

- 项目里有 README、作业要求、assignment、spec 之类的文件时，会逐条对照代码是否满足要求。
- 检查正确性、名字与实现是否一致、边界情况、错误处理、并发、安全、性能、测试。
- 有一分钟内能跑完的测试就跑一遍。
- 只报告能给出具体触发场景的问题，尽量不误报。

安装：运行上面的 `install.sh` 会自动装上。也可以手动把 [`skills/review/SKILL.md`](skills/review/SKILL.md) 复制到 `~/Library/Application Support/dsh-desktop/harness/skills/review/SKILL.md`，不用重启。

---

## 3. 科研证据模式 v4（Agent 预设）

在 DSH 广场原版「Scientific Evidence mode」的基础上改进：

- **v2**：删掉了从未生效的 persona `text` 配置（schema 只认 `prefix`），加入子代理和工作流编排；
- **v3**：加入当前日期上下文；
- **v4**：persona 加入技能路由，接入 [Nature Skills](https://github.com/chanhaoxian5-ship-it/dsh-nature-skills)，同时保证本预设的证据与诚实规则优先于任何技能。

导入：DSH Desktop → 设置 → Agent 预设 → 导入，选择 [`presets/scientific-evidence-v4/scientific-evidence-en-mode-v4.dshpreset`](presets/scientific-evidence-v4/)。

完整的改动记录、组件构成、校验和与回滚方法见 [说明.md](presets/scientific-evidence-v4/说明.md)。

Nature Skills 是另一个独立项目，**本仓库不包含它**。需要 v4 的技能路由时，请按它的说明另行安装。

---

## 致谢与原作者

- **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**（DeepSeek，MIT）：cursor-kit 是基于它的插件接口开发的。
- **Scientific Evidence mode** 原版：DSH Desktop contributors 发布于 DSH 广场（发布者 `dshdesktop`，预设 ID `scientific-evidence-mode-3b2c67`，MIT）。原许可证和设计来源保留在 [`presets/scientific-evidence-v4/LICENSE`](presets/scientific-evidence-v4/LICENSE) 和 [`SOURCE.md`](presets/scientific-evidence-v4/SOURCE.md)。
  - 原版设计参考了 [K-Dense Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)（MIT）和 PRISMA 报告规范。
- **[dsh-nature-skills](https://github.com/chanhaoxian5-ship-it/dsh-nature-skills)**（chanhaoxian5-ship-it，Apache-2.0），上游为 [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills)：v4 预设路由调用的技能集，本仓库没有收录它的任何文件。
- “Cursor” 是 Anysphere 的商标。本项目只是功能上参考 Cursor，与 Cursor / Anysphere 没有任何关联。

## 许可证

- 本仓库自己的代码和文档：[MIT](LICENSE)。
- `presets/scientific-evidence-v4/` 下的预设是在原版基础上修改的，沿用原版的 MIT 许可证，版权归 DSH Desktop contributors，见该目录下的 [LICENSE](presets/scientific-evidence-v4/LICENSE)。
