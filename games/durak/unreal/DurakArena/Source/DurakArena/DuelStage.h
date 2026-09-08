#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "DurakRules.h"
#include "DuelStage.generated.h"

class UStaticMeshComponent;
class UMaterialInterface;
class ACameraActor;
class UAudioComponent;
class USoundBase;
class ASkeletalCardDuel;
namespace DurakMotion { struct FFighterPose; }

struct FLimbMeshes {
    UStaticMeshComponent* Upper{nullptr};
    UStaticMeshComponent* Lower{nullptr};
    UStaticMeshComponent* Joint{nullptr};
    UStaticMeshComponent* End{nullptr};
};

// All component references below are observers; AActor::InstanceComponents owns them.
struct FFigureRig {
    USceneComponent* Root{nullptr};
    USceneComponent* Torso{nullptr}; // FIX: optional authored hero waist pivot.
    USceneComponent* Head{nullptr};
    FLimbMeshes Arms[2],Legs[2];
    UStaticMeshComponent* Weapon{nullptr};
    USceneComponent* Shield{nullptr};
    USceneComponent* Cape{nullptr};
    int Rank{11};
    float Side{-1.f};
};

UCLASS()
class DURAKARENA_API ADuelStage : public AActor {
    GENERATED_BODY()
public:
    ADuelStage();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;
    void EndPlay(const EEndPlayReason::Type Reason) override;
    float CombatDuration() const; // FIX: authored sequences need their full playback range.
    bool IsSkeletalCombat() const;
    void PlayScenario(int Index);
    void ClearCombat();
    void ShowCombat(Durak::Card AttackCard,Durak::Card DefenseCard,int TrumpSuit);
    int Scenario{0};
    float Clock{0.f};
    bool Paused{false};
    FString Title() const;
    FString Phase() const;
    static constexpr float Duration{9.f};
private:
    USceneComponent* Joint(USceneComponent* Parent,FVector Position);
    UStaticMeshComponent* Piece(USceneComponent* Parent,const FString& Shape,FVector Position,FVector Scale,const FString& Material,bool Transient=true);
    FFigureRig Figure(int Rank,int Suit,float Side);
    FFigureRig HeroFigure(int Rank,float Side);
    void PlayAudioCues(float Previous,float Current,const FVector& Contact);
    void Pose(FFigureRig& Rig,const DurakMotion::FFighterPose& Frame);
    void BuildRoom();
    void BuildCard(Durak::Card Card,float Side);
    void HandleInput();
    UPROPERTY() TObjectPtr<ACameraActor> Camera;
    UPROPERTY() TObjectPtr<ASkeletalCardDuel> SkeletalCombat;
    UPROPERTY() TMap<FString,TObjectPtr<UMaterialInterface>> Materials;
    UPROPERTY() TArray<TObjectPtr<USceneComponent>> TransientParts;
    UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Bricks;
    UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Sparks;
    UPROPERTY() TMap<FString,TObjectPtr<USoundBase>> Sounds;
    UPROPERTY() TArray<TObjectPtr<UAudioComponent>> PlayingSounds;
    FFigureRig Attacker;
    FFigureRig Defender;
    Durak::Card Attack{10,1};
    Durak::Card Defense{11,1};
    int Trump{2};
    float Runtime{0.f};
    bool ScreenshotRequested{false};
    bool Showcase{false};
    int CaptureIndex{0};
    float AudioClock{0.f};
    bool HeroDuel{false};
};

UCLASS()
class DURAKARENA_API ADuelHUD : public AHUD {
    GENERATED_BODY()
public:
    void DrawHUD() override;
};

UCLASS()
class DURAKARENA_API ADuelGameMode : public AGameModeBase {
    GENERATED_BODY()
public:
    ADuelGameMode();
    void BeginPlay() override;
};
