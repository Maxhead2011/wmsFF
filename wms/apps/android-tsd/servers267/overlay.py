"""Apply only the reviewed update methods to a fresh apktool disassembly of 266."""
import re
import sys
from pathlib import Path

MAIN = "Lpro/logoff/wms/tsd/MainActivity;"
FOLDER = "smali/pro/logoff/wms/tsd"
METHOD = re.compile(r"^\.method [^\n]*\n.*?^\.end method", re.M | re.S)
# Match one header, never consume the next method.
METHOD = re.compile(r"^\.method [^\n]+\n[\s\S]*?^\.end method", re.M)
LAMBDA = re.compile(r"MainActivity\$\$ExternalSyntheticLambda\d+")
VERSION = "0.1.267-idle-update"


def key(block):
    return block.splitlines()[0].split()[-1]


def methods(source):
    return {key(match): match for match in METHOD.findall(source)}


def overlay(base, donor):
    base, donor = base / FOLDER, donor / FOLDER
    activity = base / "MainActivity.smali"
    original = activity.read_text("utf8")
    incoming = (donor / activity.name).read_text("utf8")
    parts = methods(incoming)
    old = methods(original)
    names = {"idleUpdateEnabled", "idleUpdateScreen", "idleUpdateState", "tryIdleUpdate",
             "pendingUpdateScans", "releaseUpdateBarrier", "startManagedApkUpdate",
             "downloadAndVerifyUpdateApk", "installUpdateApk",
             "-$$Nest$mtryIdleUpdate", "-$$Nest$mreleaseUpdateBarrier"}
    selected = {k: v for k, v in parts.items() if k.split("(")[0] in names
                or k.startswith(("lambda$tryIdleUpdate$", "lambda$startManagedApkUpdate$"))}
    if not names.issubset({k.split("(")[0] for k in selected}):
        raise ValueError("Missing update methods")
    def relocate(code):
        return LAMBDA.sub(lambda m: m.group().replace("ExternalSynthetic", "Idle267"), code)
    for name in set(LAMBDA.findall("\n".join(selected.values()))):
        target = base / (relocate(name) + ".smali")
        if target.exists():
            raise ValueError("Already overlaid")
        text = (donor / (name + ".smali")).read_text("utf8")
        for bridge in re.findall(r"MainActivity;->(\$r8\$lambda\$[^\s]+)", text):
            if bridge in old and old[bridge] != parts[bridge]:
                raise ValueError("Conflicting synthetic bridge: " + bridge)
            selected[bridge] = parts[bridge]
        target.write_text(relocate(text), "utf8")
    for filename in ["MainActivity$1.smali", "MainActivity$2.smali"]:
        # The heartbeat and update-status receiver carry the two new callbacks.
        dest = base / filename
        src = (donor / filename).read_text("utf8")
        before = dest.read_text("utf8")
        def instructions(text):
            return [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith((".line", ".source"))]
        import difflib
        delta = list(difflib.unified_diff(instructions(before), instructions(src), n=0))
        print(filename, "\n".join(delta))
        dest.write_text(src,"utf8")
    for k, block in selected.items():
        if k in old:
            original = original.replace(old[k], relocate(block))
        else:
            original += "\n" + relocate(block) + "\n"
    for name in ["nextIdleUpdateCheck", "nextQueueCheck", "updateBarrier", "waitingUpdate"]:
        field = re.search(r"^\.field [^\n]* " + name + r":[^\n]+", incoming, re.M)[0]
        original = original.replace("# instance fields", "# instance fields\n" + field, 1)
    original = original.replace(".field private appUpdateBusy:Z", ".field private volatile appUpdateBusy:Z")
    destroy = methods(original)["onDestroy()V"]
    updated, count = re.subn(r"(\.locals \d+)", r"\1\n    invoke-direct {p0}, " + MAIN + "->releaseUpdateBarrier()V", destroy, count=1)
    if count != 1:
        raise ValueError("Missing onDestroy hook")
    original = original.replace(destroy, updated).replace("0.1.266-ozon-voice-v1", VERSION)
    activity.write_text(original, "utf8")
    (base / "IdleUpdateGuard.smali").write_bytes((donor / "IdleUpdateGuard.smali").read_bytes())
    config = base / "BuildConfig.smali"
    config.write_text(config.read_text("utf8").replace("0.1.266-ozon-voice-v1", VERSION)
                      .replace("VERSION_CODE:I = 0x10a", "VERSION_CODE:I = 0x10b"), "utf8")


if __name__ == "__main__":
    overlay(Path(sys.argv[1]), Path(sys.argv[2]))
