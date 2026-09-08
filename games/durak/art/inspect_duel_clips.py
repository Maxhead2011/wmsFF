"""Read-only structured animation sampling; original Fab assets are never modified."""
import json
from pathlib import Path
import unreal

result = {}
for hero, names in {
    'Kwang': ['Idle', 'PrimaryAttack_A_Slow', 'PrimaryAttack_B_Slow', 'Hitreact_Fwd', 'Death_Bwd'],
    'Countess': ['Idle_Pose', 'Primary_Attack_Normal', 'Primary_Attack_B_Normal', 'Hitreact_Fwd'],
}.items():
    base = '/Game/Paragon' + hero + '/Characters/Heroes/' + hero + '/Animations/'
    result[hero] = {}
    for name in names:
        clip = unreal.load_asset(base + name)
        assert isinstance(clip, unreal.AnimSequence), name
        length = clip.get_play_length()
        samples = []
        for index in range(21):
            time = length * index / 20
            pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(clip, time, unreal.AnimPoseEvaluationOptions())
            frame = {'time': time}
            for bone in ['root', 'pelvis', 'head', 'foot_l', 'foot_r', 'hand_r', 'weapon_r', 'weapon_l']:
                transform = unreal.AnimPoseExtensions.get_bone_pose(pose, bone, unreal.AnimPoseSpaces.WORLD)
                location = transform.translation
                frame[bone] = [location.x, location.y, location.z]
            samples.append(frame)
        result[hero][name] = {'seconds': length, 'samples': samples}
        print('DUEL_CLIP', hero, name, length, 'head_mid', samples[10]['head'], 'weapon_mid', samples[10]['weapon_r'])
Path(unreal.Paths.project_saved_dir(), 'skeletal-duel-clips.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print('DUEL_CLIPS_INSPECTED')
