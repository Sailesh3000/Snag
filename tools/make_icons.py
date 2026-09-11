"""Generate Snag brand assets as PNG (pure Pillow, no font/asset dependencies).

Outputs:
  extension/icons/{16,32,48,128}.png   - extension icons (CWS requires PNG)
  store/icon-128.png                   - Chrome Web Store listing icon
  store/promo-tile.png                 - 440x280 promo tile
  store/screenshots/*.png              - 1280x800 screenshot placeholders
                                         (replace with real captures before submission)

Run:  python tools/make_icons.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INDIGO = (99, 102, 241)
VIOLET = (139, 92, 246)
DARK = (10, 10, 15)
PANEL = (17, 17, 24)
CARD = (26, 26, 36)
BORDER = (45, 45, 60)
TEXT_DIM = (148, 163, 184)
TEXT_BRIGHT = (241, 245, 249)
GREEN = (16, 185, 129)

# Lucide "zap" bolt, 24x24 grid, filled.
BOLT = [(13, 10), (13, 3), (4, 14), (11, 14), (11, 21), (20, 10)]


def font(size: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def diagonal_gradient(w: int, h: int) -> Image.Image:
    """135deg gradient INDIGO -> VIOLET, blended from H and V strips."""
    strip_h = Image.new("RGB", (w, 1))
    for x in range(w):
        t = x / max(w - 1, 1)
        strip_h.putpixel((x, 0), tuple(int(a + (b - a) * t) for a, b in zip(INDIGO, VIOLET)))
    strip_v = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        strip_v.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(INDIGO, VIOLET)))
    hor = strip_h.resize((w, h))
    ver = strip_v.resize((w, h))
    return Image.blend(hor, ver, 0.5)


def bolt_layer(w: int, h: int, color=(255, 255, 255)) -> Image.Image:
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    scale = (min(w, h) * 0.52) / 24
    cx, cy = w / 2, h / 2
    pts = [(cx + (px - 12) * scale, cy + (py - 12) * scale) for px, py in BOLT]
    ImageDraw.Draw(layer).polygon(pts, fill=color + (255,))
    return layer


def brand_tile(size: int) -> Image.Image:
    img = diagonal_gradient(size, size).convert("RGBA")
    radius = int(size * 0.23)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    img = Image.alpha_composite(img, bolt_layer(size, size))
    return img


def save(img: Image.Image, rel: str) -> None:
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"wrote {rel}")


# ---------------------------------------------------------------------------
# Extension + store icons
# ---------------------------------------------------------------------------
for size in (16, 32, 48, 128):
    save(brand_tile(size), f"extension/icons/{size}.png")
save(brand_tile(128), "store/icon-128.png")

# ---------------------------------------------------------------------------
# Promo tile 440x280
# ---------------------------------------------------------------------------
tile = diagonal_gradient(440, 280).convert("RGBA")
tl = Image.new("RGBA", (440, 280), (0, 0, 0, 0))
bolt = bolt_layer(160, 160)
tl.paste(bolt, (36, 60), bolt)
tile = Image.alpha_composite(tile, tl)
d = ImageDraw.Draw(tile)
d.text((188, 92), "Snag", font=font(56), fill=(255, 255, 255, 255))
d.text((190, 168), "AI job application copilot", font=font(18), fill=(230, 232, 255, 220))
save(tile, "store/promo-tile.png")

# ---------------------------------------------------------------------------
# Screenshot placeholders 1280x800 - stylized mockups of the real UI
# ---------------------------------------------------------------------------
W, H = 1280, 800
SIDEBAR_W = 400
SIDEBAR_X = W - SIDEBAR_W - 40
SIDEBAR_Y = 40


def base_screenshot():
    img = Image.new("RGB", (W, H), DARK).convert("RGBA")
    d = ImageDraw.Draw(img)
    # faint "application form" behind: label + input rows on the left
    for i in range(6):
        y = 120 + i * 100
        d.rounded_rectangle([80, y, 460, y + 18], radius=9, fill=(30, 30, 44))
        d.rounded_rectangle([80, y + 34, 900, y + 74], radius=10, fill=(20, 20, 30), outline=BORDER)
    # sidebar panel
    d.rounded_rectangle(
        [SIDEBAR_X, SIDEBAR_Y, W - 40, H - 40],
        radius=16, fill=PANEL, outline=BORDER, width=2,
    )
    # sidebar header
    hx = SIDEBAR_X + 20
    d.rounded_rectangle([hx, SIDEBAR_Y + 18, hx + 34, SIDEBAR_Y + 52], radius=9, fill=INDIGO)
    d.text((hx + 46, SIDEBAR_Y + 24), "Snag", font=font(22), fill=TEXT_BRIGHT)
    d.rounded_rectangle([W - 150, SIDEBAR_Y + 24, W - 60, SIDEBAR_Y + 48], radius=12, fill=(22, 101, 52))
    d.text((W - 138, SIDEBAR_Y + 28), "Pro", font=font(14), fill=(134, 239, 172))
    return img, d


def sidebar_block(d, x, y, w, h, fill=CARD, outline=BORDER):
    d.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=fill, outline=outline)


def shot_fields():
    img, d = base_screenshot()
    x, w = SIDEBAR_X + 20, SIDEBAR_W - 40
    d.text((x, 96), "5 questions detected", font=font(15), fill=TEXT_DIM)
    for i in range(5):
        y = 136 + i * 118
        sidebar_block(d, x, y, w, 100)
        d.rounded_rectangle([x + 14, y + 14, x + 66, y + 30], radius=6, fill=(50, 50, 70))
        d.text((x + 14, y + 40), ["Tell me about yourself", "Why do you want this job?", "Biggest accomplishment",
                                   "Strengths and weaknesses", "Where do you see yourself?"][i],
               font=font(14), fill=TEXT_BRIGHT)
        d.rounded_rectangle([x + 14, y + 70, x + 94, y + 86], radius=8, fill=INDIGO)
        d.text((x + 26, y + 72), "Generate", font=font(12), fill=(255, 255, 255))
    d.text((x, H - 78), "Profile answers stay on this device", font=font(13), fill=TEXT_DIM)
    save(img.convert("RGB"), "store/screenshots/1-field-detection.png")


def shot_answer():
    img, d = base_screenshot()
    x, w = SIDEBAR_X + 20, SIDEBAR_W - 40
    y = 110
    sidebar_block(d, x, y, w, 400)
    d.text((x + 14, y + 14), "Tell me about yourself", font=font(15), fill=TEXT_BRIGHT)
    lines = [
        "I am a software engineer with six years of",
        "experience building payments infrastructure.",
        "At my current company I lead the team that",
        "shipped a new ledger engine used by 40M",
        "transactions a month. I enjoy owning problems",
        "end to end, from data model to deploy.",
    ]
    for i, line in enumerate(lines):
        d.text((x + 14, y + 52 + i * 26), line, font=font(14), fill=(203, 213, 225))
    d.rounded_rectangle([x, y + 424, x + 140, y + 464], radius=10, fill=INDIGO)
    d.text((x + 34, y + 434), "Approve & fill", font=font(14), fill=(255, 255, 255))
    d.rounded_rectangle([x + 152, y + 424, x + 232, y + 464], radius=10, fill=(40, 40, 55), outline=BORDER)
    d.text((x + 176, y + 434), "Skip", font=font(14), fill=TEXT_DIM)
    d.text((x, y + 486), "Matched 2 past answers as style guide", font=font(13), fill=GREEN)
    save(img.convert("RGB"), "store/screenshots/2-answer-generation.png")


def shot_subscription():
    img, d = base_screenshot()
    x, w = SIDEBAR_X + 20, SIDEBAR_W - 40
    y = 180
    sidebar_block(d, x, y, w, 330)
    d.text((x + 24, y + 30), "Subscribe to Snag", font=font(20), fill=TEXT_BRIGHT)
    for i, line in enumerate(["Your profile and past answers stay",
                              "on this device. Snag generates the",
                              "answers from your subscription."]):
        d.text((x + 24, y + 74 + i * 26), line, font=font(14), fill=TEXT_DIM)
    d.text((x + 24, y + 176), "$5 / month", font=font(30), fill=TEXT_BRIGHT)
    d.rounded_rectangle([x + 24, y + 232, x + 260, y + 278], radius=12, fill=INDIGO)
    d.text((x + 44, y + 244), "Subscribe with Paddle", font=font(15), fill=(255, 255, 255))
    save(img.convert("RGB"), "store/screenshots/3-subscription.png")


def shot_profile():
    img, d = base_screenshot()
    x, w = SIDEBAR_X + 20, SIDEBAR_W - 40
    d.text((x, 96), "Profile", font=font(15), fill=TEXT_DIM)
    for i, (label, val) in enumerate([("Email", "you@example.com"),
                                      ("Phone", "555-0100"),
                                      ("LinkedIn", "linkedin.com/in/you")]):
        y = 130 + i * 86
        sidebar_block(d, x, y, w, 70)
        d.text((x + 14, y + 10), label, font=font(12), fill=TEXT_DIM)
        d.text((x + 14, y + 34), val, font=font(14), fill=TEXT_BRIGHT)
    d.text((x, 410), "Memory - past approved answers", font=font(15), fill=TEXT_DIM)
    for i in range(2):
        y = 446 + i * 104
        sidebar_block(d, x, y, w, 88)
        d.text((x + 14, y + 12), ["Tell me about yourself", "Why this company?"][i], font=font(14), fill=TEXT_BRIGHT)
        d.text((x + 14, y + 38), "Acme - Engineer", font=font(12), fill=GREEN)
        d.text((x + 14, y + 60), "I am a software engineer with six", font=font(12), fill=TEXT_DIM)
    save(img.convert("RGB"), "store/screenshots/4-profile-and-memory.png")


shot_fields()
shot_answer()
shot_subscription()
shot_profile()
print("done")
