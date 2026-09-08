#include "Misc/AutomationTest.h"
#include "DurakRules.h"
#include "DuelMotion.h"
#include "DuelEvents.h"
#include "DuelStage.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"

// TEST: imported hero components are used by the real stage and fully removed on skip/replay.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakHeroTest,"Durak.Art.HeroPairLifecycle",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakHeroTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Art test world"),World)) return false;
    auto* Stage=World->SpawnActor<ADuelStage>();
    if(!TestNotNull(TEXT("Art stage"),Stage)) { World->DestroyWorld(false); return false; }
    for(int Replay=0;Replay<3;++Replay) {
        Stage->ShowCombat({11,1},{12,1},2);
        TArray<UStaticMeshComponent*> Meshes; Stage->GetComponents(Meshes);
        int HeroParts=0;
        for(auto* Component:Meshes) {
            UStaticMesh* Mesh=Component->GetStaticMesh();
            if(!TestNotNull(TEXT("No missing art meshes"),Mesh)) continue;
            if(Mesh->GetPathName().StartsWith(TEXT("/Game/Heroes/"))) {
                ++HeroParts;
                TestTrue(TEXT("Imported art stays unit scale"),Component->GetRelativeScale3D().Equals(FVector::OneVector));
                for(int Slot=0;Slot<Mesh->GetStaticMaterials().Num();++Slot)
                    TestNotNull(TEXT("Every armor material is assigned"),Component->GetMaterial(Slot));
            }
        }
        TestTrue(TEXT("Both fighters use the authored parts"),HeroParts>=40);
        Stage->ClearCombat(); Meshes.Reset(); Stage->GetComponents(Meshes);
        TestEqual(TEXT("Skip removes all transient meshes"),Meshes.Num(),0);
    }
    // TEST: the isolated art preview must not erase existing red trump effects.
    Stage->ShowCombat({11,2},{12,2},2);
    TArray<UStaticMeshComponent*> TrumpMeshes; Stage->GetComponents(TrumpMeshes);
    int PreviewParts=0;
    for(auto* Component:TrumpMeshes) if(Component->GetStaticMesh() &&
        Component->GetStaticMesh()->GetPathName().StartsWith(TEXT("/Game/Heroes/"))) ++PreviewParts;
    TestEqual(TEXT("Trump keeps its original aura-equipped rig"),PreviewParts,0);
    Stage->ClearCombat();
    World->DestroyWorld(false); return true;
}

// TEST: sound events survive a slow frame but never repeat on pause or backward seek.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakCueTest,"Durak.Motion.AudioCrossings",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakCueTest::RunTest(const FString& Parameters) {
    TestTrue(TEXT("Hit on exact boundary"),DurakEvents::Crossed(2.99f,3.f,3.f));
    TestTrue(TEXT("Slow frame still triggers hit"),DurakEvents::Crossed(2.8f,3.2f,3.f));
    TestFalse(TEXT("No duplicate on next frame"),DurakEvents::Crossed(3.f,3.1f,3.f));
    TestFalse(TEXT("Pause is silent"),DurakEvents::Crossed(3.f,3.f,3.f));
    TestFalse(TEXT("Backward seek is silent"),DurakEvents::Crossed(3.2f,2.f,3.f));
    TestFalse(TEXT("Future cue is silent"),DurakEvents::Crossed(2.f,2.9f,3.f));
    return true;
}

// TEST: exhaustive local winner parity; cosmetics must not reverse legal card outcomes.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakDefenseTest,"Durak.Rules.Defense",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakDefenseTest::RunTest(const FString& Parameters) {
    using namespace Durak;
    TestTrue(TEXT("Jack beats ten"), CanBeat({10,1},{11,1},2));
    TestTrue(TEXT("Trump jack beats ace"), CanBeat({14,1},{11,2},2));
    TestFalse(TEXT("Off-suit ace cannot beat trump"), CanBeat({6,2},{14,1},2));
    TestFalse(TEXT("Malformed rank"), CanBeat({2,1},{14,1},2));
    TestFalse(TEXT("Malformed suit"), CanBeat({10,1},{14,7},2));
    for(int T=0;T<4;++T) for(int S=0;S<4;++S) for(int R=6;R<=14;++R) {
        TestFalse(TEXT("No self-defense"),CanBeat({R,S},{R,S},T));
        for(int D=6;D<=14;++D) TestEqual(TEXT("Same suit rank order"),CanBeat({R,S},{D,S},T),D>R);
    }
    TestEqual(TEXT("Maximum six"),AttackLimit(12),6);
    TestEqual(TEXT("Short hand limit"),AttackLimit(3),3);
    return true;
}

