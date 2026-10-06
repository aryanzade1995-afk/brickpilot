"""Preserve curated PBR values when exporting procedural Blender shaders to glTF."""
import bpy


def export_glb(path):
    links = []
    # glTF cannot serialize Noise -> ColorRamp or procedural bump node graphs.
    # Principled inputs retain each palette's physical base color/roughness.
    # Temporarily expose those inputs; restore the editable master immediately.
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        if material.get('asset_pbr'):
            continue  # Preserve real asset images and normal maps in the browser too.
        for shader in (n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'):
            for key in ('Base Color', 'Normal'):
                for link in list(shader.inputs[key].links):
                    links.append((material.node_tree, link.from_socket, link.to_socket))
                    material.node_tree.links.remove(link)
    try:
        bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                                  export_apply=True, export_extras=True, use_visible=True)
    finally:
        for tree, start, end in links:
            tree.links.new(start, end)
