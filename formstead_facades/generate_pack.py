"""Deterministic Formstead facade prototype generator.
Creates 10 GLB scenes and 100 consistent camera images.
These are geometric concept facades, not approved building designs.
"""
from pathlib import Path
import json, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images_100"
MODELS = ROOT / "glb_models_10"
SHEETS = ROOT / "contact_sheets_10"
for p in (IMAGES, MODELS, SHEETS):
    p.mkdir(parents=True, exist_ok=True)

DESIGNS = [
    ("D01", "Cantilever Ribbon", 11021, "Cantilevered upper ribbon, stone tower, deep balcony, slatted shade"),
    ("D02", "Glass Bridge", 22034, "Two staggered wings connected by a glass bridge, recessed portal"),
    ("D03", "Horizon House", 33047, "Low horizontal roof planes, continuous ribbon glazing, asymmetrical fins"),
    ("D04", "Curved Corner", 44052, "Stepped volumes with a softened curved corner and vertical green wall"),
    ("D05", "Terrace Garden", 55063, "Setback roof terraces, pergola, garden planters and shifted frames"),
    ("D06", "Split Pavilion", 66078, "Two separated upper pavilions, framed central void and warm timber"),
    ("D07", "Diagonal Blade", 77085, "Two angled facade blades, tall corner glazing and offset volumes"),
    ("D08", "Stone Tower", 88092, "Tall stone-clad feature tower beside broad horizontal glass volumes"),
    ("D09", "Floating Carport", 99103, "Projecting upper structure and column-supported open carport"),
    ("D10", "Perforated Screen", 10117, "Projecting perforated privacy screen, shifting roof slabs and fins"),
]
CAMS = [
    ("01_front", 0, 10),
    ("02_front_left", -38, 17),
    ("03_front_right", 38, 17),
    ("04_left", -90, 12),
    ("05_right", 90, 12),
    ("06_rear", 180, 12),
    ("07_rear_left", -142, 19),
    ("08_rear_right", 142, 19),
    ("09_aerial_front", 38, 43),
    ("10_aerial_rear", 218, 43),
]
PALETTES = [
    ("#eee9dd","#373b3d","#a66e45","#777771"),
    ("#d2d0cb","#eeeae4","#8d603c","#2b3235"),
    ("#f3f0e9","#827e79","#af845b","#343b3f"),
    ("#e4e1da","#e9e8e2","#704e37","#34373a"),
    ("#c7c5bd","#eee6da","#a17147","#686a62"),
    ("#e4e6e5","#303b41","#9b754d","#74746d"),
    ("#eee5d8","#acaba7","#a06b43","#363b3c"),
    ("#efeae4","#77746c","#7d543e","#30383d"),
    ("#c9c7c0","#383b3d","#936d4e","#ebe6df"),
    ("#e9e7e1","#333a3c","#ab7750","#626262"),
]
DARK="#272d30"
GLASS="#355d70"
PLANTS="#427a43"
LAMP="#ffcc7a"
GROUND="#dedbd5"

def rgb(h):
    h=h.lstrip("#")
    return tuple(int(h[i:i+2],16) for i in (0,2,4))

def mix(color, k):
    return tuple(max(0,min(255,int(c*k))) for c in color)

