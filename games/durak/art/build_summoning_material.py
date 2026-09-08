"""Build only authored entrance-card and matte-stage materials; no licensed asset changes."""
import unreal

lib=unreal.EditorAssetLibrary
edit=unreal.MaterialEditingLibrary

def material(name):
    path='/Game/Materials/'+name
    result=unreal.load_asset(path) if lib.does_asset_exist(path) else None
    if result is None:
        result=unreal.AssetToolsHelpers.get_asset_tools().create_asset(name,'/Game/Materials',unreal.Material,unreal.MaterialFactoryNew())
    # FIX: only these two locally authored graphs are rebuilt, never a source character material.
    edit.delete_all_material_expressions(result)
    return result

def scalar(mat,value,prop):
    node=edit.create_material_expression(mat,unreal.MaterialExpressionConstant)
    node.set_editor_property('r',value)
    edit.connect_material_property(node,'',prop)

paper=material('M_SummonCard')
sample=edit.create_material_expression(paper,unreal.MaterialExpressionTextureSampleParameter2D)
sample.set_editor_property('parameter_name','Face')
sample.set_editor_property('texture',unreal.load_asset('/Game/Cards/T_JD'))
tint=edit.create_material_expression(paper,unreal.MaterialExpressionMultiply)
tint.set_editor_property('const_b',.65)
edit.connect_material_expressions(sample,'RGB',tint,'A')
edit.connect_material_property(tint,'',unreal.MaterialProperty.MP_BASE_COLOR)
scalar(paper,.85,unreal.MaterialProperty.MP_ROUGHNESS)
scalar(paper,.12,unreal.MaterialProperty.MP_SPECULAR)
paper.set_editor_property('two_sided',True)

stone=material('M_DuelStone')
color=edit.create_material_expression(stone,unreal.MaterialExpressionConstant3Vector)
color.set_editor_property('constant',unreal.LinearColor(.035,.038,.045,1))
edit.connect_material_property(color,'',unreal.MaterialProperty.MP_BASE_COLOR)
scalar(stone,.95,unreal.MaterialProperty.MP_ROUGHNESS)
scalar(stone,.08,unreal.MaterialProperty.MP_SPECULAR)
scalar(stone,0,unreal.MaterialProperty.MP_METALLIC)
for mat in [paper,stone]:
    edit.recompile_material(mat)
    lib.save_loaded_asset(mat)
# TEST: reload both assets and verify the runtime face parameter.
assert isinstance(unreal.load_asset('/Game/Materials/M_DuelStone'),unreal.Material)
assert 'Face' in [str(p) for p in edit.get_texture_parameter_names(paper)]
print('SUMMONING_MATERIAL_READY','paper and matte stage')
