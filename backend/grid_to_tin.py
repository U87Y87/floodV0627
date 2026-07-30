import argparse
import math
from pathlib import Path
from typing import Dict, List, Sequence, Tuple
import numpy as np
from pyproj import Transformer

try:
    import cupy as cp  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    cp = None  # CUDA acceleration will be disabled


def parse_dem(dem_path: Path) -> Tuple[np.ndarray, Dict[str, float]]:
    """Read DEM ASCII grid, returning height grid and header values."""
    with dem_path.open("r", encoding="utf-8") as f:
        header_lines = [next(f).strip() for _ in range(6)]
        header: Dict[str, float] = {}
        for line in header_lines:
            parts = line.split()
            if len(parts) >= 2:
                header[parts[0].lower()] = float(parts[-1])
        data = np.loadtxt(f, dtype=np.float32)
    nrows = int(header.get("nrows", data.shape[0]))
    ncols = int(header.get("ncols", data.shape[1] if data.ndim > 1 else 1))
    data = data.reshape((nrows, ncols))
    return data.astype(np.float32), header


def parse_depth(depth_path: Path, shape: Tuple[int, int]) -> np.ndarray:
    """Read depth ASCII grid (6-line header + body) with robust fallback.

    Primary path uses numpy.loadtxt. If column count is irregular, falls back to
    tokenizing all numeric values and reshaping/padding/truncating to expected shape.
    """
    try:
        with depth_path.open("r", encoding="utf-8") as f:
            for _ in range(6):
                next(f, None)
            data = np.loadtxt(f, dtype=np.float32)
        return data.reshape(shape)
    except Exception as e:
        try:
            with depth_path.open("r", encoding="utf-8") as f:
                for _ in range(6):
                    next(f, None)
                text = f.read()
            text = text.replace(",", " ")
            tokens = text.split()
            values: List[float] = []
            for tok in tokens:
                try:
                    values.append(float(tok))
                except ValueError:
                    continue
            expected = int(shape[0] * shape[1])
            if len(values) < expected:
                values.extend([0.0] * (expected - len(values)))
            elif len(values) > expected:
                values = values[:expected]
            arr = np.asarray(values, dtype=np.float32).reshape(shape)
            print(f"Warning: used fallback parser for {depth_path.name} due to irregular columns ({e})")
            return arr
        except Exception:
            raise


def build_index_map(grid_depth: np.ndarray) -> Tuple[Dict[Tuple[int, int], int], List[Tuple[int, int]]]:
    positions: List[Tuple[int, int]] = []
    h, w = grid_depth.shape
    for i in range(h):
        row = grid_depth[i]
        for j in range(w):
            if row[j] != 0:
                positions.append((i, j))
    mapping = {(i, j): idx for idx, (i, j) in enumerate(positions)}
    return mapping, positions


def triangulate(grid_depth: np.ndarray, index_map: Dict[Tuple[int, int], int]) -> List[Tuple[int, int, int]]:
    """Vectorized triangulation of the grid."""
    print("开始三角剖分...")
    h, w = grid_depth.shape
    
    # 1. 识别所有有效点 (depth != 0)
    valid_mask = grid_depth != 0
    
    # 2. 创建四个偏移的有效点掩码，用于识别邻居
    #    - p_tl (top-left): 当前点 (i, j)
    #    - p_tr (top-right): 右侧点 (i, j+1)
    #    - p_bl (bottom-left):下方点 (i+1, j)
    #    - p_br (bottom-right): 右下角点 (i+1, j+1)
    p_tl = valid_mask[:-1, :-1]
    p_tr = valid_mask[:-1, 1:]
    p_bl = valid_mask[1:, :-1]
    p_br = valid_mask[1:, 1:]

    triangles: List[Tuple[int, int, int]] = []

    # 3. 组合一: (i,j), (i+1,j), (i+1,j+1)
    #    - 条件: p_tl, p_bl, p_br 都有效
    mask1 = p_tl & p_bl & p_br
    indices1 = np.argwhere(mask1)
    for i, j in indices1:
        idx1 = index_map[(i, j)]
        idx2 = index_map[(i + 1, j)]
        idx3 = index_map[(i + 1, j + 1)]
        triangles.append((idx1, idx2, idx3))

    # 4. 组合二: (i,j), (i+1,j+1), (i,j+1)
    #    - 条件: p_tl, p_br, p_tr 都有效
    mask2 = p_tl & p_br & p_tr
    indices2 = np.argwhere(mask2)
    for i, j in indices2:
        idx1 = index_map[(i, j)]
        idx2 = index_map[(i + 1, j + 1)]
        idx3 = index_map[(i, j + 1)]
        triangles.append((idx1, idx2, idx3))
        
    print(f"三角剖分完成，生成 {len(triangles)} 个三角形。")
    return triangles


