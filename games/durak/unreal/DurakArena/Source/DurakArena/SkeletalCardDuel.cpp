#include "SkeletalCardDuel.h"
#include "Animation/SkeletalMeshActor.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "DefaultLevelSequenceInstanceData.h"
#include "Engine/PointLight.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "LevelSequence.h"
#include "LevelSequenceActor.h"
#include "LevelSequencePlayer.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture2D.h"
#include "Misc/PackageName.h"
#include "MovieScene.h"
#include "MovieSceneObjectBindingID.h"

namespace {
// FIX: the cinematic lives away from the table, without map travel or a second game world.
const FVector ArenaOrigin(10000,0,0);
FString HeroForRank(int Rank) { return Rank==12 || Rank==14?TEXT("Countess"):TEXT("Kwang"); }
FString MeshForRank(int Rank) {
    switch(Rank) {
    case 12:return TEXT("/Game/ParagonCountess/Characters/Heroes/Countess/Meshes/SM_Countess");
    case 13:return TEXT("/Game/ParagonKwang/Characters/Heroes/Kwang/Skins/Tier2/Kwang_Manban/Meshes/KwangManbun");
    case 14:return TEXT("/Game/ParagonCountess/Characters/Heroes/Countess/Skins/Tier2/Shogun/Meshes/SM_Countess_Shogun");
    default:return TEXT("/Game/ParagonKwang/Characters/Heroes/Kwang/Meshes/Kwang_GDC");
    }
}
}

