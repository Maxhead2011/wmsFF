"""Original segmented plate armor. Run with Blender --background --python.

FIX: explicit centimeter pivots for the existing UE contact rig. No downloaded art.
This is hard-surface armor, not a skinned human or a cloth simulation.
"""
import bpy
import json
import math
import random
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'output' / 'heroes'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = .01
PALETTE = {
    'Graphite': ((.055,.075,.10),.82,.4),
    'Silver': ((.52,.60,.66),.85,.35),
    'Ivory': ((.75,.71,.59),.52,.43),
    'Bronze': ((.43,.25,.09),.80,.4),
    'Leather': ((.025,.014,.012),0,.9),
    'Wine': ((.15,.009,.023),0,.87),
    'Midnight': ((.018,.042,.072),0,.9),
    'Ruby': ((.42,.005,.014),.45,.19),
}
MATS={}
for name,(color,metal,rough) in PALETTE.items():
    mat=bpy.data.materials.new(name); mat.diffuse_color=(*color,1); mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Metallic'].default_value=metal; bsdf.inputs['Roughness'].default_value=rough
    MATS[name]=mat

parts=[]
assets=[]
def mesh(name,vertices,faces,material,bevel=.22):
    data=bpy.data.meshes.new(name); data.from_pydata(vertices,[],faces); data.update()
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[material])
    bpy.context.view_layer.objects.active=obj; obj.select_set(True)
    if bevel:
        mod=obj.modifiers.new('Forged edge','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False); parts.append(obj); return obj

def loft(rings,material,n=16,offset=(0,0,0),bevel=.22):
    # Cross-sections (z, front/back radius, width, forward offset).
    vertices=[]
    for z,depth,width,cx in rings:
        for i in range(n):
            a=2*math.pi*i/n
            vertices.append((offset[0]+cx+depth*math.cos(a),offset[1]+width*math.sin(a),offset[2]+z))
    faces=[tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))]
    for r in range(len(rings)-1):
        for i in range(n):
            j=(i+1)%n; faces.append((r*n+i,r*n+j,(r+1)*n+j,(r+1)*n+i))
    return mesh('plate',vertices,faces,material,bevel)

