"""TEST: install the actual release APK over the emulator's app and verify Android startup."""
import argparse
import json
import pathlib
import subprocess
import time
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--apk', required=True, type=pathlib.Path)
    parser.add_argument('--version', required=True, type=int)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not args.serial.startswith('emulator-'):
        parser.error('This test runs only on an explicitly selected emulator, never on a warehouse TSD')
    command = [args.adb, '-s', args.serial]

    def adb(*parts):
        return subprocess.check_output(command + list(parts), stderr=subprocess.STDOUT, timeout=60)

    assert adb('shell', 'getprop', 'ro.kernel.qemu').strip() == b'1'
    assert adb('shell', 'getprop', 'sys.boot_completed').strip() == b'1'
    args.output.mkdir(parents=True, exist_ok=True)
    # TEST: -r preserves preferences, the local database, and queued operations.
    install = adb('install', '-r', str(args.apk)).decode()
    assert 'Success' in install, install
    package = 'pro.logoff.wms.tsd'
    installed = adb('shell', 'dumpsys', 'package', package).decode()
    assert 'versionCode=' + str(args.version) + ' ' in installed
    adb('shell', 'am', 'force-stop', package)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-n', package + '/.MainActivity')
    time.sleep(4)
    log = adb('logcat', '-d', '-s', 'AndroidRuntime').decode(errors='replace')
    (args.output / 'runtime.log').write_text(log, encoding='utf8')
    assert 'FATAL EXCEPTION' not in log, log
    assert adb('shell', 'pidof', package).strip(), 'Application exited during startup'
    adb('shell', 'uiautomator', 'dump', '/sdcard/tsd-startup.xml')
    screen = adb('shell', 'cat', '/sdcard/tsd-startup.xml')
    (args.output / 'screen.xml').write_bytes(screen)
    nodes = list(ET.fromstring(screen).iter('node'))
    assert any(n.get('package') == package for n in nodes), 'App is not on screen'
    assert sum(n.get('class') == 'android.widget.EditText' for n in nodes) >= 2, 'Login did not render'
    (args.output / 'screen.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    result = {'passed': True, 'version': args.version, 'serial': args.serial, 'installedWithDataPreserved': True}
    (args.output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