class Design:
    def __init__(self, index, did, name, seed, description):
        self.index=index
        self.did,self.name,self.seed,self.description=did,name,seed,description
        self.random=random.Random(seed)
        self.palette=PALETTES[index]
        self.scene=trimesh.Scene()
        self.parts=[]
        self.count=0
        self.width=15.0+self.random.uniform(-.5,.5)
        self.depth=11.8+self.random.uniform(-.35,.35)
        self.height=3.3
        self.front=-self.depth/2

    def box(self, key,x,y,z,sx,sy,sz,color):
        if min(sx,sy,sz) <= 0: return
        verts=np.array([
            [x-sx/2,y-sy/2,z-sz/2],[x+sx/2,y-sy/2,z-sz/2],
            [x+sx/2,y+sy/2,z-sz/2],[x-sx/2,y+sy/2,z-sz/2],
            [x-sx/2,y-sy/2,z+sz/2],[x+sx/2,y-sy/2,z+sz/2],
            [x+sx/2,y+sy/2,z+sz/2],[x-sx/2,y+sy/2,z+sz/2]],dtype=float)
        faces=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
        mesh=trimesh.creation.box(extents=(sx,sy,sz))
        mesh.apply_translation((x,y,z))
        mesh.visual.face_colors=np.array([*rgb(color),255],dtype=np.uint8)
        self.scene.add_geometry(mesh, geom_name="%03d_%s"%(self.count,key))
        self.count+=1
        self.parts.append((verts,faces,rgb(color)))

    def beam(self, key,x,y,z,length=.8,depth=.2,height=.2,c=None):
        self.box(key,x,y,z,length,depth,height,c or DARK)

    def window_front(self,key,x,y,z,w=2.5,h=1.9,pieces=3):
        self.box(key+"_glass",x,y-.07,z,w,.08,h,GLASS)
        self.box(key+"_top",x,y-.13,z+h/2,w+.12,.13,.065,DARK)
        self.box(key+"_bottom",x,y-.13,z-h/2,w+.12,.13,.065,DARK)
        for j in range(pieces+1):
            xx=x-w/2+(w*j/max(1,pieces))
            self.box(key+"_mullion_"+str(j),xx,y-.14,z,.058,.14,h,DARK)

    def window_side(self,key,x,y,z,w=2.2,h=1.7):
        self.box(key+"_glass",x,y,z,.08,w,h,GLASS)
        for yy in (y-w/2,y,y+w/2):
            self.box(key+"_mullion_"+str(yy),x+.09,yy,z,.12,.06,h,DARK)
        for zz in (z-h/2,z+h/2):
            self.box(key+"_rail_"+str(zz),x+.09,y,zz,.12,w,.065,DARK)

    def planter(self,key,x,y,z,length=1.1):
        self.box(key+"_bed",x,y,z+.18,length,.43,.38,self.palette[3])
        for j in range(4):
            self.box(key+"_plant_"+str(j),x-length*.33+j*length*.22,y,z+.55,.18,.22,.48+(.1 if j%2 else 0),PLANTS)

    def slats(self,key,left,right,y,z0,z1,vertical=True,color=None):
        c=color or self.palette[2]
        if vertical:
            for j,x in enumerate(np.linspace(left,right,max(3,int((right-left)/.32)))):
                self.box(key+"_"+str(j),float(x),y,(z0+z1)/2,.11,.18,z1-z0,c)
        else:
            for j,z in enumerate(np.linspace(z0,z1,max(3,int((z1-z0)/.33)))):
                self.box(key+"_"+str(j),(left+right)/2,y,float(z),right-left,.22,.105,c)

    def portal(self,x):
        f=self.front
        self.box("entry_back",x,f-.35,1.58,2.6,.16,3.12,self.palette[2])
        self.box("door",x,f-.47,1.35,1.26,.12,2.45,DARK)
        self.box("handle",x+.4,f-.57,1.35,.045,.09,.95,LAMP)
        self.box("portal_top",x,f-.55,3.22,3.1,.75,.25,self.palette[3])
        for sign in (-1,1):
            self.box("portal_col",x+sign*1.52,f-.55,1.7,.24,.72,2.8,self.palette[3])
        for j in range(3):
            self.box("step_"+str(j),x,f-1.0-j*.34,.1+j*.12,3.55,.46,.14,GROUND)

    def base(self):
        r=self.random
        w,d,h,f=self.width,self.depth,self.height,self.front
        self.box("site_plinth",0,0,-.18,w+2.6,d+3.5,.36,GROUND)
        shift=r.uniform(.6,1.5)
        self.box("left_ground",-w*.245,.18,h/2,w*.51,d-.8,h,self.palette[0])
        self.box("right_ground",w*.25,-.15,h/2,w*.49,d-.65,h,self.palette[1])
        self.box("upper_a",shift/2,-.65,h*1.5,w*.72,d*.68,h-.08,self.palette[0])
        self.box("upper_b",-shift*.85,1.7,h*1.5,w*.31,d*.48,h-.08,self.palette[1])
        self.box("floating_roof",shift/2,-.7,2*h+.06,w*.76,d*.74,.25,self.palette[3])
        self.box("rear_roof",-shift*.85,1.7,2*h+.19,w*.35,d*.53,.35,self.palette[1])
        self.portal(w*.09)
        self.window_front("living", -w*.29,f-.2,1.55,3.05,2.25,3)
        self.window_front("dining", w*.32,f-.21,1.58,2.65,2.13,3)
        uf=-.65-d*.68/2
        self.window_front("upper_lounge",-.50,uf-.12,4.95,4.15,1.85,4)
        self.window_front("upper_bedroom",w*.28,uf-.11,4.9,2.6,1.84,3)
        self.window_front("rear_ground",0,d/2+.10,1.58,3.45,1.8,4)
        self.window_front("rear_first",-w*.12,d*.48,4.92,2.8,1.85,3)
        self.window_side("left_ground_window",-w/2-.07,-1.4,1.57,2.75,1.65)
        self.window_side("right_ground_window",w/2+.08,1.1,1.58,2.45,1.6)
        self.window_side("left_upper",-w/2-.07,.3,4.9,2.5,1.55)
        self.window_side("right_upper",w/2+.08,-.1,4.9,2.5,1.55)
        # a floating slab and rail define a partially open balcony
        self.box("front_balcony_slab",-w*.15,f-1.02,h+.02,4.4,2.15,.23,self.palette[0])
        self.box("glass_balustrade",-w*.15,f-2.04,h+.72,4.13,.075,1.15,GLASS)
        self.beam("balustrade_top",-w*.15,f-2.08,h+1.27,4.2,.12,.055,DARK)
        self.slats("wood_battens",-w*.47,-w*.35,f-.31,3.6,6.34)
        self.planter("front_left", -w*.42,f-1.0,.03,2.1)
        self.planter("front_right",w*.41,f-1.0,.03,1.25)
        self.planter("rear_planter",w*.2,d/2+.45,.03,1.8)
        for sign in (-1,1):
            self.box("side_feature_"+str(sign),sign*(w/2+.08),d*.2,3.2,.18,2.4,.15,self.palette[2])

    def variant(self):
        w,d,h,f=self.width,self.depth,self.height,self.front
        i=self.index
        if i==0:
            self.box("extra_ribbon",2.2,f-1.0,6.48,8.5,.48,.34,self.palette[0])
            self.box("feature_tower",-w*.44,f-.11,4.05,1.45,.35,8.1,self.palette[3])
            self.slats("horizontal_sunshade",-w*.40,-w*.13,f-.4,4.2,6.25,False,DARK)
        elif i==1:
            self.box("bridge_glass",0,f-1.1,4.95,5.6,.21,2.05,GLASS)
            for zz in (3.84,6.05):
                self.box("bridge_beam",0,f-1.15,zz,6.15,.55,.22,DARK)
            self.box("offset_wing",w*.40,f-.95,5.05,4.6,1.6,2.2,self.palette[1])
        elif i==2:
            self.box("horizon_slab",0,f-.4,6.95,w+2.3,2.2,.19,DARK)
            self.window_front("horizon_window",.25,f-.5,5.56,8.8,.85,7)
            self.slats("horizon_screen",w*.32,w*.47,f-.55,3.85,6.32,True,self.palette[2])
        elif i==3:
            for j,ang in enumerate(np.linspace(0,math.pi/2,15)):
                self.box("curved_shell_"+str(j),-w*.38+1.0*math.cos(ang),f-.5+1.0*math.sin(ang),2.35,.28,.25,4.65,self.palette[0])
            self.slats("curved_wood",-w*.38,-w*.21,f-.62,3.65,6.4)
            for j in range(8):
                self.box("green_column_"+str(j),-w*.03,f-.32,3.65+j*.38,.7,.17,.32,PLANTS)
        elif i==4:
            self.box("terrace_platform",w*.24,f+.2,7.15,8.0,4.65,.25,self.palette[0])
            for j in range(7):
                self.planter("roof_planter_"+str(j),-2.7+j*.95,f-1.23,7.3,.75)
            self.box("terrace_frame", -w*.26,f-.92,5.1,4.5,.8,2.3,self.palette[1])
        elif i==5:
            self.box("pavilion_a",-w*.34,f-.6,5.13,w*.36,2.0,2.6,self.palette[0])
            self.box("pavilion_b",w*.33,f-.72,5.2,w*.32,2.3,2.6,self.palette[1])
            self.slats("courtyard_fins",-1.1,1.2,f-1.05,4.0,6.65,True,self.palette[2])
        elif i==6:
            for j in range(14):
                z=0.42+j*.51
                self.box("diagonal_blade_"+str(j),-w*.39+z*.18,f-1.0,z,.59,.38,.55,self.palette[0])
                self.box("opposite_blade_"+str(j),w*.45-z*.1,f-.66,z,.32,.35,.54,DARK)
            self.slats("blade_louvers",-w*.25,-w*.02,f-.46,3.7,6.4)
        elif i==7:
            self.box("stone_tower",-w*.4,f-.6,4.25,2.2,1.7,8.3,self.palette[3])
            self.window_front("tower_long_window",-w*.4,f-1.52,4.45,1.4,5.65,2)
            self.slats("tower_fins",-w*.51,-w*.3,f-1.58,6.1,8.1)
        elif i==8:
            self.box("carport_top",-w*.26,f-1.2,5.1,w*.55,3.0,2.55,self.palette[0])
            self.box("carport_slab",-w*.26,f-1.65,3.58,w*.55,2.35,.2,DARK)
            for x in (-w*.5,-w*.08):
                self.box("carport_pillar",x,f-2.54,1.75,.25,.25,3.5,DARK)
            self.window_front("carport_glazing",-w*.29,f-2.73,5.1,3.8,1.85,4)
        elif i==9:
            self.box("screen_top",-w*.31,f-1.22,6.53,5.6,.3,.25,DARK)
            self.box("screen_bottom",-w*.31,f-1.22,3.58,5.6,.3,.25,DARK)
            for j,x in enumerate(np.linspace(-w*.49,-w*.12,25)):
                self.box("screen_column_"+str(j),float(x),f-1.25,5.05,.065,.12,2.85,DARK)
            self.slats("screen_fins",w*.28,w*.46,f-.5,3.65,6.48)

    def build(self):
        self.base()
        self.variant()
        # a visible roof pergola keeps the silhouette from being a plain box
        r=self.random
        px=-self.width*.19
        cy=1.1
        z=7.65
        self.box("pergola_front",px,cy-1.35,z,4.1,.17,.18,DARK)
        self.box("pergola_back",px,cy+1.35,z,4.1,.17,.18,DARK)
        for j in range(9):
            self.box("pergola_slats_"+str(j),px-1.85+j*.46,cy,z,.12,2.75,.14,self.palette[2])
        for j,x in enumerate((px-1.93,px+1.93)):
            self.box("pergola_post_"+str(j),x,cy-1.35,7.05,.15,.15,1.2,DARK)

