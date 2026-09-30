"""Private still try-on server. The mirror never calls this directly.

Listens on 127.0.0.1 only. Point WORKER_ENDPOINT_URL at http://127.0.0.1:8090/infer

Weights are not in the git repo. Install FASHN VTON v1.5 on the GPU machine and set
FASHN_WEIGHTS_DIR. Until model.safetensors is there, /infer returns 503 and no image.

  pip install pillow 'fashn-vton @ git+https://github.com/fashn-AI/fashn-vton-1.5.git'
  python scripts/download_weights.py --weights-dir ./weights
  FASHN_WEIGHTS_DIR=./weights python server.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from finish import corner_background_mask, face_box, fashn_category

HOST = "127.0.0.1"
PORT = int(os.environ.get("STILL_VTON_PORT", "8090"))
MAX_BYTES = 2_000_000


def weights_ready(path: str | None) -> bool:
    if not path:
        return False
    return os.path.isfile(os.path.join(path, "model.safetensors"))


def _download(url: str) -> bytes:
    if not url.startswith("https://") and not url.startswith("http://"):
        raise ValueError("bad url")
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or len(data) < 32:
        raise ValueError("bad image size")
    return data


def _studio_and_face(person_jpeg: bytes, result_png: bytes) -> bytes:
    from PIL import Image, ImageDraw, ImageFilter

    person = Image.open(BytesIO(person_jpeg)).convert("RGB")
    result = Image.open(BytesIO(result_png)).convert("RGB")
    result = result.resize(person.size, Image.Resampling.LANCZOS)
    width, height = person.size
    small = result.resize((max(8, width // 8), max(8, height // 8)), Image.Resampling.BOX)
    sw, sh = small.size
    mask = corner_background_mask(list(small.getdata()), sw, sh)
    if mask is not None:
        plate = Image.new("RGB", (sw, sh))
        draw_plate = plate.load()
        for y in range(sh):
            tone = 22 + int(28 * y / max(1, sh - 1))
            for x in range(sw):
                draw_plate[x, y] = (tone, tone - 2, tone - 4)
        composed = Image.new("RGB", (sw, sh))
        src = small.load()
        out = composed.load()
        for index, background in enumerate(mask):
            x = index % sw
            y = index // sw
            out[x, y] = draw_plate[x, y] if background else src[x, y]
        result = composed.resize((width, height), Image.Resampling.BILINEAR)
        # Keep the garment pixels from the full-resolution result where the
        # person is, by pasting the model output through an inverted mask.
        full_mask = Image.new("L", (sw, sh))
        raw = full_mask.load()
        for index, background in enumerate(mask):
            raw[index % sw, index // sw] = 0 if background else 255
        full_mask = full_mask.resize((width, height), Image.Resampling.BILINEAR)
        sharp = Image.open(BytesIO(result_png)).convert("RGB").resize(person.size, Image.Resampling.LANCZOS)
        backdrop = composed.resize((width, height), Image.Resampling.BILINEAR)
        result = Image.composite(sharp, backdrop, full_mask)

    box = face_box(width, height)
    if box is None:
        raise RuntimeError("FACE_NOT_LOCKED")
    fx, fy, fw, fh = box
    face = person.crop((fx, fy, fx + fw, fy + fh))
    oval = Image.new("L", (fw, fh), 0)
    ImageDraw.Draw(oval).ellipse((2, 2, fw - 3, fh - 3), fill=255)
    oval = oval.filter(ImageFilter.GaussianBlur(radius=max(2, fw // 24)))
    result.paste(face, (fx, fy), oval)
    sink = BytesIO()
    result.save(sink, format="JPEG", quality=85)
    encoded = sink.getvalue()
    if len(encoded) < 1024 or len(encoded) > MAX_BYTES:
        raise RuntimeError("INVALID_OUTPUT")
    return encoded


_pipeline = None


def _run_fashn(person_jpeg: bytes, garment_jpeg: bytes, category: str) -> bytes:
    global _pipeline
    from PIL import Image
    from fashn_vton import TryOnPipeline

    weights = os.environ.get("FASHN_WEIGHTS_DIR", "").strip()
    if _pipeline is None:
        _pipeline = TryOnPipeline(weights_dir=weights)
    person = Image.open(BytesIO(person_jpeg)).convert("RGB")
    garment = Image.open(BytesIO(garment_jpeg)).convert("RGB")
    generated = _pipeline(person_image=person, garment_image=garment, category=category)
    sink = BytesIO()
    generated.images[0].save(sink, format="PNG")
    return _studio_and_face(person_jpeg, sink.getvalue())


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        ready = weights_ready(os.environ.get("FASHN_WEIGHTS_DIR"))
        self._json(
            200,
            {
                "ready": ready,
                "model": "fashn-vton-1.5",
                "reason": "ok" if ready else "weights_not_installed",
            },
        )

    def do_POST(self) -> None:
        weights = os.environ.get("FASHN_WEIGHTS_DIR", "").strip()
        if not weights_ready(weights):
            self._json(503, {"error": "WEIGHTS_NOT_INSTALLED"})
            return
        length = int(self.headers.get("content-length", "0") or "0")
        if length <= 0 or length > 64_000:
            self._json(400, {"error": "BAD_BODY"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if payload.get("mode") != "still":
                self._json(400, {"error": "STILL_ONLY"})
                return
            category = fashn_category(payload.get("fit_category"))
            if category is None:
                self._json(422, {"error": "CATEGORY_UNSUPPORTED"})
                return
            person = _download(str(payload.get("person_url") or ""))
            garment = _download(str(payload.get("garment_url") or ""))
            jpeg = _run_fashn(person, garment, category)
        except Exception:
            self._json(502, {"error": "UPSTREAM"})
            return
        self.send_response(200)
        self.send_header("content-type", "image/jpeg")
        self.send_header("content-length", str(len(jpeg)))
        self.end_headers()
        self.wfile.write(jpeg)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
