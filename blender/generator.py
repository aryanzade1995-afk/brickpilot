"""BrickPilot headless Blender geometry exporter.

blender -b --python blender/generator.py -- --input output/blender-input.json --out-dir output/villa
"""

from __future__ import annotations

import argparse
import json
import re
import hashlib
from pathlib import Path
import sys
from types import SimpleNamespace

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validation import validate_payload  # noqa: E402
from geometry.common import SceneBuilder, MM  # noqa: E402
from geometry.site import create_site  # noqa: E402
from geometry.structure import (create_foundation, create_slab, create_wall, create_column,
                                create_beam, create_staircase, create_massing_volume,
                                create_roof_slab)  # noqa: E402
from geometry.openings import create_door_opening, create_window_opening  # noqa: E402
from geometry.stairs import stair_opening, stair_layout  # noqa: E402
from geometry.sizing import create_sized_foundation, slab_thickness  # noqa: E402
from geometry.outdoor import (create_balcony, create_terrace, create_parapet,
                              create_pergola, create_planter, accessible_roof_pad)  # noqa: E402
from facade.features import create_facade, finish_wall_bevels  # noqa: E402
from facade.specialized import create_specialized_grammars  # noqa: E402
from visualization.config import visualization_options, CAMERAS  # noqa: E402
from visualization.spec_materials import apply_specifications
from visualization.materials import apply_finish_composition  # noqa: E402
from visualization.surfaces import create_surface_details  # noqa: E402
from visualization.landscape import create_landscape  # noqa: E402
from visualization.lighting import create_lighting  # noqa: E402
from visualization.cameras import create_cameras  # noqa: E402
from visualization.render import configure_render  # noqa: E402
from exporters.shape import measure_shape, clay_materials, lock_gallery_cameras  # noqa: E402
from exporters.glb import export_glb  # noqa: E402


from geometry.roof_services import create_roof_services
from geometry.covered import create_covered_outdoor, create_exposed_roofs, create_pool_deck


