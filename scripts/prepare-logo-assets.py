"""Crop and optimize Supplier Portal brand assets from the approved lockup."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\Bad-Boy\.cursor\projects\c-dev-Supplier-Portal\assets"
    r"\Modern_Supplier_Portal_Logo-ea0087a5-eb2c-4627-a142-2dc4ded03242.png"
)
OUT = Path(__file__).resolve().parents[1] / "public" / "brand"
APP = Path(__file__).resolve().parents[1] / "src" / "app"


def is_bg(r: int, g: int, b: int, a: int) -> bool:
    if a < 10:
        return True
    return r < 18 and g < 18 and b < 18


def content_density(im: Image.Image) -> list[int]:
    px = im.load()
    w, h = im.size
    densities: list[int] = []
    for x in range(w):
        count = 0
        for y in range(h):
            r, g, b, a = px[x, y]
            if not is_bg(r, g, b, a):
                count += 1
        densities.append(count)
    return densities


def content_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    px = im.load()
    w, h = im.size
    xs: list[int] = []
    ys: list[int] = []
    for x in range(w):
        for y in range(h):
            r, g, b, a = px[x, y]
            if not is_bg(r, g, b, a):
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    dens = content_density(im)
    threshold = max(3, int(h * 0.015))

    # Segments of contiguous non-empty columns.
    segments: list[tuple[int, int]] = []
    start: int | None = None
    for x, d in enumerate(dens):
        if d > threshold:
            if start is None:
                start = x
        elif start is not None:
            segments.append((start, x - 1))
            start = None
    if start is not None:
        segments.append((start, w - 1))

    print("size", w, h)
    print("segments", segments)

    # Icon = first dense segment; divider may be thin; text follows.
    icon_left, icon_right = segments[0]
    # Include a little padding but stop before divider/text.
    pad = 8
    mark_box = (
        max(0, icon_left - pad),
        0,
        min(w, icon_right + pad + 1),
        h,
    )
    print("mark_box", mark_box)

    # Full lockup: trim near-black margins tightly.
    left, top, right, bottom = content_bbox(im)
    full_box = (
        max(0, left - 12),
        max(0, top - 12),
        min(w, right + 13),
        min(h, bottom + 13),
    )
    print("full_box", full_box)

    full = im.crop(full_box)
    mark = im.crop(mark_box)

    # Square mark with equal padding for favicon / compact nav.
    mw, mh = mark.size
    side = max(mw, mh)
    square = Image.new("RGBA", (side, side), (5, 5, 5, 255))
    square.paste(mark, ((side - mw) // 2, (side - mh) // 2), mark)

    # Transparent-friendly exports for UI (keep #050505 baked for sharpness on dark).
    full_path = OUT / "supplier-portal-logo.png"
    mark_path = OUT / "supplier-portal-mark.png"
    full.save(full_path, "PNG", optimize=True)
    square.save(mark_path, "PNG", optimize=True)

    # Also write optimized JPEG-less PNG sizes for common display widths.
    for width, name in ((640, "supplier-portal-logo-640.png"), (320, "supplier-portal-logo-320.png")):
        ratio = width / full.size[0]
        resized = full.resize((width, max(1, int(full.size[1] * ratio))), Image.Resampling.LANCZOS)
        resized.save(OUT / name, "PNG", optimize=True)

    for size, name in ((128, "supplier-portal-mark-128.png"), (64, "supplier-portal-mark-64.png"), (32, "supplier-portal-mark-32.png")):
        square.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, "PNG", optimize=True)

    # Favicon.ico multi-size from mark.
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    ico_images = [square.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
    ico_path = APP / "favicon.ico"
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=ico_sizes,
        append_images=ico_images[1:],
    )

    # Apple touch / app icon PNG.
    apple = square.resize((180, 180), Image.Resampling.LANCZOS)
    apple.save(APP / "apple-icon.png", "PNG", optimize=True)
    icon32 = square.resize((32, 32), Image.Resampling.LANCZOS)
    icon32.save(APP / "icon.png", "PNG", optimize=True)

    print("wrote", full_path, full.size, full_path.stat().st_size)
    print("wrote", mark_path, square.size, mark_path.stat().st_size)
    print("wrote", ico_path)


if __name__ == "__main__":
    main()