ASkeletalCardDuel::ASkeletalCardDuel() { PrimaryActorTick.bCanEverTick=true; }
bool ASkeletalCardDuel::StartCards(Durak::Card Attack,Durak::Card Defense,int TrumpSuit) {
    if(!Durak::CanBeat(Attack,Defense,TrumpSuit) || Defense.Rank<11) return false;
    const FString Pair=(Attack.Rank<11?FString(TEXT("Wall")):HeroForRank(Attack.Rank))+TEXT("_")+HeroForRank(Defense.Rank);
    const FString Path=Pair==TEXT("Kwang_Countess")?TEXT("/Game/Art/SkeletalDuel"):TEXT("/Game/Art/RoyalDuelsPolish/")+Pair;
    if(!Start(Path,Attack.Rank,Defense.Rank,Defense.Suit==TrumpSuit)) return false;
    BuildSummoningCards(Attack,Defense);
    ApplyEntrance(0.f);
    return true;
}
bool ASkeletalCardDuel::Start(const FString& SequencePath,int AttackRank,int DefenseRank,bool Trump) {
    Stop();
    if(!FPackageName::DoesPackageExist(SequencePath)) return false;
    auto* Sequence=LoadObject<ULevelSequence>(nullptr,*SequencePath);
    if(!Sequence || !Sequence->GetMovieScene()) return false;
    auto* Scene=Sequence->GetMovieScene();
    TMap<FString,FGuid> Bindings;
    for(int Index=0;Index<Scene->GetPossessableCount();++Index) {
        const auto& Binding=Scene->GetPossessable(Index);
        Bindings.Add(Binding.GetName(),Binding.GetGuid());
    }
    if(!Bindings.Contains(TEXT("Kwang")) || !Bindings.Contains(TEXT("Countess")) || !Bindings.Contains(TEXT("Fighter review camera"))) return false;

    const FString MeshPaths[]={MeshForRank(AttackRank),MeshForRank(DefenseRank)};
    USkeletalMesh* Meshes[2]={};
    for(int Index=0;Index<2;++Index) {
        if(!FPackageName::DoesPackageExist(MeshPaths[Index])) return false;
        Meshes[Index]=LoadObject<USkeletalMesh>(nullptr,*MeshPaths[Index]);
        if(!Meshes[Index]) return false;
    }
    FMovieSceneSequencePlaybackSettings Settings;
    Settings.bAutoPlay=false;
    Settings.LoopCount.Value=0;
    Settings.bPauseAtEnd=true;
    Settings.bDisableCameraCuts=true; // FIX: camera ownership is restored explicitly even after a skip.
    Settings.FinishCompletionStateOverride=EMovieSceneCompletionModeOverride::ForceRestoreState;
    ALevelSequenceActor* CreatedActor=nullptr;
    Player=ULevelSequencePlayer::CreateLevelSequencePlayer(GetWorld(),Sequence,Settings,CreatedActor);
    SequenceActor=CreatedActor;
    if(!Player || !SequenceActor) { Stop(); return false; }
    auto* Instance=NewObject<UDefaultLevelSequenceInstanceData>(SequenceActor);
    Instance->TransformOrigin=FTransform(ArenaOrigin);
    SequenceActor->DefaultInstanceData=Instance;
    SequenceActor->bOverrideInstanceData=true;
    const auto Bind=[&](const TCHAR* Name,AActor* Actor) {
        const FMovieSceneObjectBindingID ID{UE::MovieScene::FRelativeObjectBindingID(Bindings.FindChecked(Name))};
        SequenceActor->SetBinding(ID,{Actor},false);
    };
    for(int Index=0;Index<2;++Index) {
        auto* Fighter=GetWorld()->SpawnActor<ASkeletalMeshActor>(ArenaOrigin,FRotator::ZeroRotator);
        if(!Fighter) { Stop(); return false; }
        OwnedActors.Add(Fighter);
        auto* Mesh=Fighter->GetSkeletalMeshComponent();
        Fighters.Add(Mesh);
        Mesh->SetSkeletalMeshAsset(Meshes[Index]);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetLightingChannels(false,true,false);
        Mesh->VisibilityBasedAnimTickOption=EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
        if(Index==0 && AttackRank<11) Fighter->SetActorHiddenInGame(true);
        if(Index==1 && Trump) {
            // FIX: a moving red light follows only the trump fighter; no global post-process flash.
            auto* Aura=NewObject<UPointLightComponent>(Fighter);
            Fighter->AddInstanceComponent(Aura); Aura->SetupAttachment(Mesh);
            Aura->SetLightingChannels(false,true,false); Aura->SetLightColor(FLinearColor(1,.015f,.025f));
            Aura->SetIntensityUnits(ELightUnits::Lumens); Aura->SetIntensity(1700); Aura->SetAttenuationRadius(360);
            Aura->SetCastShadows(false); Aura->RegisterComponent(); Aura->SetRelativeLocation({0,0,105});
        }
        Bind(Index==0?TEXT("Kwang"):TEXT("Countess"),Fighter);
    }
    Camera=GetWorld()->SpawnActor<ACameraActor>(ArenaOrigin,FRotator::ZeroRotator);
    if(!Camera) { Stop(); return false; }
    OwnedActors.Add(Camera);
    // FIX: wider than the art-review lens so raised swords remain inside the gameplay viewport.
    Camera->GetCameraComponent()->SetFieldOfView(66);
    // FIX: lower the lens so the showcase's lower HUD does not cover the fighters' feet.
    Camera->GetCameraComponent()->SetRelativeLocation({-170,0,-10});
    Camera->GetCameraComponent()->PostProcessSettings.bOverride_BloomIntensity=true;
    Camera->GetCameraComponent()->PostProcessSettings.BloomIntensity=.12f;
    Bind(TEXT("Fighter review camera"),Camera);
    BuildEnvironment();
    if(AttackRank<11) {
        for(int Index=0;Index<AttackRank;++Index) {
            auto* Brick=GetWorld()->SpawnActor<AStaticMeshActor>(ArenaOrigin+FVector(-100,(Index%2)*36-18,14+(Index/2)*25),FRotator::ZeroRotator);
            if(!Brick) continue;
            OwnedActors.Add(Brick);WallBricks.Add(Brick);
            auto* Mesh=Brick->GetStaticMeshComponent();Mesh->SetMobility(EComponentMobility::Movable);
            Mesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube")));
            Mesh->SetMaterial(0,LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_Brick")));
            Mesh->SetLightingChannels(false,true,false);Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
            Brick->SetActorScale3D({.3,.33,.23});
        }
    }
    SequenceDuration=static_cast<float>(Player->GetDuration().AsSeconds());
    if(SequenceDuration<=0 || SequenceDuration>30) { Stop(); return false; }
    PlaybackDuration=SequenceDuration+EntranceSeconds;
    Player->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(0.f,EUpdatePositionMethod::Jump));
    for(const auto& Mesh:Fighters) FighterAnchors.Add(Mesh->GetComponentLocation());
    if(auto* PC=GetWorld()->GetFirstPlayerController()) {
        ReturnCamera=PC->GetViewTarget();
        PC->SetViewTarget(Camera);
    }
    // FIX: the original attack timeline waits for the physical card entrance, at full body scale.
    Player->Pause(); ApplyEntrance(0.f);
    UE_LOG(LogTemp,Display,TEXT("DURAK_SKELETAL_CARD_START duration=%.2f"),PlaybackDuration);
    return true;
}

