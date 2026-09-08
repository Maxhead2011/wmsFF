"""Persisted cinematic contract, independent of card rules."""
import unreal

# TEST: a real timed skeletal duel must exist, not just two looping idle poses.
sequence = unreal.load_asset('/Game/Art/SkeletalDuel')
assert sequence, 'Missing skeletal duel'
assert sequence.get_playback_end() == 330
names = []
by_name = {}
for binding in sequence.get_bindings():
    for track in binding.get_tracks():
        if isinstance(track, unreal.MovieSceneSkeletalAnimationTrack):
            sections = track.get_sections()
            assert len(sections) >= 5, binding.get_name()
            # TEST: no single frame may drop into a reference pose between sections.
            for time in range(330):
                assert any(s.get_start_frame() <= time < s.get_end_frame() for s in sections), (binding.get_name(), time)
            for section in sections:
                clip = section.get_editor_property('params').get_editor_property('animation')
                assert clip and clip.get_play_length() > 0
                # TEST: mesh-space additive reactions silently fail in Sequencer.
                assert clip.get_editor_property('additive_anim_type') == unreal.AdditiveAnimationType.AAT_NONE, clip.get_path_name()
                names.append(clip.get_name())
                by_name.setdefault(clip.get_name(), []).append(section)
assert 'PrimaryAttack_A_Slow' in names and 'Primary_Attack_Normal' in names
assert 'Death_Bwd' in names, 'The defeated Jack must not jump back into idle'
# TEST: reactions line up with the inspected forward weapon-swing phase (not clip midpoint).
def peak(section, source_peak):
    rate = unreal.MovieSceneTimeWarpExtensions.to_fixed_play_rate(section.get_editor_property('params').get_editor_property('play_rate'))
    return section.get_start_frame() / 30 + source_peak / rate

queen_attacks = sorted(by_name['Primary_Attack_Normal'], key=lambda s: s.get_start_frame())
for attack, source_peak, reaction in [
    (by_name['PrimaryAttack_A_Slow'][0], .24, by_name['Countess_Hitreact_Fwd'][0]),
    (queen_attacks[0], .18, by_name['Kwang_Hitreact_Fwd'][0]),
    (queen_attacks[-1], .18, by_name['Death_Bwd'][0]),
]:
    assert abs(peak(attack, source_peak) - reaction.get_start_frame() / 30) < 2 / 30
assert abs(peak(by_name['PrimaryAttack_B_Slow'][0], .253333) - peak(by_name['Primary_Attack_B_Normal'][0], .18)) < 2 / 30
assert unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level('/Game/Art/SkeletalDuelArena')
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
players = [a for a in actors if isinstance(a, unreal.LevelSequenceActor)]
assert len(players) == 1 and players[0].get_sequence() == sequence
assert players[0].get_editor_property('playback_settings').get_editor_property('auto_play')
for actor in [a for a in actors if isinstance(a, unreal.SkeletalMeshActor)]:
    assert abs(actor.get_actor_rotation().pitch) < .01
    assert abs(actor.get_actor_rotation().roll) < .01
print('SKELETAL_DUEL_TESTS_OK', names)
