package pro.logoff.wms.tsd.network;
import java.util.List;
public class TsdReceiptPlacementTask {
 public String id,clientId,client,document,date,status;
 public int total,placed;
 public boolean canFinish,receiving;
 public List<String> remaining,boxes,excluded;
}
