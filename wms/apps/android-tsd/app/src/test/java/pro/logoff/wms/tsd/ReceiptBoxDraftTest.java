package pro.logoff.wms.tsd;
import android.content.SharedPreferences;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.data.*;
import java.util.*;
import static org.junit.Assert.*;

// TEST: real persistent preferences, scoped drafts and stable close keys across recreation.
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptBoxDraftTest {
    private SharedPreferences prefs;
    @Before public void setup(){prefs=RuntimeEnvironment.getApplication().getSharedPreferences("draft-test",0);prefs.edit().clear().commit();}
    private ReceiptBoxDraft store(String operator,String client,String document,String box){return new ReceiptBoxDraft(prefs,operator,client,document,box);}
    private List<Map<String,String>> items(int count){List<Map<String,String>> rows=new ArrayList<>();for(int i=0;i<count;i++){Map<String,String> row=new LinkedHashMap<>();row.put("barcode","2037359944196");row.put("kiz","01-test-"+i);row.put("name","Шарф");row.put("secondBarcodeScan","proof-"+i);rows.add(row);}return rows;}
    @Test public void ninetyNineScansSurviveNewStoreInstance(){var rows=items(99);store("worker","client","doc","BOX").save(rows,null);assertEquals(rows,store("worker","client","doc","BOX").load().items);}
    @Test public void scopeIncludesOperatorClientDocumentAndBox(){store("worker","client","doc","BOX").save(items(99),null);assertTrue(store("other","client","doc","BOX").load().items.isEmpty());assertTrue(store("worker","other","doc","BOX").load().items.isEmpty());assertTrue(store("worker","client","other","BOX").load().items.isEmpty());assertTrue(store("worker","client","doc","OTHER").load().items.isEmpty());}
    @Test public void closeHandoffRetainsEveryOriginalIdempotencyKey(){var rows=items(99);var batch=ReceiptCloseBatch.create("client","BOX","doc",rows);store("worker","client","doc","BOX").save(rows,batch);var reloaded=store("worker","client","doc","BOX").load();assertEquals(rows,reloaded.items);assertEquals(batch.closeKey,reloaded.batch.closeKey);assertEquals(batch.operationKeys(),reloaded.batch.operationKeys());assertEquals(100,reloaded.batch.operations.size());for(int i=0;i<100;i++)assertEquals(batch.operations.get(i).payload,reloaded.batch.operations.get(i).payload);}
    @Test public void completingOneBoxDoesNotRemoveAnotherDraft(){store("worker","client","doc","BOX").save(items(99),null);store("worker","client","doc","OTHER").save(items(2),null);store("worker","client","doc","OTHER").clear();assertEquals(99,store("worker","client","doc","BOX").load().items.size());}
    @Test public void corruptDraftFailsClosedInsteadOfSilentlyLosingScans(){store("worker","client","doc","BOX").save(items(99),null);String key=prefs.getAll().keySet().iterator().next();prefs.edit().putString(key,"broken-json").commit();try{store("worker","client","doc","BOX").load();fail("Must not open empty");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("повреждён"));}}
    @Test public void restoredBatchUsesTheSameBoxNormalizationAsTheScreen(){var rows=items(2);var batch=ReceiptCloseBatch.create("client","FFL_ELE0811_06","doc",rows);store("worker","client","doc","FFLELE081106").save(rows,batch);assertEquals(batch.closeKey,store("worker","client","doc","ffl_ele0811_06").load().batch.closeKey);}
    @Test public void partialCloseBatchCannotBeRestored(){var batch=ReceiptCloseBatch.create("client","BOX","doc",items(99));var truncated=new ArrayList<>(batch.operations);truncated.remove(0);try{ReceiptCloseBatch.restore(truncated);fail("Must retain all dependencies");}catch(IllegalArgumentException expected){}}
}