void ASkeletalCardDuel::BuildSummoningCards(Durak::Card Attack,Durak::Card Defense) {
    auto* Material=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_SummonCard"));
    auto* Plane=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Plane"));
    if(!Material || !Plane || Fighters.Num()!=2) return;
    const Durak::Card Cards[]={Attack,Defense};
    const TCHAR* Suits[]={TEXT("C"),TEXT("D"),TEXT("H"),TEXT("S")};
    for(int Index=0;Index<2;++Index) {
        const auto Card=Cards[Index];
        const FString Rank=Card.Rank==14?TEXT("A"):Card.Rank==13?TEXT("K"):Card.Rank==12?TEXT("Q"):Card.Rank==11?TEXT("J"):Card.Rank==10?TEXT("T"):FString::FromInt(Card.Rank);
        auto* Face=LoadObject<UTexture2D>(nullptr,*(TEXT("/Game/Cards/T_")+Rank+Suits[Card.Suit]));
        if(!Face) continue;
        FVector Anchor=Fighters[Index]->GetOwner()->GetActorLocation(); Anchor.Z=ArenaOrigin.Z+1.f;
        auto* Prop=GetWorld()->SpawnActor<AStaticMeshActor>(Anchor,FRotator::ZeroRotator);
        if(!Prop) continue;
        Prop->Tags.Add(TEXT("DurakSummonCard"));
        OwnedActors.Add(Prop); SummoningCards.Add(Prop); CardAnchors.Add(Anchor);
        auto* Mesh=Prop->GetStaticMeshComponent(); Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Plane); Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetLightingChannels(false,true,false);
        auto* Print=UMaterialInstanceDynamic::Create(Material,Prop);
        Print->SetTextureParameterValue(TEXT("Face"),Face); Mesh->SetMaterial(0,Print);
        Prop->SetActorScale3D({.9,1.26,1.});
    }
}

void ASkeletalCardDuel::ApplyEntrance(float Seconds) {
    const auto Smooth=[](float Value) { const float T=FMath::Clamp(Value,0.f,1.f);return T*T*(3.f-2.f*T); };
    const float Fall=Smooth(Seconds/.4f),Rise=Smooth((Seconds-.4f)/1.f);
    for(int Index=0;Index<SummoningCards.Num();++Index) if(IsValid(SummoningCards[Index])) {
        SummoningCards[Index]->SetActorLocation(CardAnchors[Index]+FVector(0,0,240.f*(1.f-Fall)));
        SummoningCards[Index]->SetActorRotation(FRotator(-35.f*(1.f-Fall),Index==0?-12.f:12.f,18.f*(1.f-Fall)));
    }
    // FIX: the opaque ground occludes the rising body; never squash the skeleton or scale its bones.
    for(int Index=0;Index<Fighters.Num();++Index) if(IsValid(Fighters[Index]) && FighterAnchors.IsValidIndex(Index))
        Fighters[Index]->SetWorldLocation(FighterAnchors[Index]+FVector(0,0,-220.f*(1.f-Rise)));
}

void ASkeletalCardDuel::SeekForReview(float Seconds) {
    if(!Player) return;
    EntranceElapsed=FMath::Clamp(Seconds,0.f,PlaybackDuration);
    Paused=true; Player->Pause(); ApplyEntrance(EntranceElapsed);
    Player->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(FMath::Clamp(Seconds-EntranceSeconds,0.f,SequenceDuration-.001f),EUpdatePositionMethod::Jump));
    if(Seconds<EntranceSeconds) ApplyEntrance(EntranceElapsed);
}

