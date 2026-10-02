"""Reuse the planner's site rectangles. No independent site layout is generated."""
import math
from .plates import subtract_rectangles

SITE_KINDS = {"parking", "driveway", "path", "lawn", "pool", "sitOut", "utilityYard"}
SITE_LEVELS = {"grade": -400, "groundDepth": 50, "pavingHeight": 40,
               "waterDepth": 80, "waterThickness": 40, "poolDepth": 1000,
               "basinThickness": 120, "copingWidth": 120, "copingHeight": 100}


def overlaps(a, b):
    return min(a["x"] + a["w"], b["x"] + b["w"]) > max(a["x"], b["x"]) and \
        min(a["y"] + a["h"], b["y"] + b["h"]) > max(a["y"], b["y"])


def validate_site_features(building):
    features = building.get("siteFeatures", [])
    ground = min(building["floors"], key=lambda f: f["level"])
    rooms = [r for r in building["rooms"] if r["floorId"] == ground["id"]]
    seen = set()
    for index, feature in enumerate(features):
        r = feature["rect"]
        if feature["id"] in seen or feature["kind"] not in SITE_KINDS or not isinstance(feature["covered"], bool):
            raise ValueError("Invalid source site feature identity")
        seen.add(feature["id"])
        if any(not isinstance(r[k], (int, float)) or not math.isfinite(r[k]) for k in ("x", "y", "w", "h")) or \
                min(r["w"], r["h"]) <= 0 or min(r["x"], r["y"]) < 0 or \
                r["x"] + r["w"] > building["plot"]["widthMm"] or r["y"] + r["h"] > building["plot"]["depthMm"]:
            raise ValueError(f"Site feature {feature['id']} crosses the plot boundary")
        if feature["covered"] and not any(room["id"] == feature.get("roomId") and room["outdoor"] and room["rect"] == r for room in rooms):
            raise ValueError("Covered site feature lacks its source outdoor room")
        if any(overlaps(r, room["rect"]) for room in rooms if room["id"] not in (feature.get("roomId"), "courtyard")) or \
                any(overlaps(r, other["rect"]) for other in features[:index]):
            raise ValueError(f"Site feature {feature['id']} intersects the source plan")
        if feature["kind"] == "pool" and min(r["w"], r["h"]) <= SITE_LEVELS["copingWidth"] * 2:
            raise ValueError("Source pool cannot fit its coping")


def create_site(scene, building):
    """Paving and a genuine excavated pool remain present when greenery is off."""
    validate_site_features(building)
    ground = min(building["floors"], key=lambda f: f["level"])
    grade = ground["elevationMm"] + SITE_LEVELS["grade"]
    plot = {"x": 0, "y": 0, "w": building["plot"]["widthMm"], "h": building["plot"]["depthMm"]}
    pools = [f["rect"] for f in building.get("siteFeatures", []) if f["kind"] == "pool"]
    span = max(plot["w"], plot["h"]) * 6
    context = {"x": (plot["w"] - span) / 2, "y": (plot["h"] - span) / 2, "w": span, "h": span}
    for name, rect, bottom, material, presentation in [
        ("Site_Ground", plot, grade - 50, "landscape", False),
        ("Ground_Context", context, grade - 105, "paving", True),
    ]:
        for index, piece in enumerate(subtract_rectangles(rect, pools), 1):
            obj = scene.rect(f"{name}_{index:02d}", "LANDSCAPE", piece, bottom,
                             SITE_LEVELS["groundDepth"], material, building["planId"], bevel=0)
            obj["presentation_only"] = presentation
    for feature in building.get("siteFeatures", []):
        if feature["covered"]:
            continue  # Already built from the authoritative outdoor room/slab.
        r, name, kind = feature["rect"], feature["id"], feature["kind"]
        material = "landscape" if kind == "lawn" else "glass" if kind == "pool" else "paving"
        bottom = grade - SITE_LEVELS["waterDepth"] if kind == "pool" else grade + 10
        height = SITE_LEVELS["waterThickness"] if kind == "pool" else SITE_LEVELS["pavingHeight"]
        obj = scene.rect(name, "LANDSCAPE", r, bottom, height, material, name, bevel=3)
        obj["site_feature_kind"] = kind
        if kind != "pool":
            continue
        basin = grade - SITE_LEVELS["poolDepth"]
        scene.rect(f"{name}_Basin", "LANDSCAPE", r, basin, SITE_LEVELS["basinThickness"], "secondary_wall", name, bevel=4)
        rim = SITE_LEVELS["copingWidth"]
        edges = [dict(r, h=rim), dict(r, y=r["y"] + r["h"] - rim, h=rim),
                 dict(r, y=r["y"] + rim, w=rim, h=r["h"] - rim * 2),
                 dict(r, x=r["x"] + r["w"] - rim, y=r["y"] + rim, w=rim, h=r["h"] - rim * 2)]
        for index, edge in enumerate(edges):
            scene.rect(f"{name}_Side_{index}", "LANDSCAPE", edge, basin, grade - basin, "secondary_wall", name, bevel=4)
            scene.rect(f"{name}_Coping_{index}", "LANDSCAPE", edge, grade, SITE_LEVELS["copingHeight"], "stone", name, bevel=4)

    if building.get("siteRequirements", {}).get("compoundWall"):
        pw, pd = plot["w"], plot["h"]
        driveway = next((f for f in building.get("siteFeatures", []) if f["kind"] == "driveway"), None)
        center = driveway["rect"]["x"]+driveway["rect"]["w"]/2 if driveway else pw/2
        half = min(1900, (pw-600)/2)
        center = min(pw-half-300, max(half+300, center))
        portal = next((z for z in scene.facade['zones'] if z.get('anchorKind') == 'gate'), None) if hasattr(scene, 'facade') else None
        # The geometry generator stores facade data before creating the site.
        if portal and any(f['type'] == 'GATE_PORTAL' for f in scene.facade['features']):
            center = (portal['startMm']+portal['endMm'])/2
            half = (portal['endMm']-portal['startMm']-560)/2
        for name, x, y, w, d in [("North",pw/2,150,pw-150,150),("West",150,pd/2,150,pd-300),("East",pw-150,pd/2,150,pd-300)]:
            scene.box(f"Compound_{name}","LANDSCAPE",x,y,grade,w,d,1600,"wall",building["planId"])
        for side, a, b in [("Left",150,center-half),("Right",center+half,pw-150)]:
            if b>a: scene.box(f"Compound_South_{side}","LANDSCAPE",(a+b)/2,pd-150,grade,b-a,150,1600,"wall",building["planId"])
        if not (portal and any(f['type'] == 'GATE_PORTAL' for f in scene.facade['features'])):
            for side in (-1,1):
                scene.box(f"Gate_Pier_{side}","LANDSCAPE",center+side*half,pd-600,grade,200,1200,3000,"stone",building["planId"])
            scene.box("CompoundGate_Canopy","LANDSCAPE",center,pd-700,grade+3000,half*2+300,1200,180,"concrete",building["planId"])
