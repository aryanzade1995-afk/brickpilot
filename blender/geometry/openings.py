"""Door/window assemblies placed only inside holes cut by segmented wall meshes."""

import bpy

from .common import MM
from validation import opening_vertical_span


def _axis(wall):
    return "h" if abs(wall["a"]["y"] - wall["b"]["y"]) <= 2 else "v"


def _bar(scene, name, collection, axis, along, fixed, bottom, along_size, height,
         thickness, material, source_id):
    x, y = (along, fixed) if axis == "h" else (fixed, along)
    w, d = (along_size, thickness) if axis == "h" else (thickness, along_size)
    return scene.box(name, collection, x, y, bottom, w, d, height, material, source_id, bevel=3)


def _opening_anchor(scene, opening, floor, axis, bottom, height):
    empty = bpy.data.objects.new(f"Opening_{opening['id']}", None)
    scene.collections["OPENINGS"].objects.link(empty)
    empty.location = (opening["at"]["x"] * MM, opening["at"]["y"] * MM,
                      (floor["elevationMm"] + bottom) * MM)
    empty.empty_display_type = "CUBE"
    empty.empty_display_size = opening["width"] * MM / 2
    empty["source_id"] = opening["id"]
    empty["width_mm"] = opening["width"]
    empty["height_mm"] = height
    empty["source_plan_id"] = scene.plan_id
    return empty


def create_window_opening(scene, opening, wall, floor):
    axis = _axis(wall)
    along = opening["at"]["x" if axis == "h" else "y"]
    fixed = opening["at"]["y" if axis == "h" else "x"]
    width = opening["width"]
    sill, head = opening_vertical_span(opening, floor)
    base = floor["elevationMm"] + sill
    height = head - sill
    _opening_anchor(scene, opening, floor, axis, sill, height)
    jamb = 55
    depth = min(90, wall["thickness"])
    for side, offset in (("L", -width / 2 + jamb / 2), ("R", width / 2 - jamb / 2)):
        _bar(scene, f"Window_{opening['id']}_{side}", "WINDOWS", axis,
             along + offset, fixed, base, jamb, height, depth, "metal", opening["id"])
    for label, z in (("Sill", base), ("Head", base + height - jamb)):
        _bar(scene, f"Window_{opening['id']}_{label}", "WINDOWS", axis,
             along, fixed, z, width, jamb, depth, "metal", opening["id"])
    glass = _bar(scene, f"Window_{opening['id']}_Glass", "WINDOWS", axis,
         along, fixed, base + jamb, width - 2 * jamb, height - 2 * jamb,
         26, "glass", opening["id"])
    glass['opening_operation'] = 'fixed-window'
    if width >= 1800:
        _bar(scene, f"Window_{opening['id']}_Transom", "WINDOWS", axis,
             along, fixed, base + height * .55, width - 2 * jamb, 35, depth, "metal", opening['id'])


def _sliding_door(scene, opening, axis, along, fixed, base, height, width, jamb):
    """Two independently editable overlapping panels, with tracks and pulls."""
    clear = width - 2*jamb
    panel_width = (clear + 80)/2
    panel_height = height - jamb - 35
    frame = 38
    for label, sign in (('Left', -1), ('Right', 1)):
        center = along + sign * (clear-panel_width)/2
        plane = fixed + sign * 24
        name = f"Door_{opening['id']}_Sliding{label}"
        glass = _bar(scene, name+'_Glass', 'DOORS', axis, center, plane, base+35+frame,
                     panel_width-2*frame, panel_height-2*frame, 20, 'glass', opening['id'])
        glass['opening_operation'] = 'sliding-door'
        _clear_slider_glass(glass)
        for side in (-1, 1):
            _bar(scene, name+f'_Stile_{side}', 'DOORS', axis, center+side*(panel_width-frame)/2, plane,
                 base+35, frame, panel_height, 35, 'metal', opening['id'])
        for label2, z in (('Bottom', base+35), ('Top', base+35+panel_height-frame)):
            _bar(scene, name+'_'+label2, 'DOORS', axis, center, plane, z, panel_width, frame, 35, 'metal', opening['id'])
        _bar(scene, name+'_Handle', 'DOORS', axis, center-sign*(panel_width/2-90), plane+28,
             base+900, 20, 300, 25, 'metal', opening['id'])
    for offset in (-24,24):
        _bar(scene, f"Door_{opening['id']}_SlidingTrack_{offset}", 'DOORS', axis, along, fixed+offset, base+3, clear, 12, 18, 'metal', opening['id'])
        _bar(scene, f"Door_{opening['id']}_SlidingHeadRail_{offset}", 'DOORS', axis, along, fixed+offset, base+height-40, clear, 30, 20, 'metal', opening['id'])


