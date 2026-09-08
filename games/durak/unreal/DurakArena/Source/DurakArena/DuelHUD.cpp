#include "DuelStage.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"

void ADuelHUD::DrawHUD() {
    Super::DrawHUD(); if(!Canvas) return;
    ADuelStage* Stage=nullptr;
    for(TActorIterator<ADuelStage> It(GetWorld());It;++It) { Stage=*It; break; }
    if(!Stage) return;
    const float W=Canvas->SizeX,H=Canvas->SizeY;
    const FLinearColor Gold(.82f,.64f,.34f),White(.94f,.91f,.83f),Muted(.55f,.60f,.64f);
    DrawRect(FLinearColor(.008f,.012f,.02f,.92f),0,0,W,104);
    DrawText(TEXT("LOGOFF / DURAK"),Gold,32,18,GEngine->GetLargeFont(),1.15f);
    DrawText(Stage->Title(),White,32,52,GEngine->GetLargeFont(),W<1200?1.f:1.65f);
    DrawText(TEXT("ROYAL DUEL   /   ПРОТОТИП 01"),Muted,W-360,24,GEngine->GetSmallFont(),1.1f);
    DrawText(TEXT("SPACE — пауза     R — повтор     ESC — выход"),Muted,W-440,63,GEngine->GetSmallFont(),1.f);
    DrawRect(FLinearColor(.008f,.012f,.02f,.90f),0,H-157,W,157);
    DrawText(Stage->Phase(),Gold,32,H-142,GEngine->GetSmallFont(),1.1f);
    if(W>=1200) DrawText(TEXT("3D-постановка  ·  Победа определяется правилами карт"),Muted,W-460,H-142,GEngine->GetSmallFont(),1.f);
    const TCHAR* Labels[]={TEXT("1   ВАЛЕТ × 10"),TEXT("2   ДАМА × ВАЛЕТ"),TEXT("3   КОРОЛЬ × ДАМА"),TEXT("4   КОЗЫРЬ × ТУЗ"),TEXT("5   ТУЗ × КОРОЛЬ")};
    const float Slot=(W-64)/5.f;
    for(int I=0;I<5;++I) {
        const float X=32+I*Slot;
        DrawRect(FLinearColor(0,0,0,.7f),X+2,H-100,Slot-10,63);
        DrawRect(I==Stage->Scenario?FLinearColor(.20f,.13f,.055f):FLinearColor(.035f,.045f,.06f),X,H-104,Slot-10,60);
        DrawRect(I==Stage->Scenario?Gold:FLinearColor(.15f,.18f,.22f),X,H-104,Slot-10,2);
        DrawText(Labels[I],I==Stage->Scenario?White:Muted,X+14,H-84,GEngine->GetSmallFont(),1.05f);
    }
    // FIX: scene durations differ (five-second wall strike, eleven-second royal duel).
    DrawRect(Gold,32,H-26,(W-64)*FMath::Clamp(Stage->Clock/Stage->CombatDuration(),0.f,1.f),2);
}
