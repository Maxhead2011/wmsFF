#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/HUD.h"
#include "CardMatch.h"
#include "CardTable.generated.h"

class ADuelStage;
class UTexture2D;
enum class ECardAction { Hand, Target, Take, Pass, Transfer, Combat, Skip, Menu, Mode, Close, Quit };
struct FCardHit { FBox2D Rect; ECardAction Action; int Index{0}; };

UCLASS()
class DURAKARENA_API ACardTable : public AActor {
    GENERATED_BODY()
public:
    ACardTable();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;
    void Act(ECardAction Action,int Index=0);
    void NewGame(EDurakMode Mode);
    FString Instruction() const;
    FString ModeName() const;
    FCardMatch Match;
    int SelectedTarget{-1};
    bool TransferSelected{false};
    bool CombatEnabled{false}; // FIX: unfinished choreography never delays a normal match.
    bool MenuOpen{false};
    float AnimationRemaining{0.f};
    FString Message;
private:
    void AfterMove(bool Success);
    UPROPERTY() TObjectPtr<ADuelStage> Stage;
    float BotDelay{.9f};
    float MessageRemaining{0.f};
    bool AutoTest{false};
};

UCLASS()
class DURAKARENA_API ACardHUD : public AHUD {
    GENERATED_BODY()
public:
    void DrawHUD() override;
    void Click(float X,float Y);
private:
    TArray<FCardHit> Hits;
    UPROPERTY() TMap<int,TObjectPtr<UTexture2D>> CardTextures; // FIX: load each printed face once.
    float Scale{1.f},OffsetX{0.f},OffsetY{0.f};
    void Box(float X,float Y,float W,float H,FLinearColor Color);
    void Text(const FString& Value,float X,float Y,float Size,FLinearColor Color);
    void Suit(int Value,float X,float Y,float Size,FLinearColor Color);
    void Card(Durak::Card Value,float X,float Y,float W,float H,bool Selected=false,bool Playable=false,bool Back=false);
    void Button(const FString& Label,float X,float Y,float W,ECardAction Action,int Index=0,bool Enabled=true,bool Selected=false);
    void Hit(float X,float Y,float W,float H,ECardAction Action,int Index=0);
    ACardTable* Table() const;
};
