"""Read step: PDF -> text, locally only.

Text-layer PDFs use PyMuPDF. Pages without a text layer are rendered at 300 dpi and read with
local Tesseract (--psm 6, as in week 2). No hosted OCR, ever. Results are cached by SHA-256.
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image

from harborline.config import get_settings

MIN_TEXT_CHARS = 40  # a page with less text than this is treated as a scan


@dataclass
class ReadResult:
    sha256: str
    text: str
    mode: str  # "text" | "ocr"
    mean_conf: float | None  # OCR only, 0-100


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ocr_page(page: pymupdf.Page) -> tuple[str, list[float]]:
    pix = page.get_pixmap(dpi=300)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    data = pytesseract.image_to_data(img, config="--psm 6", output_type=pytesseract.Output.DICT)
    confs = [float(c) for c, t in zip(data["conf"], data["text"]) if t.strip() and float(c) >= 0]
    text = pytesseract.image_to_string(img, config="--psm 6")
    return text, confs


def read_pdf_bytes(data: bytes) -> ReadResult:
    digest = sha256_bytes(data)
    cache = get_settings().cache_dir / "read" / f"{digest}.json"
    if cache.exists():
        return ReadResult(**json.loads(cache.read_text()))

    doc = pymupdf.open(stream=data, filetype="pdf")
    texts, confs, used_ocr = [], [], False
    for page in doc:
        t = page.get_text("text")
        if len(t.strip()) >= MIN_TEXT_CHARS:
            texts.append(t)
        else:
            used_ocr = True
            t, c = _ocr_page(page)
            texts.append(t)
            confs.extend(c)
    result = ReadResult(
        sha256=digest,
        text="\n".join(texts),
        mode="ocr" if used_ocr else "text",
        mean_conf=round(sum(confs) / len(confs), 1) if confs else None,
    )
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(asdict(result)))
    return result


def read_pdf(path: Path) -> ReadResult:
    return read_pdf_bytes(Path(path).read_bytes())
