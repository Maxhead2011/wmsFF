"""Generate rig-compatible variants without touching the original Jack/Queen sequence."""
import unreal
lib=unreal.EditorAssetLibrary
source='/Game/Art/SkeletalDuel'
assert lib.does_asset_exist(source)

def clip(hero,name):
    path='/Game/Art/DuelReactions/'+hero+'_Hitreact_Fwd' if 'Hitreact' in name else '/Game/Paragon'+hero+'/Characters/Heroes/'+hero+'/Animations/'+name
    result=unreal.load_asset(path)
    assert isinstance(result,unreal.AnimSequence),path
    assert result.get_editor_property('additive_anim_type')==unreal.AdditiveAnimationType.AAT_NONE
    return result

maps={
 'Countess':{'Idle':'Idle_Pose','PrimaryAttack_A_Slow':'Primary_Attack_Normal','PrimaryAttack_B_Slow':'Primary_Attack_B_Normal','Death_Bwd':'Knock_Bwd'},
 'Kwang':{'Idle_Pose':'Idle','Primary_Attack_Normal':'PrimaryAttack_A_Slow','Primary_Attack_B_Normal':'PrimaryAttack_B_Slow'},
}
for left,right in [('Kwang','Kwang'),('Countess','Kwang'),('Countess','Countess'),('Wall','Kwang'),('Wall','Countess')]:
    path='/Game/Art/RoyalDuelsPolish/'+left+'_'+right
    # FIX: publish a separate generated revision, without deleting loaded previous sequences.
    if lib.does_asset_exist(path):
        print('ROYAL_DUEL_READY',path,'already generated')
        continue
    sequence=lib.duplicate_asset(source,path)
    assert sequence
    for binding in sequence.get_bindings():
        role=str(binding.get_name())
        if role not in ['Kwang','Countess']:continue
        hero=left if role=='Kwang' else right
        for track in binding.get_tracks():
            if not isinstance(track,unreal.MovieSceneSkeletalAnimationTrack):continue
            for section in track.get_sections():
                params=section.get_editor_property('params')
                original=params.get_editor_property('animation')
                name=original.get_name()
                if hero=='Wall': name='Idle';hero_for_clip='Kwang'
                else:hero_for_clip=hero;name=maps.get(hero,{}).get(name,name)
                if 'Hitreact' in name:name='Hitreact_Fwd'
                replacement=clip(hero_for_clip,name)
                rate=unreal.MovieSceneTimeWarpExtensions.to_fixed_play_rate(params.get_editor_property('play_rate'))
                rate*=replacement.get_play_length()/original.get_play_length()
                # FIX: the Countess recoil retreats instead of using her airborne dissolve/death clip.
                if name=='Knock_Bwd':rate=replacement.get_play_length()/4.2
                params.set_editor_property('animation',replacement)
                params.set_editor_property('play_rate',unreal.MovieSceneTimeWarpExtensions.make_time_warp(rate))
                section.set_editor_property('params',params)
                assert replacement.get_editor_property('skeleton').get_name()==('Kwang_Skeleton' if hero_for_clip=='Kwang' else 'S_Countess_Skeleton')
    if left=='Wall':
        # FIX: a wall does not strike back. Only one deliberate finishing attack is played.
        defender=next(b for b in sequence.get_bindings() if str(b.get_name())=='Countess')
        track=next(t for t in defender.get_tracks() if isinstance(t,unreal.MovieSceneSkeletalAnimationTrack))
        for section in track.get_sections():track.remove_section(section)
        for name,start,end,rate in [(('Idle' if right=='Kwang' else 'Idle_Pose'),0,1.65,1),
                                    (('PrimaryAttack_A_Slow' if right=='Kwang' else 'Primary_Attack_Normal'),1.5,3,.85),
                                    (('Idle' if right=='Kwang' else 'Idle_Pose'),2.85,5,1)]:
            section=track.add_section();section.set_range(round(start*30),round(end*30))
            params=unreal.MovieSceneSkeletalAnimationParams();params.set_editor_property('animation',clip(right,name));params.set_editor_property('play_rate',unreal.MovieSceneTimeWarpExtensions.make_time_warp(rate));params.set_editor_property('skip_anim_notifiers',True)
            section.set_editor_property('params',params);section.set_ease_in_duration(4);section.set_ease_out_duration(4)
        sequence.set_playback_end(150)
        for track in sequence.get_tracks():
            if isinstance(track,unreal.MovieSceneAudioTrack):
                for section in track.get_sections():
                    if section.get_start_frame()>90:track.remove_section(section)
    lib.save_loaded_asset(sequence)
    print('ROYAL_DUEL_READY',path)
