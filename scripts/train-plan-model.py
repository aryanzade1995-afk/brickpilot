"""Train a small conditional footprint/anchor model from the user's ResPlan archive.
No dataset code is executed. Pickle globals are explicitly allowlisted.
Python dependencies are offline training tools only: numpy, shapely, networkx.
"""
import argparse
import hashlib
import io
import json
import pickle
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'output/ml-python'))
import numpy as np
import networkx as nx
from networkx.classes import reportviews, coreviews
from shapely import from_wkb
from shapely.ops import unary_union
from shapely import affinity


class RestrictedPlans(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {
            ('shapely.io', 'from_wkb'): from_wkb,
            ('numpy._core.multiarray', 'scalar'): np._core.multiarray.scalar,
            ('numpy.core.multiarray', 'scalar'): np._core.multiarray.scalar,
            ('numpy', 'dtype'): np.dtype,
            ('networkx.classes.graph', 'Graph'): nx.Graph,
            ('networkx.classes.coreviews', 'AdjacencyView'): coreviews.AdjacencyView,
            **{('networkx.classes.reportviews', n): getattr(reportviews, n)
               for n in ('NodeView', 'EdgeView', 'DegreeView')},
        }
        if (module, name) not in allowed:
            raise ValueError(f'Unsupported pickle class: {module}.{name}')
        return allowed[module, name]


def parts(g):
    if g is None or getattr(g, 'is_empty', True):
        return []
    return list(g.geoms) if hasattr(g, 'geoms') else [g]


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    with zipfile.ZipFile(args.archive) as archive:
        payload = archive.read('ResPlan.pkl')
        plans = RestrictedPlans(io.BytesIO(payload)).load()
        splits = json.loads(archive.read('split.json'))
        licence = archive.read('LICENSE').decode()
    if args.inspect:
        print(len(plans), list(plans[0]))
        for k,v in plans[0].items():
            print(k, str(v)[:100])
        return
    rows = []
    seen = set()
    # Deduplicate quantized, normalized shape + semantic anchors before splitting.
    # Canonical augmented plans are excluded entirely.
    aug = set(splits.get('augmented', []))
    train = set(splits['train'])
    val = set(splits['val'])
    test = set(splits['test'])
    dropped = 0
    for p in plans:
        if p['id'] in aug:
            continue
        rooms = {k:parts(p.get(k)) for k in ('bedroom','bathroom','kitchen','living','balcony','corridor')}
        polygons = [g for key,gs in rooms.items() if key!='balcony' for g in gs]
        polygons += parts(p.get('wall')) + parts(p.get('inner'))
        if not polygons:
            dropped += 1
            continue
        shape = unary_union([g if g.is_valid else g.buffer(0) for g in polygons])
        x,y,x1,y1 = shape.bounds
        w,h = x1-x,y1-y
        area = float(p.get('net_area',0))
        if w <= 0 or h <= 0 or not np.isfinite(area) or not 20 < area < 1000:
            dropped += 1
            continue
        # Some archive coordinates are image-scale. Learn normalized geometry;
        # area comes from recorded net_area, never from unverified polygon units.
        door = p.get('front_door')
        angle = 0
        if door is not None and not door.is_empty:
            c = door.centroid
            side = min([(abs(c.y-y)/h,180),(abs(c.y-y1)/h,0),
                        (abs(c.x-x)/w,-90),(abs(c.x-x1)/w,90)])[1]
            angle=side
        if angle:
            origin=shape.centroid
            shape=affinity.rotate(shape,angle,origin=origin)
            rooms={k:[affinity.rotate(g,angle,origin=origin) for g in gs] for k,gs in rooms.items()}
            x,y,x1,y1=shape.bounds;w,h=x1-x,y1-y
        def centre(key):
            if not rooms[key]: return [.5,.5]
            c = unary_union(rooms[key]).centroid
            return [(c.x-x)/w, (c.y-y)/h]
        fill = min(1.,shape.area/(w*h))
        from shapely.geometry import Point
        mask = [int(shape.covers(Point(x+(gx+.5)*w/12,y+(gy+.5)*h/12)))
                for gy in range(12) for gx in range(12)]
        living, kitchen = centre('living'), centre('kitchen')
        signature = tuple(mask)+tuple(round(n*12) for n in living+kitchen)+tuple(len(rooms[k]) for k in ('bedroom','bathroom'))
        if signature in seen: continue
        seen.add(signature)
        aspect = np.clip(w/h,.25,4.)
        # Units documented in the runtime feature encoder.
        features = [min(len(rooms['bedroom']),8)/8, min(len(rooms['bathroom']),8)/8,
                    min(area,600)/600, np.log(aspect)/np.log(4)]
        targets = [fill, *living, *kitchen]
        split = 'train' if p['id'] in train else 'validation' if p['id'] in val else 'test' if p['id'] in test else None
        if not split: continue
        holes = sum(len(g.interiors) for g in parts(shape) if g.geom_type=='Polygon')
        family = 'courtyard' if holes and fill<.85 else 'rectangular' if fill>.92 else 'l-shape' if fill<.78 else 'stepped'
        rows.append(dict(id=int(p['id']),split=split,features=features,targets=targets,aspect=float(aspect),
                         family=family,mask=mask,signature=hashlib.sha256(str(signature).encode()).hexdigest()))
    tr = [r for r in rows if r['split']=='train']
    X=np.array([r['features'] for r in tr]); Y=np.array([r['targets'] for r in tr])
    mean=X.mean(axis=0); scale=np.maximum(X.std(axis=0),.01)
    A=np.column_stack([np.ones(len(X)),(X-mean)/scale])
    # Validation selects ridge regularization. Test remains unused until final metrics.
    candidates=[]
    for alpha in (.1,1.,10.,100.):
        penalty=np.eye(5)*alpha;penalty[0,0]=0
        weights=np.linalg.solve(A.T@A+penalty,A.T@Y)
        vr=[r for r in rows if r['split']=='validation']
        vx=np.array([r['features'] for r in vr]); vy=np.array([r['targets'] for r in vr])
        va=np.column_stack([np.ones(len(vx)),(vx-mean)/scale])
        candidates.append((float(np.mean((va@weights-vy)**2)),alpha,weights))
    mse,alpha,weights=min(candidates,key=lambda c:c[0])
    metrics={}
    baseline=Y.mean(axis=0)
    for split in ('validation','test'):
        rs=[r for r in rows if r['split']==split]
        sx=np.array([r['features'] for r in rs]); sy=np.array([r['targets'] for r in rs])
        predicted=np.column_stack([np.ones(len(sx)),(sx-mean)/scale])@weights
        metrics[split]={'count':len(rs),'modelMSE':float(np.mean((predicted-sy)**2)),
                       'meanBaselineMSE':float(np.mean((baseline-sy)**2))}
    # A balanced, bounded training-only retrieval memory; raw full plans never ship.
    memory=[]
    for family in ('rectangular','stepped','l-shape','courtyard'):
        group=[r for r in tr if r['family']==family]
        group.sort(key=lambda r:r['signature'])
        indices=np.linspace(0,len(group)-1,min(48,len(group)),dtype=int) if group else []
        memory.extend(group[i] for i in indices)
    model={'version':'resplan-ridge-retrieval-v1','method':'conditional-ridge + seeded-nearest-exemplar',
           'source':'ResPlan','sourceUrl':'https://github.com/m-agour/ResPlan','licence':'CC BY 4.0',
           'archiveSha256':hashlib.sha256(Path(args.archive).read_bytes()).hexdigest(),
           'featureNames':['bedrooms/8','bathrooms/8','enclosedAreaM2/600','logAspect/log4'],
           'targetNames':['fill','livingX','livingY','kitchenX','kitchenY'],
           'mean':mean.tolist(),'scale':scale.tolist(),'weights':weights.tolist(),'alpha':alpha,
           'trainingCount':len(tr),'metrics':metrics,
           'exemplars':[{k:v for k,v in r.items() if k not in ('split','signature')} for r in memory]}
    output=ROOT/'src/lib/engine/planner/ml/data';output.mkdir(parents=True,exist_ok=True)
    (output/'plan-model.json').write_text(json.dumps(model,separators=(',',':')),encoding='utf-8')
    (output/'LICENSE-ResPlan.txt').write_text(licence,encoding='utf-8')
    report={'accepted':len(rows),'training':len(tr),'dropped':dropped,'exemplars':len(memory),
            'canonicalAugmentedExcluded':len(aug),'metrics':metrics,'alpha':alpha,
            'limits':'Single-floor source; geometric family labels are derived heuristics, not architectural ground truth. Similarity dedup uses normalized 12x12 occupancy and semantic anchors; it does not certify absence of all near duplicates.'}
    out=ROOT/'output/ml-review';out.mkdir(parents=True,exist_ok=True)
    (out/'training-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    run()
