package pro.logoff.wms.tsd;
import org.junit.Test;import static org.junit.Assert.*;
public class PalletRecoveryPairsTest{
 // TEST: a barcode alone cannot create quantity; repeated KIZ and incomplete pairs are rejected.
 @Test public void uniquePairsOnly(){PalletRecoveryPairs p=new PalletRecoveryPairs();p.product("sku","4610460840526","Food");try{p.payload();fail();}catch(IllegalStateException expected){}p.accept("0104610460840526215uLmfm");p.product("sku","4610460840526","Food");try{p.accept("]d20104610460840526215uLmfm");fail();}catch(IllegalArgumentException expected){}assertTrue(p.pending());p.accept("0104610460840526215other");assertEquals(2,p.payload().size());assertEquals(1,p.payload().get(0).get("quantity"));try{p.product("sku","4610460840526","Food");fail();}catch(IllegalStateException expected){}}
 @Test public void clearStartsNewBox(){PalletRecoveryPairs p=new PalletRecoveryPairs();p.product("sku","4610460840526","Food");p.accept("0104610460840526215uLmfm");p.clear();assertFalse(p.pending());p.product("sku","4610460840526","Food");assertTrue(p.accept("0104610460840526215uLmfm"));}
}
