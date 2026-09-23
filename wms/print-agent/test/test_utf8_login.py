"""Regression checks for Cyrillic WMS logins in the Windows print agent."""

import http.server
import pathlib
import subprocess
import threading
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVE = ROOT.parent / 'apps' / 'web' / 'public' / 'downloads' / 'LOGOFF-FBS-Print-Agent.zip'


class Utf8LoginTest(unittest.TestCase):
    # TEST: both login paths must encode the JSON bytes explicitly on Windows PowerShell 5.1.
    def test_setup_and_background_login_use_utf8_bytes(self):
        for name in ('Setup-Agent.ps1', 'LOGOFF-FBS-Print-Agent.ps1'):
            with self.subTest(name=name):
                source = (ROOT / name).read_text(encoding='utf-8-sig')
                self.assertIn('[System.Text.Encoding]::UTF8.GetBytes($authBody)', source)
                self.assertIn("'application/json; charset=utf-8'", source)

    def test_download_archive_contains_current_scripts(self):
        with zipfile.ZipFile(ARCHIVE) as archive:
            for name in ('Setup-Agent.ps1', 'LOGOFF-FBS-Print-Agent.ps1'):
                with self.subTest(name=name):
                    self.assertEqual(archive.read(name), (ROOT / name).read_bytes())

    def test_explicit_utf8_bytes_reach_server_with_cyrillic_login(self):
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.headers['Content-Type'], self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{}')

            def log_message(self, *_args):
                pass

        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            script = (
                '$email = -join ([char[]](1089,1082,1083,1072,1076)); '
                '$authBody = @{ email = $email; password = "test" } | ConvertTo-Json; '
                '$bytes = [System.Text.Encoding]::UTF8.GetBytes($authBody); '
                f'Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:{server.server_port}/" '
                "-ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null"
            )
            subprocess.run(['powershell.exe', '-NoProfile', '-Command', script],
                           check=True, capture_output=True, timeout=15)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
        self.assertEqual(len(received), 1)
        self.assertIn('charset=utf-8', received[0][0])
        self.assertIn('склад', received[0][1].decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
