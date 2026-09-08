#include "Misc/AutomationTest.h"
#include "DuelStage.h"
#include "CardTable.h"
#include "SkeletalCardDuel.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PlayerController.h"
#include "LevelSequenceActor.h"
#include "LevelSequencePlayer.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Animation/SkeletalMeshActor.h"
#include "Components/SkeletalMeshComponent.h"
#include "EngineUtils.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

// TEST: cards precede full-size fighters; pause and skip must also stop/clean the entrance.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakSummoningTest,"Durak.Art.CardSummoning",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakSummoningTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Summoning world"),World)) return false;
    GEngine->CreateNewWorldContext(EWorldType::Game).SetCurrentWorld(World);
    auto* Duel=World->SpawnActor<ASkeletalCardDuel>();
    TestTrue(TEXT("Summoning starts"),Duel->StartCards({11,1},{12,1},2));
    int Cards=0;
    for(TActorIterator<AActor> It(World);It;++It) if(It->ActorHasTag(TEXT("DurakSummonCard"))) ++Cards;
    TestEqual(TEXT("Two actual printed cards on the arena floor"),Cards,2);
    for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) {
        TestTrue(TEXT("Fighter starts beneath the opaque floor"),It->GetSkeletalMeshComponent()->GetRelativeLocation().Z<-190);
        TestEqual(TEXT("No toy-like body scaling"),It->GetActorScale3D(),FVector::OneVector);
    }
    Duel->Tick(.9f);
    Duel->SetPaused(true);
    for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) {
        const FVector Before=It->GetSkeletalMeshComponent()->GetRelativeLocation();
        Duel->Tick(.5f);
        TestEqual(TEXT("Paused entrance stays still"),It->GetSkeletalMeshComponent()->GetRelativeLocation(),Before);
    }
    Duel->SetPaused(false); Duel->Tick(1.f);
    for(TActorIterator<ASkeletalMeshActor> It(World);It;++It)
        TestEqual(TEXT("Entrance finishes exactly at the authored ground plane"),It->GetSkeletalMeshComponent()->GetRelativeLocation().Z,0.);
    // TEST: direct review jumps settle props too, instead of leaving cards above the fighters.
    Duel->SeekForReview(3.2f);
    for(TActorIterator<AActor> It(World);It;++It) if(It->ActorHasTag(TEXT("DurakSummonCard")))
        TestTrue(TEXT("Review jump settles the card onto the ground"),FMath::Abs(It->GetActorLocation().Z-1.)<.01);
    Duel->Stop();
    for(TActorIterator<AActor> It(World);It;++It) if(It->ActorHasTag(TEXT("DurakSummonCard")))
        TestTrue(TEXT("Skip removes printed props"),It->IsActorBeingDestroyed());
    GEngine->DestroyWorldContext(World); World->DestroyWorld(false);
    return true;
}

// TEST: inspect evaluated native feet, rather than trusting actor transforms or a still frame.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakNativeFootworkTest,"Durak.Art.NativeFootwork",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakNativeFootworkTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Inspection world"),World)) return false;
    GEngine->CreateNewWorldContext(EWorldType::Game).SetCurrentWorld(World);
    auto* Duel=World->SpawnActor<ASkeletalCardDuel>();
    const bool Started=Duel->StartCards({11,1},{12,1},2);
    TestTrue(TEXT("Inspection sequence starts"),Started);
    Duel->Tick(1.4f); // TEST: inspect combat poses after the entrance, not below the stage.
    FString Report=TEXT("time,mesh,root_x,root_y,left_x,left_y,left_z,right_x,right_y,right_z\n");
    FVector FirstRoot=FVector::ZeroVector;
    double IdleTravel=0;
    if(Started) for(TActorIterator<ALevelSequenceActor> Sequence(World);Sequence;++Sequence) {
        auto* Player=Sequence->GetSequencePlayer(); Player->Pause();
        for(int Frame=0;Frame<330;++Frame) {
            const float Time=Frame/30.f;
            Player->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(Time,EUpdatePositionMethod::Jump));
            for(TActorIterator<ASkeletalMeshActor> Actor(World);Actor;++Actor) {
                auto* Mesh=Actor->GetSkeletalMeshComponent();
                Mesh->TickAnimation(0.f,false); Mesh->RefreshBoneTransforms();
                const auto Left=Mesh->GetSocketLocation(TEXT("foot_l"));
                const auto Right=Mesh->GetSocketLocation(TEXT("foot_r"));
                const auto Root=Actor->GetActorLocation();
                const FString Name=Mesh->GetSkeletalMeshAsset()->GetName();
                Report+=FString::Printf(TEXT("%.4f,%s,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n"),Time,*Name,Root.X,Root.Y,Left.X,Left.Y,Left.Z,Right.X,Right.Y,Right.Z);
                if(Name==TEXT("SM_Countess")) {
                    if(Frame==84) FirstRoot=Root;
                    if(Frame>=84 && Frame<=96) IdleTravel=FMath::Max(IdleTravel,FVector::Dist2D(FirstRoot,Root));
                }
            }
        }
    }
    FFileHelper::SaveStringToFile(Report,*(FPaths::ProjectSavedDir()/TEXT("native-footwork.csv")));
    // TEST: an idle pose cannot glide sixty centimetres toward the opponent.
    TestTrue(FString::Printf(TEXT("No actor glide during the planted idle interval (%.2f cm)"),IdleTravel),IdleTravel<2.);
    Duel->Stop(); GEngine->DestroyWorldContext(World); World->DestroyWorld(false);
    return true;
}