def build_vectors_and_depths(
    positions: Sequence[Tuple[int, int]], grid_dem: np.ndarray, grid_depth: np.ndarray
) -> Tuple[List[float], List[float], float, float]:
    vectors: List[float] = []
    depths: List[float] = []
    min_depth = float("inf")
    max_depth = float("-inf")

    for i, j in positions:
        z = float(grid_dem[i, j])
        depth_val = round(float(grid_depth[i, j]), 2)# 保留两位小数
        vectors.extend([float(i), float(j), float(z)])
        depths.append(depth_val)
        if depth_val < min_depth:
            min_depth = depth_val
        if depth_val > max_depth:
            max_depth = depth_val

    if not depths:
        min_depth = 0.0
        max_depth = 0.0

    return vectors, depths, min_depth, max_depth


def infer_utm_epsg(header: Dict[str, float], default_zone: int) -> str:
    """Infer WGS84 UTM EPSG from the ASC header, falling back to a user-provided zone."""
    for key in ("epsg", "crs", "srid"):
        value = header.get(key)
        if value and int(value) > 0:
            return f"EPSG:{int(value)}"
    zone = int(header.get("utm_zone", default_zone))
    return f"EPSG:326{zone:02d}"


def grid_cell_center(header: Dict[str, float], row: int, col: int) -> Tuple[float, float]:
    nrows = int(header["nrows"])
    xllcorner = float(header["xllcorner"])
    yllcorner = float(header["yllcorner"])
    cellsize = float(header["cellsize"])
    x = xllcorner + (col + 0.5) * cellsize
    y = yllcorner + (nrows - row - 0.5) * cellsize
    return x, y


def build_heatmap_points(
    positions: Sequence[Tuple[int, int]],
    grid_depth: np.ndarray,
    header: Dict[str, float],
    transformer: Transformer,
) -> Tuple[List[Tuple[float, float, float]], float, float]:
    points: List[Tuple[float, float, float]] = []
    min_depth = 0.0
    max_depth = 0.0

    for row, col in positions:
        depth_val = round(float(grid_depth[row, col]), 2)
        if depth_val == 0:
            continue
        utm_x, utm_y = grid_cell_center(header, row, col)
        lon, lat = transformer.transform(utm_x, utm_y)
        points.append((round(float(lon), 6), round(float(lat), 6), depth_val))
        if depth_val > max_depth:
            max_depth = depth_val

    return points, min_depth, max_depth


def format_number(value: float) -> str:
    if math.isfinite(value) and float(value).is_integer():
        return str(int(value))
    return f"{value:.10f}".rstrip("0").rstrip(".")


