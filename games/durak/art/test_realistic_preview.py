"""Read-only persisted preview regression checks, run in Unreal's Python commandlet."""
import unreal

assert unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level('/Game/Art/RealisticPreview')
mode_class = unreal.EditorAssetLibrary.load_blueprint_class('/Game/Art/BP_RealisticPreviewMode')
# TEST: no default pawn may steal the studio camera after player login.
assert mode_class, 'Missing isolated preview mode'
assert unreal.get_default_object(mode_class).get_editor_property('default_pawn_class') is None
scene = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
cameras = [a for a in scene if isinstance(a, unreal.CameraActor)]
assert len(cameras) == 1
assert cameras[0].get_editor_property('auto_activate_for_player') == unreal.AutoReceiveInput.PLAYER0
assert cameras[0].get_actor_location().x > 500, 'Camera must stay outside the fighters'
print('PREVIEW_CAMERA_COMPONENT', cameras[0].camera_component.get_world_location(), cameras[0].camera_component.get_world_rotation())
fighters = [a for a in scene if isinstance(a, unreal.SkeletalMeshActor)]
assert len(fighters) == 2
for fighter in fighters:
    print('PREVIEW_FIGHTER_TRANSFORM', fighter.get_actor_label(), fighter.get_actor_location(), fighter.get_actor_rotation(), fighter.get_actor_bounds(False))
    # TEST: heading must never become pitch/roll due to Python Rotator argument order.
    rotation = fighter.get_actor_rotation()
    assert abs(rotation.pitch) < .01 and abs(rotation.roll) < .01, 'Fighter is lying sideways'
    data = fighter.skeletal_mesh_component.get_editor_property('animation_data')
    assert data.get_editor_property('anim_to_play'), fighter.get_actor_label()
# TEST: use explicit physical light units, not the default unitless multiplier.
for lamp in [a for a in scene if isinstance(a, unreal.PointLight)]:
    assert lamp.light_component.get_editor_property('intensity_units') == unreal.LightUnits.LUMENS
    assert lamp.light_component.get_editor_property('intensity') <= 2000
print('REALISTIC_PREVIEW_TESTS_OK')