// TEST: a hanging sword extends down local -Z; a strike must reach local +X (opponent).
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakSwordTest,"Durak.Motion.SwordReachesOpponent",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakSwordTest::RunTest(const FString& Parameters) {
    const FVector Tip=DurakMotion::SwordPose(1.f).RotateVector(FVector(0,0,-100));
    TestTrue(TEXT("Sword tip reaches forward, not behind the fighter"),Tip.X>70);
    return true;
}

// TEST: contacts are shared by the weapon and shield/body, not two unrelated timers.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakContactTest,"Durak.Motion.SynchronizedContacts",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakContactTest::RunTest(const FString& Parameters) {
    for(int Rank=11;Rank<=14;++Rank) for(const float T:{3.f,4.15f,5.3f,6.5f}) {
        const auto Frame=DurakMotion::Evaluate(T,Rank,false);
        const auto& Striker=T<5?Frame.Left:Frame.Right;
        TestTrue(TEXT("Blade tip reaches the actual contact"),FVector::Distance(Striker.BladeTip,Frame.ContactPoint)<.1f);
        TestTrue(TEXT("Impact exists only at contact"),Frame.Impact>0);
        TestTrue(TEXT("Elbow upper segment length"),FMath::IsNearlyEqual(FVector::Distance(Striker.SwordArm.Root,Striker.SwordArm.Joint),28.,.01));
        TestTrue(TEXT("Elbow lower segment length"),FMath::IsNearlyEqual(FVector::Distance(Striker.SwordArm.Joint,Striker.SwordArm.End),28.,.01));
    }
    return true;
}

// TEST: feet are planted throughout exchanges; contacts and roots do not teleport.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakGroundTest,"Durak.Motion.GroundedContinuousPose",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakGroundTest::RunTest(const FString& Parameters) {
    const auto Start=DurakMotion::Evaluate(2.7f,13,false);
    auto Previous=Start;
    for(int I=271;I<=900;++I) {
        const auto Frame=DurakMotion::Evaluate(I/100.f,13,false);
        for(int Side=0;Side<2;++Side) {
            const auto& Pose=Side==0?Frame.Left:Frame.Right;
            const auto& Initial=Side==0?Start.Left:Start.Right;
            const auto& Prior=Side==0?Previous.Left:Previous.Right;
            for(int Foot=0;Foot<2;++Foot) {
                TestTrue(TEXT("No planted-foot sliding"),Pose.Feet[Foot].Equals(Initial.Feet[Foot],.01));
                TestTrue(TEXT("Feet above table"),Pose.Feet[Foot].Z>=5.9);
                TestTrue(TEXT("Leg reaches planted ankle"),Pose.Legs[Foot].End.Equals(Pose.Feet[Foot],.01));
            }
            TestTrue(TEXT("No root jumps"),FVector::Distance(Pose.Root,Prior.Root)<3);
            TestTrue(TEXT("No sword-tip jumps"),FVector::Distance(Pose.BladeTip,Prior.BladeTip)<25);
        }
        Previous=Frame;
    }
    const auto Before=DurakMotion::Evaluate(6.49f,11,true);
    const auto After=DurakMotion::Evaluate(6.55f,11,true);
    TestEqual(TEXT("Bricks intact before contact"),Before.BrickAge,0.f);
    TestTrue(TEXT("Bricks break after contact"),After.BrickAge>0);
    return true;
}
