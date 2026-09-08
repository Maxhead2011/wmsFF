#include "CardMatch.h"

void FCardMatch::Start(EDurakMode NewMode,int Seed) {
    *this=FCardMatch{}; Mode=NewMode;
    for(int S=0;S<4;++S) for(int R=6;R<=14;++R) Deck.Add({R,S});
    FRandomStream Random(Seed);
    for(int I=Deck.Num()-1;I>0;--I) Deck.Swap(I,Random.RandRange(0,I));
    TrumpCard=Deck[0]; Trump=TrumpCard.Suit;
    for(int I=0;I<6;++I) { Hands[0].Add(Deck.Pop()); Hands[1].Add(Deck.Pop()); }
    int Lowest=15; Attacker=Random.RandRange(0,1);
    for(int P=0;P<2;++P) for(const auto C:Hands[P]) if(C.Suit==Trump && C.Rank<Lowest) { Lowest=C.Rank; Attacker=P; }
    Capacity=Durak::AttackLimit(Hands[Defender()].Num()); SortHands();
}
void FCardMatch::SortHands() {
    for(auto& Hand:Hands) Hand.Sort([this](Durak::Card A,Durak::Card B) {
        const int AS=A.Suit==Trump?4:A.Suit, BS=B.Suit==Trump?4:B.Suit;
        return AS==BS?A.Rank<B.Rank:AS<BS;
    });
}
int FCardMatch::OpenTarget() const {
    for(int I=0;I<Table.Num();++I) if(!Table[I].Defense.IsSet()) return I;
    return INDEX_NONE;
}
bool FCardMatch::CanPlay(int Player,int HandIndex,int Target,bool Transfer) const {
    FCardMatch Copy=*this; return Copy.Play(Player,HandIndex,Target,Transfer);
}
bool FCardMatch::Play(int Player,int HandIndex,int Target,bool Transfer) {
    if(Player!=ToAct() || Player<0 || Player>1) return Fail(TEXT("Сейчас ход соперника"));
    if(!Hands[Player].IsValidIndex(HandIndex)) return Fail(TEXT("Выберите карту из своей руки"));
    const auto Card=Hands[Player][HandIndex];
    if(Transfer) {
        if(Mode!=EDurakMode::Transfer || Step!=EDurakStep::Defend || Table.IsEmpty()) return Fail(TEXT("Сейчас перевод недоступен"));
        for(const auto& Pair:Table) if(Pair.Defense.IsSet() || Pair.Attack.Rank!=Card.Rank) return Fail(TEXT("Перевод: тот же номинал, до начала отбоя"));
        const int NewLimit=Durak::AttackLimit(Hands[Attacker].Num());
        if(Table.Num()+1>NewLimit) return Fail(TEXT("У следующего игрока недостаточно карт для перевода"));
        Hands[Player].RemoveAt(HandIndex); Table.Add({Card,{}});
        Attacker=Player; Capacity=NewLimit; LastDefense.Reset(); Error.Empty(); return true;
    }
    if(Step==EDurakStep::Defend) {
        if(Target<0) Target=OpenTarget();
        if(!Table.IsValidIndex(Target) || Table[Target].Defense.IsSet()) return Fail(TEXT("Выберите непокрытую карту на столе"));
        if(!Durak::CanBeat(Table[Target].Attack,Card,Trump)) return Fail(TEXT("Нужна старшая карта той же масти или козырь"));
        Hands[Player].RemoveAt(HandIndex); Table[Target].Defense=Card;
        LastDefense=Table[Target];
        if(OpenTarget()==INDEX_NONE) Step=EDurakStep::ThrowIn;
    } else {
        if(Table.Num()>=Capacity || Table.Num()>=6) return Fail(TEXT("Достигнут предел карт на столе"));
        if(!Table.IsEmpty()) {
            if(Mode==EDurakMode::Simple) return Fail(TEXT("В простом режиме без подкидывания"));
            bool Matches=false;
            for(const auto& Pair:Table) Matches|=Pair.Attack.Rank==Card.Rank || (Pair.Defense.IsSet() && Pair.Defense->Rank==Card.Rank);
            if(!Matches) return Fail(TEXT("Подкинуть можно только номинал, уже лежащий на столе"));
        }
        Hands[Player].RemoveAt(HandIndex); Table.Add({Card,{}}); LastDefense.Reset();
        if(Step!=EDurakStep::PickingUp) Step=EDurakStep::Defend;
    }
    Error.Empty(); return true;
}
bool FCardMatch::Take(int Player) {
    if(Step!=EDurakStep::Defend || Player!=Defender()) return Fail(TEXT("Сейчас нельзя взять карты"));
    Step=EDurakStep::PickingUp; LastDefense.Reset(); Error.Empty(); return true;
}
bool FCardMatch::Pass(int Player) {
    if(Player!=Attacker || (Step!=EDurakStep::ThrowIn && Step!=EDurakStep::PickingUp)) return Fail(TEXT("Сначала завершите отбой"));
    FinishRound(Step==EDurakStep::PickingUp); Error.Empty(); return true;
}
void FCardMatch::DrawToSix(int Player) { while(Hands[Player].Num()<6 && !Deck.IsEmpty()) Hands[Player].Add(Deck.Pop()); }
void FCardMatch::FinishRound(bool Taken) {
    const int OldDefender=Defender();
    auto& Destination=Taken?Hands[OldDefender]:Discard;
    for(const auto& Pair:Table) { Destination.Add(Pair.Attack); if(Pair.Defense.IsSet()) Destination.Add(Pair.Defense.GetValue()); }
    Table.Reset(); LastDefense.Reset();
    // FIX: refill attacker first, defender last; a pickup loses the defender's next attack.
    DrawToSix(Attacker); DrawToSix(OldDefender); SortHands();
    if(Deck.IsEmpty() && (Hands[0].IsEmpty() || Hands[1].IsEmpty())) {
        Step=EDurakStep::Over;
        Winner=Hands[0].IsEmpty()?(Hands[1].IsEmpty()?-1:0):1;
    } else { if(!Taken) Attacker=OldDefender; Step=EDurakStep::Attack; }
    Capacity=Durak::AttackLimit(Hands[Defender()].Num()); ++Round;
}
bool FCardMatch::AutoMove(int Player) {
    if(Player!=ToAct() || Player<0) return false;
    int Choice=-1,Cost=100;
    // The policy looks only at its own hand and public legal-move information.
    for(int I=0;I<Hands[Player].Num();++I) if(CanPlay(Player,I)) {
        const auto C=Hands[Player][I]; const int Value=C.Rank+(C.Suit==Trump?20:0);
        if(Value<Cost) { Choice=I; Cost=Value; }
    }
    if(Choice>=0) return Play(Player,Choice);
    if(Step==EDurakStep::Defend) {
        if(Mode==EDurakMode::Transfer) for(int I=0;I<Hands[Player].Num();++I) if(CanPlay(Player,I,-1,true)) return Play(Player,I,-1,true);
        return Take(Player);
    }
    return Pass(Player);
}
bool FCardMatch::ConservesDeck() const {
    TSet<int> Seen; int Count=0; bool Valid=true;
    const auto Add=[&](Durak::Card C) {
        const int Key=C.Suit*16+C.Rank;
        if(!Durak::Valid(C) || Seen.Contains(Key)) Valid=false;
        Seen.Add(Key); ++Count;
    };
    for(const auto& H:Hands) for(const auto C:H) Add(C);
    for(const auto C:Deck) Add(C);
    for(const auto C:Discard) Add(C);
    for(const auto& P:Table) { Add(P.Attack); if(P.Defense.IsSet()) Add(P.Defense.GetValue()); }
    return Valid && Count==36;
}
