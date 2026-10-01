"""Independent geometric check of production usable terraces before creating meshes."""

def union_area(rects):
    xs=sorted({x for r in rects for x in (r["x"],r["x"]+r["w"])})
    ys=sorted({y for r in rects for y in (r["y"],r["y"]+r["h"])})
    return sum((b-a)*(d-c) for a,b in zip(xs,xs[1:]) for c,d in zip(ys,ys[1:])
               if any(r["x"] <= (a+b)/2 < r["x"]+r["w"] and r["y"] <= (c+d)/2 < r["y"]+r["h"] for r in rects))

def validate_terrace(payload):
    limits=payload["massingModel"].get("architectureLimits",{})
    if not limits.get("minFreeTerraceRatio"): return
    terrace=payload["buildingModel"].get("roofTerrace")
    if not terrace: raise ValueError("Production roof requires the authoritative usable terrace")
    if any(m["usage"]=="roof" for m in payload["massingModel"]["masses"]):
        raise ValueError("Decorative roof volumes are forbidden on the usable terrace")
    building=payload["buildingModel"]
    top=max(building["floors"],key=lambda f:f["level"])
    plates=terrace["slab"]
    if plates != top["footprint"]: raise ValueError("Terrace slab differs from the authoritative top floor")
    stair=next((s for s in building["stairs"] if s["floorId"]==top["id"]),None)
    if terrace.get("mumty") != (stair["rect"] if stair else None): raise ValueError("Headroom must match the source stair")
    tank=terrace.get("tank")
    if tank:
        if union_area([*plates,tank])-union_area(plates)>1: raise ValueError("Tank must stay on the actual roof")
        if stair:
            a,b=tank,stair["rect"]
            if min(a["x"]+a["w"],b["x"]+b["w"])>max(a["x"],b["x"]) and min(a["y"]+a["h"],b["y"]+b["h"])>max(a["y"],b["y"]): raise ValueError("Tank intersects headroom")
    blocked=[terrace[k] for k in ("mumty","tank") if terrace.get(k)]
    # Edge guards take 120 mm inward. Exact union removes duplicated shared edges.
    xs=sorted({x for r in plates for x in (r["x"],r["x"]+r["w"])})
    ys=sorted({y for r in plates for y in (r["y"],r["y"]+r["h"])})
    inside=lambda x,y:any(r["x"]<x<r["x"]+r["w"] and r["y"]<y<r["y"]+r["h"] for r in plates)
    for x in xs:
        for lo,hi in zip(ys,ys[1:]):
            left,right=inside(x-1,(lo+hi)/2),inside(x+1,(lo+hi)/2)
            if left!=right: blocked.append({"x":x-120 if left else x,"y":lo,"w":120,"h":hi-lo})
    for y in ys:
        for lo,hi in zip(xs,xs[1:]):
            up,down=inside((lo+hi)/2,y-1),inside((lo+hi)/2,y+1)
            if up!=down: blocked.append({"x":lo,"y":y-120 if up else y,"w":hi-lo,"h":120})
    clipped=[]
    for r in blocked:
        for p in plates:
            x,y=max(r["x"],p["x"]),max(r["y"],p["y"])
            w,h=min(r["x"]+r["w"],p["x"]+p["w"])-x,min(r["y"]+r["h"],p["y"]+p["h"])-y
            if w>0 and h>0: clipped.append({"x":x,"y":y,"w":w,"h":h})
    free=1-union_area(clipped)/union_area(plates)
    if free+1e-9<limits["minFreeTerraceRatio"]: raise ValueError(f"Terrace free area {free:.1%} is below 80%")
    allowed={"FLAT_PARAPET","STEPPED_PARAPET","OFFSET_PARAPET"}
    for unit in payload["facadeGrammar"].get("specialized",{}).get("assemblies",[]):
        if unit["category"]=="ROOFLINE" and unit["type"] not in allowed: raise ValueError("Usable terrace has a decorative roof assembly")
    return free
