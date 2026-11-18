# GHL baselines for GKBench

学园偶像大师「初」考试的八个 GHL 基线。B0 随机选合法动作。B1 系列按当前画面估值出牌。B2 和 B4 系列通过 GKBench 采样世界做搜索。算法入口兼容 GKBench 的 `文件.py:类名` 格式。

## 哪些题能跑

| 算法 | 入口（相对于仓库根目录） | 运行条件 |
| --- | --- | --- |
| B0 | `algorithms/ghl_random.py:B0` | GKBench SDK。按合法动作均匀采样，已覆盖官方「初」48 题 |
| B1 | `algorithms/ghl_policies.py:B1` | Node 24+ 和下面生成的公开数据。Logic 考试启发式 |
| B1v2 | `algorithms/ghl_policies.py:B1v2` | 同上。按好印象或干劲选择策略 |
| B1v2gi | `algorithms/ghl_policies.py:B1v2GI` | 同上。固定用好印象策略 |
| B3 | `algorithms/ghl_policies.py:B3Campaign` | 同上。原 B3 在考试阶段调用 B1，两者提交的 768 局动作路线和分数一致 |
| B2 | `algorithms/ghl_search.py:GHLB2:samples=3,seconds=4.5` | SDK 和兼容的 GKMS 原生引擎。用原 B2 估值函数中的考试项做单步搜索 |
| B4 | `algorithms/ghl_search.py:GHLB4:samples=3,seconds=9.5` | 原生引擎、Node 和公开数据。用 B1v2 推演到考试结束，比较终局分 |
| B4v2 | `algorithms/ghl_search.py:GHLB4V2:samples=3,seconds=9.5` | 同 B4。中间审查按公开对手分数范围估计名次，并给留到后面的饮料估值。最终审查比较终局分 |

官方「初」实测的 Logic 题是 `AS-X8NXKZXW`（中间）和 `AS-DDCRRSTM`（最终）。另外 46 题属于 Anomaly，其中也有课程。移植到那些题需要补相应状态、动作和估值。自有集合的 26 道 Logic 题上，B0、B2 跑完全部题，依赖启发式的算法覆盖其中 22 题。其余 4 题的卡牌需要公开画面缺少的累计消耗元气计数。新题可先按下文在本机试跑，碰到未知卡牌、状态或动作会报出原因。[官方集合](https://hiro.matto.top/gkbench/sets/hajime) · [实测社区集合](https://hiro.matto.top/gkbench/exams/u-yzhouwang-723768)

## 先跑 B0

以下命令从本目录执行。使用 Python 3.12 和 Git。托管评测使用运行者自己的 GKBench 登录凭据。这个命令在服务端创建一项单题单牌序评测。

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m gkbench eval --hosted --set hajime --only AS-X8NXKZXW --seeds 1 \
  --algo algorithms/ghl_random.py:B0 --parallel 1
```

## 准备启发式用的数据

安装 Node.js 24 或更高版本。把两个公开数据源检出到以下版本，已有相同版本的本地检出可以直接传给脚本。脚本在本机生成四份 JSON，并逐个检查 SHA-256。

```sh
mkdir -p .deps
git init -q .deps/gakumas-tools
git -C .deps/gakumas-tools fetch --depth 1 https://github.com/gakumas-tools/gakumas-tools.git b3427501e4ccffa3cc64a4d4b014381961ab4dce
git -C .deps/gakumas-tools checkout --detach FETCH_HEAD
git init -q .deps/gakumasu-diff
git -C .deps/gakumasu-diff fetch --depth 1 https://github.com/vertesan/gakumasu-diff.git ecc33afcb100888072b6258790e8730f6768db9a
git -C .deps/gakumasu-diff checkout --detach FETCH_HEAD
python tools/prepare_data.py --master .deps/gakumasu-diff --gakumas-tools .deps/gakumas-tools
python -m gkbench eval --hosted --set hajime --only AS-X8NXKZXW,AS-DDCRRSTM \
  --seeds 1 --parallel 1 --algo algorithms/ghl_policies.py:B1v2
```

## 用已有的 GKMS 环境跑搜索

B2、B4 和 B4v2 的本地搜索要用 GKBench 兼容的原生引擎。提供已获授权的 GKMSProject 检出及构建好的原生库，在该环境安装上面固定版本的 GKBench。历史对照使用 GKMS commit `b5dd367ecda5e3b8416a3c007df60bc898abd8c3`（rules 59）与 GKBench commit `d88aed67e95ea8c0d6b6590c27ccf080e2c94258`。引擎另行获取。[GKBench 引擎接入说明](https://github.com/matto49/gakumas-bench/blob/d88aed67e95ea8c0d6b6590c27ccf080e2c94258/gkbench/engine.py)

先把 `GKMS_ROOT` 设置为本机 GKMSProject 的绝对路径。如果原生库安装在非默认位置，再设置 `GKMSCLIGPU_LIB` 指向该库。本机试跑使用一份公开开局 JSON 和自行指定的练习种子。将下面的文件名换成实际文件。

```sh
export GKMS_ROOT=/path/to/GKMSProject
python examples/local_exam.py path/to/loadout.json \
  'algorithms/ghl_search.py:GHLB4:samples=3,seconds=9.5'
```

托管跑同样两道题时，B2 设置 `--budget 5`，B4 和 B4v2 设置 `--budget 10`。新 Logic 题换成相应集合名和题号即可试跑。两题各试一个牌序的 B4 命令如下。

```sh
python -m gkbench eval --hosted --set hajime --only AS-X8NXKZXW,AS-DDCRRSTM \
  --algo "$PWD/algorithms/ghl_search.py:GHLB4:samples=3,seconds=9.5" \
  --budget 10 --seeds 1 --parallel 1
```

以上入口支持从独立仓库运行。GKBench 固定评测机还提供向 `develop` 提交算法的 PR 流程，该流程按集合运行，并且需要安排额外依赖。[上游提交说明](https://github.com/matto49/gakumas-bench/blob/develop/submissions/README.md)

## 来源与许可

本包从 GHL commit `f88dbef894ee65bdec03de818c0bcfa7fc88e4a2` 提取考试阶段代码，配套的是 2026-11-15 评测结束时的 GKBench 适配器。原成绩采用固定的 32 个牌序。B4 在共同题上的官方均分为 8,243.34，自有集均分为 70,857.76。[官方 B4 记录](https://hiro.matto.top/gkbench/runs/template-hajime-ghl-b4-gkms-n3-v1-yzhouwang-2270d5dbbc06) · [自有集 B4 记录](https://hiro.matto.top/gkbench/runs/template-u-yzhouwang-723768-ghl-b4-gkms-n3-v1-yzhouwang-d262d3cc1d11)

MIT 授权范围为本包作者编写的代码。GKBench SDK 使用其 MIT 许可证，gakumas-tools 的代码使用其 BSD-3-Clause 许可证。游戏内容、上游主数据与 GKMS 原生引擎的权利归各自权利人，安装者从相应来源取得。[本包 LICENSE](LICENSE) · [gakumas-tools](https://github.com/gakumas-tools/gakumas-tools) · [gakumasu-diff](https://github.com/vertesan/gakumasu-diff)
