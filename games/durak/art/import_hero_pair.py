"""Import only the isolated /Game/Heroes library. Run in UE Python commandlet."""
import json
from pathlib import Path
import unreal

root=Path(__file__).resolve().parent/'output'/'heroes'
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
tools=unreal.AssetToolsHelpers.get_asset_tools()
library=unreal.EditorAssetLibrary
materials={}
for name,(color,metal,rough) in manifest['palette'].items():
    path='/Game/Heroes/Materials/M_'+name
    mat=library.load_asset(path) if library.does_asset_exist(path) else tools.create_asset(
        'M_'+name,'/Game/Heroes/Materials',unreal.Material,unreal.MaterialFactoryNew())
    unreal.MaterialEditingLibrary.delete_all_material_expressions(mat)
    node=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant3Vector)
    node.set_editor_property('constant',unreal.LinearColor(*color,1))
    unreal.MaterialEditingLibrary.connect_material_property(node,'',unreal.MaterialProperty.MP_BASE_COLOR)
    for value,prop in [(metal,unreal.MaterialProperty.MP_METALLIC),(rough,unreal.MaterialProperty.MP_ROUGHNESS)]:
        scalar=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant)
        scalar.set_editor_property('r',value)
        unreal.MaterialEditingLibrary.connect_material_property(scalar,'',prop)
    unreal.MaterialEditingLibrary.recompile_material(mat); library.save_loaded_asset(mat)
    materials[name]=mat

for asset in manifest['assets']:
    name=asset['name']; task=unreal.AssetImportTask()
    task.set_editor_property('filename',str(root/f'{name}.fbx'))
    task.set_editor_property('destination_path','/Game/Heroes')
    task.set_editor_property('destination_name',name)
    task.set_editor_property('automated',True); task.set_editor_property('save',True)
    task.set_editor_property('replace_existing',True)
    options=unreal.FbxImportUI()
    options.set_editor_property('import_mesh',True)
    options.set_editor_property('import_materials',False); options.set_editor_property('import_textures',False)
    options.set_editor_property('import_as_skeletal',False)
    options.set_editor_property('mesh_type_to_import',unreal.FBXImportType.FBXIT_STATIC_MESH)
    options.static_mesh_import_data.set_editor_property('combine_meshes',True)
    task.set_editor_property('options',options); tools.import_asset_tasks([task])
    loaded=library.load_asset('/Game/Heroes/'+name)
    assert loaded, name
    slots=loaded.get_editor_property('static_materials')
    for index,slot in enumerate(slots):
        key=str(slot.get_editor_property('imported_material_slot_name'))
        assert key in materials, (name,key)
        # FIX: reflected struct-array iteration returns copies; mutate the mesh through its API.
        loaded.set_material(index,materials[key])
    library.save_loaded_asset(loaded,only_if_is_dirty=False)
    for index,slot in enumerate(loaded.get_editor_property('static_materials')):
        assert slot.get_editor_property('material_interface').get_path_name().startswith('/Game/Heroes/Materials/'), (name,index)
    bounds=loaded.get_bounds()
    extent=bounds.box_extent
    expected=[(asset['max'][i]-asset['min'][i])/2 for i in range(3)]
    # TEST: FBX unit/axis conversion must not silently enlarge or rotate the rig parts.
    for actual,target in zip([extent.x,extent.y,extent.z],expected):
        assert abs(actual-target)<.2,(name,actual,target)
    print('DURAK_HERO_IMPORT',name,'slots',len(slots),'extent_cm',extent)

for name in ['Whoosh','Clash','Impact','Resolve']:
    task=unreal.AssetImportTask(); task.set_editor_property('filename',str(root/f'{name}.wav'))
    task.set_editor_property('destination_path','/Game/Heroes/Audio')
    task.set_editor_property('destination_name',name); task.set_editor_property('automated',True)
    task.set_editor_property('replace_existing',True); task.set_editor_property('save',True)
    tools.import_asset_tasks([task])
    assert library.does_asset_exist('/Game/Heroes/Audio/'+name)
library.save_directory('/Game/Heroes',only_if_is_dirty=True,recursive=True)
print('DURAK_HERO_IMPORT_READY')