void ASkeletalCardDuel::BuildEnvironment() {
    auto* Material=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_DuelStone"));
    if(!Material) Material=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_Obsidian"));
    auto* Cube=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube"));
    const auto Geometry=[&](FVector Position,FVector Scale) {
        auto* Actor=GetWorld()->SpawnActor<AStaticMeshActor>(ArenaOrigin+Position,FRotator::ZeroRotator);
        if(!Actor) return;
        OwnedActors.Add(Actor);
        auto* Mesh=Actor->GetStaticMeshComponent();
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Cube); Mesh->SetMaterial(0,Material);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetLightingChannels(false,true,false);
        Actor->SetActorScale3D(Scale);
    };
    Geometry({-150,0,-8},{20,20,.16});
    Geometry({0,270,290},{20,.2,6});
    const auto Light=[&](FVector Position,FLinearColor Color,float Intensity) {
        auto* Actor=GetWorld()->SpawnActor<APointLight>(ArenaOrigin+Position,FRotator::ZeroRotator);
        if(!Actor) return;
        OwnedActors.Add(Actor);
        auto* Lamp=Actor->PointLightComponent.Get();
        Lamp->SetMobility(EComponentMobility::Movable);
        Lamp->SetLightingChannels(false,true,false);
        Lamp->SetIntensityUnits(ELightUnits::Lumens);
        // FIX: keep rim separation without oversized white specular discs on the backdrop.
        Lamp->SetSpecularScale(.15f);
        Lamp->SetIntensity(Intensity); Lamp->SetLightColor(Color);
        Lamp->SetAttenuationRadius(1400); Lamp->SetSourceRadius(50);
    };
    Light({0,-320,250},{.75f,.85f,1.f},800);
    Light({-220,140,250},{.18f,.48f,1.f},1500);
    Light({180,160,230},{1.f,.08f,.025f},1500);
    Light({-80,-100,430},{1.f,.86f,.75f},2200);
}

void ASkeletalCardDuel::SetPaused(bool ShouldPause) {
    Paused=ShouldPause;
    if(!Player) return;
    if((Paused || EntranceElapsed<EntranceSeconds) && Player->IsPlaying()) Player->Pause();
    else if(!Paused && EntranceElapsed>=EntranceSeconds && Player->IsPaused() && Player->GetCurrentTime().AsSeconds()<SequenceDuration-.05) Player->Play();
}

void ASkeletalCardDuel::Tick(float DeltaSeconds) {
    Super::Tick(DeltaSeconds);
    if(!Player) return;
    if(!Paused && EntranceElapsed<EntranceSeconds) {
        EntranceElapsed+=FMath::Max(0.f,DeltaSeconds);
        ApplyEntrance(EntranceElapsed);
        if(EntranceElapsed>=EntranceSeconds) {
            Player->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(FMath::Min(EntranceElapsed-EntranceSeconds,SequenceDuration-.001f),EUpdatePositionMethod::Jump));
            Player->Play();
        }
    }
    if(WallBricks.IsEmpty()) return;
    const float Age=FMath::Max(0.f,static_cast<float>(Player->GetCurrentTime().AsSeconds())-1.8f);
    for(int Index=0;Index<WallBricks.Num();++Index) if(IsValid(WallBricks[Index])) {
        const float Height=FMath::Max(12.f,14+(Index/2)*25+Age*(80+Index*6)-125*Age*Age);
        WallBricks[Index]->SetActorLocation(ArenaOrigin+FVector(-100-Age*(35+Index*4),(Index%2?1.f:-1.f)*(18+Age*(20+Index*2)),Height));
        WallBricks[Index]->SetActorRotation(FRotator(Age*Index*18,Age*Index*25,Age*Index*12));
    }
}

void ASkeletalCardDuel::Stop() {
    const bool WasActive=Player!=nullptr;
    if(IsValid(Player)) Player->Stop();
    if(GetWorld()) if(auto* PC=GetWorld()->GetFirstPlayerController()) {
        if(PC->GetViewTarget()==Camera && ReturnCamera.IsValid()) PC->SetViewTarget(ReturnCamera.Get());
    }
    ReturnCamera.Reset();
    Player=nullptr;
    if(IsValid(SequenceActor)) SequenceActor->Destroy();
    SequenceActor=nullptr;
    for(auto& Actor:OwnedActors) if(IsValid(Actor)) Actor->Destroy();
    OwnedActors.Reset(); WallBricks.Reset(); SummoningCards.Reset(); Fighters.Reset(); CardAnchors.Reset(); FighterAnchors.Reset();
    Camera=nullptr; PlaybackDuration=0; SequenceDuration=0; EntranceElapsed=0; Paused=false;
    if(WasActive) UE_LOG(LogTemp,Display,TEXT("DURAK_SKELETAL_CARD_STOP: camera restored, actors cleared"));
}

void ASkeletalCardDuel::EndPlay(const EEndPlayReason::Type Reason) {
    Stop();
    Super::EndPlay(Reason);
}
