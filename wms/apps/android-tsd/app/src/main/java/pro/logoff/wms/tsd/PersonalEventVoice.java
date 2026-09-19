package pro.logoff.wms.tsd;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
// FIX: announce transitions once; an empty queue does not establish completion.
final class PersonalEventVoice {
 enum Cue { FBS_OPEN, FBS_DONE, FBS_EMPTY, RECOUNT, KIZ_CHECK, PALLET }
 private String opening, lastTerminal;
 void selected(String id){opening=id;lastTerminal=null;}
 Cue fbs(String id,TsdFbsAssemblyResponse response){
  if(id==null||id.isEmpty()||response==null)return null;
  var p=response.progress;
  Cue terminal=p!=null&&p.requestTotalItems>0&&p.requestCompletedItems>=p.requestTotalItems&&p.requestRemainingItems==0
    ?Cue.FBS_DONE:response.task==null?Cue.FBS_EMPTY:null;
  if(terminal!=null){opening=null;String key=id+":"+terminal;if(key.equals(lastTerminal))return null;lastTerminal=key;return terminal;}
  lastTerminal=null;
  if(id.equals(opening)){opening=null;return Cue.FBS_OPEN;}
  return null;
 }
}
