"""Blender mesh creation with shared mesh data and individual semantic objects."""

import bpy
from visualization.materials import create_materials

MM = 0.001
COLLECTION_NAMES = (
    "STRUCTURE", "WALLS", "OPENINGS", "WINDOWS", "DOORS", "MASSING",
    "FACADE", "BALCONIES", "ROOF", "LANDSCAPE", "LIGHTING",
)


class SceneBuilder:
    def __init__(self, plan_id, palette="warm-stone"):
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        self.collections = {}
        for name in COLLECTION_NAMES:
            collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
            if collection.name not in {child.name for child in bpy.context.scene.collection.children}:
                bpy.context.scene.collection.children.link(collection)
            self.collections[name] = collection
        self.meshes = {}
        self.plan_id = plan_id
        bpy.context.scene.unit_settings.system = "METRIC"
        bpy.context.scene.unit_settings.scale_length = 1.0
        bpy.context.scene["source_plan_id"] = plan_id
        self.materials = create_materials(palette)
        self.finish_meshes = {}

    def assign_material(self, obj, role):
        key = (obj.data.name, role)
        if key not in self.finish_meshes:
            mesh = obj.data.copy()
            mesh.materials.clear()
            mesh.materials.append(self.materials[role])
            self.finish_meshes[key] = mesh
        obj.data = self.finish_meshes[key]
        obj["material_role"] = role

    def box(self, name, collection, x, y, z, width, depth, height, material="wall", source_id=None, bevel=8):
        """Inputs are millimetres; x/y are the plan centre and z is the bottom."""
        if min(width, depth, height) <= 0:
            raise ValueError(f"{name} has non-positive dimensions")
        dims = tuple(round(value * MM, 6) for value in (width, depth, height))
        mesh_key = (dims, material)
        mesh = self.meshes.get(mesh_key)
        if mesh is None:
            w, d, h = (value / 2 for value in dims)
            vertices = [(-w, -d, -h), (w, -d, -h), (w, d, -h), (-w, d, -h),
                        (-w, -d, h), (w, -d, h), (w, d, h), (-w, d, h)]
            faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                     (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            mesh = bpy.data.meshes.new(f"BP_Box_{len(self.meshes):04d}")
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            mesh.materials.append(self.materials[material])
            self.meshes[mesh_key] = mesh
        obj = bpy.data.objects.new(name, mesh)
        self.collections[collection].objects.link(obj)
        obj.location = (x * MM, y * MM, (z + height / 2) * MM)
        obj["source_plan_id"] = self.plan_id
        obj["material_role"] = material
        if source_id:
            obj["source_id"] = source_id
        if bevel > 0:
            modifier = obj.modifiers.new("Controlled edge bevel", "BEVEL")
            modifier.width = min(bevel, min(width, depth, height) * 0.18) * MM
            modifier.segments = 2
            if hasattr(modifier, "affect"):
                modifier.affect = "EDGES"
            normal = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
            normal.keep_sharp = True
        return obj

    def rect(self, name, collection, rect, bottom, height, material="concrete", source_id=None, bevel=8):
        return self.box(name, collection, rect["x"] + rect["w"] / 2,
                        rect["y"] + rect["h"] / 2, bottom, rect["w"], rect["h"],
                        height, material, source_id, bevel)


def floor_prefix(floor):
    return floor["id"]
