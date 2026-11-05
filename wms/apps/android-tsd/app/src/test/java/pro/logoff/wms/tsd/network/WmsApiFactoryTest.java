package pro.logoff.wms.tsd.network;
import org.junit.Test;
import static org.junit.Assert.*;
public class WmsApiFactoryTest {
 @Test public void reuseForSameNormalizedServer() {assertSame(WmsApiFactory.create("https://77.37.144.211"),WmsApiFactory.create("https://77.37.144.211/"));}
 @Test public void serverSwitchKeepsSeparateApi() {assertNotSame(WmsApiFactory.create("https://77.37.144.211"),WmsApiFactory.create("https://example.com"));}
 @Test public void missingServerUsesDefault() {assertSame(WmsApiFactory.create(null),WmsApiFactory.create("https://wms.logoff.pro/"));}
}
