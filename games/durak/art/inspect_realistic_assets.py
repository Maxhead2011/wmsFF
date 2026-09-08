"""Read-only imported fighter contract. Run through UE Python commandlet; no asset saves."""
import json
from collections import Counter
from pathlib import Path
import unreal

registry = unreal.AssetRegistryHelpers.get_asset_registry()
report = {}
for hero in ['Kwang', 'Countess']:
    root = '/Game/Paragon' + hero
    registry.scan_paths_synchronous([root], force_rescan=True)
    assets = list(registry.get_assets_by_path(root, recursive=True) or [])
    classes = Counter(str(a.asset_class_path.asset_name) for a in assets)
    # TEST: a finished download must contain actual skinned characters and animation clips.
    assert classes['SkeletalMesh'] > 0, (hero, 'missing skeletal mesh')
    assert classes['AnimSequence'] > 0, (hero, 'missing animations')
    meshes = []
    for data in assets:
        if str(data.asset_class_path.asset_name) != 'SkeletalMesh':
            continue
        mesh = data.get_asset()
        assert isinstance(mesh, unreal.SkeletalMesh), str(data.package_name)
        skeleton = mesh.get_editor_property('skeleton')
        assert skeleton, mesh.get_path_name()
        component = unreal.SkeletalMeshComponent()
        component.set_skeletal_mesh(mesh)
        bones = [str(component.get_bone_name(i)) for i in range(component.get_num_bones())]
        slots = mesh.get_editor_property('materials')
        materials = []
        for slot in slots:
            material = slot.get_editor_property('material_interface')
            assert material, (mesh.get_name(), 'missing material')
            materials.append(material.get_path_name())
        bounds = mesh.get_imported_bounds()
        meshes.append(dict(path=mesh.get_path_name(), skeleton=skeleton.get_path_name(),
            bones=bones, material_paths=materials,
            bounds_origin_cm=[bounds.origin.x, bounds.origin.y, bounds.origin.z],
            bounds_extent_cm=[bounds.box_extent.x, bounds.box_extent.y, bounds.box_extent.z]))
    animation_data = [a for a in assets if str(a.asset_class_path.asset_name) == 'AnimSequence']
    clips = []
    skeleton_paths = {m['skeleton'] for m in meshes}
    for data in animation_data:
        name = str(data.asset_name)
        if name not in ['Idle_Pose', 'Idle_Relaxed', 'Death', 'Hitreact_Fwd', 'Primary_Attack_Normal']:
            continue
        clip = data.get_asset()
        skeleton = clip.get_editor_property('skeleton')
        assert skeleton and skeleton.get_path_name() in skeleton_paths, (hero, name, 'incompatible skeleton')
        length = clip.get_play_length()
        assert length > 0, (hero, name, 'empty animation')
        clips.append(dict(name=name, path=clip.get_path_name(), seconds=length, skeleton=skeleton.get_path_name()))
    report[hero] = dict(asset_classes=dict(classes), meshes=meshes, checked_clips=clips,
        animation_paths=[str(a.package_name) for a in animation_data])
    print('REALISTIC_ASSET_CHECK', hero, dict(classes), 'checked_clips', len(clips))

output = Path(unreal.Paths.project_saved_dir()) / 'realistic-asset-inspection.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('REALISTIC_ASSET_INSPECTION_OK', str(output))
