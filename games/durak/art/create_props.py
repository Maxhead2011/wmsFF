"""Reproducible original Blender prototype props; centimeters, Z up, +X forward."""
import bpy
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'output'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 0.01

def mesh(name, vertices, faces):
    data=bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    return obj

# Hollow twelve-point royal crown: not a solid cone or billboard.
n=48
verts=[]
for radius,top in [(16,False),(16,True),(13.5,False),(13.5,True)]:
    for i in range(n):
        angle=2*math.pi*i/n
        height=(15 if i%4==0 else 6) if top else 0
        verts.append((radius*math.cos(angle),radius*math.sin(angle),height))
faces=[]
for i in range(n):
    j=(i+1)%n
    faces += [(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
              (n+i,n+j,3*n+j,3*n+i),(i,2*n+i,2*n+j,j)]
crown=mesh('Crown',verts,faces)

# Broad faceted blade with crossguard and grip, modeled as connected pieces.
verts=[(-4,-1.2,0),(4,-1.2,0),(4,1.2,0),(-4,1.2,0),
       (-3,-.8,61),(3,-.8,61),(3,.8,61),(-3,.8,61),(0,0,76)]
faces=[(0,1,2,3),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0),
       (4,8,5),(5,8,6),(6,8,7),(7,8,4)]
sword=mesh('Sword',verts,faces)
parts=[sword]
for position,scale in [((0,0,-1),(14,2,2)),((0,0,-10),(2,2,9)),((0,0,-20),(3.5,3.5,2))]:
    bpy.ops.mesh.primitive_cube_add(size=2,location=position)
    obj=bpy.context.object
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    parts.append(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=sword
bpy.ops.object.join()

for obj in [crown,sword]:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bevel=obj.modifiers.new('Forged edges','BEVEL')
    bevel.width=.45
    bevel.segments=3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'RoyalProps.blend'))
    bpy.ops.export_scene.fbx(filepath=str(OUT/f'{obj.name}.fbx'),use_selection=True,
        object_types={'MESH'},add_leaf_bones=False,bake_anim=False,axis_forward='-Y',axis_up='Z',
        apply_unit_scale=True,mesh_smooth_type='FACE')
    bounds=[tuple(round(v,3) for v in corner) for corner in obj.bound_box]
    print('DURAK_PROP',obj.name,'dimensions_cm',tuple(round(v,3) for v in obj.dimensions),'bounds',bounds)
print('DURAK_BLENDER_PROPS_READY')
