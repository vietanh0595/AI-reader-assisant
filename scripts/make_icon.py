"""Generate BookSense AI's app icon.

Drawn rather than illustrated, because an icon is read at about 60 points on a home
screen: one idea, high contrast, no detail that survives the shrink. An open book
with a spark at its corner — the book says what the app is, the spark says what it
does.

Colours are the app's own (App.tsx `colors`), so the icon and the product look like
the same thing.
"""

import math

from PIL import Image, ImageDraw

SAGE = (36, 79, 56)       # colors.sageDark
CREAM = (255, 253, 248)   # colors.paper
GOLD = (236, 199, 123)    # a lighter clay, so the spark reads against both

# Drawn oversized and downsampled: Pillow does not antialiase, and clean edges at
# icon scale are most of what makes a mark look deliberate rather than drawn.
SCALE = 4


def sparkle(draw, cx, cy, outer, colour):
    """A four-pointed spark.

    The waist sits at 42% of the point length. Much narrower and the points turn
    into needles that read as a star or a crucifix; much wider and it stops looking
    like a spark at all.
    """
    inner = outer * 0.42
    points = []
    for index in range(8):
        radius = outer if index % 2 == 0 else inner
        radians = math.radians(index * 45 - 90)
        points.append((cx + radius * math.cos(radians), cy + radius * math.sin(radians)))
    draw.polygon(points, fill=colour)


def draw_icon(size, background, book_colour, spark_colour, inset=0.0):
    canvas = size * SCALE
    image = Image.new("RGBA", (canvas, canvas), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # `inset` leaves room for Android's adaptive-icon mask, which crops hard.
    unit = canvas * (1 - inset)
    origin = (canvas - unit) / 2

    def at(fraction):
        return origin + unit * fraction

    # An open book, seen face on. What makes it read as a book rather than two
    # panels: the spine dips lower than the outer corners, so the top edge is a
    # shallow V, and each page is wider than it is tall. Tall rectangles either
    # side of a gap look like doors.
    spine_top, spine_bottom = at(0.44), at(0.74)
    outer_top, outer_bottom = at(0.34), at(0.66)
    left, right = at(0.13), at(0.87)
    centre = at(0.5)
    gap = unit * 0.025

    for side in (-1, 1):
        edge = left if side < 0 else right
        near = centre + side * gap
        draw.polygon(
            [
                (near, spine_top),      # the spine, lower than the outer corner
                (edge, outer_top),      # outer top corner lifts
                (edge, outer_bottom),
                (near, spine_bottom),   # and the foot dips back down
            ],
            fill=book_colour,
        )

    # Tucked above the right page's top corner. Three constraints fix this
    # position: centred, it impales the spine and the mark becomes a nativity star;
    # further right, iOS's rounded corner mask clips it; further away, it stops
    # belonging to the book and becomes a second object sharing a square.
    sparkle(draw, at(0.76), at(0.27), unit * 0.10, spark_colour)

    return image.resize((size, size), Image.LANCZOS)


def main():
    # iOS wants no transparency and full bleed; the system applies its own corners.
    draw_icon(1024, SAGE + (255,), CREAM, GOLD).convert("RGB").save("assets/icon.png")

    # Android masks adaptive icons to a circle or squircle, cropping roughly a
    # quarter, so the mark is drawn smaller inside its own square.
    draw_icon(1024, SAGE + (255,), CREAM, GOLD, inset=0.24).convert("RGB").save(
        "assets/adaptive-icon.png"
    )

    # The splash sits on white (app.json), so the mark flips to sage on transparent.
    draw_icon(1024, None, SAGE + (255,), (143, 108, 61, 255), inset=0.20).save(
        "assets/splash-icon.png"
    )

    draw_icon(64, SAGE + (255,), CREAM, GOLD).convert("RGB").save("assets/favicon.png")

    print("wrote icon.png, adaptive-icon.png, splash-icon.png, favicon.png")


if __name__ == "__main__":
    main()