// TEST: a real gameplay stage uses native fighters; skipping/replaying leaves no stale actors.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakSkeletalCardLifecycleTest,"Durak.Art.SkeletalCardLifecycle",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakSkeletalCardLifecycleTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Test world"),World)) return false;
    GEngine->CreateNewWorldContext(EWorldType::Game).SetCurrentWorld(World);
    auto* PC=World->SpawnActor<APlayerController>();
    if(World->GetFirstPlayerController()!=PC) World->AddController(PC);
    // TEST: this transient test world has not initialized gameplay actors automatically.
    PC->PlayerCameraManager=World->SpawnActor<APlayerCameraManager>();
    PC->PlayerCameraManager->InitializeFor(PC);
    auto* Stage=World->SpawnActor<ADuelStage>();
    Stage->DispatchBeginPlay();
    AActor* TableCamera=PC->GetViewTarget();
    TestNotNull(TEXT("Transient world has the table camera"),TableCamera);
    const auto CountFighters=[&]() {
        int Count=0;
        for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) if(!It->IsActorBeingDestroyed()) ++Count;
        return Count;
    };
    for(int Repeat=0;Repeat<2;++Repeat) {
        Stage->ShowCombat({11,1},{12,1},2);
        TestEqual(TEXT("Jack and Queen are skeletal fighters in a card match"),CountFighters(),2);
        TestEqual(TEXT("The finish gets eleven seconds after the entrance"),Stage->CombatDuration(),12.4f);
        TestTrue(TEXT("Cinematic selects a different camera"),PC->GetViewTarget()!=TableCamera);
        // TEST: retain room above the lower HUD for the fighters' feet.
        auto* CombatCamera=Cast<ACameraActor>(PC->GetViewTarget());
        TestTrue(TEXT("Gameplay lens is framed below the review camera"),CombatCamera && CombatCamera->GetCameraComponent()->GetRelativeLocation().Z<0);
        for(TActorIterator<ALevelSequenceActor> It(World);It;++It) if(!It->IsActorBeingDestroyed()) {
            It->GetSequencePlayer()->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(2.f,EUpdatePositionMethod::Jump));
        }
        for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) if(!It->IsActorBeingDestroyed()) {
            TestTrue(TEXT("Rebound fighter is in the isolated arena, not the card table"),It->GetActorLocation().X>9500);
            TestTrue(TEXT("Fighter remains upright"),FMath::Abs(It->GetActorRotation().Pitch)<.1 && FMath::Abs(It->GetActorRotation().Roll)<.1);
        }
        Stage->ClearCombat();
        TestEqual(TEXT("Skip removes both fighters"),CountFighters(),0);
        TestEqual(TEXT("Skip restores the card camera"),PC->GetViewTarget(),TableCamera);
    }
    Stage->ShowCombat({11,1},{11,2},2);
    TestEqual(TEXT("Trump also uses native fighters"),CountFighters(),2);
    Stage->ClearCombat();
    // TEST: the King/Ace and the wall must not fall back to segmented prototype figures.
    for(const auto Pair:TArray<FCardPair>{{{12,1},Durak::Card{13,1}},{{13,1},Durak::Card{14,1}},{{10,1},Durak::Card{11,1}}}) {
        Stage->ShowCombat(Pair.Attack,Pair.Defense.GetValue(),2);
        TestTrue(TEXT("Every senior rank selects native choreography"),Stage->IsSkeletalCombat());
        TestEqual(TEXT("Wall uses a shorter deliberate finish"),Stage->CombatDuration(),Pair.Attack.Rank<11?6.4f:12.4f);
        TArray<FString> MeshNames;
        for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) if(!It->IsActorBeingDestroyed() && !It->IsHidden()) MeshNames.Add(It->GetSkeletalMeshComponent()->GetSkeletalMeshAsset()->GetName());
        if(Pair.Defense->Rank==13) TestTrue(TEXT("King has a distinct mesh"),MeshNames.Contains(TEXT("KwangManbun")));
        if(Pair.Defense->Rank==14) TestTrue(TEXT("Ace has a distinct armored mesh"),MeshNames.Contains(TEXT("SM_Countess_Shogun")));
        if(Pair.Attack.Rank<11) TestEqual(TEXT("Only the defending fighter is visible against a wall"),MeshNames.Num(),1);
        Stage->ClearCombat();
    }
    auto* Missing=World->SpawnActor<ASkeletalCardDuel>();
    TestFalse(TEXT("Missing optional cinematic returns a safe fallback"),Missing->Start(TEXT("/Game/Art/NotInstalled")));
    TestEqual(TEXT("Missing assets create no ghost fighters"),CountFighters(),0);
    GEngine->DestroyWorldContext(World);
    World->DestroyWorld(false);
    return true;
}

