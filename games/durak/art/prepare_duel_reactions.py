"""Create cinematic-only non-additive copies; verify resolved poses against originals."""
import unreal

for hero in ['Kwang', 'Countess']:
    source_path = '/Game/Paragon' + hero + '/Characters/Heroes/' + hero + '/Animations/Hitreact_Fwd'
    target_path = '/Game/Art/DuelReactions/' + hero + '_Hitreact_Fwd'
    source = unreal.load_asset(source_path)
    target = unreal.load_asset(target_path) if unreal.EditorAssetLibrary.does_asset_exist(target_path) else unreal.EditorAssetLibrary.duplicate_asset(source_path, target_path)
    assert source and target and source != target
    # FIX: raw source tracks contain absolute poses; only the duplicate's compression mode changes.
    target.set_editor_property('additive_anim_type', unreal.AdditiveAnimationType.AAT_NONE)
    unreal.EditorAssetLibrary.save_loaded_asset(target)
    options = unreal.AnimPoseEvaluationOptions()
    options.set_editor_property('retrieve_additive_as_full_pose', True)
    maximum_error = 0
    for fraction in [0, .25, .5, .75, 1]:
        time = source.get_play_length() * fraction
        original_pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(source, time, options)
        converted_pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(target, time, options)
        for bone in ['root', 'pelvis', 'head', 'hand_l', 'hand_r', 'foot_l', 'foot_r']:
            a = unreal.AnimPoseExtensions.get_bone_pose(original_pose, bone, unreal.AnimPoseSpaces.WORLD).translation
            b = unreal.AnimPoseExtensions.get_bone_pose(converted_pose, bone, unreal.AnimPoseSpaces.WORLD).translation
            error = unreal.MathLibrary.vector_distance(a, b)
            maximum_error = max(maximum_error, error)
            # TEST: converting the mode must not deform or shift the authored character.
            assert error < 1, (hero, time, bone, error)
    print('DUEL_REACTION_VERIFIED', hero, maximum_error)
