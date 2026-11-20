"""生成扩展图标：渐变圆角方块 + 白色放大镜。

用法（仓库自带的 Python 即可）：
    python scripts/make-icons.py
产物写入 src/icons/icon{16,32,48,128}.png。
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "icons"


def make_icon(size: int) -> Image.Image:
    scale = 8
    side = size * scale

    gradient = Image.new("RGBA", (side, side))
    pixels = gradient.load()
    for y in range(side):
        t = y / (side - 1)
        r = round(59 + (99 - 59) * t)
        g = round(130 + (102 - 130) * t)
        b = round(246 + (241 - 246) * t)
        for x in range(side):
            pixels[x, y] = (r, g, b, 255)

    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, side - 1, side - 1], radius=round(side * 0.23), fill=255
    )
    gradient.putalpha(mask)

    draw = ImageDraw.Draw(gradient)
    ring = max(2, round(side * 0.07))
    cx, cy = side * 0.44, side * 0.42
    radius = side * 0.235
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=(255, 255, 255, 255),
        width=ring,
    )

    start_x = cx + radius * 0.72
    start_y = cy + radius * 0.72
    draw.line(
        [start_x, start_y, side * 0.8, side * 0.8],
        fill=(255, 255, 255, 255),
        width=ring,
    )

    dot = max(1.5, side * 0.045)
    draw.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=(255, 255, 255, 255))

    return gradient.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        make_icon(size).save(path, optimize=True)
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
