package pro.logoff.wms.tsd;

// TEST: the LOGOFF application captures its own window and uses the dedicated multipart endpoint.

import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.Assert.assertTrue;

public class MonitorErrorScreenshotTest {
    @Test
    public void screenshotIsUploadedAfterErrorWasRecorded() throws IOException {
        String source = source("src/main/java/pro/logoff/wms/tsd/MainActivity.java");
        String method = methodBody(source, "private void reportMonitorError(String message)");
        assertTrue(method.contains("captureAppScreenshot()"));
        assertTrue(method.contains("operationId"));
        assertTrue(method.contains("uploadMonitorErrorScreenshot"));
    }

    @Test
    public void apiUsesDedicatedMultipartScreenshotEndpoint() throws IOException {
        String source = source("src/main/java/pro/logoff/wms/tsd/network/WmsApi.java");
        assertTrue(source.contains("@Multipart"));
        assertTrue(source.contains("api/v1/tsd/monitor/error/{id}/screenshot"));
        assertTrue(source.contains("MultipartBody.Part screenshot"));
    }

    private static String source(String relative) throws IOException {
        Path[] candidates = { Paths.get(relative), Paths.get("app").resolve(relative) };
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) return Files.readString(candidate, StandardCharsets.UTF_8);
        }
        throw new IOException("Source file not found: " + relative);
    }

    private static String methodBody(String source, String signature) {
        int methodStart = source.indexOf(signature);
        if (methodStart < 0) throw new AssertionError("Method not found: " + signature);
        int bodyStart = source.indexOf('{', methodStart);
        int depth = 0;
        for (int index = bodyStart; index < source.length(); index += 1) {
            char current = source.charAt(index);
            if (current == '{') depth += 1;
            if (current == '}') depth -= 1;
            if (depth == 0) return source.substring(bodyStart, index + 1);
        }
        throw new AssertionError("Method body is not closed: " + signature);
    }
}
