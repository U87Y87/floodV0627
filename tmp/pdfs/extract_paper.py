from pathlib import Path
from pypdf import PdfReader

source = Path(r"D:\Chain1\gtt\A multi-source spatio-temporal data cube for large-scale geospatial analysis.pdf")
out_dir = Path(r"D:\Debris Flow\V0622\tmp\pdfs\paper_text")
out_dir.mkdir(parents=True, exist_ok=True)

reader = PdfReader(str(source))
all_text = []
for index, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    (out_dir / f"page-{index:02d}.txt").write_text(text, encoding="utf-8")
    all_text.append(f"\n\n===== PAGE {index} =====\n\n{text}")

(out_dir / "full.txt").write_text("".join(all_text), encoding="utf-8")
print(f"pages={len(reader.pages)} chars={sum(len(x) for x in all_text)}")
