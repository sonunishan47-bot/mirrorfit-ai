"""Finish a real try-on still. Does not draw a person or a garment.

The photographic try-on comes from FASHN. This module only:
- copies the customer's face pixels from the captured still back onto that result
- replaces the shop wall with a plain studio gradient when a background mask is reliable

If the mask or the face region is not reliable, the caller must not invent a picture.
"""

from __future__ import annotations

FIT_CATEGORY = {
    "TOP": "tops",
    "LOWER_BODY": "bottoms",
    "FULL_BODY": "one-pieces",
}


def fashn_category(fit_category: str | None) -> str | None:
    if not fit_category:
        return None
    return FIT_CATEGORY.get(fit_category)


def face_box(width: int, height: int) -> tuple[int, int, int, int] | None:
    """Upper-center oval of a mirror framing. Pixels stay the customer's."""
    if width < 64 or height < 64:
        return None
    side = min(width, height)
    fw = max(24, int(side * 0.28))
    fh = max(24, int(side * 0.34))
    if fw >= width or fh >= height:
        return None
    fx = (width - fw) // 2
    fy = max(0, int(height * 0.06))
    if fy + fh > height:
        return None
    return (fx, fy, fw, fh)


def _close(color: tuple[int, int, int], sample: tuple[int, int, int], tolerance: int) -> bool:
    return (
        abs(color[0] - sample[0]) <= tolerance
        and abs(color[1] - sample[1]) <= tolerance
        and abs(color[2] - sample[2]) <= tolerance
    )


def corner_background_mask(
    pixels: list[tuple[int, int, int]],
    width: int,
    height: int,
    tolerance: int = 28,
) -> list[bool] | None:
    """True where a corner color is connected to the frame edge. None if unreliable."""
    if width < 8 or height < 8 or len(pixels) != width * height:
        return None
    corners = (
        pixels[0],
        pixels[width - 1],
        pixels[(height - 1) * width],
        pixels[height * width - 1],
    )
    sample = tuple(sum(channel) // 4 for channel in zip(*corners, strict=True))
    mask = [False] * (width * height)
    stack = [0, width - 1, (height - 1) * width, height * width - 1]
    seen = bytearray(width * height)
    while stack:
        index = stack.pop()
        if seen[index]:
            continue
        seen[index] = 1
        if not _close(pixels[index], sample, tolerance):
            continue
        mask[index] = True
        x = index % width
        y = index // width
        if x > 0:
            stack.append(index - 1)
        if x + 1 < width:
            stack.append(index + 1)
        if y > 0:
            stack.append(index - width)
        if y + 1 < height:
            stack.append(index + width)
    background = sum(mask)
    total = width * height
    if background < int(total * 0.08) or background > int(total * 0.85):
        return None
    return mask
