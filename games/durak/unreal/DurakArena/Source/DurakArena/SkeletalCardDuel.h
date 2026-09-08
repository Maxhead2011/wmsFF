#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DurakRules.h"
#include "SkeletalCardDuel.generated.h"

class ALevelSequenceActor;
class ULevelSequencePlayer;
class ACameraActor;
class USkeletalMeshComponent;

// FIX: owns only cosmetic actors; never reads or mutates a card match.
UCLASS()
class DURAKARENA_API ASkeletalCardDuel : public AActor {
    GENERATED_BODY()
public:
    ASkeletalCardDuel();
    bool Start(const FString& SequencePath=TEXT("/Game/Art/SkeletalDuel"),int AttackRank=11,int DefenseRank=12,bool Trump=false);
    bool StartCards(Durak::Card Attack,Durak::Card Defense,int TrumpSuit);
    void Tick(float DeltaSeconds) override;
    void Stop();
    void SetPaused(bool Paused);
    void SeekForReview(float Seconds);
    void EndPlay(const EEndPlayReason::Type Reason) override;
    float Duration() const { return PlaybackDuration; }
    bool IsActive() const { return Player!=nullptr; }
private:
    void BuildEnvironment();
    void BuildSummoningCards(Durak::Card Attack,Durak::Card Defense);
    void ApplyEntrance(float Seconds);
    UPROPERTY() TObjectPtr<ALevelSequenceActor> SequenceActor;
    UPROPERTY() TObjectPtr<ULevelSequencePlayer> Player;
    UPROPERTY() TObjectPtr<ACameraActor> Camera;
    UPROPERTY() TArray<TObjectPtr<AActor>> OwnedActors;
    UPROPERTY() TArray<TObjectPtr<AActor>> WallBricks;
    UPROPERTY() TArray<TObjectPtr<AActor>> SummoningCards;
    UPROPERTY() TArray<TObjectPtr<USkeletalMeshComponent>> Fighters;
    TArray<FVector> CardAnchors;
    TArray<FVector> FighterAnchors;
    UPROPERTY() TWeakObjectPtr<AActor> ReturnCamera;
    float PlaybackDuration{0.f};
    float SequenceDuration{0.f};
    float EntranceElapsed{0.f};
    bool Paused{false};
    static constexpr float EntranceSeconds=1.4f;
};
