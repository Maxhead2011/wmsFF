#include "CardTable.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "Engine/Texture2D.h"

namespace {
const FLinearColor Ink(.014f,.025f,.032f),Paper(.96f,.94f,.86f),Gold(.83f,.66f,.36f),Muted(.61f,.69f,.67f),Felt(.035f,.115f,.095f),Red(.65f,.035f,.06f);
FString Rank(int R) { return R==14?TEXT("A"):R==13?TEXT("K"):R==12?TEXT("Q"):R==11?TEXT("J"):FString::FromInt(R); }
}
ACardTable* ACardHUD::Table() const {
    for(TActorIterator<ACardTable> It(GetWorld());It;++It) return *It;
    return nullptr;
}
void ACardHUD::Box(float X,float Y,float W,float H,FLinearColor Color) { DrawRect(Color,OffsetX+X*Scale,OffsetY+Y*Scale,W*Scale,H*Scale); }
void ACardHUD::Text(const FString& Value,float X,float Y,float Size,FLinearColor Color) {
    DrawText(Value,Color,OffsetX+X*Scale,OffsetY+Y*Scale,GEngine->GetLargeFont(),Size*Scale);
}
void ACardHUD::Hit(float X,float Y,float W,float H,ECardAction Action,int Index) {
    Hits.Add({FBox2D(FVector2D(X,Y),FVector2D(X+W,Y+H)),Action,Index});
}
void ACardHUD::Click(float X,float Y) {
    auto* T=Table(); if(!T || Scale<=0) return;
    const FVector2D Point((X-OffsetX)/Scale,(Y-OffsetY)/Scale);
    for(int I=Hits.Num()-1;I>=0;--I) if(Hits[I].Rect.IsInside(Point)) { const auto H=Hits[I]; T->Act(H.Action,H.Index); return; }
}
void ACardHUD::Suit(int Value,float X,float Y,float Size,FLinearColor Color) {
    // Vector suit shapes remain readable without depending on Unicode font glyphs.
    const auto Disc=[&](float CX,float CY,float R) {
        for(float DY=-R;DY<=R;DY+=1.f) {
            const float DX=FMath::Sqrt(FMath::Max(0.f,R*R-DY*DY));
            Box(CX-DX,CY+DY,DX*2,1.1f,Color);
        }
    };
    if(Value==1) {
        for(float DY=-Size;DY<=Size;DY+=1.f) { const float DX=(Size-FMath::Abs(DY))*.68f; Box(X-DX,Y+DY,DX*2,1.1f,Color); }
    } else if(Value==0) {
        Disc(X,Y-Size*.46f,Size*.43f); Disc(X-Size*.43f,Y+Size*.18f,Size*.43f); Disc(X+Size*.43f,Y+Size*.18f,Size*.43f);
        Box(X-Size*.12f,Y,Size*.24f,Size,Color); Box(X-Size*.4f,Y+Size*.84f,Size*.8f,Size*.13f,Color);
    } else {
        const float Flip=Value==2?1.f:-1.f;
        Disc(X-Size*.4f,Y-Flip*Size*.28f,Size*.44f); Disc(X+Size*.4f,Y-Flip*Size*.28f,Size*.44f);
        for(float DY=0;DY<=Size;DY+=1.f) { const float DX=(Size-DY)*.79f; Box(X-DX,Y+Flip*DY,DX*2,1.1f,Color); }
        if(Value==3) { Box(X-Size*.12f,Y,Size*.24f,Size,Color); Box(X-Size*.4f,Y+Size*.84f,Size*.8f,Size*.13f,Color); }
    }
}
void ACardHUD::Card(Durak::Card Value,float X,float Y,float W,float H,bool Selected,bool Playable,bool Back) {
    Box(X+4,Y+7,W,H,FLinearColor(0,0,0,.45f));
    Box(X-2,Y-2,W+4,H+4,Selected?Gold:Playable?FLinearColor(.28f,.68f,.48f):Ink);
    // FIX: retain the exact rank/suit but render real court artwork and printed pip placement.
    const int Key=Back?0:Value.Suit*16+Value.Rank;
    if(!CardTextures.Contains(Key)) {
        const TCHAR* Suits[]={TEXT("C"),TEXT("D"),TEXT("H"),TEXT("S")};
        const FString Face=Back?TEXT("1B"):(Value.Rank==10?FString(TEXT("T")):Rank(Value.Rank))+Suits[Value.Suit];
        CardTextures.Add(Key,LoadObject<UTexture2D>(nullptr,*(TEXT("/Game/Cards/T_")+Face)));
    }
    if(auto* Texture=CardTextures[Key].Get()) {
        DrawTexture(Texture,OffsetX+X*Scale,OffsetY+Y*Scale,W*Scale,H*Scale,0,0,1,1,FLinearColor::White);
        return;
    }
    Box(X,Y,W,H,Back?Ink:Paper);
    if(Back) {
        Box(X+5,Y+5,W-10,H-10,Gold); Box(X+6,Y+6,W-12,H-12,Felt);
        Suit(1,X+W*.5f,Y+H*.5f,FMath::Min(W*.25f,H*.25f),Gold); return;
    }
    const FLinearColor Color=Value.Suit==1||Value.Suit==2?Red:Ink;
    const float Type=FMath::Clamp(H/110.f,.66f,1.2f);
    Text(Rank(Value.Rank),X+7,Y+4,Type,Color);
    Suit(Value.Suit,X+W-15,Y+17,FMath::Min(8.f,H*.1f),Color);
    if(H>=90) {
        Suit(Value.Suit,X+W*.5f,Y+H*.55f,FMath::Min(W*.23f,H*.18f),Color);
        Text(Rank(Value.Rank),X+W-29,Y+H-28,.72f,Color);
    } else Suit(Value.Suit,X+W*.62f,Y+H*.62f,11,Color);
}
void ACardHUD::Button(const FString& Label,float X,float Y,float W,ECardAction Action,int Index,bool Enabled,bool Selected) {
    Box(X+2,Y+4,W,46,FLinearColor(0,0,0,.4f));
    Box(X,Y,W,46,Selected?Gold:Enabled?FLinearColor(.085f,.17f,.15f):FLinearColor(.035f,.055f,.052f));
    Box(X,Y,W,1,Enabled?Gold:Muted*.3f);
    Text(Label,X+16,Y+13,.77f,Selected?Ink:Enabled?Paper:Muted*.65f);
    if(Enabled) Hit(X,Y,W,46,Action,Index);
}
void ACardHUD::DrawHUD() {
    Super::DrawHUD(); if(!Canvas) return;
    auto* T=Table(); if(!T) return;
    Scale=FMath::Min(Canvas->SizeX/1600.f,Canvas->SizeY/900.f);
    OffsetX=(Canvas->SizeX-1600*Scale)*.5f; OffsetY=(Canvas->SizeY-900*Scale)*.5f;
    Hits.Reset(); const auto& G=T->Match;
    // FIX: keep the fight viewport clear; only the actual played pair and Skip stay visible.
    if(T->AnimationRemaining>0 && !T->MenuOpen) {
        Box(0,0,1600,88,FLinearColor(.008f,.018f,.022f,.92f));
        Text(TEXT("LOGOFF  /  КАРТОЧНЫЙ ПОЕДИНОК"),32,22,1.f,Gold);
        if(G.LastDefense.IsSet()) {
            const auto& Pair=G.LastDefense.GetValue();
            Text(Rank(Pair.Attack.Rank)+TEXT("  →  ")+Rank(Pair.Defense->Rank),670,21,1.4f,Paper);
            Suit(Pair.Attack.Suit,643,40,12,Gold);
            Suit(Pair.Defense->Suit,850,40,12,Gold);
        }
        Button(TEXT("Пропустить бой"),1310,20,260,ECardAction::Skip);
        Box(0,850,1600,50,FLinearColor(.008f,.018f,.022f,.90f));
        Text(TEXT("Карта побита. Space — к столу. Esc — меню."),32,865,.8f,Paper);
        return;
    }
    Box(0,0,1600,900,FLinearColor(.008f,.022f,.023f,.34f));
    Box(0,0,1600,91,FLinearColor(.008f,.018f,.022f,.96f));
    Text(TEXT("LOGOFF"),38,16,.75f,Gold); Text(TEXT("ДУРАК"),36,36,1.9f,Paper);
    Text(T->ModeName()+TEXT("  /  против компьютера"),295,27,.95f,Paper);
    Text(FString::Printf(TEXT("Круг %d   ·   Колода 36 карт   ·   До 6 карт на столе"),G.Round),295,55,.66f,Muted);
    Button(TEXT("Новая игра"),1230,23,180,ECardAction::Menu);
    Button(TEXT("Выход"),1426,23,135,ECardAction::Quit);
    Text(FString::Printf(TEXT("СОПЕРНИК  ·  %d карт"),G.Hands[1].Num()),665,110,.8f,Paper);
    const int Backs=FMath::Min(12,G.Hands[1].Num());
    for(int I=0;I<Backs;++I) Card({},800-Backs*25+I*50,144,45,66,false,false,true);
    Text(TEXT("КОЛОДА"),42,251,.75f,Muted);
    if(!G.Deck.IsEmpty()) { Card({},49,301,88,128,false,false,true); Card(G.TrumpCard,83,320,88,128); }
    else Card(G.TrumpCard,49,301,88,128);
    Text(FString::Printf(TEXT("%d карт"),G.Deck.Num()),43,467,.95f,Paper);
    Text(TEXT("Козырная масть"),43,497,.63f,Muted);
    Suit(G.Trump,65,545,19,Gold);
    Text(TEXT("ОТБОЙ"),1430,265,.75f,Muted);
    Text(FString::FromInt(G.Discard.Num()),1429,299,2.1f,Paper);
    Text(TEXT("карт вышло"),1430,357,.63f,Muted);
    if(T->AnimationRemaining<=0) {
        if(G.Table.IsEmpty()) {
            Text(G.Step==EDurakStep::Over?TEXT("ПАРТИЯ ЗАВЕРШЕНА"):TEXT("ВАШ КАРТОЧНЫЙ СТОЛ"),563,338,1.15f,Gold);
            Text(TEXT("Старшая карта той же масти бьёт младшую."),530,383,.74f,Muted);
            Text(TEXT("Козырь бьёт любую некозырную карту."),556,410,.74f,Muted);
        }
        const float Start=800-G.Table.Num()*79.f;
        for(int I=0;I<G.Table.Num();++I) {
            const auto& P=G.Table[I]; const float X=Start+I*158;
            const bool Selected=!P.Defense.IsSet() && I==(T->SelectedTarget>=0?T->SelectedTarget:G.OpenTarget());
            Card(P.Attack,X,273,99,143,Selected);
            if(!P.Defense.IsSet()) Hit(X,273,124,173,ECardAction::Target,I);
            if(P.Defense.IsSet()) Card(P.Defense.GetValue(),X+26,306,99,143);
            Text(P.Defense.IsSet()?TEXT("Побита"):TEXT("Отбейте"),X+12,463,.64f,P.Defense.IsSet()?Muted:Gold);
        }
    }
    Box(275,520,1060,46,FLinearColor(.008f,.022f,.023f,.93f));
    Text(T->Instruction(),295,533,.88f,T->Message.IsEmpty()?Paper:FLinearColor(1,.45f,.3f));
    const bool Human=G.ToAct()==0 && T->AnimationRemaining<=0;
    Button(TEXT("Взять"),350,584,145,ECardAction::Take,0,Human && G.Step==EDurakStep::Defend);
    Button(G.Step==EDurakStep::PickingUp?TEXT("Завершить ход"):TEXT("Бито"),511,584,210,ECardAction::Pass,0,Human && (G.Step==EDurakStep::ThrowIn||G.Step==EDurakStep::PickingUp));
    Button(TEXT("Перевести"),737,584,185,ECardAction::Transfer,0,Human && G.Mode==EDurakMode::Transfer && G.Step==EDurakStep::Defend,T->TransferSelected);
    Button(T->CombatEnabled?TEXT("Бои: вкл"):TEXT("Бои: выкл"),938,584,172,ECardAction::Combat,0,true,T->CombatEnabled);
    if(T->AnimationRemaining>0) Button(TEXT("Пропустить бой"),1126,584,220,ECardAction::Skip);
    Box(0,651,1600,249,FLinearColor(.008f,.018f,.022f,.95f));
    Text(FString::Printf(TEXT("ВАША РУКА  /  %d карт"),G.Hands[0].Num()),36,670,.76f,Gold);
    Text(TEXT("Нажмите карту, чтобы сыграть. Подсвечены доступные ходы."),365,671,.69f,Muted);
    const int Count=G.Hands[0].Num(),Rows=FMath::Max(1,(Count+11)/12);
    const float CH=Rows==1?151.f:Rows==2?78.f:51.f,CW=Rows==1?99.f:93.f;
    for(int I=0;I<Count;++I) {
        const int Row=I/12,Col=I%12,InRow=FMath::Min(12,Count-Row*12);
        const float X=800-InRow*(CW+13)*.5f+Col*(CW+13),Y=711+Row*(CH+10);
        const bool Playable=Human && G.CanPlay(0,I,T->SelectedTarget,T->TransferSelected);
        Card(G.Hands[0][I],X,Y,CW,CH,false,Playable);
        Hit(X,Y,CW,CH,ECardAction::Hand,I);
    }
    if(G.Step==EDurakStep::Over) Button(TEXT("Сыграть ещё"),681,224,240,ECardAction::Menu,0,true,true);
    if(T->MenuOpen) {
        Hits.Reset(); // FIX: modal cannot leak clicks into cards behind it.
        Box(0,0,1600,900,FLinearColor(0,0,0,.78f));
        Box(430,210,740,430,Ink); Box(430,210,740,3,Gold);
        Text(TEXT("Новая партия"),470,244,1.7f,Paper);
        Text(TEXT("Текущая партия будет завершена. Выберите правила:"),470,301,.8f,Muted);
        Button(TEXT("Простой · без подкидывания"),470,354,660,ECardAction::Mode,0);
        Button(TEXT("Подкидной · совпадающие номиналы"),470,416,660,ECardAction::Mode,1);
        Button(TEXT("Переводной · можно передать атаку"),470,478,660,ECardAction::Mode,2);
        Button(TEXT("Продолжить текущую партию"),470,564,660,ECardAction::Close);
    }
}
