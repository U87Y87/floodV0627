from pathlib import Path
from PIL import Image, ImageDraw

out_dir = Path(r"D:\Debris Flow\V0622\tmp\pdfs\rendered_translation_pages")
out_dir.mkdir(parents=True, exist_ok=True)

thumbs = []
page_paths = sorted(out_dir.glob("page-*.png"))
for i, path in enumerate(page_paths, 1):
    image = Image.open(path).convert("RGB")
    image.thumbnail((340, 440))
    thumbs.append((i, image.copy()))

for sheet_index in range(0, len(thumbs), 12):
    group = thumbs[sheet_index:sheet_index + 12]
    sheet = Image.new("RGB", (4 * 370, 3 * 475), "white")
    draw = ImageDraw.Draw(sheet)
    for j, (page_num, image) in enumerate(group):
        x = (j % 4) * 370 + 15
        y = (j // 4) * 475 + 25
        sheet.paste(image, (x, y))
        draw.text((x, 5 + (j // 4) * 475), f"Page {page_num}", fill="black")
    sheet.save(out_dir / f"contact-{sheet_index // 12 + 1}.png")

print(f"pages={len(page_paths)} sheets={(len(thumbs) + 11) // 12}")