def payload_digest(payload):
    text = 'villa-blender-v2|' + json.dumps(payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def create_scene(payload, visualization=None):
    building = payload["buildingModel"]
    massing = payload["massingModel"]
    facade = payload["facadeGrammar"]
    dna = payload["villaDesignDNA"]
    specialized = facade.get("specialized")
    assemblies = specialized["assemblies"] if specialized else []
    hosts = validate_payload(payload)
    options = visualization_options(payload, visualization)
    if massing.get("architectureLimits", {}).get("minFreeTerraceRatio"):
        options["landscape"]["terrace"] = False
    floors = sorted(building["floors"], key=lambda floor: floor["level"])
    by_floor = {floor["id"]: floor for floor in floors}
    flat_roof = dna["roofType"] not in ("gable", "hip", "mono-slope")
    for stair in building["stairs"]:
        stair_layout(stair)  # Fail on unsupported stair data before touching the scene.
    scene = SceneBuilder(building["planId"], options["palette"])
    scene.facade = facade
    scene.plot_width = building["plot"]["widthMm"]
    scene.plot_depth = building["plot"]["depthMm"]
    scene.warnings = []
    create_site(scene, building)
    if building.get("structuralSizing") and building.get("quantityRules"):
        create_sized_foundation(scene, building, floors[0])
    else:
        create_foundation(scene, floors[0], exterior_walls=[wall for wall in building["walls"]
                          if wall["floorId"] == floors[0]["id"] and wall["kind"] == "exterior"])
    for slab in building["slabs"]:
        floor = by_floor[slab["floorId"]]
        voids = [stair_opening(stair) for stair in building["stairs"]
                 if by_floor[stair["floorId"]]["level"] == floor["level"] - 1]
        voids += [shaft["rect"] for shaft in building["shafts"] if shaft["floorId"] == floor["id"]]
        voids += [void["rect"] for void in floor.get("doubleHeightVoids", [])]
        if floor.get("courtyard"):
            voids.append(floor["courtyard"])
        create_slab(scene, slab, floor, voids)
    for column in building["columns"]:
        create_column(scene, column, by_floor[column["floorId"]])
    for beam in building["beams"]:
        create_beam(scene, beam, by_floor[beam["floorId"]], exterior_walls=[
            wall for wall in building["walls"] if wall["floorId"] == beam["floorId"] and wall["kind"] == "exterior"],
            columns=[c for c in building["columns"] if c["floorId"] == beam["floorId"]])
    openings = [*building["doors"], *building["windows"]]
    serials = {floor["id"]: 1 for floor in floors}
    wall_by_id = {wall["id"]: wall for wall in building["walls"]}
    for wall in building["walls"]:
        floor = by_floor[wall["floorId"]]
        hosted = [opening for opening in openings if hosts[opening["id"]] == wall["id"]]
        serials[floor["id"]] = create_wall(scene, wall, floor, hosted, serials[floor["id"]])
    for opening in building["doors"]:
        create_door_opening(scene, opening, wall_by_id[hosts[opening["id"]]], by_floor[opening["floorId"]])
    for opening in building["windows"]:
        create_window_opening(scene, opening, wall_by_id[hosts[opening["id"]]], by_floor[opening["floorId"]])
    for stair in building["stairs"]:
        floor = by_floor[stair["floorId"]]
        if floor["level"] < floors[-1]["level"] or flat_roof:
            create_staircase(scene, stair, floor)
    for mass in massing["masses"]:
        # Roof caps must not seal the stair exit or service shafts.
        voids = [stair["rect"] for stair in building["stairs"] if flat_roof and stair["floorId"] == mass["sourceFloorId"]]
        voids += [shaft["rect"] for shaft in building["shafts"] if shaft["floorId"] == mass["sourceFloorId"]]
        create_massing_volume(scene, mass, dna["roofType"], voids)
    for room in building["rooms"]:
        if room["outdoor"] and room["id"].startswith("balcony"):
            terrace_mass = next((mass for mass in massing["masses"] if mass["usage"] == "terrace" and
                                 mass["sourceFloorId"] == room["floorId"] and
                                 room["semanticId"] in mass["sourceRoomIds"]), None)
            customized = any(unit["category"] == "BALCONY" and room["semanticId"] in unit["sourceRoomIds"] for unit in assemblies)
            create_balcony(scene, room, by_floor[room["floorId"]], terrace_mass, building["doors"], with_railing=not customized)
    create_roof_services(scene, building)
    # car porch / verandah roofs (a balcony where the upper floor opens onto
    # them), the parked car and a deck round the pool
    covered = create_covered_outdoor(scene, building, massing, facade)
    covered.update(create_exposed_roofs(scene, building))
    covered["poolDeck"] = create_pool_deck(scene, building)
    top = floors[-1]
    roof_level = top["elevationMm"] + top["heightMm"]
    accessible = create_terrace(scene, top, building["stairs"], building["shafts"]) if flat_roof else False
    if not accessible:
        create_roof_slab(scene, top, [shaft["rect"] for shaft in building["shafts"] if shaft["floorId"] == top["id"]])
    # Interior voids omit the intermediate floor, but retain their actual upper
    # ceiling. These caps are sourced by the plan, not decorative roof blocks.
    for floor in floors:
        for index, void in enumerate(floor.get("doubleHeightVoids", []), 1):
            scene.rect(f"{floor['id']}_DoubleHeight_Ceiling_{index}", "ROOF", void["rect"],
                       floor["elevationMm"] + floor["heightMm"] - slab_thickness(floor), slab_thickness(floor), "concrete", void["sourceRoomId"])
    custom_parapet = any(unit["category"] == "ROOFLINE" and unit["type"] in ("FLAT_PARAPET", "STEPPED_PARAPET", "OFFSET_PARAPET", "PLANTER_PARAPET") for unit in assemblies)
    if flat_roof and not custom_parapet:
        create_parapet(scene, top, roof_level, massing["masses"])
    pad = accessible_roof_pad(top, building["stairs"], massing["masses"], building["shafts"]) if accessible else None
    if not specialized and accessible and dna["roofType"] == "pergola-terrace":
        if pad:
            create_pergola(scene, f"{top['id']}_Roof_Pergola_01", pad, roof_level)
        else:
            scene.warnings.append("Roof pergola omitted: no source-stair-accessible clear roof patch.")
    if not specialized and pad and dna["landscapeStyle"] in ("courtyard", "lush-tropical"):
        create_planter(scene, f"{top['id']}_Roof_Planter_01", pad["x"] + pad["w"] / 2,
                       pad["y"] + pad["h"] - 170, roof_level)
    create_facade(scene, facade, building, finish=False)
    create_specialized_grammars(scene, specialized, building, massing)
    finish_wall_bevels(scene)
    bpy.context.view_layer.update()
    composition = apply_finish_composition(scene, building, options["composition"])
    surfaces = create_surface_details(scene, building, options)
    landscape = create_landscape(scene, payload, options)
    finishes = apply_specifications(scene, building, payload.get("specifications"))
    lighting = create_lighting(scene, payload, options)
    render = configure_render(options, dna["seed"])
    cameras = create_cameras(scene, building, options)
    scene.visualization_report = {"palette": options["palette"], "options": options, "composition": composition,
                                  "finishes": finishes, "surfaces": surfaces, "landscape": landscape, "lighting": lighting,
                                  "render": render, "cameras": cameras, "outdoor": covered}
    bpy.context.scene["visualization_settings"] = json.dumps(options)
    return scene


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--name", default="villa")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--render-all", action="store_true")
    parser.add_argument("--prepare", action="store_true", help="Build and measure only; no final export/render")
    parser.add_argument("--resume", action="store_true", help="Export the previously accepted prepared scene")
    parser.add_argument("--production-names", action="store_true")
    parser.add_argument("--clay", action="store_true")
    parser.add_argument("--gallery-frame", action="store_true")
    parser.add_argument("--visualization", help="Optional visualization configuration JSON")
    parser.add_argument("--palette")
    parser.add_argument("--engine", type=str.upper, choices=("EEVEE", "CYCLES"))
    parser.add_argument("--quality", choices=("preview", "final"))
    parser.add_argument("--camera", choices=CAMERAS)
    parser.add_argument("--samples", type=int)
    parser.add_argument("--resolution", help="Pixel dimensions, e.g. 1200x900")
    parser.add_argument("--lighting", type=str.upper, choices=("DAY", "DUSK"))
    parser.add_argument("--hdri", help="Local .hdr/.exr environment")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", args.name):
        parser.error("--name must use letters, digits, _ or -")
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    overrides = json.loads(Path(args.visualization).read_text(encoding="utf-8")) if args.visualization else {}
    if args.palette:
        overrides["palette"] = args.palette
    for flag in ("engine", "quality", "camera", "samples"):
        if getattr(args, flag) is not None:
            overrides.setdefault("render", {})[flag] = getattr(args, flag)
    if args.resolution:
        if not re.fullmatch(r"[0-9]+x[0-9]+", args.resolution):
            parser.error("--resolution must be widthxheight")
        overrides.setdefault("render", {})["resolution"] = [int(n) for n in args.resolution.split("x")]
    if args.render_all:
        overrides.setdefault("render", {})["renderAll"] = True
    if args.lighting:
        overrides.setdefault("lighting", {})["preset"] = args.lighting
    if args.hdri:
        overrides.setdefault("lighting", {})["hdriPath"] = str(Path(args.hdri).resolve())
    blend = out_dir / f"{args.name}.blend"
    glb = out_dir / f"{args.name}.glb"
    if args.resume:
        manifest = json.loads((out_dir / f"{args.name}.json").read_text(encoding="utf-8"))
        if manifest["planId"] != payload["buildingModel"]["planId"] or manifest["seed"] != payload["villaDesignDNA"]["seed"]:
            raise ValueError("Prepared scene belongs to another plan or seed")
        if manifest.get('inputDigest') != payload_digest(payload):
            raise ValueError('Prepared geometry inputs have changed')
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        if bpy.context.scene.get("source_plan_id") != manifest["planId"]:
            raise ValueError("Prepared scene source identity changed")
        scene = SimpleNamespace(visualization_report=manifest["visualization"])
        # Device preferences are process-local and must be resolved again in
        # the export process, even when the prepared .blend says GPU.
        scene.visualization_report['render'] = configure_render(scene.visualization_report['options'], payload['villaDesignDNA']['seed'])
    else:
        scene = create_scene(payload, overrides)
        if args.gallery_frame:
            lock_gallery_cameras(payload)
        manifest = {"planId": payload["buildingModel"]["planId"],
                "seed": payload["villaDesignDNA"]["seed"],
                "warnings": scene.warnings,
                "objects": {name: len(collection.objects) for name, collection in scene.collections.items()},
                "blend": str(blend), "glb": str(glb), "visualization": scene.visualization_report,
                "realizedGeometry": measure_shape(payload), "inputDigest": payload_digest(payload)}
        # Blender integer custom properties are int32. DNA supports safe numeric
        # seeds including uint32 retries; retain the exact value as a string here.
        bpy.context.scene["architectural_seed"] = str(payload["villaDesignDNA"]["seed"])
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    if args.prepare:
        (out_dir / f"{args.name}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"Prepared seed {manifest['seed']}: {manifest['realizedGeometry']['meshCount']} measured meshes", flush=True)
        return
    export_glb(glb)
    specialized = payload["facadeGrammar"].get("specialized")
    if specialized is not None:
        manifest["specializedGrammars"] = {
            "applied": [{"id": unit["id"], "category": unit["category"], "type": unit["type"],
                         "parts": len(unit["parts"])} for unit in specialized["assemblies"]],
            "omissions": specialized["omissions"],
        }
    if args.render or args.render_all:
        if args.clay:
            clay_materials()
        config = scene.visualization_report["options"]["render"]
        names = ["HeroPerspectiveCamera", "FrontCamera", "AerialCamera"] if args.production_names else CAMERAS if config["renderAll"] else [config["camera"]]
        selected = bpy.context.scene.camera
        renders = {}
        for name in names:
            bpy.context.scene.camera = bpy.data.objects[name]
            suffix = {"HeroPerspectiveCamera": "hero", "FrontCamera": "front", "AerialCamera": "aerial"}.get(name, name)
            filename = f"{args.name}_{suffix}.png" if args.production_names else f"{args.name}_{name}.png" if config["renderAll"] else f"{args.name}.png"
            bpy.context.scene.render.filepath = str(out_dir / filename)
            bpy.ops.render.render(write_still=True)
            renders[name] = bpy.context.scene.render.filepath
        bpy.context.scene.camera = selected
        manifest["renders"] = renders
        manifest["render"] = renders[config["camera"]]
    (out_dir / f"{args.name}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