def create_door_opening(scene, opening, wall, floor, assembly=None):
    axis = _axis(wall)
    along = opening["at"]["x" if axis == "h" else "y"]
    fixed = opening["at"]["y" if axis == "h" else "x"]
    width = opening["width"]
    _sill, height = opening_vertical_span(opening, floor)
    base = floor["elevationMm"]
    _opening_anchor(scene, opening, floor, axis, 0, height)
    # A source open portal has no door leaf, threshold or low metal head frame.
    # Its actual opening head remains below the source structural beam.
    if not assembly and (opening.get("treatment") == "open" or opening.get("leaf") is False):
        return
    jamb = 55
    depth = min(90, wall["thickness"])
    for side, offset in (("L", -width / 2 + jamb / 2), ("R", width / 2 - jamb / 2)):
        _bar(scene, f"Door_{opening['id']}_{side}", "DOORS", axis,
             along + offset, fixed, base, jamb, height, depth, "metal", opening["id"])
    _bar(scene, f"Door_{opening['id']}_Head", "DOORS", axis,
         along, fixed, base + height - jamb, width, jamb, depth, "metal", opening["id"])
    if assembly and assembly["operation"] == "surface-slide":
        _surface_slider(scene, opening, axis, along, fixed, base, height, width, jamb, assembly)
    elif opening.get("kind") == "entry" and not opening.get("emergencyExit"):
        style = opening.get("entranceDesign", "stone-surround")
        ratio = 0.7 if style == "wide-pivot" else 0.5
        surround_depth = 550 if style == "framed-portico" else 350 if style == "stone-surround" else 240
        clear = width - 2 * jamb - 15
        for label, fraction, center in (("Left", ratio, -clear * (1-ratio)/2), ("Right", 1-ratio, clear * ratio/2)):
            _bar(scene, f"MainEntry_{opening['id']}_Leaf_{label}", "DOORS", axis, along+center,
                 fixed, base+35, clear*fraction-8, height-jamb-55, 55, "door", opening["id"])
            if style == "indian-carved":
                for row in range(4):
                    _bar(scene, f"MainEntry_{opening['id']}_CarvedPanel_{label}_{row}", "DOORS", axis,
                         along+center, fixed+35, base+200+row*520, clear*fraction-140, 340, 20, "wood", opening["id"])
        for sign in (-1,1):
            _bar(scene, f"MainEntry_{opening['id']}_Surround_{sign}", "DOORS", axis,
                 along+sign*(width/2+60), fixed+40, base, 120, height+170, surround_depth, "wood" if style=="indian-carved" else "stone", opening["id"])
            _bar(scene, f"MainEntry_{opening['id']}_Handle_{sign}", "DOORS", axis,
                 along+sign*60, fixed+60, base+900, 25, 500, 45, "metal", opening["id"])
        _bar(scene, f"MainEntry_{opening['id']}_SurroundHead", "DOORS", axis,
             along, fixed+40, base+height, width+240, 170, 300, "wood" if style=="indian-carved" else "stone", opening["id"])
        _bar(scene, f"MainEntry_{opening['id']}_Threshold", "DOORS", axis,
             along, fixed+140, base, width+240, 30, 350, "stone", opening["id"])
        # Source main entries face plan south. Shade stays inside the property edge.
        shade_depth = min(900, scene.plot_depth-fixed-120) if axis=="h" else min(900, scene.plot_width-fixed-120)
        shade_depth = max(150, shade_depth)
        _bar(scene, f"MainEntry_{opening['id']}_Canopy", "FACADE", axis,
             along, fixed+shade_depth/2, base+height+240, width+320, 120, shade_depth, "concrete", opening["id"])
    elif assembly or opening.get('treatment') == 'glazed-slide':
        _sliding_door(scene, opening, axis, along, fixed, base, height, width, jamb)
    elif opening.get("leaf", True):
        _bar(scene, f"Door_{opening['id']}_Leaf", "DOORS", axis,
             along, fixed, base + 35, width - 2 * jamb - 15, height - jamb - 55,
             40, 'door', opening["id"])
        _bar(scene, f"Door_{opening['id']}_Handle", 'DOORS', axis, along+width/2-140, fixed+35,
             base+950, 100, 25, 30, 'metal', opening['id'])

