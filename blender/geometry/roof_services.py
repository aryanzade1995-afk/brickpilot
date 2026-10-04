"""Editable stair headroom with a real exit and a corner tank on a slender stand."""
def tank_bank(terrace):
    """The tank slot widened along the roof edge for up to three tanks, where deck and stair room allow."""
    t=terrace.get("tank")
    if not t: return None
    mumty=terrace.get("mumty")
    def on_roof(r): return any(r["x"]>=p["x"] and r["y"]>=p["y"] and r["x"]+r["w"]<=p["x"]+p["w"] and r["y"]+r["h"]<=p["y"]+p["h"] for p in terrace["slab"])
    def clear(r): return not mumty or not (r["x"]<mumty["x"]+mumty["w"]+300 and r["x"]+r["w"]+300>mumty["x"] and r["y"]<mumty["y"]+mumty["h"]+300 and r["y"]+r["h"]+300>mumty["y"])
    for n in (2,1):
        grow=n*(t["w"]+100)
        for r in ({**t,"w":t["w"]+grow},{**t,"x":t["x"]-grow,"w":t["w"]+grow},{**t,"h":t["h"]+grow},{**t,"y":t["y"]-grow,"h":t["h"]+grow}):
            if on_roof(r) and clear(r): return r
    return t


def create_roof_services(scene, building):
    terrace=building.get("roofTerrace")
    if not terrace: return
    top=max(building["floors"],key=lambda f:f["level"])
    z=top["elevationMm"]+top["heightMm"]
    r=terrace.get("mumty")
    if r:
        stair=next((s for s in building["stairs"] if s["floorId"]==top["id"]),None)
        side=stair.get("startSide","N") if stair else "N"
        for name,horizontal,fixed,lo,length in [("N",True,r["y"],r["x"],r["w"]),("S",True,r["y"]+r["h"],r["x"],r["w"]),("W",False,r["x"],r["y"],r["h"]),("E",False,r["x"]+r["w"],r["y"],r["h"])]:
            spans=[(lo,length,0,2200)]
            if name==side:
                margin=(length-900)/2
                spans=[(lo,margin,0,2200),(lo+margin+900,margin,0,2200),(lo+margin,900,2100,100)]
            for i,(at,w,bottom,height) in enumerate(spans):
                x,y=(at+w/2,fixed) if horizontal else (fixed,at+w/2)
                scene.box(f"Roof_Mumty_{name}_{i}","ROOF",x,y,z+bottom,w if horizontal else 120,120 if horizontal else w,height,"wall",top["id"])
        scene.rect("Roof_Mumty_Cap","ROOF",r,z+2200,120,"concrete",top["id"])
    tank=tank_bank(terrace)
    if tank:
        # a battery of cylindrical tanks side by side on one steel stand
        along_x=tank["w"]>=tank["h"]
        span,cross=(tank["w"],tank["h"]) if along_x else (tank["h"],tank["w"])
        count=max(1,round(span/1150))
        pitch=span/count
        radius=min(pitch,cross)/2-70
        cx,cy=tank["x"]+tank["w"]/2,tank["y"]+tank["h"]/2
        for i in range(count+1):
            at=-span/2+pitch*i
            for side in (-1,1):
                dx,dy=(at,side*(cross/2-70)) if along_x else (side*(cross/2-70),at)
                scene.box(f"Roof_Tank_Stand_{i}_{side}","ROOF",cx+dx,cy+dy,z,60,60,800,"metal",top["id"])
        scene.rect("Roof_Tank_Tray","ROOF",tank,z+800,60,"metal",top["id"])
        from .covered import _cylinder
        for i in range(count):
            at=-span/2+pitch*(i+.5)
            x,y=(cx+at,cy) if along_x else (cx,cy+at)
            base=z+860
            _cylinder(scene,f"Roof_WaterTank_{i+1}",x,y,base+500,radius,1000,"z","tank",top["id"])
            _cylinder(scene,f"Roof_WaterTank_{i+1}_Band",x,y,base+300,radius+12,90,"z","tank_lid",top["id"])
            _cylinder(scene,f"Roof_WaterTank_{i+1}_Lid",x,y,base+1030,radius*.82,70,"z","tank_lid",top["id"])
            _cylinder(scene,f"Roof_WaterTank_{i+1}_Knob",x,y,base+1100,radius*.22,70,"z","tank_lid",top["id"])
