#!/usr/bin/env python3
"""
Transform a metadata.json file into 3 output files:
  1. new-furniture-catalog.json  — furniture items (no walls/floors), mm → m
  2. newRoomTemplate.ts          — walls (Box*) + floor (Sàn) as room template
  3. newCatalogMeta.ts           — catalog metadata keyed by modelUrl

Usage:
  python3 transform-metadata.py <folder>
  python3 transform-metadata.py forest-ngu/models

The folder must contain a metadata.json file.
All size/position values are divided by 1000 (mm → m).
"""

import json
import sys
from pathlib import Path


def mm2m(v: float) -> float:
    return round(v / 1000, 4)


def transform(folder: str) -> None:
    folder_path = Path(folder)
    metadata_path = folder_path / "metadata.json"

    if not metadata_path.exists():
        print(f"Error: {metadata_path} not found")
        sys.exit(1)

    data = json.loads(metadata_path.read_text(encoding="utf-8"))
    print(f"Loaded {len(data)} entries from {metadata_path}")

    # ── Classify entries ──
    walls_box = []      # Box* → structural or decorative
    floors = []         # name == "Sàn"
    furniture = []      # everything else

    for entry in data:
        if entry["id"].startswith("Box"):
            walls_box.append(entry)
        elif entry["name"] == "Sàn":
            floors.append(entry)
        else:
            furniture.append(entry)

    # Structural walls: Box* with height >= 2000mm and one thin dimension <= 200mm
    structural_walls = []
    decorative_boxes = []
    for w in walls_box:
        s = w["size"]
        if s[2] >= 2000 and (s[0] <= 200 or s[1] <= 200):
            structural_walls.append(w)
        else:
            decorative_boxes.append(w)

    # Decorative boxes go back to furniture
    furniture.extend(decorative_boxes)

    print(f"  Furniture: {len(furniture)}")
    print(f"  Structural walls: {len(structural_walls)}")
    print(f"  Floors: {len(floors)}")

    # ── 1. new-furniture-catalog.json ──
    catalog = []
    for e in furniture:
        sx, sy, sz = mm2m(e["size"][0]), mm2m(e["size"][1]), mm2m(e["size"][2])
        if sx < 0 or sy < 0 or sz < 0:
            sx, sy, sz = 0, 0, 0
        item = {
            "id": e["id"],
            "name": e["name"],
            "category": e["category"],
            "shape": e["shape"],
            "size": [sx, sy, sz],
            "placementType": e["placementType"],
            "color": e["color"],
            "modelUrl": e["modelUrl"],
        }
        catalog.append(item)

    catalog_path = folder_path / "new-furniture-catalog.json"
    catalog_path.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"  Wrote {catalog_path} ({len(catalog)} items)")

    # ── 2. newRoomTemplate.ts ──
    # Wall segments: derive [startPoint, endPoint] from center position + size
    seg_lines = []
    for w in structural_walls:
        s = w["size"]
        p = w["position"]
        cx, cy = mm2m(p["x"]), mm2m(p["y"])
        sx, sy = mm2m(s[0]), mm2m(s[1])

        if s[0] <= 200:  # thin in X → runs along Y
            start = [round(cx, 2), round(cy - sy / 2, 2)]
            end = [round(cx, 2), round(cy + sy / 2, 2)]
        else:  # thin in Y → runs along X
            start = [round(cx - sx / 2, 2), round(cy, 2)]
            end = [round(cx + sx / 2, 2), round(cy, 2)]

        seg_lines.append(f"      // {w['id']}")
        seg_lines.append(f"      [[{start[0]}, {start[1]}], [{end[0]}, {end[1]}]],")

    segs_block = "\n".join(seg_lines)

    # Floor polygon
    if floors:
        fl = floors[0]
        cx, cy = mm2m(fl["position"]["x"]), mm2m(fl["position"]["y"])
        hx, hy = mm2m(fl["size"][0]) / 2, mm2m(fl["size"][1]) / 2
        polygon = [
            [round(cx - hx, 2), round(cy - hy, 2)],
            [round(cx + hx, 2), round(cy - hy, 2)],
            [round(cx + hx, 2), round(cy + hy, 2)],
            [round(cx - hx, 2), round(cy + hy, 2)],
        ]
        area = round(mm2m(fl["size"][0]) * mm2m(fl["size"][1]), 1)
    else:
        polygon = []
        area = 0

    poly_str = ",\n".join(f"    [{p[0]}, {p[1]}]" for p in polygon)

    # Objects block: all furniture with position / 1000
    obj_lines = []
    for e in furniture:
        name = e["name"].replace('"', '\\"')
        px = mm2m(e["position"]["x"])
        py = mm2m(e["position"]["y"])
        pz = mm2m(e["position"]["z"])

        sx = mm2m(e["size"][0])
        sy = mm2m(e["size"][1])
        sz = mm2m(e["size"][2])
        if sx < 0 or sy < 0 or sz < 0:
            sx, sy, sz = 0, 0, 0

        obj_lines.append("      {")
        obj_lines.append(f'        name: "{name}",')
        obj_lines.append('        type: "model",')
        obj_lines.append(f'        modelUrl: "{e["modelUrl"]}",')
        obj_lines.append(f"        position: [{px}, {py}, {pz}],")
        obj_lines.append("        rotation: [0, 0, 0, 1],")
        obj_lines.append(f'        color: "{e["color"]}",')
        obj_lines.append(f"        size: [{sx}, {sy}, {sz}],")
        obj_lines.append(f'        placementType: "{e["placementType"]}",')
        obj_lines.append("      },")

    objects_block = "\n".join(obj_lines)

    # Derive room name from folder
    room_id = folder_path.name.replace(" ", "-").lower()

    ts_content = f'''// newRoomTemplate.ts
// Auto-generated from {metadata_path}
// All dimensions in meters (original mm values / 1000)

import type {{ Wall }} from "@/states/slices/walls/types";
import type {{ SceneObject }} from "@/states/slices/objects/types";

export type TemplateObject = Omit<SceneObject, "id">;

export interface RoomTemplate {{
  id: string;
  name: string;
  description: string;
  area: number;
  polygon: [number, number][];
  walls: Wall[];
  objects?: TemplateObject[];
}}

function makeWalls(
  segments: [[number, number], [number, number]][],
  prefix: string,
): Wall[] {{
  return segments.map(([start, end], i) => ({{
    id: `${{prefix}}-wall-${{i + 1}}`,
    startPoint: start as [number, number],
    endPoint: end as [number, number],
    thickness: 0.14,
    height: 2.65,
    color: "#e0e0e0",
  }}));
}}

// {len(structural_walls)} structural walls, {len(furniture)} furniture items, area = {area} m²
export const ROOM_TEMPLATE: RoomTemplate = {{
  id: "{room_id}",
  name: "{room_id}",
  description: "~{area} m²",
  area: {area},
  polygon: [
{poly_str},
  ],
  walls: makeWalls(
    [
{segs_block}
    ],
    "{room_id}",
  ),
  objects: [
{objects_block}
  ],
}};
'''

    rt_path = folder_path / "newRoomTemplate.ts"
    rt_path.write_text(ts_content, encoding="utf-8")
    print(f"  Wrote {rt_path} ({len(structural_walls)} walls, {len(furniture)} objects)")

    # ── 3. newCatalogMeta.ts ──
    meta_lines = []
    for e in furniture:
        model_url = e["modelUrl"]
        name = e["name"].replace('"', '\\"')
        color = e["color"]
        sx = mm2m(e["size"][0])
        sy = mm2m(e["size"][1])
        sz = mm2m(e["size"][2])
        if sx < 0 or sy < 0 or sz < 0:
            sx, sy, sz = 0, 0, 0

        meta_lines.append(f'  "{model_url}": {{')
        meta_lines.append(f'    brand: "",')
        meta_lines.append(f'    description: "{name}",')
        meta_lines.append(f"    price: 0,")
        meta_lines.append(
            f'    colorOptions: [{{ name: "Default", hex: "{color}" }}],'
        )
        meta_lines.append(
            f'    sizeOptions: [{{ label: "Default", size: [{sx}, {sy}, {sz}] }}],'
        )
        meta_lines.append(f"    materialOptions: [],")
        meta_lines.append(f"  }},")
        meta_lines.append("")

    meta_block = "\n".join(meta_lines)

    cm_content = f'''// newCatalogMeta.ts
// Auto-generated from {metadata_path}
// All dimensions in meters (original mm values / 1000)

export interface ColorOption {{
  name: string;
  hex: string;
}}

export interface SizeOption {{
  label: string;
  size: [number, number, number];
}}

export interface CatalogMeta {{
  brand: string;
  description: string;
  price: number;
  rating?: number;
  reviewCount?: number;
  colorOptions: ColorOption[];
  sizeOptions: SizeOption[];
  materialOptions: string[];
}}

const META: Record<string, CatalogMeta> = {{
{meta_block}
}};

export function getCatalogMeta(modelUrl: string): CatalogMeta | undefined {{
  return META[modelUrl];
}}
'''

    cm_path = folder_path / "newCatalogMeta.ts"
    cm_path.write_text(cm_content, encoding="utf-8")
    print(f"  Wrote {cm_path} ({len(furniture)} entries)")

    print(f"\nDone! 3 files written to {folder_path}/")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 transform-metadata.py <folder>")
        print("Example: python3 transform-metadata.py forest-ngu/models")
        sys.exit(1)

    transform(sys.argv[1])
