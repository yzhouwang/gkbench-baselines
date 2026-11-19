"""Build the public GKBench metadata shared by the released baselines."""


def description(summary, chinese, english, *, family=None):
    about = {
        "summary": summary,
        "detail": [chinese, english],
        "sees": "screen",
        "links": [{"title": "源码 / Source", "url": "https://github.com/yzhouwang/gkbench-baselines"}],
    }
    if family:
        about["family"] = family
    return about
