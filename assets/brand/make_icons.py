"""Regenerate the derived brand assets from logo.png (the master).

Usage:  python assets/brand/make_icons.py
Writes next to this file:
  logo-mark.png   transparent background, the four letter blocks only (UI use)
  icon-1024.png   app icon: rounded square on #21222C, mark at ~62% (electron-builder source)
  icon.ico        16-256 px Windows icon
  favicon.png     64 px, for the mockups
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
BG = (33, 34, 44)
GREEN = (80, 250, 123)

master = Image.open(HERE / "logo.png").convert("RGBA")

# Transparent mark: alpha comes from how green each pixel is (bg G=34, green G=250).
r, g, b, _ = master.split()
alpha = g.point(lambda v: max(0, min(255, round((v - BG[1]) / (GREEN[1] - BG[1]) * 255))))
mark = Image.new("RGBA", master.size, GREEN + (0,))
mark.putalpha(alpha)
mark = mark.crop(alpha.getbbox())
side = max(mark.size)
square = Image.new("RGBA", (side, side), GREEN + (0,))
square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
mark = square.resize((512, 512), Image.LANCZOS)
mark.save(HERE / "logo-mark.png", optimize=True)

# App icon: rounded square, mark centred with a safe margin.
S = 1024
tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (S * 2, S * 2), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S * 2 - 1, S * 2 - 1), radius=int(S * 2 * 0.225), fill=255)
mask = mask.resize((S, S), Image.LANCZOS)
tile.paste(Image.new("RGBA", (S, S), BG + (255,)), (0, 0), mask)
inner = int(S * 0.62)
m = mark.resize((inner, inner), Image.LANCZOS)
tile.alpha_composite(m, ((S - inner) // 2, (S - inner) // 2))
tile.save(HERE / "icon-1024.png", optimize=True)
tile.save(HERE / "icon.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
tile.resize((64, 64), Image.LANCZOS).save(HERE / "favicon.png", optimize=True)
print("ok")
