#!/usr/bin/env python3
"""Generate README image assets for dsh-customs-mcp (docs/assets/).

Outputs (idempotent overwrite):
  dsh-customs-mcp-flow-light.svg / dsh-customs-mcp-flow-dark.svg
      Hero pipeline diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is the command surface only: MCP tool
      names, file extensions, rule ids, and the two report section headings.
      No prose, so all five README languages share the same pair.

No evidence chart: this repo ships no benchmark or measured dataset
(benchmark/RESULTS.md does not exist), and inventing one is out of bounds.

The diagram is laid out on a fixed grid. Every label is measured with the
probed fonts before the SVG is written, so a label that would overflow its
box aborts the run instead of shipping clipped text.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow) + a CJK font for the report-section
           tokens; the script refuses to run without one.
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

NAME = "dsh-customs-mcp"

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: the report headings must never render as tofu --------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")

# --- monospace probe: command tokens are measured in the font that draws
# --- them, so a too-long label is caught here instead of in the browser ---
MONO_CANDIDATES = [
    r"C:\Windows\Fonts\consola.ttf",   # Consolas
    r"C:\Windows\Fonts\cour.ttf",      # Courier New
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]
MONO_PATH = next((p for p in MONO_CANDIDATES if os.path.exists(p)), FONT_PATH)

_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def font(size: int, mono: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MONO_PATH if mono else FONT_PATH, size)


def has_cjk(text: str) -> bool:
    return any("\u2e80" <= ch <= "\u9fff" or "\u3000" <= ch <= "\u303f"
               or "\uff00" <= ch <= "\uffef" for ch in text)


def width(text: str, size: int) -> float:
    """Advance width of `text`, measured in the font that will draw it."""
    return _MEASURE.textlength(text, font=font(size, mono=not has_cjk(text)))


def fits(text: str, size: int, box_w: int, pad: int = 12, where: str = "") -> None:
    w = width(text, size)
    if w > box_w - 2 * pad:
        sys.exit(f"FATAL: {where} label {text!r} needs {w:.0f}px, the box "
                 f"allows {box_w - 2 * pad}px. Shorten the label or widen "
                 f"the node — a clipped diagram must not ship.")


# ---------------------------------------------------------------------------
# Hero pipeline SVG (light + dark)
# ---------------------------------------------------------------------------
# label / sub-label, in pipeline order. Command-surface tokens only.
FLOW_NODES = [
    (".docx", "read-only · max 20 MB"),
    ("customs_read_docx", "paragraphs · | cells |"),
    ("ledger", "JSON/YAML · rows[]"),
    ("customs_check", "CD-001...CD-007"),
    ("report", "明细 + 未执行的检查"),
]
# Node that carries the family accent (the check step) and the one that
# carries the green "result" accent (the report).
ACCENT_INDEX = 3

W, H = 1280, 420
X0, NW, NH, GAP, Y0 = 60, 204, 96, 35, 150
BAR_X, BAR_W, BAR_Y, BAR_H = 299, 921, 285, 52
BAR_TEXT = ("customs_schema: columns + aliases · "
            "customs_rulebook: CD-001...CD-007 · verbatimClause 0/7")
SUBTITLE = "stdio JSON-RPC · read-only · no network · no writes"
FOOTER = ("report = 明细 + 未执行的检查 + disclaimer · "
          "severity capped at warn · 0 of 7 rules quote a clause")


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    nw, nh, gap, y0 = NW, NH, GAP, Y0
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-label="{NAME} data flow">',
        f'<title>{NAME} data flow</title>',
        f'<rect width="{W}" height="{H}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="{X0}" y="62" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">{NAME}</text>',
        f'<text x="{X0}" y="94" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">{SUBTITLE}</text>',
        f'<line x1="{X0}" y1="116" x2="{W - X0}" y2="116" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = X0 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i == ACCENT_INDEX else s["border"])
        fits(label, 15, nw, where=f"node {i + 1} title")
        fits(sub, 12, nw, where=f"node {i + 1} sub")
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="15" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 68}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="12">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 6
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 12}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 14} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # contract bar under the ledger + check nodes
    fits(BAR_TEXT, 14, BAR_W, where="contract bar")
    for cx in (X0 + (nw + gap) + nw // 2, X0 + ACCENT_INDEX * (nw + gap) + nw // 2):
        parts.append(
            f'<path d="M{cx} {y0 + nh}v{BAR_Y - y0 - nh}" '
            f'stroke="{FAMILY}" stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{BAR_X}" y="{BAR_Y}" width="{BAR_W}" height="{BAR_H}" rx="12" '
        f'fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="{BAR_X + BAR_W // 2}" y="{BAR_Y + 33}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="14">{BAR_TEXT}</text>')
    fits(FOOTER, 13, W - 2 * X0, where="footer")
    parts.append(
        f'<text x="{X0}" y="{H - 28}" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="13">{FOOTER}</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"{NAME}-flow-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        ET.parse(path)  # a malformed diagram is not an asset
    print(f"wrote 2 SVG assets to {os.path.relpath(OUT, ROOT)}/ "
          f"(fonts: {os.path.basename(FONT_PATH)}, {os.path.basename(MONO_PATH)})")


if __name__ == "__main__":
    main()
