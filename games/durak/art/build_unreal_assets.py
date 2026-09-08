"""Run inside UnrealEditor-Cmd using -run=pythonscript -script=<this file>."""
import unreal
from pathlib import Path

root=Path(__file__).resolve().parent
tools=unreal.AssetToolsHelpers.get_asset_tools()
library=unreal.EditorAssetLibrary
palette={
 'Obsidian':((.019,.025,.04),.65,.28,0),
 'Gold':((.72,.40,.095),.82,.24,0),
 'Ivory':((.88,.80,.61),.05,.45,0),
 'Blue':((.028,.095,.24),.72,.25,0),
 'Crimson':((.30,.007,.016),.60,.24,0),
 'Felt':((.013,.053,.044),0,.9,0),
 'Brick':((.20,.045,.028),0,.84,0),
 'Glow':((1,.01,.003),.1,.32,6),
 'Steel':((.26,.32,.38),.9,.22,0),
}
for name,(color,metal,rough,emissive) in palette.items():
    path='/Game/Materials/M_'+name
    if library.does_asset_exist(path): continue
    mat=tools.create_asset('M_'+name,'/Game/Materials',unreal.Material,unreal.MaterialFactoryNew())
    node=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant3Vector)
    node.set_editor_property('constant',unreal.LinearColor(*color,1))
    unreal.MaterialEditingLibrary.connect_material_property(node,'',unreal.MaterialProperty.MP_BASE_COLOR)
    for value,prop in [(metal,unreal.MaterialProperty.MP_METALLIC),(rough,unreal.MaterialProperty.MP_ROUGHNESS)]:
        scalar=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant)
        scalar.set_editor_property('r',value)
        unreal.MaterialEditingLibrary.connect_material_property(scalar,'',prop)
    if emissive:
        glow=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant3Vector)
        glow.set_editor_property('constant',unreal.LinearColor(*(v*emissive for v in color),1))
        unreal.MaterialEditingLibrary.connect_material_property(glow,'',unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(mat)
    library.save_loaded_asset(mat)
for name in ['Crown','Sword']:
    task=unreal.AssetImportTask()
    task.set_editor_property('filename',str(root/'output'/f'{name}.fbx'))
    task.set_editor_property('destination_path','/Game/Art')
    task.set_editor_property('destination_name',name)
    task.set_editor_property('automated',True)
    task.set_editor_property('save',True)
    task.set_editor_property('replace_existing',False)
    opts=unreal.FbxImportUI()
    opts.set_editor_property('import_mesh',True)
    opts.set_editor_property('import_materials',False)
    opts.set_editor_property('import_textures',False)
    opts.set_editor_property('import_as_skeletal',False)
    opts.set_editor_property('mesh_type_to_import',unreal.FBXImportType.FBXIT_STATIC_MESH)
    opts.static_mesh_import_data.set_editor_property('combine_meshes',True)
    task.set_editor_property('options',opts)
    tools.import_asset_tasks([task])
    assert library.does_asset_exist('/Game/Art/'+name), 'Missing imported prop: '+name
subsystem=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
if not library.does_asset_exist('/Game/Arena'):
    assert subsystem.new_level('/Game/Arena')
    assert subsystem.save_current_level()
library.save_directory('/Game',only_if_is_dirty=True,recursive=True)
print('DURAK_ASSETS_READY')
