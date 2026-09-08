"""Generate a separate first Jack/Queen cinematic using original skeletal clips."""
import unreal

FPS, END = 30, 330
MAP, SEQUENCE = '/Game/Art/SkeletalDuelArena', '/Game/Art/SkeletalDuel'
library = unreal.EditorAssetLibrary
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not library.does_asset_exist(MAP):
    assert library.duplicate_asset('/Game/Art/RealisticPreview', MAP)
assert levels.load_level(MAP)
scene = {a.get_actor_label(): a for a in actors.get_all_level_actors()}
# FIX: this scene is viewed from the side, unlike the front-facing character gallery.
scene['Dark backdrop'].set_actor_location(unreal.Vector(0, 270, 290), False, False)
scene['Dark backdrop'].set_actor_scale3d(unreal.Vector(20, .2, 6))
scene['Front fill'].set_actor_location(unreal.Vector(0, -320, 250), False, False)
scene['Front fill'].light_component.set_intensity(800)
scene['Soft neutral key'].light_component.set_intensity(1.4)
scene['Cool rim'].set_actor_location(unreal.Vector(-220, 140, 250), False, False)
scene['Warm rim'].set_actor_location(unreal.Vector(180, 160, 230), False, False)
sequence = unreal.load_asset(SEQUENCE) if library.does_asset_exist(SEQUENCE) else None
if sequence:
    # FIX: rebuild only this generated sequence, never the card game or source animations.
    for binding in sequence.get_bindings():
        binding.remove()
    for track in sequence.get_tracks():
        sequence.remove_track(track)
