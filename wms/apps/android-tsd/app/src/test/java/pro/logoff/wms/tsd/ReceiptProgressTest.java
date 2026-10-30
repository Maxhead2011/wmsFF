package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.*;
import pro.logoff.wms.tsd.data.*;
import static org.junit.Assert.*;

public class ReceiptProgressTest {
    private PendingOperation op(String key,String type,String box,OperationStatus status,String client,String doc){
        Map<String,String> p=new HashMap<>();p.put("clientId",client);p.put("sourceDocument",doc);p.put("boxCode",box);p.put("quantity","1");
        return new PendingOperation(key,type,p,1,status,0,null);
    }
    // TEST: six late acknowledgements turn 3 into 9 without another button press.
    @Test public void lateSyncRestoresNineBoxesAndReplayDoesNotInflate(){
        List<PendingOperation> rows=new ArrayList<>();
        for(int i=0;i<9;i++)rows.add(op("close"+i,"receipt_close","BOX"+i,i<3?OperationStatus.SYNCED:OperationStatus.PENDING,"c","d"));
        ReceiptProgress first=ReceiptProgress.from(rows,"c","d");assertEquals(3,first.closed.size());assertEquals(6,first.awaiting.size());
        for(int i=3;i<9;i++)rows.set(i,op("close"+i,"receipt_close","BOX"+i,OperationStatus.SYNCED,"c","d"));
        rows.add(rows.get(0));ReceiptProgress next=ReceiptProgress.from(rows,"c","d");assertEquals(9,next.closed.size());assertEquals(0,next.awaiting.size());
    }
    @Test public void separatesReceiptsAndCountsOnlyAcceptedUnits(){
        List<PendingOperation> rows=Arrays.asList(op("a","receipt_scan","B",OperationStatus.SYNCED,"c","d"),op("b","receipt_scan","B",OperationStatus.REJECTED,"c","d"),op("c","receipt_scan","B",OperationStatus.PENDING,"c","d"),op("x","receipt_close","X",OperationStatus.SYNCED,"other","d"),op("y","receipt_close","Y",OperationStatus.SYNCED,"c","other"));
        ReceiptProgress p=ReceiptProgress.from(rows,"c","d");assertEquals(1,p.acceptedItems);assertEquals(0,p.closed.size());
    }
    @Test public void retryCloseForSameBoxCountsOnce(){
        ReceiptProgress p=ReceiptProgress.from(Arrays.asList(op("a","receipt_close","B",OperationStatus.SYNCED,"c","d"),op("b","receipt_close","B",OperationStatus.PENDING,"c","d")),"c","d");assertEquals(1,p.closed.size());assertTrue(p.awaiting.isEmpty());
    }
}
