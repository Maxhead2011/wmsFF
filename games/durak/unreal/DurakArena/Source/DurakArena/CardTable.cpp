#include "CardTable.h"
#include "DuelStage.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

ACardTable::ACardTable() { PrimaryActorTick.bCanEverTick=true; }
void ACardTable::BeginPlay() {
    Super::BeginPlay();
    Stage=GetWorld()->SpawnActor<ADuelStage>();
    AutoTest=FParse::Param(FCommandLine::Get(),TEXT("CardAutoPlay"));
    // FIX: optional development launch flag; regular matches still start with combat off.
    CombatEnabled=FParse::Param(FCommandLine::Get(),TEXT("CardCombat"));
    NewGame(EDurakMode::ThrowIn);
    UE_LOG(LogTemp,Display,TEXT("DURAK_CARD_GAME_READY: human versus bot, combat=%d"),CombatEnabled);
}
void ACardTable::NewGame(EDurakMode Mode) {
    int Seed=static_cast<int>(FPlatformTime::Cycles());
    FParse::Value(FCommandLine::Get(),TEXT("CardSeed="),Seed);
    Match.Start(Mode,Seed); SelectedTarget=-1; TransferSelected=false; MenuOpen=false;
    AnimationRemaining=0; Message.Empty(); BotDelay=.9f;
    if(Stage) Stage->ClearCombat();
}
void ACardTable::AfterMove(bool Success) {
    if(!Success) { Message=Match.Error; MessageRemaining=3.f; return; }
    Message.Empty(); SelectedTarget=Match.OpenTarget(); TransferSelected=false; BotDelay=.9f;
    check(Match.ConservesDeck());
    if(CombatEnabled && Match.LastDefense.IsSet() && Match.LastDefense->Defense->Rank>=11 && Stage) {
        const auto& Pair=Match.LastDefense.GetValue();
        Stage->ShowCombat(Pair.Attack,Pair.Defense.GetValue(),Match.Trump);
        // FIX: do not truncate the 11-second skeletal finish at the old 9-second deadline.
        AnimationRemaining=Stage->CombatDuration();
    }
    if(Match.Step==EDurakStep::Over)
        UE_LOG(LogTemp,Display,TEXT("DURAK_MATCH_COMPLETE: winner=%d rounds=%d conserved=%d"),Match.Winner,Match.Round,Match.ConservesDeck());
}
void ACardTable::Act(ECardAction Action,int Index) {
    if(Action==ECardAction::Quit) { if(auto* PC=GetWorld()->GetFirstPlayerController()) PC->ConsoleCommand(TEXT("quit")); return; }
    if(Action==ECardAction::Menu) { MenuOpen=true; if(Stage) Stage->Paused=true; return; }
    if(Action==ECardAction::Close) { MenuOpen=false; if(Stage) Stage->Paused=false; return; }
    if(Action==ECardAction::Mode) { if(MenuOpen && Index>=0 && Index<=2) NewGame(static_cast<EDurakMode>(Index)); return; }
    if(Action==ECardAction::Skip) { AnimationRemaining=0; if(Stage) Stage->ClearCombat(); return; }
    if(Action==ECardAction::Combat) {
        CombatEnabled=!CombatEnabled;
        if(!CombatEnabled) { AnimationRemaining=0; if(Stage) Stage->ClearCombat(); }
        return;
    }
    if(MenuOpen || AnimationRemaining>0 || Match.ToAct()!=0) return;
    switch(Action) {
    case ECardAction::Target:
        if(Match.Table.IsValidIndex(Index) && !Match.Table[Index].Defense.IsSet()) SelectedTarget=Index;
        break;
    case ECardAction::Hand: AfterMove(Match.Play(0,Index,SelectedTarget,TransferSelected)); break;
    case ECardAction::Take: AfterMove(Match.Take(0)); break;
    case ECardAction::Pass: AfterMove(Match.Pass(0)); break;
    case ECardAction::Transfer: TransferSelected=!TransferSelected; break;
    default: break;
    }
}
void ACardTable::Tick(float DeltaSeconds) {
    Super::Tick(DeltaSeconds);
    if(auto* PC=GetWorld()->GetFirstPlayerController()) {
        if(PC->WasInputKeyJustPressed(EKeys::LeftMouseButton)) {
            float X=0,Y=0;
            if(PC->GetMousePosition(X,Y)) if(auto* HUD=Cast<ACardHUD>(PC->GetHUD())) HUD->Click(X,Y);
        }
        if(PC->WasInputKeyJustPressed(EKeys::SpaceBar) && AnimationRemaining>0) Act(ECardAction::Skip);
        if(PC->WasInputKeyJustPressed(EKeys::Escape)) MenuOpen=!MenuOpen;
        if(PC->WasInputKeyJustPressed(EKeys::N)) MenuOpen=true;
    }
    if(MessageRemaining>0) { MessageRemaining-=DeltaSeconds; if(MessageRemaining<=0) Message.Empty(); }
    if(Stage) Stage->Paused=MenuOpen;
    if(MenuOpen) return;
    if(AnimationRemaining>0) {
        AnimationRemaining-=DeltaSeconds;
        if(AnimationRemaining<=0 && Stage) Stage->ClearCombat();
        return;
    }
    if(Match.ToAct()==1 || (AutoTest && Match.ToAct()==0)) {
        BotDelay-=DeltaSeconds;
        if(BotDelay<=0) {
            AfterMove(Match.AutoMove(Match.ToAct()));
            if(AutoTest) BotDelay=.025f;
        }
    }
}
FString ACardTable::ModeName() const {
    return Match.Mode==EDurakMode::Simple?TEXT("Простой"):Match.Mode==EDurakMode::Transfer?TEXT("Переводной"):TEXT("Подкидной");
}
FString ACardTable::Instruction() const {
    if(Match.Step==EDurakStep::Over) return Match.Winner==0?TEXT("Вы выиграли!"):Match.Winner==1?TEXT("На этот раз победил соперник"):TEXT("Ничья — карты закончились у обоих");
    if(AnimationRemaining>0) return TEXT("Карта побита. Space — вернуться к картам");
    if(!Message.IsEmpty()) return Message;
    if(Match.ToAct()==1) return Match.Step==EDurakStep::PickingUp?TEXT("Вы берёте. Соперник может подкинуть карты"):TEXT("Соперник выбирает ход...");
    if(TransferSelected) return TEXT("Перевод: выберите карту того же номинала");
    switch(Match.Step) {
    case EDurakStep::Attack: return TEXT("Ваш ход. Нажмите на карту в своей руке");
    case EDurakStep::Defend: return TEXT("Отбейте выделенную карту или нажмите «Взять»");
    case EDurakStep::ThrowIn: return TEXT("Подкиньте совпадающий номинал или нажмите «Бито»");
    case EDurakStep::PickingUp: return TEXT("Соперник берёт. Подкиньте карты или завершите ход");
    default: return TEXT("");
    }
}
