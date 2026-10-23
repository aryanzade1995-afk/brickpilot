"""Replay canonical TS guard vertices, never calculate another stair layout."""
import math
import bpy


def create_stair_guards(scene, payload):
    guards = payload.get('stairGuards')
    if not guards:
        return
    if guards.get('version') != 'stair-guards-v1':
        raise ValueError('Unsupported stair guard version')
    stair_ids = {(s['floorId'], s['id']) for s in payload['buildingModel']['stairs']}
    for part in guards['parts']:
        if (part['floorId'], part['stairId']) not in stair_ids or len(part['verticesMm']) != 8 or not all(math.isfinite(v) for p in part['verticesMm'] for v in p):
            raise ValueError('Invalid canonical stair guard')
        mesh = bpy.data.meshes.new(part['id'])
        mesh.from_pydata([tuple(v*.001 for v in p) for p in part['verticesMm']], [], part['faces'])
        mesh.update()
        mesh.materials.append(scene.materials['metal'])
        obj = bpy.data.objects.new(part['id'], mesh)
        scene.collections['STRUCTURE'].objects.link(obj)
        obj['source_plan_id'] = scene.plan_id
        obj['source_id'] = part['stairId']
        obj['stair_guard_version'] = guards['version']
        obj['stair_guard_part_id'] = part['id']
        obj['material_role'] = 'metal'
        bevel = obj.modifiers.new('Rail edge', 'BEVEL')
        bevel.width = .002
        bevel.segments = 2
        normal = obj.modifiers.new('Rail normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    for issue in guards.get('issues', []):
        scene.warnings.append(issue['message'])
