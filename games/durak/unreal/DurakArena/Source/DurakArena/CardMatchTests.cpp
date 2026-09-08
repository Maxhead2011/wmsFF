#include "Misc/AutomationTest.h"
#include "CardMatch.h"

// TEST: real matches, not cosmetic scene selection.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCardMatchDealTest,"Durak.Match.Deal",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FCardMatchDealTest::RunTest(const FString&) {
    FCardMatch G; G.Start(EDurakMode::ThrowIn,145);
    TestEqual(TEXT("Human receives six"),G.Hands[0].Num(),6);
    TestEqual(TEXT("Bot receives six"),G.Hands[1].Num(),6);
    TestEqual(TEXT("Twenty-four remain"),G.Deck.Num(),24);
    TestTrue(TEXT("Exactly 36 unique cards"),G.ConservesDeck());
    TestEqual(TEXT("Face-up trump is drawn last"),G.Deck[0].Suit,G.Trump);
    const auto Before=G.Hands[1-G.ToAct()].Num();
    TestFalse(TEXT("Cannot play out of turn"),G.Play(1-G.ToAct(),0));
    TestEqual(TEXT("Invalid move preserved hand"),G.Hands[1-G.ToAct()].Num(),Before);
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCardMatchRoundsTest,"Durak.Match.RoundTransitions",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FCardMatchRoundsTest::RunTest(const FString&) {
    FCardMatch G; G.Mode=EDurakMode::ThrowIn; G.Trump=2; G.Attacker=0; G.Capacity=2;
    G.Hands[0]={{6,0},{9,1}}; G.Hands[1]={{7,0},{10,1}};
    TestTrue(TEXT("Attack"),G.Play(0,0));
    TestFalse(TEXT("Illegal off-suit defense"),G.Play(1,1));
    TestTrue(TEXT("Legal defense"),G.Play(1,0));
    TestFalse(TEXT("Cannot throw unmatched rank"),G.Play(0,0));
    TestTrue(TEXT("Attacker declares beaten"),G.Pass(0));
    TestEqual(TEXT("Defender attacks next"),G.Attacker,1);
    TestEqual(TEXT("Two cards discarded"),G.Discard.Num(),2);
    TestTrue(TEXT("Next attack"),G.Play(1,0));
    TestTrue(TEXT("Defender takes"),G.Take(0));
    TestTrue(TEXT("Attacker finishes throw-in window"),G.Pass(1));
    TestEqual(TEXT("Bot wins after last attack taken"),G.Winner,1);
    TestEqual(TEXT("Taken card is in human hand"),G.Hands[0].Num(),2);
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCardMatchTransferTest,"Durak.Match.TransferAndLimit",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FCardMatchTransferTest::RunTest(const FString&) {
    FCardMatch G; G.Mode=EDurakMode::Transfer; G.Attacker=0; G.Capacity=3; G.Trump=2;
    G.Hands[0]={{6,0},{8,0},{9,0}}; G.Hands[1]={{6,1},{7,1},{8,1}};
    TestTrue(TEXT("Attack"),G.Play(0,0));
    TestTrue(TEXT("Transfer matching six"),G.Play(1,0,-1,true));
    TestEqual(TEXT("Roles swapped"),G.Attacker,1);
    TestEqual(TEXT("Two attacks on table"),G.Table.Num(),2);
    TestEqual(TEXT("Capacity based on NEW defender hand"),G.Capacity,2);
    TestTrue(TEXT("Defense after transfer"),G.Play(0,0,0));
    TestFalse(TEXT("No transfer after defense"),G.Play(0,0,-1,true));
    FCardMatch Short; Short.Mode=EDurakMode::Transfer; Short.Capacity=2; Short.Attacker=0; Short.Trump=2;
    Short.Hands[0]={{6,0},{8,0}}; Short.Hands[1]={{6,1},{7,1}};
    Short.Play(0,0);
    TestFalse(TEXT("Two cards cannot transfer to one-card hand"),Short.Play(1,0,-1,true));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FCardMatchSimulationTest,"Durak.Match.CompleteGames",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FCardMatchSimulationTest::RunTest(const FString&) {
    for(const auto Mode:{EDurakMode::Simple,EDurakMode::ThrowIn,EDurakMode::Transfer}) {
        for(int Seed=1;Seed<=100;++Seed) {
            FCardMatch G; G.Start(Mode,Seed);
            int Moves=0;
            while(G.Step!=EDurakStep::Over && Moves++<5000) {
                TestTrue(TEXT("Bot policy always makes a legal move"),G.AutoMove(G.ToAct()));
                if(!TestTrue(TEXT("36 distinct cards remain after every action"),G.ConservesDeck())) return false;
                if(!TestTrue(TEXT("Attack respects six and defender capacity"),G.Table.Num()<=G.Capacity && G.Table.Num()<=6)) return false;
            }
            if(!TestTrue(FString::Printf(TEXT("Mode %d seed %d finishes"),static_cast<int>(Mode),Seed),G.Step==EDurakStep::Over)) return false;
        }
    }
    return true;
}