def render_house(design, title, az_deg, el_deg):
    # Orthographic camera: project the SAME model from different directions.
    az,el=np.radians([az_deg,el_deg])
    eye=np.array([math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)])
    right=np.cross(np.array([0,0,1.]),eye)
    right=right/np.linalg.norm(right)
    up=np.cross(eye,right)
    center=np.array([0.,0.,3.55])
    scale=32.5 if el_deg<35 else 37.0
    width,height=1280,960
    image=Image.new("RGB",(width,height),"#edf0f2")
    draw=ImageDraw.Draw(image)
    for y in range(height):
        k=y/height
        draw.line((0,y,width,y),fill=(int(241-23*k),int(245-25*k),int(246-27*k)))
    faces=[]
    light=np.array([-.55,-.62,.58]);light/=np.linalg.norm(light)
    for verts,polys,color in design.parts:
        for ids in polys:
            pts=verts[list(ids)]
            normal=np.cross(pts[1]-pts[0],pts[2]-pts[0])
            norm=np.linalg.norm(normal)
            if norm<1e-9: continue
            normal=normal/norm
            # render only forward-facing polygon surfaces
            if np.dot(normal,eye) <= 0: continue
            uv=[]
            for pt in pts:
                delta=pt-center
                uv.append((width/2+np.dot(delta,right)*width/scale,
                           height*.55-np.dot(delta,up)*width/scale))
            brightness=.70+.32*max(0,float(np.dot(normal,light)))
            if np.dot(normal,np.array([0.,0.,1.]))>.9:
                brightness=min(1.15,brightness+.16)
            faces.append((float(np.dot(pts.mean(axis=0),eye)),uv,mix(color,brightness)))
    faces.sort(key=lambda item:item[0])
    for depth,poly,color in faces:
        draw.polygon(poly,fill=color,outline=mix(color,.85),width=1)
    draw.rounded_rectangle((25,24,548,124),radius=14,fill="#1a2832")
    try:
        font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",24)
        small=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",17)
    except OSError:
        font=small=ImageFont.load_default()
    draw.text((46,41),design.did+"  |  "+design.name,fill="white",font=font)
    draw.text((46,85),"SEED "+str(design.seed)+"  /  "+title[3:].replace("_"," ").upper(),fill="#c9dbe2",font=small)
    draw.text((1010,920),"FORMSTEAD  |  3D",fill="#53646d",font=small)
    return image

