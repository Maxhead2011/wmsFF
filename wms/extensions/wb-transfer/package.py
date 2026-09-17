"""Build a deterministic pilot ZIP with an explicit file allowlist (no keys, profiles or tests)."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

source = Path(__file__).resolve().parent
output = source.parents[1] / "apps" / "web" / "public" / "downloads"
output.mkdir(parents=True, exist_ok=True)
files = ["manifest.json", "background.js", "content.js", "portal.js", "protocol.js", "INSTALL.txt"]
with ZipFile(output / "logoff-wb-transfer.zip", "w") as archive:
    for name in files:
        info = ZipInfo(name, date_time=(2026, 9, 12, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (source / name).read_bytes())
(output / "wb-transfer-install.txt").write_bytes((source / "INSTALL.txt").read_bytes())
with ZipFile(output / "logoff-wb-transfer.zip") as archive:
    assert archive.namelist() == files
    assert archive.testzip() is None
print(output / "logoff-wb-transfer.zip")
