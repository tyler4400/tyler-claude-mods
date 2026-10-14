"""用示例数据画出 README 里的截图（SVG），不含任何真实会话内容。

运行：python3 docs/render_screenshots.py，输出到同目录的 sidebar.*.svg 和 drift.*.svg。
"""

from pathlib import Path
from xml.sax.saxutils import escape

FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', 'Noto Sans SC', sans-serif"
MONO = "'SF Mono', Menlo, Consolas, monospace"
COLORS = {
    "page": "#30302e",
    "panel": "#262624",
    "selected": "#3a3a37",
    "text": "#ececea",
    "dim": "#8f8f8a",
    "accent": "#d97757",
    "keep": "#4caf50",
    "line": "#4a4a46",
}

# 侧边栏里的会话标题；数据是虚构的
SIDEBAR = {
    "en": {
        "header": "Sessions",
        "legend": "prefix｜MMDD｜subject",
        "titles": [
            "实现｜1014｜Public API rate limiting",
            "问题｜1014｜Flaky CI test timeouts",
            "方案｜1013｜Order export endpoint",
            "探索｜1013｜Rust ownership basics",
            "环境｜1012｜Local proxy and certificates",
            "生活｜1011｜Weekend camping checklist",
        ],
    },
    "zh": {
        "header": "会话",
        "legend": "前缀｜MMDD｜主体",
        "titles": [
            "实现｜1014｜公开API限流",
            "问题｜1014｜CI单测偶发超时",
            "方案｜1013｜订单导出接口设计",
            "探索｜1013｜Rust所有权入门",
            "环境｜1012｜本地代理与证书配置",
            "生活｜1011｜周末露营装备清单",
        ],
    },
}

# 一个会话里标题怎么跟着主线走：(轮次, 这一轮在做什么, 模型写的主线, 结果, 是否改了标题)
DRIFT = {
    "en": {
        "header": "How the title follows the session",
        "steps": [
            ("turn 2", "Opens by comparing rate-limiting approaches", "主线：Compare rate-limiting options for the public API", "选型｜1013｜API rate limiting options", True),
            ("turn 9", "Several turns of building the limiter and its tests", "主线：Implement token-bucket rate limiting for the public API", "实现｜1013｜Public API rate limiting", True),
            ("turn 10", "A quick question about a failing CI run", "主线：Implement token-bucket rate limiting for the public API", "KEEP (title unchanged)", False),
        ],
    },
    "zh": {
        "header": "标题怎么跟着主线走",
        "steps": [
            ("第 2 轮", "开场在比较几种限流方案", "主线：比较公开 API 的几种限流方案", "选型｜1013｜API限流方案对比", True),
            ("第 9 轮", "之后连续多轮在实现限流器、补测试", "主线：给公开 API 实现令牌桶限流并补测试", "实现｜1013｜公开API限流", True),
            ("第 10 轮", "临时问了一句 CI 为什么挂了", "主线：给公开 API 实现令牌桶限流并补测试", "KEEP（标题不变）", False),
        ],
    },
}


def text(x, y, content, color, *, size=14, bold=False, anchor="start", family=None) -> str:
    attrs = f' font-weight="600"' if bold else ""
    attrs += f' font-family="{family}"' if family else ""
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" text-anchor="{anchor}"{attrs}>{escape(content)}</text>'


def svg(width: int, height: int, parts: list[str]) -> str:
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="{FONT}">',
            f'<rect width="{width}" height="{height}" rx="14" fill="{COLORS["page"]}"/>',
            *parts,
            "</svg>",
            "",
        ]
    )


def render_sidebar(data: dict) -> str:
    width, row = 400, 36
    parts = [text(28, 40, data["header"], COLORS["dim"], size=13, bold=True)]
    y = 56
    for i, title in enumerate(data["titles"]):
        if i == 0:
            parts.append(f'<rect x="16" y="{y}" width="{width - 32}" height="{row - 4}" rx="8" fill="{COLORS["selected"]}"/>')
        parts.append(text(28, y + 21, title, COLORS["text"] if i == 0 else "#d6d6d2"))
        y += row
    parts.append(f'<line x1="28" y1="{y + 10}" x2="{width - 28}" y2="{y + 10}" stroke="{COLORS["line"]}"/>')
    parts.append(text(28, y + 34, data["legend"], COLORS["dim"], size=12, family=MONO))
    return svg(width, y + 52, parts)


def render_drift(data: dict) -> str:
    width, left, step_height = 720, 36, 112
    parts = [text(left, 40, data["header"], COLORS["dim"], size=13, bold=True)]
    y = 64
    for i, (turn, doing, mainline, result, changed) in enumerate(data["steps"]):
        dot = COLORS["accent"] if changed else COLORS["keep"]
        # 左侧时间线
        parts.append(f'<circle cx="{left + 6}" cy="{y + 10}" r="6" fill="{dot}"/>')
        if i < len(data["steps"]) - 1:
            parts.append(f'<line x1="{left + 6}" y1="{y + 22}" x2="{left + 6}" y2="{y + step_height - 2}" stroke="{COLORS["line"]}" stroke-width="2"/>')
        x = left + 28
        parts.append(text(x, y + 15, turn, COLORS["text"], bold=True))
        parts.append(text(x + 80, y + 15, doing, COLORS["dim"]))
        # 模型的两行输出
        parts.append(f'<rect x="{x}" y="{y + 28}" width="{width - x - 28}" height="58" rx="8" fill="{COLORS["panel"]}" stroke="{COLORS["line"]}"/>')
        parts.append(text(x + 14, y + 51, mainline, COLORS["dim"], size=13, family=MONO))
        parts.append(text(x + 14, y + 74, result, dot, size=13, bold=True, family=MONO))
        y += step_height
    return svg(width, y + 8, parts)


def main() -> None:
    out = Path(__file__).parent
    for lang in ("en", "zh"):
        (out / f"sidebar.{lang}.svg").write_text(render_sidebar(SIDEBAR[lang]), encoding="utf-8")
        (out / f"drift.{lang}.svg").write_text(render_drift(DRIFT[lang]), encoding="utf-8")


if __name__ == "__main__":
    main()
