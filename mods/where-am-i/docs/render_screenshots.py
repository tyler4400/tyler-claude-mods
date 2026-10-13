"""用示例数据画出 README 里的卡片截图（SVG），不含任何真实会话内容。

运行：python3 docs/render_screenshots.py，输出到同目录的 card-*.svg。
"""

from pathlib import Path
from xml.sax.saxutils import escape

WIDTH = 960
FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', 'Noto Sans SC', sans-serif"
COLORS = {
    "page": "#30302e",
    "card": "#262624",
    "text": "#ececea",
    "dim": "#8f8f8a",
    "detail": "#cfcfca",
    "waiting": "#d4943a",
    "idle": "#4caf50",
}

# 两种状态 × 两种语言；数据是虚构的示例会话
SAMPLES = {
    "en": {
        "waiting": {
            "goal": "🎯 Add rate limiting to the public API",
            "meta": "turn 14 · 16:20",
            "now": "Wired the limiter into the gateway and added tests",
            "stats": "18 calls · 3 files edited · 2m41s",
            "action": "⏳ waiting on you: Pick a default limit, 60 or 120 requests per minute",
            "buttons": ["Hide", "Fold"],
            "detail": "This session adds rate limiting to the public API so one client can no longer slow everyone down. "
            "The token-bucket limiter is in the gateway with tests passing; only the default limit is still open. "
            "Next: pick the limit, update the docs, then open a PR.",
        },
        "idle": {
            "goal": "🎯 Add rate limiting to the public API",
            "meta": "turn 15 · 16:32",
            "now": "Set the default to 120 requests per minute and updated the docs",
            "stats": "7 calls · 2 files edited · 1m05s",
            "action": "→ next: Open a PR and ask for review",
            "buttons": ["Details", "Fold"],
        },
    },
    "zh": {
        "waiting": {
            "goal": "🎯 给公开 API 加限流",
            "meta": "第 14 轮 · 16:20",
            "now": "已把限流器接进网关并补上测试",
            "stats": "18 次调用 · 改 3 个文件 · 2分41秒",
            "action": "⏳ 等你：默认限额定为每分钟 60 次还是 120 次",
            "buttons": ["收起", "折叠"],
            "detail": "这个会话在给公开 API 加限流，避免单个客户端拖慢所有人。令牌桶限流器已接进网关，测试通过，"
            "只剩默认限额没定。接下来：定好限额，更新文档后提 PR。",
        },
        "idle": {
            "goal": "🎯 给公开 API 加限流",
            "meta": "第 15 轮 · 16:32",
            "now": "默认限额定为每分钟 120 次，文档已更新",
            "stats": "7 次调用 · 改 2 个文件 · 1分05秒",
            "action": "→ 下一步：提 PR 并请人 review",
            "buttons": ["详情", "折叠"],
        },
    },
}


def text_width(text: str, size: float) -> float:
    """粗略估算宽度：中日韩字符一个字宽，其他半个多字宽"""
    return sum(size if ord(ch) > 0x2E80 else size * 0.5 for ch in text)


def wrap(text: str, size: float, max_width: float) -> list[str]:
    lines, line = [], ""
    # 英文按词换行，中文按字换行
    tokens = text.split(" ") if text.isascii() else list(text)
    joiner = " " if text.isascii() else ""
    for token in tokens:
        candidate = f"{line}{joiner}{token}" if line else token
        if text_width(candidate, size) > max_width and line:
            lines.append(line)
            line = token
        else:
            line = candidate
    return [*lines, line] if line else lines


def text(x: float, y: float, content: str, color: str, *, bold=False, anchor="start", size=14) -> str:
    weight = ' font-weight="600"' if bold else ""
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" text-anchor="{anchor}"{weight}>{escape(content)}</text>'


def render(sample: dict, state: str) -> str:
    color = COLORS[state]
    left, right = 36, WIDTH - 36
    rows = [48, 84, 120]
    parts = [
        text(left, rows[0], sample["goal"], COLORS["text"], bold=True),
        text(right, rows[0], sample["meta"], COLORS["dim"], anchor="end"),
        text(left, rows[1], "●", color),
        text(left + 20, rows[1], sample["now"], COLORS["text"]),
        text(right, rows[1], sample["stats"], COLORS["dim"], anchor="end"),
        text(left, rows[2], sample["action"], color if state == "waiting" else COLORS["dim"]),
    ]
    # 两个按钮右对齐，间距与卡片一致
    x = right
    for label in reversed(sample["buttons"]):
        parts.append(text(x, rows[2], label, COLORS["text"], anchor="end"))
        x -= text_width(label, 14) + 28

    bottom = rows[2] + 24
    if "detail" in sample:
        y = rows[2] + 36
        for line in wrap(sample["detail"], 14, right - left):
            parts.append(text(left, y, line, COLORS["detail"]))
            y += 24
        bottom = y - 4

    card_height = bottom - 16
    height = card_height + 32
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" font-family="{FONT}">',
            f'<rect width="{WIDTH}" height="{height}" rx="14" fill="{COLORS["page"]}"/>',
            f'<rect x="16" y="16" width="{WIDTH - 32}" height="{card_height}" rx="10" fill="{COLORS["card"]}" stroke="{color}" stroke-width="1.5"/>',
            *parts,
            "</svg>",
            "",
        ]
    )


def main() -> None:
    out = Path(__file__).parent
    for lang, states in SAMPLES.items():
        for state, sample in states.items():
            (out / f"card-{state}.{lang}.svg").write_text(render(sample, state), encoding="utf-8")


if __name__ == "__main__":
    main()
