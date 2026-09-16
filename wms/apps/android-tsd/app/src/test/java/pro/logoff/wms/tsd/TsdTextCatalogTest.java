package pro.logoff.wms.tsd;

import org.junit.Test;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;

public class TsdTextCatalogTest {
    private TsdTextCatalog shippedCatalog() throws Exception {
        return TsdTextCatalog.load(Files.newBufferedReader(Paths.get("src/main/assets/tsd-translations.tsv"),StandardCharsets.UTF_8),Files.newBufferedReader(Paths.get("src/main/assets/tsd-templates.tsv"),StandardCharsets.UTF_8));
    }
    @Test public void shippedCatalogLoadsAndCoversAllStaticTemplateText() throws Exception {
        // TEST: release assets must load and every generated instruction must be translated.
        TsdTextCatalog catalog=shippedCatalog();
        assertTrue(catalog.size()>1200);
        List<String> missing=new ArrayList<>();
        for(String line:Files.readAllLines(Paths.get("src/main/assets/tsd-templates.tsv"),StandardCharsets.UTF_8)) {
            if(line.isEmpty()||line.startsWith("#"))continue;
            String sample=TsdTextCatalog.unescape(line).replaceAll("\\{[0-9]+}","DATA_2051754386153");
            for(String language:new String[]{"uz","en"}) {
                String rendered=catalog.text(sample,language);
                if(rendered.matches("(?s).*[А-Яа-яЁё].*"))missing.add(language+": "+rendered);
            }
        }
        assertTrue("Untranslated templates ("+missing.size()+"): "+missing.subList(0,Math.min(30,missing.size())),missing.isEmpty());
    }
    private TsdTextCatalog catalog() throws Exception {
        return TsdTextCatalog.load(new StringReader("Назад\tOrqaga\tBack\nОтберите \tTanlang: \tPick \n ед. · \t dona · \t units · \nОшибка сканирования\tSkanerlash xatosi\tScanning error\n"),new StringReader("Отберите {0} ед. · {1} · {2}\n"));
    }
    @Test public void supportsAllThreeLanguagesAndSafeStoredDefaults() {
        // TEST: English was absent from login and only a subset of Uzbek labels existed.
        assertArrayEquals(new String[]{"ru","uz","en"},TsdLanguage.CODES);
        assertEquals("en",TsdLanguage.selected(2));assertEquals("ru",TsdLanguage.normalize("unexpected"));
        assertFalse(TsdLanguage.enabled("ffullhab"));assertFalse(TsdLanguage.enabled("platform"));
    }
    @Test public void translatesOnlyStaticTemplatePartsAndNeverSkuOrBarcodeData() throws Exception {
        // TEST: a product name equal to a UI label must still remain product data.
        String original="Отберите 2 ед. · Назад · 2051754386153";
        assertEquals("Pick 2 units · Назад · 2051754386153",catalog().text(original,"en"));
        assertEquals("Tanlang: 2 dona · Назад · 2051754386153",catalog().text(original,"uz"));
        assertEquals(original,catalog().text(original,"ru"));
    }
    @Test public void leavesScannedMarkBytesAndUnknownBusinessDataIntact() throws Exception {
        String kiz="0104640684261753215apMFH%IhcZVg\u001d91EE12\u001d92a+/=";
        assertEquals(kiz,catalog().text(kiz,"en"));assertEquals("Корея_голубой · S / 42",catalog().text("Корея_голубой · S / 42","uz"));
        assertEquals("Back\nScanning error",catalog().text("Назад\nОшибка сканирования","en"));
    }
    @Test public void rejectsIncompleteCatalogInsteadOfSilentlyShippingMissingTranslations() {
        assertThrows(java.io.IOException.class,()->TsdTextCatalog.load(new StringReader("Назад\tOrqaga\t\n"),new StringReader("")));
    }
    @Test public void backendHintsKeepBoxProductAndOrderIdentifiersInOrder() throws Exception {
        String source="Короб FFL_LKBS0709_11 нужен заявке. Переключено на заказ №5737342163. Найдите исходный товар «Корея_голубой» и сканируйте его ШК.";
        assertEquals("Box FFL_LKBS0709_11 is needed for this request. Switched to order #5737342163. Find the original item “Корея_голубой” and scan its barcode.",shippedCatalog().text(source,"en"));
        assertEquals("Yangi KIZ WBda ishlatilgan. Ishlatilmagan yangi KIZni oling.",shippedCatalog().text("Новый КИЗ уже использовался в WB. Возьмите свободный новый КИЗ.","uz"));
    }
    @Test(timeout=3000) public void longRepeatedInputCannotBacktrackAndFreezeScanning() throws Exception {
        TsdTextCatalog catalog=shippedCatalog();String input="Короб "+"короб · ".repeat(1600)+"?";
        for(int i=0;i<10;i++)assertNotNull(catalog.text(input,"uz"));
    }
}
