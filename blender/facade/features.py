"""Turn validated facade grammar parts into individually editable Blender solids."""

import bpy

from geometry.common import MM


def _name(feature, index):
    readable = "".join(word.title() for word in feature["type"].split("_"))
    return f"{'Hero' if feature['importance'] == 'hero' else 'Support'}_{readable}_{index:02d}"


def _part(scene, feature, part, name, material="stone"):
    world = part["world"]
    obj = scene.box(name, "FACADE", world["x"] + world["w"] / 2,
                     world["y"] + world["h"] / 2, world["z"],
                     world["w"], world["h"], world["height"], material,
                     feature["id"], bevel=12)
    zone = next(z for z in scene.facade["zones"] if z["id"] == part.get("zoneId", feature["zoneIds"][0]))
    obj["facade_side"] = zone["side"]
    return obj


def create_frame(scene, feature, base_name):
    for index, part in enumerate(feature["parts"], 1):
        _part(scene, feature, part, f"{base_name}_{part['role'].title()}_{index:02d}")


def create_projected_box(scene, feature, base_name):
    for index, part in enumerate(feature["parts"], 1):
        _part(scene, feature, part, f"{base_name}_Volume_{index:02d}", "wall")


def create_jali(scene, feature, base_name):
    for index, part in enumerate(feature["parts"], 1):
        _part(scene, feature, part, f"{base_name}_Jali_{index:03d}", "stone")


def create_fins(scene, feature, base_name):
    material = "timber" if feature["type"] in ("WOOD_SPINE", "TIMBER_BATTEN") else "metal"
    for index, part in enumerate(feature["parts"], 1):
        _part(scene, feature, part, f"{base_name}_Fin_{index:03d}", material)


def create_recessed_volume(scene, feature, base_name, zones, walls):
    """Boolean carve a shallow niche into the actual source wall, then back it."""
    panel = next((part for part in feature["parts"] if part["role"] == "panel"), None)
    if panel is None:
        raise ValueError(f"{feature['id']} has no recess panel")
    zone = zones[panel["zoneId"]]
    wall = walls[zone["wallId"]]
    thickness = wall["thickness"]
    depth = min(120, thickness - 50)
    if depth < 35:
        raise ValueError(f"{wall['id']} is too thin for a real recess")
    side = zone["side"]
    u0, u1 = panel["u0Mm"], panel["u1Mm"]
    center = (u0 + u1) / 2
    normal = -1 if side in ("N", "W") else 1
    # Cutter starts just outside the wall face and stops short of the rear face.
    outer = zone["fixedMm"] + normal * (thickness / 2 + 2)
    inner = outer - normal * (depth + 2)
    fixed_center = (outer + inner) / 2
    width, height = u1 - u0, panel["z1Mm"] - panel["z0Mm"]
    axis_h = side in ("N", "S")
    cutter = scene.box(f"{base_name}_CuttingTool", "FACADE",
                       center if axis_h else fixed_center,
                       fixed_center if axis_h else center,
                       panel["z0Mm"], width if axis_h else depth + 4,
                       depth + 4 if axis_h else width, height,
                       "concrete", feature["id"], bevel=0)
    bpy.context.view_layer.update()
    cut_count = 0
    for obj in list(scene.collections["WALLS"].objects):
        if obj.get("source_id") != wall["id"]:
            continue
        # A boolean on a disjoint mesh is unnecessary and can be unstable.
        if not _bounds_intersect(obj, cutter):
            continue
        obj.data = obj.data.copy()  # only this wall piece receives the niche
        boolean = obj.modifiers.new(f"{base_name}_Recess", "BOOLEAN")
        boolean.operation = "DIFFERENCE"
        boolean.solver = "EXACT"
        boolean.object = cutter
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=boolean.name)
        obj.select_set(False)
        cut_count += 1
    bpy.data.objects.remove(cutter, do_unlink=True)
    if not cut_count:
        raise ValueError(f"{feature['id']} recess found no wall geometry to cut")
    # A thin rear panel closes the carved niche without filling its depth.
    back = inner + normal * 18
    _part_world = {"x": u0 if axis_h else back - 18,
                   "y": back - 18 if axis_h else u0,
                   "w": width if axis_h else 36,
                   "h": 36 if axis_h else width,
                   "z": panel["z0Mm"], "height": height}
    _part(scene, feature, {"world": _part_world}, f"{base_name}_RecessBack", "stone")
    for index, part in enumerate(feature["parts"], 1):
        if part is not panel:
            _part(scene, feature, part, f"{base_name}_Surround_{index:02d}")


def _bounds_intersect(a, b):
    from mathutils import Vector
    aw = [a.matrix_world @ Vector(v) for v in a.bound_box]
    bw = [b.matrix_world @ Vector(v) for v in b.bound_box]
    return all(min(v[i] for v in aw) < max(v[i] for v in bw) and
               min(v[i] for v in bw) < max(v[i] for v in aw) for i in range(3))


def finish_wall_bevels(scene):
    for obj in scene.collections["WALLS"].objects:
        modifier = obj.modifiers.new("Controlled wall bevel", "BEVEL")
        modifier.width = 4 * MM
        modifier.segments = 2
        obj.modifiers.new("Wall weighted normals", "WEIGHTED_NORMAL")


def create_facade(scene, facade, building, finish=True):
    scene.facade = facade
    zones = {zone["id"]: zone for zone in facade["zones"]}
    walls = {wall["id"]: wall for wall in building["walls"]}
    frame_types = {"C_FRAME", "L_FRAME", "RECTANGLE_FRAME", "DOUBLE_HEIGHT_FRAME",
                   "FLOATING_FRAME", "CORNER_WRAP_FRAME", "ENTRY_PORTAL",
                   "DOUBLE_HEIGHT_PORTAL", "ROOF_FRAME", "PERGOLA_FRAME",
                   "COLONNADE", "FREEFORM_CANOPY", "STONE_PLINTH"}
    box_types = {"PROJECTED_BOX", "FLOATING_BOX", "INTERLOCKING_BOX", "STONE_SPINE",
                 "VERTICAL_TOWER", "DEEP_OVERHANG", "BRIDGE_VOLUME"}
    for index, feature in enumerate(facade["features"], 1):
        name = _name(feature, index)
        kind = feature["type"]
        if kind == "RECESSED_BOX":
            create_recessed_volume(scene, feature, name, zones, walls)
        elif kind in ("JALI_SCREEN", "COURTYARD_SCREEN"):
            create_jali(scene, feature, name)
        elif kind in ("VERTICAL_FIN_SCREEN", "HORIZONTAL_LOUVER", "WOOD_SPINE",
                      "STEEL_GRID", "TIMBER_BATTEN"):
            create_fins(scene, feature, name)
        elif kind in frame_types:
            create_frame(scene, feature, name)
        elif kind in box_types:
            create_projected_box(scene, feature, name)
        else:
            raise ValueError(f"No Blender mesh recipe for {kind}")
    if finish:
        finish_wall_bevels(scene)