// TEST: dispatch an actual legal card defense, pause/skip it, and retain the exact played pair.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakSkeletalCardMoveTest,"Durak.Interface.SkeletalDefenseAndSkip",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakSkeletalCardMoveTest::RunTest(const FString& Parameters) {
    // TEST: locate a naturally dealt early Jack/Queen defense for repeatable visual smoke runs.
    int SmokeSeed=0,SmokeMoves=100;
    for(int Seed=1;Seed<=2000;++Seed) {
        FCardMatch Probe; Probe.Start(EDurakMode::ThrowIn,Seed);
        for(int Move=1;Move<SmokeMoves && Move<=20;++Move) {
            if(!Probe.AutoMove(Probe.ToAct())) break;
            if(Probe.LastDefense.IsSet() && Probe.LastDefense->Defense->Rank>=11) {
                if(Probe.LastDefense->Attack.Rank==11 && Probe.LastDefense->Defense->Rank==12 && Probe.LastDefense->Defense->Suit!=Probe.Trump) {
                    SmokeSeed=Seed; SmokeMoves=Move;
                }
                break;
            }
        }
    }
    TestTrue(TEXT("A natural deal exercises native combat"),SmokeSeed>0);
    AddInfo(FString::Printf(TEXT("DURAK_SMOKE_SEED=%d MOVES=%d"),SmokeSeed,SmokeMoves));
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!World) return false;
    GEngine->CreateNewWorldContext(EWorldType::Game).SetCurrentWorld(World);
    World->SpawnActor<APlayerController>();
    auto* Table=World->SpawnActor<ACardTable>();
    Table->DispatchBeginPlay();
    for(TActorIterator<ADuelStage> It(World);It;++It) if(!It->HasActorBegunPlay()) It->DispatchBeginPlay();
    auto& Match=Table->Match;
    Match.Start(EDurakMode::ThrowIn,145);
    Match.Hands[0]={{12,1},{6,0}}; Match.Hands[1]={{7,0}};
    Match.Table={{ {11,1},{} }};
    Match.Deck.Reset(); Match.Discard.Reset();
    for(int Suit=0;Suit<4;++Suit) for(int Rank=6;Rank<=14;++Rank) {
        if((Suit==1 && (Rank==11 || Rank==12)) || (Suit==0 && (Rank==6 || Rank==7))) continue;
        Match.Deck.Add({Rank,Suit});
    }
    Match.Attacker=1; Match.Trump=2; Match.Capacity=2; Match.Step=EDurakStep::Defend;
    TestTrue(TEXT("Fixture conserves all 36 cards"),Match.ConservesDeck());
    Table->CombatEnabled=true;
    Table->Act(ECardAction::Hand,0);
    TestEqual(TEXT("Card action starts the complete native fight"),Table->AnimationRemaining,12.4f);
    TestTrue(TEXT("Played Queen is recorded before animation"),Match.Table[0].Defense.IsSet() && Match.Table[0].Defense->Rank==12);
    Table->Act(ECardAction::Menu);
    Table->Tick(2.f);
    TestEqual(TEXT("Menu pauses the cosmetic deadline"),Table->AnimationRemaining,12.4f);
    Table->Act(ECardAction::Close);
    Table->Act(ECardAction::Skip);
    TestEqual(TEXT("Skip returns immediately"),Table->AnimationRemaining,0.f);
    TestTrue(TEXT("Skip preserves the successful defense"),Match.Table[0].Defense.IsSet() && Match.Table[0].Defense->Rank==12);
    TestTrue(TEXT("No card is lost or duplicated by the cinematic"),Match.ConservesDeck());
    Table->NewGame(EDurakMode::Simple);
    for(TActorIterator<ASkeletalMeshActor> It(World);It;++It) TestTrue(TEXT("New game has no cinematic actors"),It->IsActorBeingDestroyed());
    GEngine->DestroyWorldContext(World); World->DestroyWorld(false);
    return true;
}
