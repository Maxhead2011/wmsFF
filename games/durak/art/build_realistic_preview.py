"""Build a separate native UE character-review map. Does not edit licensed source assets."""
import unreal

MAP = '/Game/Art/RealisticPreview'
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
# FIX: use a dedicated generated map; do not modify the playable Arena.
if unreal.EditorAssetLibrary.does_asset_exist(MAP):
    assert level.load_level(MAP)
else:
    assert level.new_level(MAP)
existing = {a.get_actor_label(): a for a in actors.get_all_level_actors()}


def spawn(cls, name, position, rotation=(0, 0, 0)):
    # FIX: UE Python positional Rotator order is not pitch/yaw/roll. Name each axis.
    orientation = unreal.Rotator(pitch=rotation[0], yaw=rotation[1], roll=rotation[2])
    actor = existing.get(name)
    if actor:
        assert isinstance(actor, cls), name
        actor.set_actor_location(unreal.Vector(*position), False, False)
        actor.set_actor_rotation(orientation, False)
    else:
        actor = actors.spawn_actor_from_class(cls, unreal.Vector(*position), orientation)
    assert actor, name
    actor.set_actor_label(name)
    return actor


def geometry(name, position, scale, material):
    actor = spawn(unreal.StaticMeshActor, name, position)
    mesh = actor.static_mesh_component
    mesh.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Cube'))
    mesh.set_material(0, unreal.load_asset('/Game/Materials/M_' + material))
    actor.set_actor_scale3d(unreal.Vector(*scale))
    return actor


geometry('Studio floor', (0, 0, -8), (16, 20, .16), 'Obsidian')
geometry('Dark backdrop', (-270, 0, 290), (.2, 20, 6), 'Obsidian')
geometry('Left platform', (0, -128, -1), (2.7, 2.3, .02), 'Steel')
geometry('Right platform', (0, 128, -1), (2.7, 2.3, .02), 'Steel')

for hero, mesh_name, clip_name, y, heading in [
    ('Kwang', 'Kwang_GDC', 'Idle', -128, -80),
    ('Countess', 'SM_Countess', 'Idle_Pose', 128, -100),
]:
    base = '/Game/Paragon' + hero + '/Characters/Heroes/' + hero
    mesh = unreal.load_asset(base + '/Meshes/' + mesh_name)
    clip = unreal.load_asset(base + '/Animations/' + clip_name)
    # TEST: do not substitute proxies or animate the wrong skeleton.
    assert isinstance(mesh, unreal.SkeletalMesh), hero
    assert isinstance(clip, unreal.AnimSequence), hero
    assert mesh.get_editor_property('skeleton') == clip.get_editor_property('skeleton'), hero
    assert clip.get_play_length() > 0, hero
    fighter = spawn(unreal.SkeletalMeshActor, hero, (0, y, 0), (0, heading, 0))
    component = fighter.skeletal_mesh_component
    component.set_skinned_asset_and_update(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.override_animation_data(clip, True, True, 0, 1)
    print('REALISTIC_PREVIEW_FIGHTER', hero, mesh.get_path_name(), clip.get_path_name())

camera_pos = unreal.Vector(660, 0, 150)
target = unreal.Vector(0, 0, 100)
camera = spawn(unreal.CameraActor, 'Fighter review camera', (camera_pos.x, camera_pos.y, camera_pos.z))
camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera_pos, target), False)
camera.set_editor_property('auto_activate_for_player', unreal.AutoReceiveInput.PLAYER0)
camera.camera_component.set_field_of_view(38)

key = spawn(unreal.DirectionalLight, 'Soft neutral key', (300, -200, 400), (-40, 145, 0))
key.light_component.set_intensity(3.2)
key.light_component.set_light_color(unreal.LinearColor(1, .86, .75, 1))
for name, position, color, intensity in [
    ('Cool rim', (-100, -240, 230), (.18, .48, 1, 1), 1500),
    ('Warm rim', (-100, 240, 230), (1, .08, .025, 1), 1500),
    ('Front fill', (350, 0, 250), (.75, .85, 1, 1), 1000),
]:
    lamp = spawn(unreal.PointLight, name, position)
    lamp.light_component.set_editor_property('intensity_units', unreal.LightUnits.LUMENS)
    lamp.light_component.set_intensity(intensity)
    lamp.light_component.set_light_color(unreal.LinearColor(*color))
    lamp.light_component.set_editor_property('attenuation_radius', 1000)
    lamp.light_component.set_editor_property('source_radius', 35)

# FIX: an art-only mode cannot spawn a gameplay pawn or move the chosen camera.
mode_path = '/Game/Art/BP_RealisticPreviewMode'
mode = unreal.load_asset(mode_path) if unreal.EditorAssetLibrary.does_asset_exist(mode_path) else None
if not mode:
    factory = unreal.BlueprintFactory()
    factory.set_editor_property('parent_class', unreal.GameModeBase)
    mode = unreal.AssetToolsHelpers.get_asset_tools().create_asset('BP_RealisticPreviewMode', '/Game/Art', unreal.Blueprint, factory)
mode_class = unreal.EditorAssetLibrary.load_blueprint_class(mode_path)
unreal.get_default_object(mode_class).set_editor_property('default_pawn_class', None)
unreal.EditorAssetLibrary.save_loaded_asset(mode)
assert level.save_current_level()
print('PREVIEW_CAMERA', camera.get_actor_location(), camera.get_actor_rotation(), camera.get_editor_property('auto_activate_for_player'))
# TEST: persisted map has the exact two real, animated fighters and one camera.
scene = actors.get_all_level_actors()
assert len([a for a in scene if isinstance(a, unreal.SkeletalMeshActor)]) == 2
assert len([a for a in scene if isinstance(a, unreal.CameraActor)]) == 1
print('REALISTIC_PREVIEW_READY', MAP)