else:
    sequence = unreal.AssetToolsHelpers.get_asset_tools().create_asset('SkeletalDuel', '/Game/Art', unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
sequence.set_display_rate(unreal.FrameRate(FPS, 1))
sequence.set_tick_resolution_directly(unreal.FrameRate(FPS, 1))
sequence.set_playback_start(0)
sequence.set_playback_end(END)


def frame(seconds):
    return round(seconds * FPS)


def transform_track(binding, keys, interpolation=unreal.MovieSceneKeyInterpolation.AUTO):
    section = binding.add_track(unreal.MovieScene3DTransformTrack).add_section()
    section.set_range(0, END)
    channels = section.get_channels_by_type(unreal.MovieSceneScriptingDoubleChannel)
    assert len(channels) == 9
    for seconds, position, rotation in keys:
        values = [*position, rotation.roll, rotation.pitch, rotation.yaw, 1, 1, 1]
        for channel, value in zip(channels, values):
            channel.add_key(unreal.FrameNumber(frame(seconds)), value, interpolation=interpolation)
    return section


def animate(hero, plan, positions, yaw):
    actor = scene[hero]
    actor.set_actor_location(unreal.Vector(*positions[0][1]), False, False)
    actor.set_actor_rotation(unreal.Rotator(yaw=yaw), False)
    binding = sequence.add_possessable(actor)
    binding.set_name(hero)
    # FIX: exact idle holds, no cubic overshoot pulling planted feet between motion keys.
    transform_track(binding, [(time, position, unreal.Rotator(yaw=yaw)) for time, position in positions],unreal.MovieSceneKeyInterpolation.LINEAR)
    track = binding.add_track(unreal.MovieSceneSkeletalAnimationTrack)
    skeleton = actor.skeletal_mesh_component.get_skinned_asset().get_editor_property('skeleton')
    for index, (name, start, end, rate) in enumerate(plan):
        clip = unreal.load_asset('/Game/Paragon' + hero + '/Characters/Heroes/' + hero + '/Animations/' + name)
        if name == 'Hitreact_Fwd':
            clip = unreal.load_asset('/Game/Art/DuelReactions/' + hero + '_Hitreact_Fwd')
        # TEST: keep source rigs and clips paired; never apply the other fighter's skeleton.
        assert isinstance(clip, unreal.AnimSequence)
        assert clip.get_editor_property('skeleton') == skeleton
        assert clip.get_editor_property('additive_anim_type') == unreal.AdditiveAnimationType.AAT_NONE
        section = track.add_section()
        section.set_range(frame(start), frame(end))
        params = unreal.MovieSceneSkeletalAnimationParams()
        params.set_editor_property('animation', clip)
        params.set_editor_property('play_rate', unreal.MovieSceneTimeWarpExtensions.make_time_warp(rate))
        params.set_editor_property('skip_anim_notifiers', True)
        section.set_editor_property('params', params)
        section.set_ease_in_duration(0 if index == 0 else 4)
        section.set_ease_out_duration(0 if index == len(plan) - 1 else 4)
    return binding


# FIX: source swings peak ~0.18–0.25s into each clip, not at the clip midpoint.
animate('Kwang', [
    ('Idle', 0, 1.65, 1),
    ('PrimaryAttack_A_Slow', 1.5, 2.95, .85),
    ('Idle', 2.8, 3.7, 1),
    ('Hitreact_Fwd', 3.55, 4.35, 1),
    ('PrimaryAttack_B_Slow', 4.2, 5.7, .85),
    ('Idle', 5.55, 6.95, 1),
    ('Death_Bwd', 6.8, 11, .50),
], [(0, (-100, 0, 0)), (1.5, (-100, 0, 0)), (1.78, (-85, 0, 0)),
    (2.8, (-100, 0, 0)), (3.55, (-100, 0, 0)), (3.75, (-115, 0, 0)),
    (4.2, (-115, 0, 0)), (4.49, (-85, 0, 0)), (5.55, (-100, 0, 0)), (11, (-100, 0, 0))], -90)
animate('Countess', [
    ('Idle_Pose', 0, 1.95, 1),
    ('Hitreact_Fwd', 1.78, 2.8, 1),
    ('Idle_Pose', 2.65, 3.5, 1),
    ('Primary_Attack_Normal', 3.33, 4.43, .85),
    ('Primary_Attack_B_Normal', 4.28, 5.48, .8),
    ('Idle_Pose', 5.33, 6.65, 1),
    ('Primary_Attack_Normal', 6.5, 7.8, .65),
    ('Idle_Pose', 7.65, 11, 1),
], [(0, (85, 0, 0)), (1.78, (85, 0, 0)), (2.1, (100, 0, 0)),
    (3.33, (100, 0, 0)), (3.57, (40, 0, 0)), (4.28, (40, 0, 0)), (4.49, (85, 0, 0)),
    (6.5, (85, 0, 0)), (6.78, (15, 0, 0)), (7.65, (20, 0, 0)), (11, (20, 0, 0))], 90)

camera = scene['Fighter review camera']
camera.camera_component.set_field_of_view(42)
camera_keys = []
for time, position, target in [
    (0, (30, -700, 205), (-10, 0, 95)),
    (1.5, (20, -620, 175), (-5, 0, 108)),
    (2.9, (0, -620, 170), (-10, 0, 108)),
    (4.2, (-20, -590, 170), (-10, 0, 108)),
    (5.5, (25, -650, 195), (-10, 0, 100)),
    (6.7, (10, -540, 175), (-45, 0, 110)),
    (7.0, (10, -550, 175), (-55, 0, 105)),
    (8.5, (-150, -850, 240), (-160, 0, 60)),
    (11, (-150, -850, 240), (-160, 0, 60)),
]:
    camera_keys.append((time, position, unreal.MathLibrary.find_look_at_rotation(unreal.Vector(*position), unreal.Vector(*target))))
camera_binding = sequence.add_possessable(camera)
transform_track(camera_binding, camera_keys)
camera.set_actor_location(unreal.Vector(*camera_keys[0][1]), False, False)
camera.set_actor_rotation(camera_keys[0][2], False)

# Original prototype audio; explicit tracks avoid unreviewed animation notify gameplay.
audio = sequence.add_track(unreal.MovieSceneAudioTrack)
for time, name in [(1.58, 'Whoosh'), (1.80, 'Impact'), (3.38, 'Whoosh'), (3.57, 'Impact'),
                   (4.30, 'Whoosh'), (4.49, 'Clash'), (6.60, 'Whoosh'), (6.82, 'Impact'), (8.5, 'Resolve')]:
    section = audio.add_section()
    sound = unreal.load_asset('/Game/Heroes/Audio/' + name)
    assert sound
    section.set_sound(sound)
    section.set_range(frame(time), min(END, frame(time + .7)))

player = scene.get('Skeletal duel player') or actors.spawn_actor_from_class(unreal.LevelSequenceActor, unreal.Vector())
player.set_actor_label('Skeletal duel player')
player.set_sequence(sequence)
settings = player.get_editor_property('playback_settings')
settings.set_editor_property('auto_play', True)
settings.set_editor_property('loop_count', unreal.MovieSceneSequenceLoopCount(-1))
player.set_editor_property('playback_settings', settings)
library.save_loaded_asset(sequence)
assert levels.save_current_level()
print('SKELETAL_DUEL_READY', MAP, SEQUENCE)
