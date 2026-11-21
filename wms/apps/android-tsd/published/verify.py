"""Resolve a release base after comparing Git against both live LOGOFF servers."""
import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHANNELS = {
    "ordinary": ("logoff-tsd", "pro.logoff.wms.tsd"),
    "servers": ("logoff-tsd-server-choice", "pro.logoff.wms.tsd.servers"),
}


def read(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()


def verify_channel(channel, origins):
    stem, package = CHANNELS[channel]
    records = []
    for origin in origins:
        prefix = origin + "downloads/" + stem
        meta = json.loads(read(prefix + ".json"))
        apk = read(prefix + ".apk")
        if (meta["packageId"] != package or len(apk) != meta["size"]
                or hashlib.sha256(apk).hexdigest() != meta["sha256"]):
            raise ValueError(f"Invalid published metadata for {channel}")
        fields = ("packageId", "versionCode", "versionName", "sha256", "size")
        records.append(({key: meta[key] for key in fields}, apk))
    if len(records) != 2 or records[0] != records[1]:
        raise ValueError(f"Published servers disagree for {channel}")
    record, apk = records[0]
    return {stem + ".json": (json.dumps(record, indent=2) + "\n").encode(),
            stem + ".apk": apk}


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--capture", action="store_true")
    group.add_argument("--base", choices=CHANNELS, nargs="?", const="servers")
    group.add_argument("--check-all", action="store_true")
    args = parser.parse_args()
    settings = ROOT.parent / "app/src/main/java/pro/logoff/wms/tsd/ServerSettings.java"
    origins = re.findall(r'(?:MAIN_URL|BACKUP_URL) = "([^"]+)"', settings.read_text(encoding="utf8"))
    if len(set(origins)) != 2:
        raise ValueError("Expected two configured servers")
    if not args.capture and not args.check_all and args.base is None:
        args.base = "servers"
    files = {}
    for channel in ([args.base] if args.base else CHANNELS):
        files.update(verify_channel(channel, origins))
    for name, data in files.items():
        target = ROOT / name
        if args.capture:
            target.write_bytes(data)
        elif target.read_bytes() != data:
            raise ValueError(f"Git baseline differs from production: {name}")
    if args.base:
        print(ROOT / (CHANNELS[args.base][0] + ".apk"))


if __name__ == "__main__":
    main()
