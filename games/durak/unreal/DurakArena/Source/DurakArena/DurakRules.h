#pragma once
#include "CoreMinimal.h"
namespace Durak {
struct Card { int Rank{6}; int Suit{0}; };
// FIX: pure rule check shared by scene and automation tests, independent of animation.
constexpr bool Valid(Card C) { return C.Rank>=6 && C.Rank<=14 && C.Suit>=0 && C.Suit<4; }
constexpr bool CanBeat(Card A, Card D, int Trump) {
    return Valid(A) && Valid(D) && Trump>=0 && Trump<4 &&
        (A.Suit==D.Suit ? D.Rank>A.Rank : D.Suit==Trump && A.Suit!=Trump);
}
constexpr int AttackLimit(int Hand) { return Hand<0?0:(Hand>6?6:Hand); }
}
