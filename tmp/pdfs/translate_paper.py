import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE = Path(r"D:\Debris Flow\V0622\tmp\pdfs\paper_text\full.txt")
OUTPUT = Path(r"D:\Debris Flow\V0622\tmp\pdfs\paper_text\full_zh.txt")


def clean_extracted_text(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = text.replace("鈥?", "-").replace("/C223", "© ")
    lines = [x.rstrip() for x in text.splitlines()]
    out = []
    paragraph = ""
    for line in lines:
        s = line.strip()
        if not s:
            if paragraph:
                out.append(paragraph)
                paragraph = ""
            continue
        if s.startswith("===== PAGE"):
            if paragraph:
                out.append(paragraph)
                paragraph = ""
            out.append(s)
            continue
        if re.match(r"^(Figure|Table)\s+\d+", s) or re.match(r"^\d+(?:\.\d+)*\.\s", s):
            if paragraph:
                out.append(paragraph)
                paragraph = ""
            out.append(s)
            continue
        if paragraph.endswith("-") and s[:1].islower():
            paragraph = paragraph[:-1] + s
        else:
            paragraph = f"{paragraph} {s}".strip()
        if re.search(r"[.!?:)]$", s) and len(paragraph) > 180:
            out.append(paragraph)
            paragraph = ""
    if paragraph:
        out.append(paragraph)
    return "\n\n".join(out)


def chunks(text: str, limit: int = 3600):
    blocks = text.split("\n\n")
    current = ""
    for block in blocks:
        if block.startswith("===== PAGE"):
            if current:
                yield current
                current = ""
            yield block
            continue
        candidate = block if not current else current + "\n\n" + block
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            yield current
        while len(block) > limit:
            cut = block.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            yield block[:cut]
            block = block[cut:].lstrip()
        current = block
    if current:
        yield current


def translate(text: str) -> str:
    if text.startswith("===== PAGE"):
        return text
    params = urlencode({
        "client": "gtx",
        "sl": "en",
        "tl": "zh-CN",
        "dt": "t",
        "q": text,
    })
    req = Request(
        "https://translate.googleapis.com/translate_a/single?" + params,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    for attempt in range(6):
        try:
            with urlopen(req, timeout=45) as response:
                data = json.loads(response.read().decode("utf-8"))
            return "".join(piece[0] for piece in data[0] if piece[0])
        except Exception:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


cleaned = clean_extracted_text(SOURCE.read_text(encoding="utf-8"))
parts = list(chunks(cleaned))
translated = []
for i, part in enumerate(parts, 1):
    translated.append(translate(part))
    print(f"{i}/{len(parts)}", flush=True)
    time.sleep(0.15)

OUTPUT.write_text("\n\n".join(translated), encoding="utf-8")
print(OUTPUT)
