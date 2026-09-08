"""Read-only native rig inventory before extending the cinematic roster."""
import unreal

for rank,path in [
    ('Jack','/Game/ParagonKwang/Characters/Heroes/Kwang/Meshes/Kwang_GDC'),
    ('Queen','/Game/ParagonCountess/Characters/Heroes/Countess/Meshes/SM_Countess'),
    ('King','/Game/ParagonKwang/Characters/Heroes/Kwang/Skins/Tier2/Kwang_Manban/Meshes/KwangManbun'),
    ('Ace','/Game/ParagonCountess/Characters/Heroes/Countess/Skins/Tier2/Shogun/Meshes/SM_Countess_Shogun'),
]:
    mesh=unreal.load_asset(path)
    assert isinstance(mesh,unreal.SkeletalMesh),path
    print('ROYAL_CAST',rank,path,'SKELETON',mesh.get_editor_property('skeleton').get_path_name())
    print('ROYAL_MATERIALS',rank,[str(m.get_editor_property('material_slot_name')) for m in mesh.get_editor_property('materials')])
    # TEST: slot labels alone do not prove that authored materials are installed.
    for slot in mesh.get_editor_property('materials'):
        material=slot.get_editor_property('material_interface')
        assert material is not None,(rank,str(slot.get_editor_property('material_slot_name')))
        assert '/Engine/EngineMaterials/' not in material.get_path_name(),material.get_path_name()
    print('ROYAL_AUTHORED_MATERIALS_OK',rank)
clip=unreal.load_asset('/Game/ParagonCountess/Characters/Heroes/Countess/Animations/Death')
assert isinstance(clip,unreal.AnimSequence)
print('COUNTESS_DEATH',clip.get_play_length(),clip.get_editor_property('additive_anim_type'))
for t in [0,0.2,0.5,1,1.5,2]:
    pose=unreal.AnimPoseExtensions.get_anim_pose_at_time(clip,min(t,clip.get_play_length()),unreal.AnimPoseEvaluationOptions())
    print('COUNTESS_DEATH_POSE',t,[(bone,str(unreal.AnimPoseExtensions.get_bone_pose(pose,bone,unreal.AnimPoseSpaces.WORLD).translation)) for bone in ['root','pelvis','head','foot_l','foot_r']])
