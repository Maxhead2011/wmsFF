type Unit={state:string;sourceBoxCode:string;wholeBox:boolean};
type Route={boxCode:string;wholeBox:boolean;tasks:Array<{quantity:number}>};
type Box={boxId:string;closedAt:unknown};
// FIX: count physical boxes once and retain completed work when the remaining route disappears.
export function fboBoxStatistics(units:Array<Unit&{targetBoxId?:string|null}>,route:Route[],boxes:Box[],unboxedRemaining=0){
 const active=units.filter(u=>u.state==='PICKED'||u.state==='PACKED');
 const source=active.map(u=>u.sourceBoxCode).filter(c=>c&&!c.startsWith('FBO-UNBOXED-'));
 const whole=new Set(active.filter(u=>u.wholeBox).map(u=>u.sourceBoxCode));
 for(const r of route)if(r.wholeBox)whole.add(r.boxCode);
 const packedTargets=new Set(active.filter(u=>u.state==='PACKED').map(u=>u.targetBoxId));
 // FIX: picking remainder comes from the current route, independently of packing remainder.
 const remainingPartialPickUnits=route.filter(r=>!r.wholeBox).reduce((n,r)=>n+r.tasks.reduce((s,t)=>s+t.quantity,0),0)+unboxedRemaining;
 const wholeRoute=route.filter(r=>r.wholeBox);
 const remainingWholePickBoxes=new Set(wholeRoute.map(r=>r.boxCode)).size;
 const remainingWholePickUnits=wholeRoute.reduce((n,r)=>n+r.tasks.reduce((s,t)=>s+t.quantity,0),0);
 // FIX: pending whole boxes are distinct physical sources, not unit counts or remaining route.
 return {remainingWholeBoxes:new Set(active.filter(u=>u.wholeBox&&u.state==='PICKED'&&u.sourceBoxCode).map(u=>u.sourceBoxCode)).size,pickedBoxes:new Set(source).size,packedBoxes:new Set(boxes.filter(b=>b.closedAt&&packedTargets.has(b.boxId)).map(b=>b.boxId)).size,
 partialUnits:active.filter(u=>!u.wholeBox).length+route.filter(r=>!r.wholeBox).reduce((n,r)=>n+r.tasks.reduce((s,t)=>s+t.quantity,0),0)+unboxedRemaining,
 wholeBoxes:whole.size,remainingPartialPickUnits,remainingWholePickBoxes,remainingWholePickUnits};
}
