#include "Misc/AutomationTest.h"
#include "DuelMotion.h"
#include "DuelStage.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInterface.h"

// TEST: the hero does not merely rotate a wrist while the whole body remains rigid.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakBodyActionTest,"Durak.Motion.BodyAnticipationAndRecovery",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakBodyActionTest::RunTest(const FString& Parameters) {
    const auto Wind=DurakMotion::Evaluate(2.78f,12,false,11,true);
    const auto Hit=DurakMotion::Evaluate(3.f,12,false,11,true);
    const auto Guard=DurakMotion::Evaluate(3.65f,12,false,11,true);
    const auto Defeat=DurakMotion::Evaluate(7.6f,12,false,11,true);
    TestTrue(TEXT("Windup and strike turn the chest in opposite directions"),Wind.Left.TorsoRotation.Yaw<-10 && Hit.Left.TorsoRotation.Yaw>10);
    TestTrue(TEXT("Weight moves into the attack"),Hit.Left.Root.X-Wind.Left.Root.X>7);
    TestTrue(TEXT("Body recovers into guard"),FMath::Abs(Guard.Left.TorsoRotation.Yaw)<4);
    TestTrue(TEXT("Defeated chest bows"),Defeat.Left.TorsoRotation.Pitch<-20);
    TestTrue(TEXT("Defeated weapon lowers"),Defeat.Left.Grip.Z<Guard.Left.Grip.Z-25);
    TestTrue(TEXT("Parry produces visible body recoil"),DurakMotion::Evaluate(3.1f,12,false,11,true).Right.TorsoRotation.Pitch>5);
    return true;
}

// TEST: moving the chest must move the shoulder sockets without stretching arms or sliding feet.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakBodyContactTest,"Durak.Motion.BodyContactAndFeet",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakBodyContactTest::RunTest(const FString& Parameters) {
    const auto Planted=DurakMotion::Evaluate(2.65f,12,false,11,true);
    auto Previous=Planted;
    for(int I=266;I<=850;++I) {
        const auto Frame=DurakMotion::Evaluate(I/100.f,12,false,11,true);
        for(int Side=0;Side<2;++Side) {
            const auto& Pose=Side==0?Frame.Left:Frame.Right;
            const auto& Prior=Side==0?Previous.Left:Previous.Right;
            const auto& Initial=Side==0?Planted.Left:Planted.Right;
            const float Facing=Side==0?-1.f:1.f, Broad=Side==0?1.f:.84f;
            const FVector Socket=DurakMotion::Local(Pose.Root,Facing,FVector(0,0,75)+Pose.TorsoRotation.RotateVector(FVector(0,-31*Broad,45)));
            TestTrue(TEXT("Shoulder follows the rendered chest pivot"),Pose.SwordArm.Root.Equals(Socket,.01));
            TestTrue(TEXT("No chest teleport"),Pose.TorsoRotation.Quaternion().AngularDistance(Prior.TorsoRotation.Quaternion())<.15);
            TestTrue(TEXT("No wrist teleport"),FVector::Distance(Pose.Grip,Prior.Grip)<12);
            for(int Foot=0;Foot<2;++Foot) {
                TestTrue(TEXT("Planted shoe stays fixed"),Pose.Feet[Foot].Equals(Initial.Feet[Foot],.01));
                TestTrue(TEXT("Shoe sole stays above felt"),Pose.Feet[Foot].Z>=5.99);
                TestTrue(TEXT("Leg reaches the planted ankle"),Pose.Legs[Foot].End.Equals(Pose.Feet[Foot],.01));
            }
            TestTrue(TEXT("Blade stays above the table"),Pose.BladeTip.Z>=0);
        }
        Previous=Frame;
    }
    for(float Time:{3.f,4.15f,5.3f,6.5f}) {
        const auto Frame=DurakMotion::Evaluate(Time,12,false,11,true);
        const auto& Striker=Time<5?Frame.Left:Frame.Right;
        TestTrue(TEXT("Whole-body strike still makes exact contact"),Striker.BladeTip.Equals(Frame.ContactPoint,.1));
        TestTrue(TEXT("Upper arm stays 28 cm"),FMath::IsNearlyEqual(FVector::Distance(Striker.SwordArm.Root,Striker.SwordArm.Joint),28.,.01));
        TestTrue(TEXT("Forearm stays 28 cm"),FMath::IsNearlyEqual(FVector::Distance(Striker.SwordArm.Joint,Striker.SwordArm.End),28.,.01));
    }
    return true;
}

// TEST: verify actual UE component hierarchy, not only the pure animation equations.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakBodySceneTest,"Durak.Art.BodySceneRendering",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakBodySceneTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Body test world"),World)) return false;
    auto* Stage=World->SpawnActor<ADuelStage>();
    if(!TestNotNull(TEXT("Body test stage"),Stage)) { World->DestroyWorld(false); return false; }
    Stage->ShowCombat({11,1},{12,1},2); Stage->Paused=true;
    TArray<UStaticMeshComponent*> Meshes; Stage->GetComponents(Meshes);
    for(float Time:{2.78f,3.f,4.15f,5.3f,6.5f,7.6f}) {
        Stage->Clock=Time; Stage->Tick(0);
        const auto Frame=DurakMotion::Evaluate(Time,12,false,11,true);
        int Swords=0,Chests=0;
        for(auto* Mesh:Meshes) {
            if(!Mesh->GetStaticMesh()) continue;
            const FString Name=Mesh->GetStaticMesh()->GetName();
            const auto& Pose=Name.StartsWith(TEXT("J_"))?Frame.Left:Frame.Right;
            if(Name==TEXT("J_Torso") || Name==TEXT("Q_Torso")) {
                ++Chests;
                TestTrue(TEXT("Rendered chest follows body rotation"),Mesh->GetAttachParent()->GetRelativeRotation().Equals(Pose.TorsoRotation,.01));
            }
            if(Name==TEXT("J_Sword") || Name==TEXT("Q_Sword")) {
                ++Swords;
                const auto Transform=Mesh->GetComponentTransform();
                TestTrue(TEXT("Rendered grip follows the hand"),Transform.TransformPosition({0,0,-10}).Equals(Pose.Grip+FVector(0,0,78),.01));
                TestTrue(TEXT("Rendered tip follows contact model"),Transform.TransformPosition({0,0,73.7272}).Equals(Pose.BladeTip+FVector(0,0,78),.01));
                for(int Slot=0;Slot<Mesh->GetNumMaterials();++Slot) {
                    const auto* Material=Mesh->GetMaterial(Slot);
                    TestTrue(TEXT("Sword uses authored material, not grid fallback"),Material && Material->GetPathName().StartsWith(TEXT("/Game/Heroes/Materials/")));
                }
            }
        }
        TestEqual(TEXT("Two distinctive authored weapons"),Swords,2);
        TestEqual(TEXT("Both chests are articulated"),Chests,2);
    }
    Stage->ClearCombat(); World->DestroyWorld(false); return true;
}
