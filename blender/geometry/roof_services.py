"""Editable stair headroom with a real exit and a corner tank on a slender stand."""
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
    tank=terrace.get("tank")
    if tank:
        cx,cy=tank["x"]+tank["w"]/2,tank["y"]+tank["h"]/2
        for i,dx in enumerate((-tank["w"]/2+70,tank["w"]/2-70)):
            for j,dy in enumerate((-tank["h"]/2+70,tank["h"]/2-70)):
                scene.box(f"Roof_Tank_Stand_{i}{j}","ROOF",cx+dx,cy+dy,z,60,60,800,"metal",top["id"])
        scene.rect("Roof_Tank_Tray","ROOF",tank,z+800,60,"metal",top["id"])
        scene.rect("Roof_WaterTank","ROOF",tank,z+860,1050,"metal",top["id"],bevel=40)
