#include "DuelStage.h"
#include "DuelMotion.h"
#include "DuelEvents.h"
#include "CardTable.h"
#include "SkeletalCardDuel.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Kismet/GameplayStatics.h"
#include "Components/TextRenderComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PointLight.h"
#include "Engine/SkyLight.h"
#include "Engine/TextureCube.h"
#include "Components/SkyLightComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Engine/GameViewportClient.h"
#include "UnrealClient.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInterface.h"
#include "Kismet/KismetMathLibrary.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace {
constexpr float TableTop{78.f};
float Ease(float T) { T=FMath::Clamp(T,0.f,1.f); return T*T*(3.f-2.f*T); }
float Pulse(float T,float Center,float Width) { return Ease(FMath::Max(0.f,1.f-FMath::Abs(T-Center)/Width)); }
}

ADuelStage::ADuelStage() {
    PrimaryActorTick.bCanEverTick=true;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("StageRoot")));
}
USceneComponent* ADuelStage::Joint(USceneComponent* Parent,FVector Position) {
    auto* C=NewObject<USceneComponent>(this);
    AddInstanceComponent(C); C->SetupAttachment(Parent); C->RegisterComponent(); C->SetRelativeLocation(Position);
    TransientParts.Add(C); return C;
}
UStaticMeshComponent* ADuelStage::Piece(USceneComponent* Parent,const FString& Shape,FVector Position,FVector Scale,const FString& Material,bool Transient) {
    auto* C=NewObject<UStaticMeshComponent>(this);
    AddInstanceComponent(C); C->SetupAttachment(Parent);
    const FString Path=Shape.StartsWith(TEXT("/"))?Shape:TEXT("/Engine/BasicShapes/")+Shape+TEXT(".")+Shape;
    C->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,*Path));
    if (const auto* M=Materials.Find(Material)) C->SetMaterial(0,M->Get());
    C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    C->SetMobility(EComponentMobility::Movable);
    C->RegisterComponent(); C->SetRelativeLocation(Position); C->SetRelativeScale3D(Scale);
    if(Transient) TransientParts.Add(C);
    return C;
}
void ADuelStage::BuildRoom() {
    for(const FString Name:{TEXT("Whoosh"),TEXT("Clash"),TEXT("Impact"),TEXT("Resolve")}) {
        const FString Path=TEXT("/Game/Heroes/Audio/")+Name+TEXT(".")+Name;
        Sounds.Add(Name,LoadObject<USoundBase>(nullptr,*Path));
    }
    for(const FString Name:{TEXT("Obsidian"),TEXT("Gold"),TEXT("Ivory"),TEXT("Blue"),TEXT("Crimson"),TEXT("Felt"),TEXT("Brick"),TEXT("Glow"),TEXT("Steel")}) {
        const FString Path=TEXT("/Game/Materials/M_")+Name+TEXT(".M_")+Name;
        Materials.Add(Name,LoadObject<UMaterialInterface>(nullptr,*Path));
    }
    Piece(RootComponent,TEXT("Cube"),{0,0,-32},{35,35,.4},TEXT("Obsidian"),false);
    Piece(RootComponent,TEXT("Cylinder"),{0,0,26},{7.1,5.15,.65},TEXT("Gold"),false);
    Piece(RootComponent,TEXT("Cylinder"),{0,0,38},{7,5,.65},TEXT("Obsidian"),false);
    Piece(RootComponent,TEXT("Cylinder"),{0,0,73},{6.8,4.8,.10},TEXT("Felt"),false);
    for(int I=0;I<24;++I) {
        const float A=I*2*PI/24;
        Piece(RootComponent,TEXT("Sphere"),{345*FMath::Cos(A),250*FMath::Sin(A),57},{.10,.10,.10},TEXT("Gold"),false);
    }
    for(int I=0;I<12;++I) {
        const float A=I*2*PI/12;
        Piece(RootComponent,TEXT("Cylinder"),{800*FMath::Cos(A),800*FMath::Sin(A),200},{.85,.85,5},TEXT("Obsidian"),false);
        Piece(RootComponent,TEXT("Cylinder"),{800*FMath::Cos(A),800*FMath::Sin(A),400},{1.05,1.05,.10},TEXT("Gold"),false);
    }
    auto* Key=GetWorld()->SpawnActor<ADirectionalLight>();
    Key->SetActorRotation(FRotator(-48,-35,0));
    Key->GetLightComponent()->SetIntensity(6.f);
    Key->GetLightComponent()->SetLightColor(FLinearColor(1.f,.80f,.57f));
    auto* Ambient=GetWorld()->SpawnActor<ASkyLight>();
    Ambient->GetLightComponent()->SourceType=ESkyLightSourceType::SLS_SpecifiedCubemap;
    Ambient->GetLightComponent()->SetCubemap(LoadObject<UTextureCube>(nullptr,TEXT("/Engine/MapTemplates/Sky/DaylightAmbientCubemap.DaylightAmbientCubemap")));
    Ambient->GetLightComponent()->SetIntensity(1.25f);
    Ambient->GetLightComponent()->SetLightColor(FLinearColor(.62f,.73f,1.f));
    for(int I=0;I<3;++I) {
        auto* L=GetWorld()->SpawnActor<APointLight>();
        L->SetActorLocation(I==0?FVector(-300,-180,330):I==1?FVector(100,280,300):FVector(280,-300,240));
        auto* P=Cast<UPointLightComponent>(L->GetLightComponent());
        P->SetIntensity(35000.f); P->SetAttenuationRadius(1100); P->SetSourceRadius(35);
        P->SetLightColor(I==1?FLinearColor(.13f,.38f,1):I==2?FLinearColor(1,.08f,.025f):FLinearColor(1,.8f,.55f));
    }
    Camera=GetWorld()->SpawnActor<ACameraActor>();
    Camera->GetCameraComponent()->SetFieldOfView(43);
    Camera->GetCameraComponent()->PostProcessSettings.bOverride_BloomIntensity=true;
    Camera->GetCameraComponent()->PostProcessSettings.BloomIntensity=.4f;
    auto* PC=GetWorld()->GetFirstPlayerController();
    if(PC) { PC->SetViewTarget(Camera); PC->bShowMouseCursor=true; PC->SetInputMode(FInputModeGameAndUI()); }
}
void ADuelStage::BeginPlay() {
    Super::BeginPlay(); BuildRoom();
    Showcase=FParse::Param(FCommandLine::Get(),TEXT("DuelShowcase"));
    // FIX: both card play and the five-scene viewer show current models, not stale prototypes.
    if(!FParse::Param(FCommandLine::Get(),TEXT("ProceduralDuel"))) SkeletalCombat=GetWorld()->SpawnActor<ASkeletalCardDuel>();
    ClearCombat();
    if(Showcase) {
        int InitialScenario=0;
        FParse::Value(FCommandLine::Get(),TEXT("DuelScenario="),InitialScenario);
        PlayScenario(FMath::Clamp(InitialScenario,0,4));
    }
    UE_LOG(LogTemp,Display,TEXT("DURAK_STAGE_READY: showcase=%d"),Showcase);
}
void ADuelStage::BuildCard(Durak::Card C,float Side) {
    Piece(RootComponent,TEXT("Cube"),{Side*160,0,TableTop+2},{.88,1.28,.026},C.Suit==Trump?TEXT("Gold"):TEXT("Ivory"));
    Piece(RootComponent,TEXT("Cube"),{Side*160,0,TableTop+4},{.81,1.20,.018},TEXT("Obsidian"));
    auto* Label=NewObject<UTextRenderComponent>(this);
    AddInstanceComponent(Label); Label->SetupAttachment(RootComponent); Label->RegisterComponent();
    const FString R=C.Rank==14?TEXT("A"):C.Rank==13?TEXT("K"):C.Rank==12?TEXT("Q"):C.Rank==11?TEXT("J"):FString::FromInt(C.Rank);
    Label->SetText(FText::FromString(R)); Label->SetWorldSize(29);
    Label->SetHorizontalAlignment(EHTA_Center); Label->SetTextRenderColor(C.Suit==1||C.Suit==2?FColor(245,70,63):FColor(225,214,185));
    Label->SetRelativeLocation({Side*160,-34,TableTop+6}); Label->SetRelativeRotation(FRotator(90,0,0));
    TransientParts.Add(Label);
    auto* Diamond=Piece(RootComponent,TEXT("Cube"),{Side*160,23,TableTop+6},{.16,.16,.015},TEXT("Crimson"));
    Diamond->SetRelativeRotation(FRotator(0,45,0));
    if(C.Suit==2) {
        Piece(RootComponent,TEXT("Sphere"),{Side*160-6,29,TableTop+6},{.18,.18,.025},TEXT("Crimson"));
        Piece(RootComponent,TEXT("Sphere"),{Side*160+6,29,TableTop+6},{.18,.18,.025},TEXT("Crimson"));
    }
}
FFigureRig ADuelStage::Figure(int Rank,int Suit,float Side) {
    // FIX: the first art pass is isolated to Jack vs Queen; all other fights retain their baseline.
    if(HeroDuel) return HeroFigure(Rank,Side);
    FFigureRig R; R.Rank=Rank; R.Side=Side; R.Root=Joint(RootComponent,{Side*160,0,TableTop});
    R.Root->SetRelativeRotation(FRotator(0,Side<0?0:180,0));
    const FString Armor=Suit==Trump?TEXT("Crimson"):TEXT("Blue");
    const float Broad=Rank==13?1.2f:Rank==12?.84f:1.f;
    // Prototype articulated armor. Blender-built crown and sword are real 3D assets.
    Piece(R.Root,TEXT("Sphere"),{0,0,102},{.45*Broad,.57*Broad,.59},Armor);
    Piece(R.Root,TEXT("Sphere"),{3,0,107},{.40*Broad,.53*Broad,.42},TEXT("Gold"));
    Piece(R.Root,TEXT("Sphere"),{0,0,77},{.35,.43,.28},TEXT("Obsidian"));
    Piece(R.Root,TEXT("Cylinder"),{0,0,73},{.45,.48,.08},TEXT("Gold"));
    R.Head=Joint(R.Root,{0,0,140});
    Piece(R.Head,TEXT("Sphere"),{0,0,0},{.32,.30,.38},TEXT("Steel"));
    Piece(R.Head,TEXT("Cube"),{15,0,1},{.025,.24,.038},Suit==Trump?TEXT("Glow"):TEXT("Ivory"));
    Piece(R.Head,TEXT("/Game/Art/Crown.Crown"),{0,0,15},{1,1,1},TEXT("Gold"));
    if(Rank==14) Piece(R.Head,TEXT("Cone"),{-3,0,38},{.20,.20,.48},TEXT("Gold"));
    for(int I=0;I<2;++I) {
        Piece(R.Root,TEXT("Sphere"),{0,(I==0?-31.f:31.f)*Broad,120},{.30,.34,.30},TEXT("Gold"));
        auto& Arm=R.Arms[I]; auto& Leg=R.Legs[I];
        Arm.Upper=Piece(R.Root,TEXT("Cylinder"),{0,0,0},{.18,.18,.28},Armor);
        Arm.Lower=Piece(R.Root,TEXT("Cylinder"),{0,0,0},{.15,.15,.28},TEXT("Steel"));
        Arm.Joint=Piece(R.Root,TEXT("Sphere"),{0,0,0},{.22,.22,.22},TEXT("Gold"));
        Arm.End=Piece(R.Root,TEXT("Sphere"),{0,0,0},{.20,.20,.20},TEXT("Obsidian"));
        Leg.Upper=Piece(R.Root,TEXT("Cylinder"),{0,0,0},{.22,.22,.34},Armor);
        Leg.Lower=Piece(R.Root,TEXT("Cylinder"),{0,0,0},{.19,.19,.34},TEXT("Steel"));
        Leg.Joint=Piece(R.Root,TEXT("Sphere"),{0,0,0},{.25,.25,.25},TEXT("Gold"));
        Leg.End=Piece(R.Root,TEXT("Cube"),{0,0,0},{.34,.26,.12},TEXT("Obsidian"));
    }
    R.Weapon=Piece(R.Root,TEXT("/Game/Art/Sword.Sword"),{0,0,0},{1,1,1},TEXT("Steel"));
    R.Shield=Joint(R.Root,{0,0,0});
    auto* Shield=Piece(R.Shield,TEXT("Cylinder"),{0,0,0},{.47,.47,.045},Armor);
    Shield->SetRelativeRotation(FRotator(90,0,0));
    auto* Rim=Piece(R.Shield,TEXT("Cylinder"),{-1.5,0,0},{.50,.50,.026},TEXT("Gold"));
    Rim->SetRelativeRotation(FRotator(90,0,0));
    Piece(R.Shield,TEXT("Sphere"),{2,0,0},{.10,.15,.15},TEXT("Gold"))->SetCastShadow(false);
    if(Suit==Trump) {
        for(int I=0;I<20;++I) {
            const float A=2*PI*I/20;
            Piece(R.Root,TEXT("Sphere"),{40*FMath::Cos(A),40*FMath::Sin(A),3},{.055,.055,.15},TEXT("Glow"));
        }
        auto* Aura=NewObject<UPointLightComponent>(this); AddInstanceComponent(Aura);
        Aura->SetupAttachment(R.Root); Aura->RegisterComponent(); Aura->SetRelativeLocation({0,0,65});
        Aura->SetLightColor(FLinearColor(1.f,.015f,.005f)); Aura->SetIntensity(2400); Aura->SetAttenuationRadius(180);
        Aura->SetCastShadows(false); TransientParts.Add(Aura);
    }
    return R;
}
FFigureRig ADuelStage::HeroFigure(int Rank,float Side) {
    FFigureRig R; R.Rank=Rank; R.Side=Side;
    R.Root=Joint(RootComponent,{Side*160,0,TableTop});
    R.Root->SetRelativeRotation(FRotator(0,Side<0?0:180,0));
    const FString Prefix=Rank==12?TEXT("Q_"):TEXT("J_");
    const auto Part=[&](USceneComponent* Parent,const FString& Name,FVector Position=FVector::ZeroVector) {
        const FString Asset=Prefix+Name;
        return Piece(Parent,TEXT("/Game/Heroes/")+Asset+TEXT(".")+Asset,Position,{1,1,1},TEXT(""));
    };
    // FIX: armor, head and shoulder plates turn together around the waist.
    R.Torso=Joint(R.Root,{0,0,75}); Part(R.Torso,TEXT("Torso"),{0,0,-75});
    R.Head=Joint(R.Torso,{0,0,65}); Part(R.Head,TEXT("Head"));
    R.Cape=Joint(R.Torso,{0,0,45}); Part(R.Cape,TEXT("Cape"));
    const float Broad=Rank==12?.84f:1.f;
    for(int I=0;I<2;++I) {
        Part(R.Torso,TEXT("Pauldron"),{0,(I==0?-31.f:31.f)*Broad,45});
        auto& Arm=R.Arms[I]; auto& Leg=R.Legs[I];
        Arm.Upper=Part(R.Root,TEXT("UpperArm")); Arm.Lower=Part(R.Root,TEXT("Forearm"));
        Arm.Joint=Part(R.Root,TEXT("Joint")); Arm.End=Part(R.Root,TEXT("Glove"));
        Leg.Upper=Part(R.Root,TEXT("Thigh")); Leg.Lower=Part(R.Root,TEXT("Shin"));
        Leg.Joint=Part(R.Root,TEXT("Joint")); Leg.End=Part(R.Root,TEXT("Boot"));
    }
    R.Weapon=Part(R.Root,TEXT("Sword"));
    R.Shield=Joint(R.Root,{0,0,0}); Part(R.Shield,TEXT("Shield"));
    return R;
}
void ADuelStage::PlayAudioCues(float Previous,float Current,const FVector& Contact) {
    // FIX: event crossings, not per-frame impact strength. No repeated clang on a paused hit.
    struct FCue { float Time; const TCHAR* Name; float Volume; };
    const FCue Cues[]={{2.82f,TEXT("Whoosh"),.45f},{3.f,TEXT("Clash"),.6f},
        {3.97f,TEXT("Whoosh"),.45f},{4.15f,TEXT("Clash"),.65f},
        {5.12f,TEXT("Whoosh"),.5f},{5.3f,TEXT("Clash"),.7f},
        {6.32f,TEXT("Whoosh"),.55f},{6.5f,TEXT("Impact"),.8f},{7.45f,TEXT("Resolve"),.35f}};
    PlayingSounds.RemoveAll([](const TObjectPtr<UAudioComponent>& Audio){ return !IsValid(Audio) || !Audio->IsPlaying(); });
    for(const auto& Cue:Cues) if(DurakEvents::Crossed(Previous,Current,Cue.Time)) {
        const auto* Sound=Sounds.Find(Cue.Name);
        if(Sound && Sound->Get()) {
            auto* Audio=UGameplayStatics::SpawnSoundAtLocation(this,Sound->Get(),Contact,FRotator::ZeroRotator,Cue.Volume);
            if(Audio) PlayingSounds.Add(Audio);
        }
        UE_LOG(LogTemp,Display,TEXT("DURAK_AUDIO %s t=%.2f"),Cue.Name,Cue.Time);
    }
}
void ADuelStage::PlayScenario(int Index) {
    if(Index<0 || Index>4) return;
    // FIX: reject invalid card pairs before creating any winning animation.
    const Durak::Card Attacks[]={{10,1},{11,1},{12,1},{14,1},{13,1}};
    const Durak::Card Defenses[]={{11,1},{12,1},{13,1},{11,2},{14,1}};
    ShowCombat(Attacks[Index],Defenses[Index],2);
    Scenario=Index;
}
// FIX: cleanup also runs during world shutdown, not just when the player clicks Skip.
void ADuelStage::EndPlay(const EEndPlayReason::Type Reason) {
    if(IsValid(SkeletalCombat)) { SkeletalCombat->Stop(); SkeletalCombat->Destroy(); }
    SkeletalCombat=nullptr;
    Super::EndPlay(Reason);
}
bool ADuelStage::IsSkeletalCombat() const { return IsValid(SkeletalCombat) && SkeletalCombat->IsActive(); }
float ADuelStage::CombatDuration() const { return IsSkeletalCombat()?SkeletalCombat->Duration():Duration; }
void ADuelStage::ClearCombat() {
    if(SkeletalCombat) SkeletalCombat->Stop();
    Paused=false;
    for(auto& Audio:PlayingSounds) if(IsValid(Audio)) Audio->Stop();
    PlayingSounds.Reset(); AudioClock=0; HeroDuel=false;
    for(int I=TransientParts.Num()-1;I>=0;--I) if(IsValid(TransientParts[I])) TransientParts[I]->DestroyComponent();
    TransientParts.Reset(); Bricks.Reset(); Sparks.Reset(); Attacker={}; Defender={};
    Clock=Duration; Scenario=-1;
}
void ADuelStage::ShowCombat(Durak::Card AttackCard,Durak::Card DefenseCard,int TrumpSuit) {
    if(!Durak::CanBeat(AttackCard,DefenseCard,TrumpSuit) || DefenseCard.Rank<11) return;
    ClearCombat();
    Attack=AttackCard; Defense=DefenseCard; Trump=TrumpSuit; Clock=0; Paused=false;
    // FIX: keep the existing aura-equipped trump rig until that art pass is approved too.
    HeroDuel=Attack.Rank==11 && Defense.Rank==12 && Defense.Suit!=Trump;
    // FIX: every senior defending rank uses its own native mesh and compatible choreography.
    if(SkeletalCombat && SkeletalCombat->StartCards(Attack,Defense,Trump)) return;
    if(HeroDuel) {
        // FIX: soft local fill reveals dark armor without changing lighting in other card scenes.
        auto* Fill=NewObject<UPointLightComponent>(this); AddInstanceComponent(Fill);
        Fill->SetupAttachment(RootComponent); Fill->SetMobility(EComponentMobility::Movable);
        Fill->RegisterComponent(); Fill->SetRelativeLocation({100,-220,350});
        Fill->SetLightColor(FLinearColor(.83f,.9f,1.f)); Fill->SetIntensity(18000);
        Fill->SetAttenuationRadius(750); Fill->SetSourceRadius(80);
        Fill->SetCastShadows(false); TransientParts.Add(Fill);
    }
    BuildCard(Attack,-1); BuildCard(Defense,1);
    if(Attack.Rank>=11) Attacker=Figure(Attack.Rank,Attack.Suit,-1);
    else for(int I=0;I<Attack.Rank;++I) {
        Bricks.Add(Piece(RootComponent,TEXT("Cube"),{-60.f,(I%2)*36.f-18,TableTop+15+(I/2)*24},{.30,.33,.21},TEXT("Brick")));
    }
    Defender=Figure(Defense.Rank,Defense.Suit,1);
    for(int I=0;I<18;++I) {
        auto* Spark=Piece(RootComponent,HeroDuel?TEXT("Cube"):TEXT("Sphere"),{0,0,0},{.025,.025,.025},TEXT("Gold"));
        Spark->SetCastShadow(false); Spark->SetVisibility(false); Sparks.Add(Spark);
    }
    UE_LOG(LogTemp,Display,TEXT("DURAK_SCENARIO %d: %d/%d beats %d/%d"),Scenario,Defense.Rank,Defense.Suit,Attack.Rank,Attack.Suit);
}
void ADuelStage::Pose(FFigureRig& R,const DurakMotion::FFighterPose& Frame) {
    if(!R.Root) return;
    R.Root->SetRelativeLocation(Frame.Root+FVector(0,0,TableTop));
    if(R.Torso) R.Torso->SetRelativeRotation(Frame.TorsoRotation);
    const auto Transform=R.Root->GetComponentTransform();
    const auto Point=[&](FVector P) { return Transform.InverseTransformPosition(P+FVector(0,0,TableTop)); };
    const auto Limb=[&](FLimbMeshes& Mesh,const DurakMotion::FLimb& L,bool Leg) {
        const FVector A=Point(L.Root),B=Point(L.Joint),C=Point(L.End);
        Mesh.Upper->SetRelativeLocation((A+B)*.5); Mesh.Lower->SetRelativeLocation((B+C)*.5);
        Mesh.Upper->SetRelativeRotation(FRotationMatrix::MakeFromZ(B-A).Rotator());
        Mesh.Lower->SetRelativeRotation(FRotationMatrix::MakeFromZ(C-B).Rotator());
        Mesh.Joint->SetRelativeLocation(B); Mesh.End->SetRelativeLocation(C);
        if(Leg) Mesh.End->SetRelativeLocation(C+FVector(5,0,0));
    };
    Limb(R.Arms[0],Frame.SwordArm,false); Limb(R.Arms[1],Frame.ShieldArm,false);
    for(int I=0;I<2;++I) Limb(R.Legs[I],Frame.Legs[I],true);
    R.Weapon->SetRelativeLocation(Point(Frame.Grip+Frame.BladeDirection*10));
    R.Weapon->SetRelativeRotation(FRotationMatrix::MakeFromZ(Transform.InverseTransformVectorNoScale(Frame.BladeDirection)).Rotator());
    R.Shield->SetRelativeLocation(Point(Frame.ShieldCenter));
    R.Head->SetRelativeRotation(R.Torso?Frame.HeadRotation:FRotator(-Frame.Defeat*24,0,0));
    if(R.Cape) {
        // Small secondary cloth-like motion, shoulder pivot remains fixed. Not a physics simulation.
        R.Cape->SetRelativeRotation(FRotator(2.f+2.f*FMath::Sin(Clock*2.2f+R.Side),0,1.2f*FMath::Sin(Clock*1.8f)));
        R.Arms[0].End->SetRelativeRotation(R.Weapon->GetRelativeRotation());
    }
}
void ADuelStage::HandleInput() {
    auto* PC=GetWorld()->GetFirstPlayerController(); if(!PC) return;
    const FKey Keys[]={EKeys::One,EKeys::Two,EKeys::Three,EKeys::Four,EKeys::Five};
    for(int I=0;I<5;++I) if(PC->WasInputKeyJustPressed(Keys[I])) PlayScenario(I);
    if(PC->WasInputKeyJustPressed(EKeys::R)) PlayScenario(Scenario);
    if(PC->WasInputKeyJustPressed(EKeys::SpaceBar)) Paused=!Paused;
    if(PC->WasInputKeyJustPressed(EKeys::Escape)) PC->ConsoleCommand(TEXT("quit"));
    if(PC->WasInputKeyJustPressed(EKeys::LeftMouseButton)) {
        float X=0,Y=0; int W=0,H=0; PC->GetMousePosition(X,Y); PC->GetViewportSize(W,H);
        if(Y>=H-104 && Y<=H-40 && X>=32 && X<W-32) {
            const int Selection=static_cast<int>((X-32)/((W-64)/5.f)); PlayScenario(Selection);
        }
    }
}
void ADuelStage::Tick(float DeltaSeconds) {
    Super::Tick(DeltaSeconds); if(Showcase) HandleInput();
    if(IsSkeletalCombat()) {
        SkeletalCombat->SetPaused(Paused);
        if(!Paused) Clock=FMath::Min(CombatDuration(),Clock+DeltaSeconds);
        // FIX: native scenes support the same bounded, opt-in render diagnostics as the old rig.
        Runtime+=DeltaSeconds;
        float ReviewTime=0;
        if(FParse::Value(FCommandLine::Get(),TEXT("DuelCaptureTime="),ReviewTime)) {
            Clock=FMath::Clamp(ReviewTime,0.f,CombatDuration());
            SkeletalCombat->SeekForReview(Clock);
        }
        FString ReviewPath;
        if(Runtime>10.f && !ScreenshotRequested && FParse::Value(FCommandLine::Get(),TEXT("DuelScreenshot="),ReviewPath)) {
            FScreenshotRequest::RequestScreenshot(ReviewPath,true,false); ScreenshotRequested=true;
        }
        float ReviewExit=0;
        if(FParse::Value(FCommandLine::Get(),TEXT("DuelAutoExit="),ReviewExit) && ReviewExit>0 && Runtime>ReviewExit) FPlatformMisc::RequestExit(false);
        return;
    }
    Runtime+=DeltaSeconds;
    if(!Paused) Clock=FMath::Min(Duration,Clock+DeltaSeconds);
    // Fixed-time capture is a diagnostic mode, never activated in normal play.
    float CaptureTime=0;
    const bool FixedCapture=FParse::Value(FCommandLine::Get(),TEXT("DuelCaptureTime="),CaptureTime);
    if(FixedCapture) Clock=FMath::Clamp(CaptureTime,0.f,Duration);
    FString Sequence;
    const bool CaptureSequence=FParse::Value(FCommandLine::Get(),TEXT("DuelCaptureSequence="),Sequence);
    const float Samples[]={2.7f,3.f,4.15f,5.3f,6.5f,7.4f};
    const int SampleIndex=FMath::Clamp(static_cast<int>((Runtime-10)/3),0,5);
    if(CaptureSequence) Clock=Samples[SampleIndex];
    const auto Frame=DurakMotion::Evaluate(Clock,Defense.Rank,Attack.Rank<11,Attack.Rank,HeroDuel);
    Pose(Attacker,Frame.Left); Pose(Defender,Frame.Right);
    for(auto& Audio:PlayingSounds) if(IsValid(Audio)) Audio->SetPaused(Paused);
    if(HeroDuel && !FixedCapture && !CaptureSequence) PlayAudioCues(AudioClock,Clock,Frame.ContactPoint+FVector(0,0,TableTop));
    AudioClock=Clock;
    for(int I=0;I<Sparks.Num();++I) {
        Sparks[I]->SetVisibility(Frame.Impact>0);
        const float Radius=(1-Frame.Impact)*70,Angle=I*2*PI/Sparks.Num();
        Sparks[I]->SetRelativeLocation(Frame.ContactPoint+FVector(Radius*FMath::Cos(Angle),Radius*FMath::Sin(Angle),TableTop+Radius*.45));
        Sparks[I]->SetRelativeScale3D(FVector(.02+.02*Frame.Impact));
        if(HeroDuel) {
            const FVector Direction(FMath::Cos(Angle),FMath::Sin(Angle),.45);
            Sparks[I]->SetRelativeRotation(FRotationMatrix::MakeFromZ(Direction).Rotator());
            Sparks[I]->SetRelativeScale3D({.008,.008,.025+.07*Frame.Impact});
        }
    }
    for(int I=0;I<Bricks.Num();++I) {
        const float Break=Frame.BrickAge;
        const float Height=FMath::Max(12.f,15+(I/2)*24+Break*(75+I*6)-125*Break*Break);
        Bricks[I]->SetRelativeLocation({-60-Break*(35+I*4),(I%2?1.f:-1.f)*(18+Break*(20+I*2)),TableTop+Height});
        Bricks[I]->SetRelativeRotation(FRotator(Break*I*18,Break*I*25,Break*I*12));
    }
    if(Camera) {
        const bool Combat=Defender.Root!=nullptr;
        const float Angle=Combat?.035f*FMath::Sin(Clock*.24f):0;
        const FVector Position=HeroDuel?FVector(275+Angle*120,-700,355):Combat?FVector(105+Angle*120,-690,420):FVector(260,-870,550);
        Camera->SetActorLocation(Position);
        Camera->SetActorRotation(UKismetMathLibrary::FindLookAtRotation(Position,{0,0,HeroDuel?185.:Combat?155.:130.}));
    }
    FString Screenshot;
    if(CaptureSequence && Runtime>11+SampleIndex*3 && CaptureIndex<=SampleIndex) {
        FScreenshotRequest::RequestScreenshot(Sequence+FString::FromInt(SampleIndex)+TEXT(".png"),true,false);
        CaptureIndex=SampleIndex+1;
        const auto* Weapon=Clock<5?Attacker.Weapon:Defender.Weapon;
        if(Weapon && Frame.Impact>0) {
            const FVector Tip=Weapon->GetComponentTransform().TransformPosition({0,0,73.7272});
            UE_LOG(LogTemp,Display,TEXT("DURAK_CONTACT t=%.2f mesh_tip_error_cm=%.4f left_foot_z=%.2f right_foot_z=%.2f"),Clock,FVector::Distance(Tip,Frame.ContactPoint+FVector(0,0,TableTop)),Frame.Left.Feet[0].Z,Frame.Right.Feet[0].Z);
        }
    }
    if(Runtime>18.f && !ScreenshotRequested && FParse::Value(FCommandLine::Get(),TEXT("DuelScreenshot="),Screenshot)) {
        FScreenshotRequest::RequestScreenshot(Screenshot,true,false);
        ScreenshotRequested=true;
    }
    float AutoExit=0;
    if(FParse::Value(FCommandLine::Get(),TEXT("DuelAutoExit="),AutoExit) && AutoExit>0 && Runtime>AutoExit) {
        FPlatformMisc::RequestExit(false);
    }
}
FString ADuelStage::Title() const {
    const TCHAR* Titles[]={TEXT("ВАЛЕТ ПРОТИВ ДЕСЯТКИ"),TEXT("ДАМА ПРОТИВ ВАЛЕТА"),TEXT("КОРОЛЬ ПРОТИВ ДАМЫ"),TEXT("КОЗЫРНЫЙ ВАЛЕТ ПРОТИВ ТУЗА"),TEXT("ТУЗ ПРОТИВ КОРОЛЯ")};
    return Scenario>=0&&Scenario<5?Titles[Scenario]:TEXT("КАРТА ПОБИТА");
}
FString ADuelStage::Phase() const {
    if(Paused) return TEXT("ПАУЗА");
    if(Clock<1.7f) return TEXT("ПРОБУЖДЕНИЕ ФИГУР");
    if(Clock<2.6f) return TEXT("СБЛИЖЕНИЕ");
    if(Clock<4.8f) return TEXT("АТАКА  /  ПАРИРОВАНИЕ");
    if(Clock<6.3f) return TEXT("КОНТРАТАКА");
    return Clock<7.5f?TEXT("РЕШАЮЩИЙ УДАР"):TEXT("ОТБОЙ  ·  R — ПОВТОРИТЬ");
}
ADuelGameMode::ADuelGameMode() {
    DefaultPawnClass=nullptr;
    HUDClass=FParse::Param(FCommandLine::Get(),TEXT("DuelShowcase"))?ADuelHUD::StaticClass():ACardHUD::StaticClass();
}
void ADuelGameMode::BeginPlay() {
    Super::BeginPlay();
    // FIX: a real card match is the default, not the animation selector.
    if(FParse::Param(FCommandLine::Get(),TEXT("DuelShowcase"))) GetWorld()->SpawnActor<ADuelStage>();
    else GetWorld()->SpawnActor<ACardTable>();
}
