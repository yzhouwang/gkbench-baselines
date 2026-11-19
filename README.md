# GHL baselines for GKBench

在 GKBench 上运行 GHL 的考试策略。下表按决策规则排列，旧 B 编号可继续用于复现历史评测。 / Run the GHL exam policies on GKBench. The catalog groups entries by decision rule and preserves the historical B entry points.

## 算法目录 / Policy catalog

| 展示名 / Name | 旧名 | 如何选动作 / Decision rule | Python 入口（位于 `algorithms/`） |
| --- | --- | --- | --- |
| Logic 卡牌估值 / Logic Card Heuristic | B1、B3 | 估算本手牌的得分、增益与体力消耗。 / Weigh the hand’s score, buffs and stamina costs. | `ghl_policies.py:LogicCardHeuristic` |
| Logic 分流启发式 / Logic Subtype Heuristic | B1v2 | 按偶像选择好印象或干劲规则。干劲型会估算元气转分的机会。 / Choose a Good Impression or Motivation rule for the idol, valuing future Genki-to-score opportunities for Motivation. | `ghl_policies.py:LogicSubtypeHeuristic` |
| 好印象固定策略 / Good Impression Only | B1v2gi | 分流对照组。固定使用好印象规则，包括干劲型开局。 / A routing control that forces the Good Impression rule on both subtypes. | `ghl_policies.py:GoodImpressionOnly` |
| 单步估值搜索 / One-Step Value Search | B2 | 在同一批采样世界里各走一步，用局面估值选动作。 / Test each action one step ahead in the same sampled worlds and compare projected value. | `ghl_search.py:OneStepValueSearch` |
| 终局得分搜索 / Final Score Rollout | B4 | 每个候选动作都由分流启发式推演到结束，比较平均得分。 / Play each candidate to the end using the subtype heuristic and choose by mean final score. | `ghl_search.py:FinalScoreRollout` |
| 名次与饮料保留搜索 / Rank and Drink Rollout | B4v2 | 中间审查权衡名次和留存饮料的价值，最终审查用终局得分。 / Midterms value rank and saved drinks. Finals optimize score. | `ghl_search.py:RankAndDrinkRollout` |
| Sense 增益估值 / Sense Buff Value | Sense B1v2 | 比较直接得分与好调、绝好调、集中在剩余回合的收益。 / Weigh current score against the value of Good Condition, Perfect Condition and Concentration on later turns. | `ghl_sense.py:SenseHeuristic` |
| 随机合法动作 / Uniform Random | B0，对照组 | 在所有合法动作中均匀抽样，直接复用 SDK 的 `random`。 / Delegate to the SDK’s uniform random policy. | 内置 `random` 或 `ghl_random.py:UniformRandom` |

B3 在独立考试里调用 B1。两者在官方「初」的 64 局和自有集合的 704 局中，逐局路线和分数完全相同，因此共用一个目录条目。原 B3 入口仍记录其历史标识。 / B3 delegates standalone exams to B1. All 768 matched historical routes and scores agree. The legacy B3 entry retains its telemetry.

好印象固定策略在好印象型上与分流策略使用同一分支。在共同覆盖的 768 个干劲型题目与牌序组合上，两者的出牌路线全部不同。两种长程搜索在最终审查共用得分目标，中间审查的目标与后续饮料规则不同。 / Good Impression Only shares the subtype heuristic’s Good Impression branch. Their routes differed on all 768 matched Motivation deals. The two rollout variants share a final-exam objective and use different midterm objectives and drink rules.

