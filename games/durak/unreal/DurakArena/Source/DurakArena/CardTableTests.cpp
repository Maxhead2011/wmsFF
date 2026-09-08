#include "Misc/AutomationTest.h"
#include "CardTable.h"
#include "DuelStage.h"
#include "Engine/World.h"

// TEST: the default game exposes cards, not the old five-scene showcase HUD.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakDefaultGameTest,"Durak.Interface.DefaultCardGame",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakDefaultGameTest::RunTest(const FString& Parameters) {
    TestEqual(TEXT("Real card HUD is default"),GetDefault<ADuelGameMode>()->HUDClass.Get(),ACardHUD::StaticClass());
    TestFalse(TEXT("Rough combat is opt-in"),GetDefault<ACardTable>()->CombatEnabled);
    return true;
}

// TEST: exercise the same action dispatcher as mouse clicks, including a complete match.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDurakTableActionsTest,"Durak.Interface.ActionsAndCompleteMatch",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FDurakTableActionsTest::RunTest(const FString& Parameters) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Test world"),World)) return false;
    ACardTable* Table=World->SpawnActor<ACardTable>();
    if(!TestNotNull(TEXT("Game table"),Table)) { World->DestroyWorld(false); return false; }
    Table->NewGame(EDurakMode::ThrowIn);
    Table->Match.Start(EDurakMode::ThrowIn,145);
    Table->Act(ECardAction::Menu);
    const int Before=Table->Match.Hands[0].Num();
    Table->Act(ECardAction::Hand,0);
    TestEqual(TEXT("Menu blocks cards"),Table->Match.Hands[0].Num(),Before);
    Table->Act(ECardAction::Mode,2);
    TestTrue(TEXT("New game switches to transfer"),Table->Match.Mode==EDurakMode::Transfer);
    TestFalse(TEXT("New game closes menu"),Table->MenuOpen);
    Table->Act(ECardAction::Combat);
    Table->AnimationRemaining=4;
    Table->Act(ECardAction::Skip);
    TestEqual(TEXT("Skip ends only animation"),Table->AnimationRemaining,0.f);
    TestTrue(TEXT("Skip preserves all cards"),Table->Match.ConservesDeck());
    Table->Act(ECardAction::Combat);
    Table->Match.Start(EDurakMode::Transfer,145);
    for(int Turn=0;Turn<5000 && Table->Match.Step!=EDurakStep::Over;++Turn) {
        if(Table->Match.ToAct()==1) Table->Tick(1.f);
        else {
            bool Played=false;
            for(int I=0;I<Table->Match.Hands[0].Num();++I) if(Table->Match.CanPlay(0,I)) {
                Table->Act(ECardAction::Target,Table->Match.OpenTarget());
                Table->Act(ECardAction::Hand,I); Played=true; break;
            }
            if(!Played) Table->Act(Table->Match.Step==EDurakStep::Defend?ECardAction::Take:ECardAction::Pass);
        }
        if(!TestTrue(TEXT("UI action conserves all 36 cards"),Table->Match.ConservesDeck())) break;
    }
    TestTrue(TEXT("Mouse-action path reaches end of match"),Table->Match.Step==EDurakStep::Over);
    World->DestroyWorld(false);
    return true;
}