def write_json(
    out_path: Path,
    points: List[Tuple[float, float, float]],
    min_depth: float,
    max_depth: float,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        f.write(f"{{min: {format_number(min_depth)},max: {format_number(max_depth)},points: [")
        for lon, lat, depth in points:
            f.write(
                f"{{x:{format_number(lon)},y:{format_number(lat)},value:{format_number(depth)}}},"
            )
        f.write("]}")


def write_xml(xml_path: Path, flood_files: List[str]) -> None:
    import xml.etree.ElementTree as ET

    root = ET.Element("floods")
    for fname in flood_files:
        node = ET.SubElement(root, "flood")
        node.set("url", fname)

    tree = ET.ElementTree(root)
    try:
        ET.indent(tree, space="    ", level=0)  # type: ignore[attr-defined]
    except AttributeError:
        pass

    xml_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def sorted_depth_files(depth_dir: Path) -> List[Path]:
    txt_files = list(depth_dir.glob("*.txt"))
    def sort_key(p: Path):
        try:
            return int(p.stem)
        except ValueError:
            return p.stem
    return sorted(txt_files, key=sort_key)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert grid + depth TXT to TIN-style JSON and XML.")
    parser.add_argument("--dem", type=Path, default=Path(r"D:/Chain1/gtt/TXT/dem.asc"), help="Path to DEM ASCII grid (.asc)")
    parser.add_argument("--depth-dir", type=Path, default=Path(r"D:/Chain1/gtt/TXT"), help="Directory containing depth TXT files")
    parser.add_argument("--output-dir", type=Path, default=Path(r"D:/Chain1/gtt/JSON"), help="Directory to write JSON outputs")
    parser.add_argument("--xml", type=Path, default=None, help="Path to summary XML (default: output-dir/Flood_New.xml)")
    parser.add_argument("--utm-zone", type=int, default=48, help="WGS84 UTM zone used by ASC coordinates when no EPSG is present")
    parser.add_argument("--use-cuda", action="store_true", help="Try to use CuPy for acceleration if available")
    args = parser.parse_args()

    grid_dem, header = parse_dem(args.dem)
    nrows, ncols = grid_dem.shape
    shape = (nrows, ncols)
    source_epsg = infer_utm_epsg(header, args.utm_zone)
    transformer = Transformer.from_crs(source_epsg, "EPSG:4326", always_xy=True)

    depth_files = sorted_depth_files(args.depth_dir)
    if not depth_files:
        raise FileNotFoundError(f"No .txt files found in {args.depth_dir}")

    # Ensure output directory exists and is a directory (not a file), otherwise give a clear error.
    try:
        if args.output_dir.exists() and not args.output_dir.is_dir():
            raise NotADirectoryError(f"Output path {args.output_dir} exists and is not a directory. Choose another --output-dir.")
        args.output_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        raise PermissionError(
            f"Cannot create or write to {args.output_dir}. Check permissions or pick another --output-dir."
        ) from exc

    xml_path = args.xml or args.output_dir / "Flood_New.xml"
    generated_files: List[str] = []

    for idx, depth_file in enumerate(depth_files, start=1):
        grid_depth = parse_depth(depth_file, shape)

        if not np.any(grid_depth):
            print(f"Skipped {depth_file} (all depths are zero)")
            continue

        if args.use_cuda and cp is not None:
            depth_gpu = cp.asarray(grid_depth)
            # Fetch back only when needed for Python loops.
            grid_depth = cp.asnumpy(depth_gpu)

        _index_map, positions = build_index_map(grid_depth)
        points, min_depth, max_depth = build_heatmap_points(positions, grid_depth, header, transformer)

        # 统一命名：Flood<数字>.json
        num_str = None
        stem = depth_file.stem
        if stem.isdigit():
            num_str = stem
        else:
            try:
                import re  # 延迟导入避免全局依赖
                m = re.search(r"(\d+)", stem)
                if m:
                    num_str = m.group(1)
            except Exception:
                pass
        if num_str is None:
            num_str = str(idx)
        # 去前导零，保持 Flood15.json 这种格式
        try:
            num_str = str(int(num_str))
        except Exception:
            pass

        out_name = f"Flood{num_str}.json"
        out_path = args.output_dir / out_name

        write_json(out_path, points, min_depth, max_depth)
        generated_files.append(out_name)
        print(f"Exported {out_path}")

    write_xml(xml_path, generated_files)
    print(f"XML summary written to {xml_path}")


if __name__ == "__main__":
    main()
