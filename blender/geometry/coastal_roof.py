"""Continuous hip-roof surface over canonical roof regions, with real voids.
All coordinates are input millimetres. No room-sized cap placement is inferred.
"""
import math
from collections import Counter


def roof_mesh(roof):
    regions=roof['regions']
    if not regions: raise ValueError('Continuous roof has no source regions')
    bounds=roof['bounds'];x0,y0=bounds['x'],bounds['y'];x1,y1=x0+bounds['w'],y0+bounds['h']
    thickness=roof['thicknessMm'];rise=roof['heightMm']-thickness
    if min(bounds['w'],bounds['h'],thickness,rise)<=0: raise ValueError('Invalid continuous roof dimensions')
    slope=min(math.tan(math.radians(roof['pitchDeg'])),rise/(min(bounds['w'],bounds['h'])/2))
    planes=[(slope,0,-slope*x0),(-slope,0,slope*x1),(0,slope,-slope*y0),(0,-slope,slope*y1)]
    xs=sorted({v for r in regions for v in (r['x'],r['x']+r['w'])})
    ys=sorted({v for r in regions for v in (r['y'],r['y']+r['h'])})
    vertices=[];faces=[];index={}
    def vertex(x,y,z):
        key=tuple(round(v,6) for v in (x,y,z))
        if key not in index: index[key]=len(vertices);vertices.append(key)
        return index[key]
    def clip(poly,a,b,c):
        out=[]
        for p,q in zip(poly,poly[1:]+poly[:1]):
            fp=a*p[0]+b*p[1]+c;fq=a*q[0]+b*q[1]+c
            if fp<=1e-7:out.append(p)
            if (fp < -1e-7 and fq > 1e-7) or (fp > 1e-7 and fq < -1e-7):
                ratio=fp/(fp-fq);out.append((p[0]+ratio*(q[0]-p[0]),p[1]+ratio*(q[1]-p[1])))
        return out
    for xa,xb in zip(xs,xs[1:]):
        for ya,yb in zip(ys,ys[1:]):
            cx,cy=(xa+xb)/2,(ya+yb)/2
            if not any(r['x']<cx<r['x']+r['w'] and r['y']<cy<r['y']+r['h'] for r in regions):continue
            for plane in planes:
                poly=[(xa,ya),(xb,ya),(xb,yb),(xa,yb)]
                for other in planes:
                    if other==plane:continue
                    poly=clip(poly,*(a-b for a,b in zip(plane,other)))
                    if len(poly)<3:break
                if len(poly)<3:continue
                area=abs(sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1])))/2
                if area<.001:continue
                face=[]
                for x,y in poly:
                    z=roof['elevationMm']+thickness+plane[0]*x+plane[1]*y+plane[2]
                    i=vertex(x,y,z)
                    if not face or face[-1]!=i:face.append(i)
                if face[0]==face[-1]:face.pop()
                if len(face)>=3:faces.append(face)
    # Matching lower skin and perimeter fascia, including shaft/courtyard edges.
    top_count=len(vertices);top_faces=list(faces)
    vertices.extend((x,y,z-thickness) for x,y,z in vertices[:top_count])
    faces.extend([i+top_count for i in reversed(face)] for face in top_faces)
    edges=Counter(tuple(sorted((a,b))) for f in top_faces for a,b in zip(f,f[1:]+f[:1]))
    for f in top_faces:
        for a,b in zip(f,f[1:]+f[:1]):
            if edges[tuple(sorted((a,b)))]==1:faces.append([a,a+top_count,b+top_count,b])
    return vertices,faces


def create_coastal_roof(scene,roof):
    import bpy
    import bmesh
    vertices,faces=roof_mesh(roof)
    mesh=bpy.data.meshes.new('CoastalRoofSurface')
    mesh.from_pydata([tuple(v*.001 for v in p) for p in vertices],[],faces)
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
    mesh.materials.append(scene.materials.get('roof',scene.materials['stone']))
    obj=bpy.data.objects.new('Coastal_Continuous_Hip_Roof',mesh)
    scene.collections['MASSING'].objects.link(obj)
    obj['source_id']=roof['sourceFloorId'];obj['source_plan_id']=scene.plan_id;obj['roof_revision']=roof['revision']
    return obj
