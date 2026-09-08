#pragma once
#include "CoreMinimal.h"
namespace DurakMotion {
// FIX: in UE positive pitch rotates a hanging (-Z) weapon toward the fighter's +X.
inline FRotator SwordPose(float Swing) {
    Swing=FMath::Clamp(Swing,0.f,1.f);
    return FRotator(18+Swing*85,Swing*24,-10);
}

// Blender inspection: blade tip is +73.7272 cm, grip center -10 cm, Z-up.
constexpr double BladeReach=83.7272;
struct FLimb { FVector Root,Joint,End; };
struct FFighterPose {
    FVector Root,Feet[2],Grip,BladeDirection,BladeTip,ShieldCenter;
    FLimb SwordArm,ShieldArm,Legs[2];
    float Defeat{0.f};
    FRotator TorsoRotation{FRotator::ZeroRotator};
    FRotator HeadRotation{FRotator::ZeroRotator};
};
struct FFrame { FFighterPose Left,Right; FVector ContactPoint; float Impact{0.f},BrickAge{0.f}; };
inline float Smooth(float T) { T=FMath::Clamp(T,0.f,1.f); return T*T*(3-2*T); }
inline float Block(float Time,float Contact) { return Smooth((Time-Contact+.4f)/.25f)*(1-Smooth((Time-Contact-.09f)/.32f)); }
inline float Recoil(float Time,float Contact) { return Smooth((Time-Contact)/.08f)*(1-Smooth((Time-Contact-.08f)/.22f)); }
inline FVector Local(FVector Root,float Side,FVector Point) { return Root+FVector(-Side*Point.X,-Side*Point.Y,Point.Z); }
// FIX: the procedural skeleton and rendered armor share a waist pivot, in centimeters.
inline FVector Chest(const FFighterPose& P,float Side,FVector Point) {
    const FVector Pivot(0,0,75);
    return Local(P.Root,Side,Pivot+P.TorsoRotation.RotateVector(Point-Pivot));
}

// FIX: analytic two-bone IK preserves limb lengths, with a stable outward bend pole.
inline FLimb SolveLimb(FVector Root,FVector Target,FVector Pole,double Length) {
    const FVector Direction=(Target-Root).GetSafeNormal(UE_SMALL_NUMBER,FVector::ForwardVector);
    const double Distance=FMath::Clamp(FVector::Distance(Root,Target),.1,Length*2-.001);
    const FVector End=Root+Direction*Distance;
    FVector Bend=Pole-Root; Bend-=Direction*FVector::DotProduct(Bend,Direction);
    Bend=Bend.GetSafeNormal(UE_SMALL_NUMBER,FVector::RightVector);
    const double Half=Distance*.5;
    return {Root,Root+Direction*Half+Bend*FMath::Sqrt(Length*Length-Half*Half),End};
}
inline FFighterPose BasePose(float Time,float Side,int Rank,bool Loser) {
    FFighterPose P;
    const float Rise=Smooth((Time-.25f)/1.f);
    const float L1=Smooth((Time-1.3f)/.4f),R1=Smooth((Time-1.7f)/.4f),L2=Smooth((Time-2.1f)/.4f);
    const float LX=FMath::Lerp(155.f,99.f,L1)+(67.f-99.f)*L2;
    const float RX=FMath::Lerp(155.f,79.f,R1);
    const float LiftL=12*(FMath::Sin(PI*L1)+FMath::Sin(PI*L2)),LiftR=12*FMath::Sin(PI*R1);
    P.Defeat=Loser?Smooth((Time-6.58f)/.72f):0;
    P.Root=FVector(Side*(LX+RX)*.5f,0,-155*(1-Rise)-25*P.Defeat);
    P.Root.X+=Side*4*(Loser?Recoil(Time,5.3f)+Recoil(Time,6.5f):Recoil(Time,3.f)+Recoil(Time,4.15f));
    P.Feet[0]=FVector(Side*LX,Side*17,6+LiftL-155*(1-Rise));
    P.Feet[1]=FVector(Side*RX,-Side*17,6+LiftR-155*(1-Rise));
    const float Broad=Rank==13?1.2f:Rank==12?.84f:1.f;
    const FVector Shoulder=Local(P.Root,Side,{0,-31*Broad,120});
    P.Grip=Local(P.Root,Side,{27,-20,96});
    P.BladeDirection=FVector(-Side*.45,0,.893).GetSafeNormal();
    const float Blocking=Loser?Block(Time,5.3f):FMath::Max(Block(Time,3.f),Block(Time,4.15f));
    P.ShieldCenter=Local(P.Root,Side,FMath::Lerp(FVector(18,30,88),FVector(29,24,112),Blocking));
    P.SwordArm=SolveLimb(Shoulder,P.Grip,Local(P.Root,Side,{-10,-65,100}),28);
    return P;
}
// FIX: planted-foot weight shift, anticipation, parry recoil and a readable defeated pose.
inline void BodyAction(FFighterPose& P,float Time,float Side,int Rank,bool Loser) {
    float Wind=0,Hit=0;
    const float Contacts[]={Loser?3.f:5.3f,Loser?4.15f:6.5f};
    for(float Contact:Contacts) {
        Wind+=Smooth((Time-Contact+.55f)/.37f)*(1-Smooth((Time-Contact+.18f)/.18f));
        Hit+=Smooth((Time-Contact+.18f)/.18f)*(1-Smooth((Time-Contact-.065f)/.455f));
    }
    const float Reaction=Loser?Recoil(Time,5.3f)+Recoil(Time,6.5f):Recoil(Time,3.f)+Recoil(Time,4.15f);
    P.Root.X+=Side*(3*Wind-8*Hit);
    P.Root.Z-=3*Wind+6*Hit;
    P.TorsoRotation=FRotator(7*Wind-9*Hit+14*Reaction-30*P.Defeat,-22*Wind+17*Hit,3*Wind-4*Hit);
    P.HeadRotation=FRotator(-15*P.Defeat,-.7f*P.TorsoRotation.Yaw,0);
    P.Grip=FMath::Lerp(Chest(P,Side,{27,-20,96}),Local(P.Root,Side,{28,-20,58}),P.Defeat);
    P.BladeDirection=FMath::Lerp(P.BladeDirection,FVector(-Side*.95,0,-.28).GetSafeNormal(),P.Defeat).GetSafeNormal();
    const float Blocking=Loser?Block(Time,5.3f):FMath::Max(Block(Time,3.f),Block(Time,4.15f));
    P.ShieldCenter=Chest(P,Side,FMath::Lerp(FVector(18,30,88),FVector(29,24,112),Blocking));
    const float Broad=Rank==12?.84f:1.f;
    P.SwordArm.Root=Chest(P,Side,{0,-31*Broad,120});
}
inline void Strike(FFighterPose& P,float Time,float ContactTime,float Side,FVector Target,bool BodyMotion=false) {
    if(Time<ContactTime-.55f || Time>ContactTime+.52f) return;
    const FVector Guard=P.Grip,GuardDirection=P.BladeDirection;
    FVector Wind=Local(P.Root,Side,{-13,-25,145});
    FVector WindDirection=FVector::UpVector;
    if(BodyMotion && FMath::IsNearlyEqual(ContactTime,4.15f)) {
        Wind=Local(P.Root,Side,{-8,-34,127});
        WindDirection=FVector(-Side*.15,Side*.88,.45).GetSafeNormal();
    } else if(BodyMotion && FMath::IsNearlyEqual(ContactTime,5.3f)) {
        Wind=Local(P.Root,Side,{0,-22,115});
        WindDirection=FVector(-Side*.4,Side*.55,.7).GetSafeNormal();
    }
    const FVector HitDirection=(Target-P.SwordArm.Root).GetSafeNormal();
    const FVector Hit=Target-HitDirection*BladeReach;
    FVector From,To,FromDirection,ToDirection;
    float Alpha=0;
    if(Time<ContactTime-.18f) {
        From=Guard; To=Wind; FromDirection=GuardDirection; ToDirection=WindDirection;
        Alpha=Smooth((Time-(ContactTime-.55f))/.37f);
    } else if(Time<ContactTime) {
        From=Wind; To=Hit; FromDirection=WindDirection; ToDirection=HitDirection;
        Alpha=Smooth((Time-(ContactTime-.18f))/.18f);
    } else if(Time<ContactTime+.065f) {
        From=Hit; To=Hit; FromDirection=HitDirection; ToDirection=HitDirection;
    } else {
        From=Hit; To=Guard; FromDirection=HitDirection; ToDirection=GuardDirection;
        Alpha=Smooth((Time-(ContactTime+.065f))/.455f);
    }
    P.Grip=FMath::Lerp(From,To,Alpha);
    P.BladeDirection=FQuat::Slerp(FQuat::FindBetweenNormals(FVector::UpVector,FromDirection),FQuat::FindBetweenNormals(FVector::UpVector,ToDirection),Alpha).RotateVector(FVector::UpVector);
}
inline void FinishPose(FFighterPose& P,float Side,int Rank) {
    const float Broad=Rank==13?1.2f:Rank==12?.84f:1.f;
    P.SwordArm=SolveLimb(Chest(P,Side,{0,-31*Broad,120}),P.Grip,Local(P.Root,Side,{-10,-65,100}),28);
    P.Grip=P.SwordArm.End;
    P.BladeTip=P.Grip+P.BladeDirection*BladeReach;
    P.ShieldArm=SolveLimb(Chest(P,Side,{0,31*Broad,120}),P.ShieldCenter-FVector(-Side*6,0,0),Local(P.Root,Side,{-10,65,95}),28);
    for(int I=0;I<2;++I) P.Legs[I]=SolveLimb(Local(P.Root,Side,{0,I==0?-13.:13.,67}),P.Feet[I],Local(P.Root,Side,{55,I==0?-16.:16.,30}),34);
}
inline FFrame Evaluate(float Time,int WinnerRank,bool Wall,int LoserRank=11,bool BodyMotion=false) {
    FFrame F; F.Left=BasePose(Time,-1,LoserRank,true); F.Right=BasePose(Time,1,WinnerRank,false);
    if(BodyMotion) { BodyAction(F.Left,Time,-1,LoserRank,true); BodyAction(F.Right,Time,1,WinnerRank,false); }
    const float Times[]={3.f,4.15f,5.3f,6.5f};
    for(int I=0;I<4;++I) {
        if(Wall && I<3) continue;
        const bool Right=I>=2;
        FVector Target=Right?F.Left.ShieldCenter:F.Right.ShieldCenter;
        if(I==3) Target=Wall?FVector(-45,0,85):Local(F.Left.Root,-1,{24,0,107});
        Strike(Right?F.Right:F.Left,Time,Times[I],Right?1.f:-1.f,Target,BodyMotion);
        const float Age=Time-Times[I];
        if(Age>=0 && Age<.18f) { F.ContactPoint=Target; F.Impact=1-Smooth(Age/.18f); }
    }
    F.BrickAge=Wall?FMath::Max(0.f,Time-6.5f):0.f;
    FinishPose(F.Left,-1,LoserRank); FinishPose(F.Right,1,WinnerRank);
    return F;
}
}
