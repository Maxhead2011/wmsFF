"""Read-only UE import inspection, independent of rendered appearance."""
import unreal
for name in ['J_Torso','Q_Torso','J_Cape','Q_Cape']:
    mesh=unreal.EditorAssetLibrary.load_asset('/Game/Heroes/'+name)
    for slot in mesh.get_editor_property('static_materials'):
        mat=slot.get_editor_property('material_interface')
        print('HERO_SLOT',name,str(slot.get_editor_property('material_slot_name')),mat.get_path_name() if mat else None)
        # TEST: a non-null WorldGridMaterial is NOT a successful material import.
        assert mat and mat.get_path_name().startswith('/Game/Heroes/Materials/'), 'Fallback material survived import: '+name
        if mat:
            nodes=unreal.MaterialEditingLibrary.get_inputs_for_material_expression
            print('HERO_INPUT',mat.get_name(),unreal.MaterialEditingLibrary.get_material_property_input_node(mat,unreal.MaterialProperty.MP_BASE_COLOR))
print('HERO_INSPECTION_DONE')