旧版 HIF 的 `ghl-b1v2-adapted-v1` 也调用 B1v2。它使用较早的画面适配器，验证过的 HIF 开局都是好印象型。它的烟雾测试和完整运行属于同一历史版本。 / The legacy HIF adapter also used B1v2. Its verified HIF decks used Good Impression and an earlier observation adapter. Its smoke test and longer run are two records of that version. [历史运行 / Historical run](https://hiro.matto.top/gkbench/runs/template-hif-ghl-b1v2-adapted-v1-yzhouwang-24f77fb2c7e7)

## 选题与运行条件 / Compatibility

随机策略覆盖官方「初」全部 48 题。Logic 策略在其中两道考试验证过，分别为 `AS-X8NXKZXW`（中间）和 `AS-DDCRRSTM`（最终）。另外 46 题属于 Anomaly。自有 26 道 Logic 考试里，随机和单步搜索覆盖全部 26 题，基于启发式的方法覆盖 22 题。其余 4 题涉及公开观测缺少的累计消耗元气计数。 / Uniform Random covered all 48 official Hajime questions. The Logic policies were verified on the two Logic exams. The other 46 use Anomaly. On the 26 personal Logic exams, Random and One-Step Value Search covered all 26 and the heuristic-based policies covered 22. The other four need a cumulative Genki counter missing from public observations. [官方集合 / Hajime](https://hiro.matto.top/gkbench/sets/hajime) · [自有集合 / Community set](https://hiro.matto.top/gkbench/exams/u-yzhouwang-723768)

基于画面的启发式需要 Node 24+ 及下文的公开数据。三种搜索还需要能在本机运行的 GKMS 引擎，单步搜索可独立于 Node 运行。 / Screen heuristics use Node 24+ and the data generated below. All three search policies require a working GKMS installation. One-Step Value Search can run without Node.

Sense 策略使用新版 GHL 的考试出牌规则。它读取手牌、公开牌堆组成、回合属性与增益，比较合法出牌及饮料。卡牌按可映射的基础和升级效果估值，定制与考中成长由裁判结算。遇到无法映射的卡牌或选择时会报告具体错误。 / The Sense policy evaluates legal plays and drinks using the visible hand, pile composition, turn attributes and buffs. It values mapped base and upgrade effects. The referee applies customizations and in-exam growth. Unsupported cards or choices raise an error.

### Sense 本地配对成绩 / Paired local Sense results

2026-11-19，在 GKBench 的规则 65 本地裁判上对三个集合的全部 149 道公开 Sense 题各跑 32 个独立练习牌序。三种算法共完成 14,304 局。每一行使用相同题目和相同牌序计算均分。线上也公布规则号 65，但完整构建版本与正式保密牌序未公开。 / All three policies completed the same 32 practice deals for each of 149 public Sense questions on a local rules-65 referee. The hosted service also reports rules 65. Official deals and the full server build are private.

| 集合 / Set | 题数 / Questions | Sense 增益估值 / Sense Buff Value | 内置贪心 / SDK Greedy | 内置随机 / SDK Random | 按题均分胜过贪心 / Questions won vs. Greedy |
| --- | ---: | ---: | ---: | ---: | ---: |
| HIF | 96 | 152,526.94 | 80,833.06 | 25,717.03 | 94/96 |
| NIA | 3 | 46,921.43 | 20,461.10 | 10,930.96 | 3/3 |
| 偶像之路 / Idol Road | 50 | 132,181.24 | 85,438.57 | 22,664.29 | 48/50 |

## 先跑随机对照 / Run the random control

以下命令从本目录执行。使用 Python 3.12 和 Git。托管评测使用运行者自己的 GKBench 登录凭据。这个命令在服务端创建一项单题单牌序评测。

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m gkbench eval --hosted --set hajime --only AS-X8NXKZXW --seeds 1 \
  --algo random --parallel 1
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
  --seeds 1 --parallel 1 --algo algorithms/ghl_policies.py:LogicSubtypeHeuristic \
  --label ghl-b1v2-logic-v2
```

## 准备 Sense 并本地试跑 / Run a Sense exam locally

先生成上面的公共数据。为支持较晚加入的 HIF 偶像专属卡，再运行下列第一条命令。它从两个固定版本的上游下载约 47 MiB 的输入，校验两个文件的 SHA-256，只在本机生成这张卡的四级定义。已有下载时可以传 `--input-dir` 指向包含 `ProduceCard.yaml` 与 `skill_cards.csv` 的目录。 / After the common data step, build the Sense supplement. It verifies two pinned upstream files and generates four local card-level definitions. Use `--input-dir` to reuse downloaded inputs.

```sh
python tools/prepare_sense_data.py
export GKMS_ROOT=/path/to/GKMSProject
python examples/local_exam.py path/to/sense-loadout.json \
  algorithms/ghl_sense.py:SenseHeuristic --seed 123
```

本机练习使用 GKMS 裁判与自选牌序。托管运行这条 Sense 策略时只需 SDK、Node 和公开数据，裁判在服务器上。 / Local practice uses a GKMS referee and a chosen deal. In hosted mode the referee runs on the server, and the policy uses only the SDK, Node and public inputs.

## 用已有的 GKMS 环境跑搜索

单步估值、终局得分及名次与饮料保留三种搜索要用 GKBench 兼容的原生引擎。提供已获授权的 GKMSProject 检出及构建好的原生库，在该环境安装上面固定版本的 GKBench。历史对照使用 GKMS commit `b5dd367ecda5e3b8416a3c007df60bc898abd8c3`（rules 59）与 GKBench commit `d88aed67e95ea8c0d6b6590c27ccf080e2c94258`。引擎另行获取。[GKBench 引擎接入说明](https://github.com/matto49/gakumas-bench/blob/d88aed67e95ea8c0d6b6590c27ccf080e2c94258/gkbench/engine.py)

先把 `GKMS_ROOT` 设置为本机 GKMSProject 的绝对路径。如果原生库安装在非默认位置，再设置 `GKMSCLIGPU_LIB` 指向该库。本机试跑使用一份公开开局 JSON 和自行指定的练习种子。将下面的文件名换成实际文件。

```sh
export GKMS_ROOT=/path/to/GKMSProject
python examples/local_exam.py path/to/loadout.json \
  'algorithms/ghl_search.py:FinalScoreRollout:samples=3,seconds=9.5'
```

托管跑同样两道题时，B2 设置 `--budget 5`，B4 和 B4v2 设置 `--budget 10`。新 Logic 题换成相应集合名和题号即可试跑。两题各试一个牌序的 B4 命令如下。

```sh
python -m gkbench eval --hosted --set hajime --only AS-X8NXKZXW,AS-DDCRRSTM \
  --algo "$PWD/algorithms/ghl_search.py:FinalScoreRollout:samples=3,seconds=9.5" \
  --budget 10 --seeds 1 --parallel 1 --label ghl-b4-gkms-n3-v1
```

托管时请用稳定的 ASCII 标签，算法的中英说明会随 `about` 上传。当前服务端只保留运行标签中的 ASCII 字母、数字和部分标点。个人历史成绩仍使用原标签。 / Use a stable ASCII label for hosted evaluations. The bilingual description travels in `about`. The server sanitizes run labels, and the existing runs keep their original labels.

以上入口支持从独立仓库运行。GKBench 固定评测机还提供向 `develop` 提交算法的 PR 流程，该流程按集合运行，并且需要安排额外依赖。[上游提交说明](https://github.com/matto49/gakumas-bench/blob/develop/submissions/README.md)

## 来源与许可

Logic 策略从 GHL commit `f88dbef894ee65bdec03de818c0bcfa7fc88e4a2` 提取考试阶段代码，配套的是 2026-11-15 评测结束时的 GKBench 适配器。Sense 考试策略提取自 GHL commit `777aa954d8d1f780455c0dceb166747c3d628979`。以前发布的 Logic 成绩采用固定的 32 个牌序。B4 在共同题上的官方均分为 8,243.34，自有集均分为 70,857.76。[官方 B4 记录](https://hiro.matto.top/gkbench/runs/template-hajime-ghl-b4-gkms-n3-v1-yzhouwang-2270d5dbbc06) · [自有集 B4 记录](https://hiro.matto.top/gkbench/runs/template-u-yzhouwang-723768-ghl-b4-gkms-n3-v1-yzhouwang-d262d3cc1d11)

MIT 授权范围为本包作者编写的代码。GKBench SDK 使用其 MIT 许可证，gakumas-tools 的代码使用其 BSD-3-Clause 许可证。游戏内容、上游主数据与 GKMS 原生引擎的权利归各自权利人，安装者从相应来源取得。[本包 LICENSE](LICENSE) · [gakumas-tools](https://github.com/gakumas-tools/gakumas-tools) · [gakumasu-diff](https://github.com/vertesan/gakumasu-diff)