def box(center,size,material,bevel=.25):
    x,y,z=center; a,b,c=(v/2 for v in size)
    return mesh('block',[(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in
        [(-1,-1,-1),(-1,1,-1),(1,1,-1),(1,-1,-1),(-1,-1,1),(-1,1,1),(1,1,1),(1,-1,1)]],
        [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,bevel)

def badge(x,y,z,width,height,material):
    return mesh('lozenge',[(x,y-width,z),(x,y,z+height),(x,y+width,z),(x,y,z-height),(x+2,y,z)],
        [(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],material,.12)

def finish(name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts: obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join()
    obj=bpy.context.object; obj.name=name
    bpy.context.scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    # Recalculate winding before export; procedural caps must not become invisible in UE.
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    # FIX: smooth armor cross-sections, weight broad plate normals over tiny bevel faces.
    for polygon in obj.data.polygons: polygon.use_smooth=True
    normals=obj.modifiers.new('Plate normals','WEIGHTED_NORMAL'); normals.keep_sharp=True; normals.weight=50
    bpy.ops.object.modifier_apply(modifier=normals.name)
    obj.data.calc_loop_triangles()
    vertices=[v.co for v in obj.data.vertices]
    assets.append({'name':name,'min':[min(v[i] for v in vertices) for i in range(3)],
        'max':[max(v[i] for v in vertices) for i in range(3)],'scale':list(obj.scale),
        'triangles':len(obj.data.loop_triangles),'materials':[m.name for m in obj.data.materials]})
    bpy.ops.export_scene.fbx(filepath=str(OUT/f'{name}.fbx'),use_selection=True,
        object_types={'MESH'},add_leaf_bones=False,bake_anim=False,axis_forward='-Y',axis_up='Z',
        apply_unit_scale=True,mesh_smooth_type='FACE')
    obj.select_set(False); parts.clear()

for hero in ['J','Q']:
    queen=hero=='Q'; armor='Ivory' if queen else 'Graphite'; trim='Silver' if queen else 'Bronze'
    cloth='Midnight' if queen else 'Wine'; broad=.84 if queen else 1
    # Cuirass: shaped waist, ridged breast, neck opening and overlapping faulds.
    loft([(70,10,15*broad,0),(85,12,16*broad,0),(103,17,24*broad,0),
          (116,15,23*broad,-1),(125,9,12,0)],armor)
    loft([(123,10,12,0),(127,10,12,0)],trim)
    for z in [72,79,86]:
        loft([(z-3,11+(86-z)*.15,(18+(86-z)*.25)*broad,0),
              (z+2,11,(17+(86-z)*.25)*broad,0)],armor)
        loft([(z-3,11.2+(86-z)*.15,(18.2+(86-z)*.25)*broad,0),
              (z-1.5,11.2+(86-z)*.15,(18.2+(86-z)*.25)*broad,0)],trim)
    box((12,0,87),(3,35*broad,4),'Leather')
    box((14,0,87),(3,8,6),trim)
    badge(18,0,110,6 if queen else 8,12,trim); badge(20.2,0,110,3,6,'Ruby')
    for side in [-1,1]:
        for z in [96,103,110]: badge(14,side*16*broad,z,1,1.4,trim)
        box((9,side*12,64),(10,12,18),armor)
        box((14.2,side*12,62),(1.5,10,1.5),trim)
    finish(hero+'_Torso')

    # Closed angular helmet, recessed visor slit, cheek guards, distinct crest/diadem.
    loft([(-13,9,10,0),(-3,14,13,0),(7,14,13,0),(18,9,10,-2),(23,2,3,-4)],armor)
    box((13.8,0,5),(2,22,2.5),'Leather',.1)
    box((15,0,8),(3,24,2),trim)
    mesh('visor',[(13,-12,2),(18,0,4),(13,12,2),(10,-10,-12),(15,0,-15),(10,10,-12)],
         [(0,3,4,1),(1,4,5,2),(0,1,2),(3,5,4),(0,2,5,3)],armor,.4)
    for side in [-1,1]:
        for i in range(3): box((14.7,side*(4+i*2.4),-4),(1,1,5),'Leather',.08)
    if queen:
        for y in [-10,-5,0,5,10]:
            badge(10,y,18,2,12-abs(y)*.5,trim)
        badge(12,0,20,2,4,'Ruby')
    else:
        mesh('crest',[(-12,-2,17),(8,-2,21),(-3,-2,39),(-18,-2,33),
                      (-12,2,17),(8,2,21),(-3,2,39),(-18,2,33)],
             [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],cloth,.4)
        box((-3,0,24),(18,5,2),trim)
    finish(hero+'_Head')

    # Layered shoulder plates, no spherical pauldrons.
    for i in range(3):
        z=5-i*5
        loft([(z-3,12-i,15-i,0),(z+2,13-i,16-i,0),(z+6,9-i,11-i,0)],armor)
        loft([(z-3,12.2-i,15.2-i,0),(z-1.6,12.2-i,15.2-i,0)],trim)
    finish(hero+'_Pauldron')

    for name,length,r1,r2 in [('UpperArm',28,7.4,6),('Forearm',28,8,5.6),('Thigh',34,10,7.5),('Shin',34,8,5.2)]:
        loft([(-length/2+1,r1,r1,0),(0,r1+1,r1*.92,0),(length/2-1,r2,r2,0)],armor)
        for z,rad in [(-length/2+2,r1),(length/2-3,r2+.6)]:
            loft([(z-1,rad+.5,rad+.5,0),(z+1,rad+.5,rad+.5,0)],trim)
        # Long forged ridge catches neutral highlights instead of mirror-like cylinders.
        mesh('ridge',[(r1,0,-length*.3),(r1+2,0,0),(r2,0,length*.3),
                       (r1,-2,0),(r1,2,0)],[(0,3,1),(3,2,1),(2,4,1),(4,0,1),(0,4,2,3)],trim,.15)
        finish(hero+'_'+name)

    loft([(-5,5,6,0),(0,7,8,0),(5,5,6,0)],'Leather')
    badge(7,0,0,7,8,trim); finish(hero+'_Joint')
    box((0,0,0),(10,11,12),'Leather',1.2)
    box((4,0,1),(3,12,10),armor,.8)
    for y in [-4.2,-1.4,1.4,4.2]: box((3,y,-5),(8,2.3,3.5),trim,.5)
    finish(hero+'_Glove')

    box((3,0,-4),(27,14,4),'Leather',.7)
    for i in range(5):
        x=-6+i*4.5
        box((x,0,-.5),(6,14-i*.7,7-i*.6),armor,.7)
        box((x+2,0,.8-i*.3),(1,12-i*.7,1),trim,.2)
    loft([(0,5,6,-4),(8,5,6,-4)],armor)
    finish(hero+'_Boot')

    # Sewn pleated cape: fixed shoulder attachment, explicit animated root in UE.
    vertices=[]; rows=16; cols=20; length=84 if queen else 58
    for r in range(rows+1):
        t=r/rows
        for c in range(cols+1):
            u=c/cols*2-1
            vertices.append((-12-15*t+math.cos(u*math.pi*5)*(1+3*t),
                             u*(17+12*t),-length*t+math.cos(u*math.pi*5)*1.4*t))
    faces=[]
    for r in range(rows):
        for c in range(cols):
            a=r*(cols+1)+c; faces.append((a,a+1,a+cols+2,a+cols+1))
    cape=mesh('pleated fabric',vertices,faces,cloth,0)
    bpy.context.view_layer.objects.active=cape
    solid=cape.modifiers.new('Woven thickness','SOLIDIFY'); solid.thickness=.35
    bpy.ops.object.modifier_apply(modifier=solid.name)
    # contrasting lower embroidered hem, real geometry follows the pleats
    hemverts=[(x-.3,y,z+.25) for x,y,z in vertices[-2*(cols+1):]]
    mesh('embroidered hem',hemverts,[(c,c+1,c+cols+2,c+cols+1) for c in range(cols)],trim,0)
    finish(hero+'_Cape')

    # Heraldic heater shield, face normal +X. Contact remains at its center.
    outline=[(-19,23),(19,23),(21,5),(14,-14),(0,-29),(-14,-14),(-21,5)]
    def shield(scale,x,material):
        v=[(x,y*scale,z*scale) for y,z in outline]+[(x+3,0,0)]
        n=len(outline); mesh('heater',v,[(i,(i+1)%n,n) for i in range(n)]+[tuple(reversed(range(n)))],material,.2)
    shield(1,0,trim); shield(.9,1,armor)
    badge(5,0,0,8,16,trim); badge(7.2,0,0,4,10,cloth)
    for y,z in outline: badge(2,y*.93,z*.93,.8,1,trim)
    finish(hero+'_Shield')

    # FIX: distinct original swords share the verified grip=-10 / tip=73.7272 cm contract.
    width=2.4 if queen else 4.1
    vertices=[(-width,0,1),(0,-1,1),(width,0,1),(0,1,1),
              (-width*.72,0,58),(0,-.7,58),(width*.72,0,58),(0,.7,58),(0,0,73.7272)]
    mesh('diamond section blade',vertices,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),
        (4,5,8),(5,6,8),(6,7,8),(7,4,8)],'Silver',0)
    # Dark recessed fuller on both sides, small heraldic lozenge at the ricasso.
    for side in [-1,1]:
        box((0,side*1.015,27),(.48,.08,39),'Graphite',.02)
    loft([(-19,2,2,0),(-3,2,2,0)],'Leather',12)
    for z in [-18,-15,-12,-9,-6,-3]: loft([(z,2.25,2.25,0),(z+.45,2.25,2.25,0)],trim,12)
    loft([(-23,1.5,1.5,0),(-21,4,3,0),(-18.8,2,2,0)],trim,12)
    loft([(-2,14,2,0),(0,15,2.5,0),(2,12,2,0)],trim,16)
    badge(3,0,-21,1.4,1.8,'Ruby')
    if queen:
        # Swept knuckle guard arcs from the quillon toward the pommel.
        ring_vertices=[]; ring_faces=[]; steps=20; sides=8
        for j in range(steps+1):
            a=math.pi*j/steps
            cx=3+10*math.sin(a); cz=-1-18*j/steps
            for k in range(sides):
                b=2*math.pi*k/sides
                ring_vertices.append((cx+.8*math.cos(b),.8*math.sin(b),cz))
        for j in range(steps):
            for k in range(sides):
                n=(k+1)%sides; ring_faces.append((j*sides+k,j*sides+n,(j+1)*sides+n,(j+1)*sides+k))
        mesh('swept guard',ring_vertices,ring_faces,trim,.12)
    else:
        for x in [-13,13]: box((x,0,1.2),(3.5,4.5,5),trim,.6)
    finish(hero+'_Sword')

# Keep original pivoted pieces at origin in the authored library; assembly is in UE.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'JackQueen.blend'))
(OUT/'manifest.json').write_text(json.dumps({'unit':'cm','forward':'+X','rig':'segmented UE IK, no armature',
    'palette':PALETTE,'assets':assets},indent=2),encoding='utf-8')

# Original short Foley-like procedural cues, normalized once, with silent edges.
rng=random.Random(4107); rate=44100
for name,duration in [('Whoosh',.32),('Clash',.65),('Impact',.48),('Resolve',1.3)]:
    samples=[]; previous=0
    for i in range(int(rate*duration)):
        t=i/rate; noise=rng.uniform(-1,1); previous=.72*previous+.28*noise
        if name=='Whoosh': value=(noise-previous)*math.sin(math.pi*t/duration)**2*.7
        elif name=='Clash': value=sum(math.sin(2*math.pi*f*t)*math.exp(-t*d) for f,d in [(1437,12),(2173,9),(3187,16),(4619,23)])*.17 + noise*.2*math.exp(-t*70)
        elif name=='Impact': value=math.sin(2*math.pi*(95*t-45*t*t))*math.exp(-t*13)*.8 + previous*.6*math.exp(-t*20)
        else: value=sum(math.sin(2*math.pi*f*t)*math.exp(-t*3.7)*.16 for f in [523.25,659.25,783.99,1046.5])
        fade=min(1,t/.004,(duration-t)/.025); samples.append(value*max(0,fade))
    peak=max(abs(v) for v in samples)
    with wave.open(str(OUT/f'{name}.wav'),'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate)
        wav.writeframes(b''.join(struct.pack('<h',int(v/peak*24000)) for v in samples))
print('DURAK_HERO_ASSETS_READY',len(assets),'meshes',sum(a['triangles'] for a in assets),'triangles')