def make_sheet(design, images):
    sheet=Image.new("RGB",(1440,2720),"#f3f4f5")
    d=ImageDraw.Draw(sheet)
    d.text((30,18),design.did+" | "+design.name+" | "+str(design.seed),fill="#172c35")
    for j,im in enumerate(images):
        thumb=im.copy()
        thumb.thumbnail((688,505))
        sheet.paste(thumb,(28+(j%2)*710,70+(j//2)*525))
    sheet.save(SHEETS/(design.did+"_contact_sheet.jpg"),quality=88)

def main():
    manifest=[]
    for index,(did,name,seed,description) in enumerate(DESIGNS):
        d=Design(index,did,name,seed,description)
        d.build()
        modelname=did+"_"+name.lower().replace(" ","_")+".glb"
        (MODELS/modelname).write_bytes(d.scene.export(file_type="glb"))
        views=[]
        thumbs=[]
        for viewname,az,el in CAMS:
            image=render_house(d,viewname,az,el)
            filename=did+"_"+str(seed)+"_"+viewname+".jpg"
            image.save(IMAGES/filename,quality=91,optimize=True)
            views.append(filename)
            thumbs.append(image)
        make_sheet(d,thumbs)
        prompt=("Create an asymmetric modern residential facade based on seed "+str(seed)+
                " ("+name+"). "+description+
                ". Use offset volumes, framed glazing, deep balcony shadows, roof details, "
                "timber and stone, without altering approved plot dimensions or openings. "
                "Build one real 3D scene and render every camera from the same scene.")
        manifest.append(dict(id=did,design=name,seed=seed,description=description,
            dimensions_m=dict(width=round(d.width,2),depth=round(d.depth,2),
                floor_height=d.height),camera_views=views,
            model="glb_models_10/"+modelname,prompt=prompt))
        print("Generated",did,":",len(views),"views and",modelname,flush=True)
    meta=dict(version="1.0",generator="deterministic Formstead procedural meshes",
        total_images=100,total_models=10,units="meters",designs=manifest)
    (ROOT/"design_seeds_manifest.json").write_text(json.dumps(meta,indent=2),encoding="utf-8")
    prompts="# Formstead facade seed prompts\n\n"
    prompts+="Seeds reproduce geometry using this generator, not diffusion image models.\n\n"
    for item in manifest:
        prompts+="## "+item["id"]+" "+item["design"]+" (seed "+str(item["seed"])+")\n\n"+item["prompt"]+"\n\n"
    (ROOT/"FORMSTEAD_DESIGN_PROMPTS.md").write_text(prompts,encoding="utf-8")
    print("Completed: 100 images, 10 GLB models, 10 contact sheets.",flush=True)

if __name__=="__main__":
    main()