def _surface_slider(scene, opening, axis, along, fixed, base, height, width, jamb, assembly):
    """Full-clear exterior glass sash for an existing narrow balcony aperture."""
    plane=fixed+assembly['offsetMm']; clear=width-2*jamb
    panel=clear+70; bottom=base+12; panel_h=height-45; frame=38
    prefix=f"Door_{opening['id']}_SurfaceSlide"
    parts=[]
    parts.append(_bar(scene,prefix+'_Glass','DOORS',axis,along,plane,bottom+frame,panel-2*frame,panel_h-2*frame,12,'glass',opening['id']))
    for sign in (-1,1):
        parts.append(_bar(scene,prefix+f'_Stile_{sign}','DOORS',axis,along+sign*(panel-frame)/2,plane,bottom,frame,panel_h,42,'metal',opening['id']))
        parts.append(_bar(scene,prefix+f'_Gasket_{sign}','DOORS',axis,along+sign*(panel/2-frame-3),plane,bottom+frame,5,panel_h-2*frame,15,'metal',opening['id']))
    for label,z in [('Bottom',bottom),('Top',bottom+panel_h-frame)]:
        parts.append(_bar(scene,prefix+'_'+label,'DOORS',axis,along,plane,z,panel,frame,42,'metal',opening['id']))
    for sign in (-1,1):
        parts.append(_bar(scene,prefix+f'_Pull_{sign}','DOORS',axis,along-panel/2+75,plane+sign*40,base+900,18,320,20,'metal',opening['id']))
    travel=assembly['travelMm']
    for part in parts:
        if part.get('material_role') == 'glass': _clear_slider_glass(part)
        part['opening_operation']='surface-sliding-door'
        part['slide_translation_mm']=[travel,0,0] if axis=='h' else [0,travel,0]
    # Track spans both the aperture and parked sash. Its 10mm lower profile
    # is an actual stepable part, not a full-width invisible collision box.
    _bar(scene,prefix+'_FixedTopRail','DOORS',axis,along+travel/2,plane,base+height-10,panel+abs(travel),28,55,'metal',opening['id'])
    _bar(scene,prefix+'_FixedBottomRail','DOORS',axis,along+travel/2,plane,base+2,panel+abs(travel),10,55,'metal',opening['id'])


def create_roof_exit_door(scene, access):
    """Paired outward-opening leaves inside the source-derived roof aperture."""
    o=access['opening'];a=o['apertureMm'];axis=o['orient'];horizontal=axis=='h'
    along=a['x']+a['w']/2 if horizontal else a['y']+a['d']/2
    fixed=a['y']+a['d']/2 if horizontal else a['x']+a['w']/2
    width=a['w'] if horizontal else a['d'];base=a['z'];height=a['h'];source=o['sourceId'];jamb=45
    for sign in (-1,1):
        _bar(scene,f'Door_{source}_Jamb_{sign}','DOORS',axis,along+sign*(width-jamb)/2,fixed,base,jamb,height,90,'metal',source)
    _bar(scene,f'Door_{source}_Head','DOORS',axis,along,fixed,base+height-jamb,width,jamb,90,'metal',source)
    clear=width-2*jamb;leaf_w=clear/2-5;leaf_h=height-jamb-18
    for label,sign in [('Left',-1),('Right',1)]:
        center=along+sign*clear/4
        _bar(scene,f'Door_{source}_Leaf_{label}','DOORS',axis,center,fixed,base+10,leaf_w,leaf_h,42,'door',source)
        _bar(scene,f'Door_{source}_Handle_{label}','DOORS',axis,along+sign*70,fixed+40,base+950,100,24,25,'metal',source)


def _clear_slider_glass(obj):
    material=bpy.data.materials.get('Balcony_Clear_Glazing')
    if material is None:
        material=obj.data.materials[0].copy();material.name='Balcony_Clear_Glazing'
        node=material.node_tree.nodes.get('Principled BSDF')
        node.inputs['Roughness'].default_value=.045
        node.inputs['IOR'].default_value=1.52
        node.inputs['Transmission Weight'].default_value=1
    obj.data.materials.clear();obj.data.materials.append(material)
