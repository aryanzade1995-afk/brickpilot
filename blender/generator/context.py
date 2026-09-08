"""
Shared context for the BrickPilot Blender house generator.

Loads the DesignSpec JSON (emitted by src/architecture/generateDesign.ts),
exposes it as light dataclasses, and provides Blender helpers (collections,
mesh-from-verts, boolean cut, principled material). Everything is metres;
the spec is millimetres, so `mm()` divides by 1000.

Runs headless:  blender --background --python house_generator.py -- --spec s.json --out v.glb
Without bpy (plain python) the spec still loads so validator.py can run in CI.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

try:  # available only inside Blender
    import bpy  # type: ignore
    import bmesh  # type: ignore

    HAS_BPY = True
except Exception:  # pragma: no cover - CI / dry run
    bpy = None  # type: ignore
    bmesh = None  # type: ignore
    HAS_BPY = False


def mm(v: float) -> float:
    """millimetres -> metres"""
    return float(v) / 1000.0


# --------------------------------------------------------------------------- #
#  Spec model                                                                 #
# --------------------------------------------------------------------------- #

@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @staticmethod
    def of(d: dict) -> "Rect":
        return Rect(d["x"], d["y"], d["w"], d["h"])


@dataclass
class Spec:
    raw: dict
    style: str
    seed: int
    plot_w: float
    plot_d: float
    setbacks: dict
    entry_side: str
    floors: list[dict]
    facade: list[dict]
    materials: dict
    massing: dict
    requirements: dict
    validation: dict
    # the composed architectural decision set (src/architecture/library/designGenome.ts)
    genome: dict = field(default_factory=dict)
    fingerprint: dict = field(default_factory=dict)
    # the structural grid (src/architecture/generator/structure.ts)
    grid: dict = field(default_factory=dict)
    # the §14 architectural audit
    audit: dict = field(default_factory=dict)
    # design-wide facade depth (src/architecture/generator/articulationResolver.ts)
    # per-storey elements live on floors[].articulation
    articulation: dict = field(default_factory=dict)
    # plot-centre offset so the model sits at the world origin
    ox: float = field(default=0.0)
    oy: float = field(default=0.0)

    @staticmethod
    def load(path: str) -> "Spec":
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        foot = raw["massing"]["footprintMm"]
        s = Spec(
            raw=raw,
            style=raw["style"],
            seed=raw["seed"],
            plot_w=raw["plot"]["widthMm"],
            plot_d=raw["plot"]["depthMm"],
            setbacks=raw["setbacksMm"],
            entry_side=raw["entrySide"],
            floors=raw["floors"],
            facade=raw.get("facade", []),
            materials=raw["materials"],
            massing=raw["massing"],
            requirements=raw["requirements"],
            validation=raw.get("validation", {"ok": True, "issues": [], "repaired": []}),
            genome=raw.get("genome", {}),
            fingerprint=raw.get("fingerprint", {}),
            grid=raw.get("grid", {}),
            audit=raw.get("audit", {}),
            articulation=raw.get("articulation", {}),
        )
        # centre the footprint bbox on the origin (metres)
        s.ox = mm(foot["x"] + foot["w"] / 2)
        s.oy = mm(foot["y"] + foot["h"] / 2)
        return s

    # world-space transform: plan (x east, y south, mm)  ->  Blender (x east, y NORTH, z up, m)
    def wx(self, x_mm: float) -> float:
        return mm(x_mm) - self.ox

    def wy(self, y_mm: float) -> float:
        # flip so plan-south (entry) is -Y, matching the three.js viewer
        return -(mm(y_mm) - self.oy)

    @property
    def top_level(self) -> int:
        return max(f["level"] for f in self.floors) if self.floors else 0


# --------------------------------------------------------------------------- #
#  Blender helpers                                                            #
# --------------------------------------------------------------------------- #

def reset_scene() -> None:
    if not HAS_BPY:
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def collection(name: str):
    if not HAS_BPY:
        return None
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def add_box(name: str, coll, center: tuple[float, float, float], size: tuple[float, float, float]):
    """axis-aligned box, `center` = centre, `size` = full extents (metres)"""
    if not HAS_BPY:
        return None
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(size[0], size[1], size[2]))
    bm.to_mesh(mesh)
    bm.free()
    obj.location = center
    return obj


_UNIT_CUBE = [None]


def linked_box(name: str, coll, center: tuple[float, float, float], size: tuple[float, float, float]):
    """a box that SHARES one unit-cube mesh — for repeated decorative elements
    (fins, mullions, slats, treads, columns). optimize.finalize() bakes the
    per-object scale into the joined mesh."""
    if not HAS_BPY:
        return None
    if _UNIT_CUBE[0] is None:
        me = bpy.data.meshes.new("bp_unit_cube")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        _UNIT_CUBE[0] = me
    obj = bpy.data.objects.new(name, _UNIT_CUBE[0])
    coll.objects.link(obj)
    obj.location = center
    obj.scale = size
    return obj


def add_prism(name: str, coll, verts: list[tuple[float, float, float]], faces: list[tuple[int, ...]]):
    if not HAS_BPY:
        return None
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def boolean_cut(target, cutter, delete_cutter: bool = True) -> None:
    """subtract `cutter` from `target` (an opening in a wall)"""
    if not HAS_BPY or target is None or cutter is None:
        return
    mod = target.modifiers.new(name="cut", type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "FAST"
    bpy.context.view_layer.objects.active = target
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        pass
    if delete_cutter:
        bpy.data.objects.remove(cutter, do_unlink=True)


_MAT_CACHE: dict[str, Any] = {}


def hex_rgb(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    # sRGB -> linear (Blender wants linear)
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(r), lin(g), lin(b))


def material(slot: str, spec: Spec):
    """principled BSDF for a material slot in the spec"""
    if not HAS_BPY:
        return None
    key = slot
    if key in _MAT_CACHE:
        return _MAT_CACHE[key]
    m = spec.materials.get(slot, {"color": "#cccccc", "roughness": 0.8, "metalness": 0.0})
    mat = bpy.data.materials.new(f"bp_{slot}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    r, g, b = hex_rgb(m["color"])
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = float(m.get("roughness", 0.8))
    bsdf.inputs["Metallic"].default_value = float(m.get("metalness", 0.0))
    if slot == "glass":
        try:
            bsdf.inputs["Transmission Weight"].default_value = 0.9
        except Exception:
            pass
        bsdf.inputs["Alpha"].default_value = 0.35
        mat.blend_method = "BLEND"
    _MAT_CACHE[key] = mat
    return mat


def assign(obj, mat) -> None:
    if not HAS_BPY or obj is None or mat is None:
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def deg(d: float) -> float:
    return math.radians(d)
