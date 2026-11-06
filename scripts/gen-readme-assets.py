#!/usr/bin/env python3
"""Generate the README artwork for dsh-customs-mcp (docs/assets/).

Two pieces, both derived from what the server actually does:

  hero (Pillow, 1440x576, webp, zh/en x light/dark)
      Left column: kicker / title / two value lines / subtitle / meta / footer.
      Right visual: the MCP protocol seam. A client session on the left, the
      server's four tools on the right, one dashed stdio/JSON-RPC boundary
      between them, and the report coming back across it.

  structure (hand-written SVG, 1100x660, light/dark, shared by all five READMEs)
      "dual intake, one engine, two report sections": JSON/YAML goes straight
      in; a .docx is read to text and assembled into a ledger first; both meet
      at check.mjs (68 aliases -> 17 row fields + 5 header fields, then the
      seven-rule pack); findings and checks-not-run leave through the wording
      gate as one Markdown report.

Facts the drawings rely on (verified against src/ before writing):
  src/server.js    stdio JSON-RPC, PROTOCOL_VERSION 2024-11-05, four tools
  src/index.js     newline-delimited JSON-RPC loop
  src/check.mjs    COLUMN_CONTRACT: 17 row fields / 68 aliases / 5 header
                   fields; ruleset 2026.1: 7 rules, all warn, 0/7 verbatim;
                   renderMarkdown with a forbidden-wording gate
  src/docx.mjs     .docx only, read-only, 20 MB cap, paragraphs and | cells |,
                   merged cells marked with an arrow glyph

The structure drawing uses command tokens, field names and short English labels
only (plus the two literal report headings), so it does not need five language
variants. Every label is measured with the font that draws it; a label that
would overflow its box aborts the run instead of shipping a clipped image.
Nothing is drawn that the README does not say.

Run:  python scripts/gen-readme-assets.py
Needs: Pillow + msyh.ttc / msyhbd.ttc / consola.ttf (Windows) or a probed
       equivalent; exits with a message when a CJK font is missing.
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from html import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")
NAME = "dsh-customs-mcp"

# --- font probes -----------------------------------------------------------
REG_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
MONO_CANDIDATES = [
    r"C:\Windows\Fonts\consola.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]


def pick(paths: list[str], what: str) -> str:
    for path in paths:
        if os.path.exists(path):
            return path
    sys.exit(f"FATAL: no {what} font found (looked for {', '.join(paths)}). "
             "Refusing to render tofu boxes; install one of the probed fonts.")


REG_PATH = pick(REG_CANDIDATES, "CJK regular")
BOLD_PATH = pick(BOLD_CANDIDATES, "CJK bold")
MONO_PATH = pick(MONO_CANDIDATES, "monospace")

_FONTS: dict[tuple[int, bool, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold, mono)
    if key not in _FONTS:
        path = MONO_PATH if mono else (BOLD_PATH if bold else REG_PATH)
        _FONTS[key] = ImageFont.truetype(path, size)
    return _FONTS[key]


_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def width(text: str, size: int, bold: bool = False, mono: bool = False) -> float:
    return _MEASURE.textlength(text, font=font(size, bold, mono))


def check(text: str, size: int, limit: float, where: str,
          bold: bool = False, mono: bool = False) -> float:
    got = width(text, size, bold, mono)
    if got > limit + 0.5:
        sys.exit(f"FATAL: {where}: {text!r} needs {got:.0f}px, the box allows "
                 f"{limit:.0f}px. Shorten the label or widen the box.")
    return got


def hx(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# --- palettes (all values are hex so Pillow and SVG share them) -----------
PALETTE = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        card="#ffffff", card_border="#dde2f0",
        chip="#f5f7fd", chip_border="#dde2f2",
        text="#1a2033", value="#2b3550", sub="#5b657b", faint="#8b94a9",
        accent="#4B67B4", accent_ink="#3B56A3",
        accent_soft="#eaeefb", accent_border="#c3cdea",
        panel="#f4f6fd", panel_border="#ccd4ea",
        row_alt="#f8f9fe", section="#f7f9ff", section_border="#e3e8f6",
        on_accent="#ffffff", warn="#b7791f",
        shadow=(0x1A, 0x20, 0x33, 40), glow=(0xFF, 0xFF, 0xFF, 120),
        svg_shadow="#1a2033", svg_shadow_opacity="0.10",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        card="#171e2f", card_border="#2b3550",
        chip="#1d2639", chip_border="#303c58",
        text="#e9eef9", value="#d8e0f2", sub="#a0aac0", faint="#6f7a92",
        accent="#8496F5", accent_ink="#B6C2FF",
        accent_soft="#212b45", accent_border="#39466b",
        panel="#1b2336", panel_border="#33405f",
        row_alt="#1a2234", section="#141b2b", section_border="#2a3450",
        on_accent="#0c1016", warn="#e0a94a",
        shadow=(0, 0, 0, 120), glow=(0x2A, 0x3A, 0x63, 90),
        svg_shadow="#000000", svg_shadow_opacity="0.45",
    ),
}

# --- hero text packs -------------------------------------------------------
HERO = {
    "zh": dict(
        kicker="dsh-customs-mcp · 只读 MCP 服务端",
        title="台账自洽核对",
        value1="把台账里自相矛盾的行一次挑出来。",
        value2="命中带行号与条款依据，未执行的检查单列成节。",
        subtitle="四个工具 · 七条规则 · stdio JSON-RPC · 不联网不写盘",
        meta="npx -y dsh-customs-mcp · Node ≥18 · 零依赖 · 0/7 逐字条文 · 封顶 warn",
        footer="github.com/PerryLink/dsh-customs-mcp · Apache-2.0 · 社区工具",
        value_size=28,
        zone_client="MCP 客户端",
        zone_server="服务端 · src/",
        methods=["initialize", "tools/list", "tools/call"],
        material_label="材料（客户端持有）",
        material=["台账 JSON / YAML", ".docx 路径 · ≤20 MB"],
        tools=[
            ("customs_schema", "17 行 + 5 表头字段", False),
            ("customs_rulebook", "7 条 · 0/7 条文", False),
            ("customs_read_docx", "只读 · ≤20 MB", False),
            ("customs_check", "7 条规则 → 报告", True),
        ],
        engine="全部编译进 src/check.mjs",
        result_title="结果：Markdown 报告 = 明细 + 未执行的检查",
        result_line1="每条命中带行号 · 字段 · 实际 · 依据 · 条款 · 编号",
        result_line2="跑不了的规则单列原因 · 严重级封顶 warn · 0/7 逐字条文",
        session="MCP SESSION · stdio",
        protocol="protocol 2024-11-05",
    ),
    "en": dict(
        kicker="dsh-customs-mcp · READ-ONLY MCP SERVER",
        title="Ledger self-check",
        value1="Find a ledger's contradictions with itself.",
        value2="Each hit: row, value, clause; unrun checks listed.",
        subtitle="Read-only · 4 tools · 7 rules · no network, no writes",
        meta="npx -y dsh-customs-mcp · Node ≥18 · zero deps · 0/7 clauses · warn cap",
        footer="github.com/PerryLink/dsh-customs-mcp · Apache-2.0 · community tool",
        value_size=26,
        zone_client="MCP CLIENT",
        zone_server="SERVER · src/",
        methods=["initialize", "tools/list", "tools/call"],
        material_label="material (client-side)",
        material=["ledger JSON / YAML", ".docx · ≤20 MB"],
        tools=[
            ("customs_schema", "17 + 5 fields", False),
            ("customs_rulebook", "7 rules · 0/7 clauses", False),
            ("customs_read_docx", "read-only · 20 MB", False),
            ("customs_check", "7 rules → report", True),
        ],
        engine="all compiled into src/check.mjs",
        result_title="Markdown report: findings + checks not run",
        result_line1="row · field · value · expected · clause · stable id",
        result_line2="unrun rules with reasons · capped at warn · 0/7 clauses",
        session="MCP SESSION · stdio",
        protocol="protocol 2024-11-05",
    ),
}


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    a, b = hx(c1), hx(c2)
    small = Image.new("RGB", (64, 64))
    pixels = []
    for y in range(64):
        for x in range(64):
            t = (x / 63 + y / 63) / 2
            pixels.append(mix(a, b, t))
    small.putdata(pixels)
    return small.resize((w, h), Image.BICUBIC)


def soft_shadow(img: Image.Image, box: tuple[int, int, int, int], radius: int,
                color: tuple[int, int, int, int], blur: int = 24, dy: int = 12) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        (box[0], box[1] + dy, box[2], box[3] + dy), radius=radius, fill=color)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def glow(img: Image.Image, center: tuple[int, int], radius: int,
         color: tuple[int, int, int, int]) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    x, y = center
    ImageDraw.Draw(layer).ellipse(
        (x - radius, y - radius, x + radius, y + radius), fill=color)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius // 3)))


def pt(draw: ImageDraw.ImageDraw, x: float, y: float, text: str, size: int,
       fill: str, bold: bool = False, mono: bool = False, anchor: str = "ls") -> None:
    draw.text((x, y), text, font=font(size, bold, mono), fill=hx(fill), anchor=anchor)


def arrow_r(draw: ImageDraw.ImageDraw, x0: int, x1: int, y: int, color: str,
            width: int = 2, head: int = 7) -> None:
    c = hx(color)
    draw.line([(x0, y), (x1 - head + 1, y)], fill=c, width=width)
    draw.polygon([(x1, y), (x1 - head, y - head * 0.62),
                  (x1 - head, y + head * 0.62)], fill=c)


def dash_v(draw: ImageDraw.ImageDraw, x: int, y0: int, y1: int, color: str,
           width: int = 2, dash: int = 7, gap: int = 7) -> None:
    c = hx(color)
    y = y0
    while y < y1:
        draw.line([(x, y), (x, min(y + dash, y1))], fill=c, width=width)
        y += dash + gap


def hero(skin: str, lang: str) -> str:
    s = PALETTE[skin]
    t = HERO[lang]
    W, H = 1440, 576
    img = gradient(W, H, s["bg1"], s["bg2"]).convert("RGBA")
    glow(img, (1180, 150), 340, s["glow"])
    glow(img, (300, 560), 260,
         (255, 255, 255, 40) if skin == "light" else (0x1C, 0x26, 0x40, 90))

    d = ImageDraw.Draw(img)
    left = 64
    left_limit = 728  # 64 .. 792, the card starts at 800

    # kicker pill
    check(t["kicker"], 18, left_limit - 44, "hero kicker", bold=True)
    k_w = width(t["kicker"], 18, bold=True) + 44
    d.rounded_rectangle((left, 48, left + k_w, 86), radius=19,
                        fill=hx(s["accent_soft"]), outline=hx(s["accent_border"]), width=1)
    pt(d, left + 22, 72, t["kicker"], 18, s["accent_ink"], bold=True)

    # title
    check(t["title"], 80, left_limit, "hero title", bold=True)
    pt(d, left, 184, t["title"], 80, s["text"], bold=True)

    # two value lines
    check(t["value1"], t["value_size"], left_limit, "hero value 1")
    check(t["value2"], t["value_size"], left_limit, "hero value 2")
    pt(d, left, 250, t["value1"], t["value_size"], s["value"])
    pt(d, left, 292, t["value2"], t["value_size"], s["value"])

    # divider
    d.line([(left, 322), (left + 712, 322)], fill=hx(s["card_border"]), width=1)
    d.line([(left, 322), (left + 64, 322)], fill=hx(s["accent"]), width=3)

    # subtitle + meta
    check(t["subtitle"], 25, left_limit, "hero subtitle")
    pt(d, left, 360, t["subtitle"], 25, s["sub"])
    check(t["meta"], 20, left_limit, "hero meta")
    pt(d, left, 398, t["meta"], 20, s["sub"])

    # footer
    d.line([(left, 486), (left + 712, 486)], fill=hx(s["card_border"]), width=1)
    check(t["footer"], 17, left_limit, "hero footer")
    pt(d, left, 524, t["footer"], 17, s["faint"])

    # --- right card: the MCP protocol seam ---------------------------------
    card = (800, 48, 1392, 528)
    soft_shadow(img, card, 22, s["shadow"], blur=26, dy=14)
    d.rounded_rectangle(card, radius=22, fill=hx(s["card"]),
                        outline=hx(s["card_border"]), width=1)
    pt(d, 824, 84, t["session"], 14, s["sub"], mono=True)
    pt(d, 1368, 84, t["protocol"], 14, s["sub"], mono=True, anchor="rs")
    d.line([(824, 100), (1368, 100)], fill=hx(s["card_border"]), width=1)

    # dashed protocol boundary
    dash_v(d, 1012, 112, 390, s["accent"], width=2, dash=7, gap=7)

    # zone labels
    check(t["zone_client"], 19, 176, "hero client zone", bold=True)
    check(t["zone_server"], 19, 340, "hero server zone", bold=True)
    pt(d, 824, 130, t["zone_client"], 19, s["text"], bold=True)
    pt(d, 1028, 130, t["zone_server"], 19, s["text"], bold=True)

    # client-side JSON-RPC methods
    for i, method in enumerate(t["methods"]):
        y = 148 + i * 42
        d.rounded_rectangle((824, y, 1000, y + 32), radius=11,
                            fill=hx(s["chip"]), outline=hx(s["chip_border"]), width=1)
        check(method, 17, 120, "hero method", mono=True)
        pt(d, 838, y + 21, method, 17, s["value"], mono=True)
        arrow_r(d, 966, 990, y + 16, s["accent"], width=2, head=6)

    # material the client holds
    check(t["material_label"], 14, 176, "hero material label")
    pt(d, 824, 292, t["material_label"], 14, s["sub"])
    for i, label in enumerate(t["material"]):
        y = 302 + i * 44
        check(label, 15, 148, f"hero material {i + 1}")
        d.rounded_rectangle((824, y, 1000, y + 34), radius=11,
                            fill=hx(s["chip"]), outline=hx(s["chip_border"]), width=1)
        pt(d, 838, y + 22, label, 15, s["value"])

    # server tools across the boundary
    for i, (name, note, accent) in enumerate(t["tools"]):
        y = 148 + i * 52
        box = (1028, y, 1368, y + 44)
        if accent:
            d.rounded_rectangle(box, radius=12, fill=hx(s["accent_soft"]),
                                outline=hx(s["accent"]), width=2)
        else:
            d.rounded_rectangle(box, radius=12, fill=hx(s["chip"]),
                                outline=hx(s["chip_border"]), width=1)
        name_w = check(name, 18, 190, f"hero tool {i + 1} name", mono=True)
        note_w = check(note, 15, 148, f"hero tool {i + 1} note")
        if name_w + note_w + 8 > 318:
            sys.exit(f"FATAL: hero tool {i + 1}: name + note overlap")
        pt(d, 1042, y + 27, name, 18, s["text"], mono=True)
        pt(d, 1360, y + 27, note, 15,
           s["accent_ink"] if accent else s["sub"], anchor="rs")

    # call chevrons on the seam
    for i in range(4):
        cy = 148 + i * 52 + 22
        d.polygon([(1016, cy - 4), (1024, cy), (1016, cy + 4)], fill=hx(s["accent"]))

    # engine line under the server tools (the client column holds its material)
    check(t["engine"], 15, 320, "hero engine line")
    pt(d, 1028, 372, t["engine"], 15, s["sub"])

    # result band crossing the seam
    d.rounded_rectangle((824, 400, 1368, 500), radius=16,
                        fill=hx(s["accent_soft"]), outline=hx(s["accent"]), width=1)
    check(t["result_title"], 20, 500, "hero result title", bold=True)
    check(t["result_line1"], 16, 500, "hero result line 1")
    check(t["result_line2"], 16, 500, "hero result line 2")
    pt(d, 844, 428, t["result_title"], 20, s["accent_ink"], bold=True)
    pt(d, 844, 454, t["result_line1"], 16, s["value"])
    pt(d, 844, 478, t["result_line2"], 16, s["sub"])

    path = os.path.join(OUT, f"{NAME}-hero-{lang}-{skin}.webp")
    img.convert("RGB").save(path, "WEBP", quality=93, method=6)
    return path


# --- structure SVG (shared by all five READMEs: tokens, not prose) --------
FLOW = dict(
    title="dual intake · one engine · two report sections",
    subtitle="JSON / YAML → rows[]\u00a0\u00a0\u00b7\u00a0\u00a0.docx → customs_read_docx → text → ledger\u00a0\u00a0\u00b7\u00a0\u00a0"
             "check.mjs → ## 明细 + ## 未执行的检查",
    top_right="read-only · stdio",
    left_header="INTAKE",
    tag_a="A · direct",
    title_a="ledger · JSON / YAML",
    a_lines=["rows[] or a bare array", "one object per row"],
    tag_b="B · via .docx",
    title_b="customs_read_docx",
    b_lines=[".docx · read-only · ≤20 MB", "paragraphs · rows as | a | b |", "merged cells ↔"],
    title_b2="text → ledger",
    b2_line="assembled into rows[]",
    engine_header="check.mjs · one engine",
    engine_sub="table · rule pack · renderer",
    node_title="parseMaterial · contract",
    node_lines=["68 aliases → 17 row fields",
                "5 header fields · row override",
                "unknown columns dropped"],
    rules_header="ruleset 2026.1 · 7 rules",
    rules_sub="7/7 warn · 0/7 verbatim clauses",
    rules=[
        ("CD-001", "name or total present"),
        ("CD-002", "HS code, ten digits"),
        ("CD-003", "currency, 3 letters"),
        ("CD-004", "document no. unique"),
        ("CD-005", "gross ≥ net weight"),
        ("CD-006", "date parses, not future"),
        ("CD-007", "placeholders replaced"),
    ],
    rules_note="capped at warn · derived basis",
    report_title="report · Markdown",
    report_sub="tools/call text result",
    section1="## 明细",
    s1_lines=["row · field · value", "locator · row or cell", "expected · clause",
              "suggested check · stable id"],
    section2="## 未执行的检查",
    s2_lines=["material / precondition unmet", "rules excluded by onlyRules", "always present"],
    report_notes=["severity capped at warn", "0/7 hold a verbatim clause"],
    gate="wording gate · 17 forbidden phrases",
    bottom="scope: ledger format · arithmetic · completeness — not truth, classification or duty",
    bottom_right="read-only · no network · no writes",
)

SANS = "Microsoft YaHei,Segoe UI,PingFang SC,Noto Sans CJK SC,sans-serif"
MONO_FAM = "Consolas,SFMono-Regular,Menlo,monospace"


def svg_text(x: float, y: float, text: str, size: int, fill: str,
             bold: bool = False, mono: bool = False, anchor: str = "start",
             extra: str = "") -> str:
    fam = MONO_FAM if mono else SANS
    weight = ' font-weight="700"' if bold else ""
    return (f'<text x="{x:g}" y="{y:g}" fill="{fill}" font-family="{fam}" '
            f'font-size="{size}"{weight} text-anchor="{anchor}"{extra}>'
            f'{escape(text)}</text>')


def flow_checks() -> None:
    t = FLOW
    check(t["title"], 24, 1012, "flow title", bold=True)
    check(t["subtitle"], 14, 1012, "flow subtitle")
    check(t["title_a"], 18, 224, "card A title", bold=True)
    check(t["title_b"], 17, 224, "card B title", mono=True)
    check(t["b2_line"], 14, 224, "card B2 note")
    for i, line in enumerate(t["a_lines"]):
        check(line, 14, 224, f"card A line {i + 1}")
    for i, line in enumerate(t["b_lines"]):
        check(line, 14, 224, f"card B line {i + 1}")
    check(t["engine_header"], 17, 276, "engine header", bold=True)
    check(t["engine_sub"], 14, 276, "engine sub")
    check(t["node_title"], 17, 240, "engine node title", bold=True)
    for i, line in enumerate(t["node_lines"]):
        check(line, 14, 226, f"engine node line {i + 1}")
    check(t["rules_header"], 17, 276, "rules header", bold=True)
    check(t["rules_sub"], 14, 276, "rules sub")
    for rid, label in t["rules"]:
        used = width(rid, 14, mono=True) + 14 + width(label, 14)
        if used > 240:
            sys.exit(f"FATAL: rule row {rid} needs {used:.0f}px, allows 240px")
    check(t["rules_note"], 14, 276, "rules note")
    check(t["report_title"], 18, 224, "report title", bold=True)
    check(t["report_sub"], 14, 224, "report sub")
    check(t["section1"], 17, 208, "section 1 header", mono=True)
    check(t["section2"], 17, 208, "section 2 header", mono=True)
    for i, line in enumerate(t["s1_lines"]):
        check(line, 14, 208, f"section 1 line {i + 1}")
    for i, line in enumerate(t["s2_lines"]):
        check(line, 14, 208, f"section 2 line {i + 1}")
    for i, line in enumerate(t["report_notes"]):
        check(line, 14, 224, f"report note {i + 1}")
    check(t["gate"], 15, 340, "gate label")
    left_w = width(t["bottom"], 14)
    right_w = width(t["bottom_right"], 14, mono=True)
    if 44 + left_w > 1056 - right_w - 24:
        sys.exit(f"FATAL: bottom notes overlap: {left_w:.0f} + {right_w:.0f}")


def flow_svg(skin: str) -> str:
    s = PALETTE[skin]
    t = FLOW
    W, H = 1100, 660
    accent = s["accent"]
    body: list[str] = []
    text: list[str] = []

    body.append(f'<rect width="{W}" height="{H}" rx="22" fill="url(#bg)"/>')
    text.append(svg_text(44, 52, t["title"], 24, s["text"], bold=True))
    text.append(svg_text(44, 80, t["subtitle"], 14, s["sub"]))
    text.append(svg_text(1056, 52, t["top_right"], 14, s["sub"], mono=True, anchor="end"))

    # --- left intake -------------------------------------------------------
    text.append(svg_text(44, 148, t["left_header"], 17, s["text"], bold=True))

    body.append(f'<rect x="44" y="186" width="256" height="120" rx="18" '
                f'fill="{s["card"]}" stroke="{s["card_border"]}" filter="url(#soft)"/>')
    body.append(f'<rect x="60" y="198" width="{width(t["tag_a"], 14) + 22:.0f}" height="22" rx="11" '
                f'fill="{s["accent_soft"]}" stroke="{s["accent_border"]}"/>')
    text.append(svg_text(71, 213, t["tag_a"], 14, s["accent_ink"]))
    text.append(svg_text(60, 250, t["title_a"], 18, s["text"], bold=True))
    for i, line in enumerate(t["a_lines"]):
        text.append(svg_text(60, 276 + i * 22, line, 14, s["sub"]))

    body.append(f'<rect x="44" y="326" width="256" height="144" rx="18" '
                f'fill="{s["card"]}" stroke="{s["card_border"]}" filter="url(#soft)"/>')
    body.append(f'<rect x="60" y="338" width="{width(t["tag_b"], 14) + 22:.0f}" height="22" rx="11" '
                f'fill="{s["accent_soft"]}" stroke="{s["accent_border"]}"/>')
    text.append(svg_text(71, 353, t["tag_b"], 14, s["accent_ink"]))
    text.append(svg_text(60, 390, t["title_b"], 17, s["text"], mono=True))
    for i, line in enumerate(t["b_lines"]):
        text.append(svg_text(60, 416 + i * 22, line, 14, s["sub"]))

    body.append(f'<rect x="44" y="486" width="256" height="72" rx="18" '
                f'fill="{s["accent_soft"]}" stroke="{s["accent_border"]}" filter="url(#soft)"/>')
    text.append(svg_text(60, 516, t["title_b2"], 17, s["accent_ink"], bold=True))
    text.append(svg_text(60, 540, t["b2_line"], 14, s["sub"]))

    # --- engine ------------------------------------------------------------
    body.append(f'<rect x="390" y="126" width="316" height="468" rx="22" '
                f'fill="{s["panel"]}" stroke="{s["panel_border"]}" filter="url(#soft)"/>')
    text.append(svg_text(410, 158, t["engine_header"], 17, s["text"], bold=True))
    text.append(svg_text(410, 180, t["engine_sub"], 14, s["sub"]))

    # a shallow trapezoid: many aliases in, fewer canonical fields out
    body.append(f'<path d="M410 196 H686 L662 304 H434 Z" fill="{s["card"]}" '
                f'stroke="{s["accent_border"]}"/>')
    text.append(svg_text(440, 224, t["node_title"], 17, s["text"], bold=True))
    for i, line in enumerate(t["node_lines"]):
        text.append(svg_text(440, 248 + i * 22, line, 14, s["sub"]))

    text.append(svg_text(410, 328, t["rules_header"], 17, s["text"], bold=True))
    text.append(svg_text(410, 350, t["rules_sub"], 14, s["accent_ink"]))
    for i, (rid, label) in enumerate(t["rules"]):
        y = 366 + i * 28
        fill = s["row_alt"] if i % 2 else s["card"]
        body.append(f'<rect x="410" y="{y}" width="276" height="26" rx="8" '
                    f'fill="{fill}" stroke="{s["chip_border"]}"/>')
        body.append(f'<rect x="410" y="{y}" width="3" height="26" rx="1.5" fill="{accent}"/>')
        text.append(svg_text(422, y + 18, rid, 14, s["faint"], mono=True))
        text.append(svg_text(486, y + 18, label, 14, s["text"]))
        body.append(f'<circle cx="672" cy="{y + 13}" r="3.2" fill="{s["warn"]}"/>')
    text.append(svg_text(410, 584, t["rules_note"], 14, s["faint"]))

    # --- report ------------------------------------------------------------
    body.append(f'<rect x="800" y="150" width="256" height="410" rx="22" '
                f'fill="{s["card"]}" stroke="{s["card_border"]}" filter="url(#soft)"/>')
    text.append(svg_text(816, 184, t["report_title"], 18, s["text"], bold=True))
    text.append(svg_text(816, 204, t["report_sub"], 14, s["sub"]))

    body.append(f'<rect x="816" y="222" width="224" height="144" rx="14" '
                f'fill="{s["section"]}" stroke="{s["section_border"]}"/>')
    text.append(svg_text(828, 248, t["section1"], 17, s["accent_ink"], mono=True))
    for i, line in enumerate(t["s1_lines"]):
        text.append(svg_text(828, 276 + i * 24, line, 14, s["sub"]))

    body.append(f'<rect x="816" y="382" width="224" height="116" rx="14" '
                f'fill="{s["section"]}" stroke="{s["section_border"]}"/>')
    text.append(svg_text(828, 408, t["section2"], 17, s["accent_ink"], mono=True))
    for i, line in enumerate(t["s2_lines"]):
        text.append(svg_text(828, 434 + i * 22, line, 14, s["sub"]))
    for i, line in enumerate(t["report_notes"]):
        text.append(svg_text(816, 524 + i * 22, line, 14, s["faint"]))

    # gate strip
    body.append(f'<rect x="738" y="200" width="36" height="360" rx="18" fill="{accent}"/>')
    text.append(f'<text x="0" y="0" fill="{s["on_accent"]}" font-family="{SANS}" '
                f'font-size="15" font-weight="700" text-anchor="middle" '
                f'transform="translate(756 380) rotate(-90)">{escape(t["gate"])}</text>')

    # --- connectors --------------------------------------------------------
    body.append(f'<path d="M300 246 H345" stroke="{accent}" stroke-width="2" fill="none"/>')
    body.append(f'<path d="M300 522 H337 Q345 522 345 514 V254 Q345 246 353 246" '
                f'stroke="{accent}" stroke-width="2" fill="none"/>')
    body.append(f'<path d="M345 246 H384" stroke="{accent}" stroke-width="2" fill="none" '
                f'marker-end="url(#ah)"/>')
    body.append(f'<circle cx="345" cy="246" r="4" fill="{accent}"/>')
    body.append(f'<path d="M172 470 V480" stroke="{accent}" stroke-width="2" fill="none" '
                f'marker-end="url(#ah)"/>')
    body.append(f'<path d="M706 380 H730" stroke="{accent}" stroke-width="2" fill="none" '
                f'marker-end="url(#ah)"/>')
    body.append(f'<path d="M774 380 H794" stroke="{accent}" stroke-width="2" fill="none" '
                f'marker-end="url(#ah)"/>')

    # --- bottom notes ------------------------------------------------------
    body.append(f'<line x1="44" y1="604" x2="1056" y2="604" '
                f'stroke="{s["card_border"]}" stroke-width="1"/>')
    text.append(svg_text(44, 630, t["bottom"], 14, s["faint"]))
    text.append(svg_text(1056, 630, t["bottom_right"], 14, s["faint"], mono=True, anchor="end"))

    defs = (
        f'<defs>'
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{s["bg1"]}"/>'
        f'<stop offset="1" stop-color="{s["bg2"]}"/>'
        f'</linearGradient>'
        f'<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto">'
        f'<path d="M0 0 L10 5 L0 10 z" fill="{accent}"/></marker>'
        f'<filter id="soft" x="-20%" y="-20%" width="140%" height="160%">'
        f'<feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="{s["svg_shadow"]}" '
        f'flood-opacity="{s["svg_shadow_opacity"]}"/></filter>'
        f'</defs>'
    )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}" role="img" aria-label="{NAME} structure">\n'
            f'<title>{NAME} structure: dual intake, one engine, two report sections</title>\n'
            + defs + "\n" + "\n".join(body) + "\n" + "\n".join(text) + "\n</svg>\n")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            hero(skin, lang)
    flow_checks()
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"{NAME}-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        ET.parse(path)  # a malformed diagram is not an asset
    print(f"wrote 4 hero webp + 2 structure svg to {os.path.relpath(OUT, ROOT)}/")
    print(f"fonts: {os.path.basename(REG_PATH)}, {os.path.basename(BOLD_PATH)}, "
          f"{os.path.basename(MONO_PATH)}")


if __name__ == "__main__":
    main()
