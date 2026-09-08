#pragma once
#include "CoreMinimal.h"
#include "DurakRules.h"

enum class EDurakMode { Simple, ThrowIn, Transfer };
enum class EDurakStep { Attack, Defend, ThrowIn, PickingUp, Over };
struct FCardPair { Durak::Card Attack; TOptional<Durak::Card> Defense; };

// FIX: local match state is independent of the renderer, input and animation clocks.
class FCardMatch {
public:
    TArray<Durak::Card> Hands[2];
    TArray<Durak::Card> Deck, Discard;
    TArray<FCardPair> Table;
    EDurakMode Mode{EDurakMode::ThrowIn};
    EDurakStep Step{EDurakStep::Attack};
    Durak::Card TrumpCard{6,2};
    int Trump{2}, Attacker{0}, Capacity{6}, Winner{-2}, Round{1};
    FString Error;
    TOptional<FCardPair> LastDefense;
    void Start(EDurakMode NewMode,int Seed);
    int Defender() const { return 1-Attacker; }
    int ToAct() const { return Step==EDurakStep::Over?-1:Step==EDurakStep::Defend?Defender():Attacker; }
    bool Play(int Player,int HandIndex,int Target=-1,bool Transfer=false);
    bool CanPlay(int Player,int HandIndex,int Target=-1,bool Transfer=false) const;
    bool Pass(int Player);
    bool Take(int Player);
    bool AutoMove(int Player);
    bool ConservesDeck() const;
    int OpenTarget() const;
private:
    void FinishRound(bool Taken);
    void DrawToSix(int Player);
    void SortHands();
    bool Fail(const TCHAR* Message) { Error=Message; return false; }
};
