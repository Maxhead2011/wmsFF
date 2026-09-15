"""Verify the actual APK payload before signing or publication (stdlib only)."""
import argparse
import hashlib
import json
import re
import struct
import subprocess
import zipfile


class Dex:
    def __init__(self, data):
        self.data = data
        if not data.startswith(b'dex\n'):
            raise ValueError('Unsupported DEX payload')
        string_count, string_offset = self.pair(56)
        self.strings = []
        for index in range(string_count):
            offset = self.u32(string_offset + index * 4)
            _, offset = self.uleb(offset)
            end = data.index(b'\0', offset)
            self.strings.append(data[offset:end].decode('utf8', errors='replace'))
        count, offset = self.pair(64)
        self.types = [self.strings[self.u32(offset + i * 4)] for i in range(count)]
        count, offset = self.pair(88)
        self.methods = []
        for i in range(count):
            owner, _, name = struct.unpack_from('<HHI', data, offset + i * 8)
            self.methods.append((self.types[owner], self.strings[name]))
        count, offset = self.pair(80)
        self.fields = set()
        for i in range(count):
            owner, _, name = struct.unpack_from('<HHI', data, offset + i * 8)
            self.fields.add((self.types[owner], self.strings[name]))
        self.code = {}
        count, offset = self.pair(96)
        for i in range(count):
            pos = self.u32(offset + i * 32 + 24)
            if not pos:
                continue
            sizes = []
            for _ in range(4):
                value, pos = self.uleb(pos)
                sizes.append(value)
            for _ in range(sizes[0] + sizes[1]):
                _, pos = self.uleb(pos)
                _, pos = self.uleb(pos)
            for method_count in sizes[2:]:
                index = 0
                for _ in range(method_count):
                    delta, pos = self.uleb(pos)
                    index += delta
                    _, pos = self.uleb(pos)
                    code_offset, pos = self.uleb(pos)
                    if code_offset:
                        units = self.u32(code_offset + 12)
                        self.code[self.methods[index]] = struct.unpack_from('<' + 'H' * units, data, code_offset + 16)

    def u32(self, offset):
        return struct.unpack_from('<I', self.data, offset)[0]

    def pair(self, offset):
        return struct.unpack_from('<II', self.data, offset)

    def uleb(self, pos):
        value = 0
        for shift in range(0, 35, 7):
            byte = self.data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value, pos
        raise ValueError('Invalid DEX integer')

    def calls(self, caller, callee):
        units = self.code.get(caller, ())
        # FIX: inspect invoke instructions in the calling method, not just APK strings.
        return any((unit & 255) in (0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78)
                   and units[i + 1] < len(self.methods) and self.methods[units[i + 1]] == callee
                   for i, unit in enumerate(units[:-2]))


def verify(apk, aapt, expected_version):
    with zipfile.ZipFile(apk) as archive:
        dex_files = {name: archive.read(name) for name in archive.namelist()
                     if re.fullmatch(r'classes(?:\d+)?\.dex', name)}
    dexes = [Dex(data) for data in dex_files.values()]
    main = 'Lpro/logoff/wms/tsd/MainActivity;'
    safety = 'Lpro/logoff/wms/tsd/OzonLabelSafety;'
    task = 'Lpro/logoff/wms/tsd/network/TsdFbsAssemblyResponse$Task;'
    required = [((main, 'renderOzonOrderSticker'), (safety, 'usesTextInstruction')),
                ((main, 'renderFbsAssemblyScreen'), (main, 'ozonQuantityInstruction')),
                ((main, 'showFbsGuidedScanDialog'), (main, 'ozonQuantityInstruction')),
                ((main, 'renderFbsAssemblyScreen'), ('Lpro/logoff/wms/tsd/FbsAssemblyUi;', 'usesPhysicalPickConfirmation'))]
    for caller, callee in required:
        if not any(dex.calls(caller, callee) for dex in dexes):
            raise ValueError('APK is missing the Ozon UI call: ' + caller[1] + ' -> ' + callee[1])
    for field in ('scannedItemCount', 'perUnitScanning', 'physicalPickConfirmation'):
        if not any((task, field) in dex.fields for dex in dexes):
            raise ValueError('APK is missing the Ozon response field: ' + field)
    for value in ('X-TSD-FBS-Capability', 'physical-pick-v1'):
        if not any(value in dex.strings for dex in dexes):
            raise ValueError('APK is missing capability header: ' + value)
    output = subprocess.check_output([str(aapt), 'dump', 'badging', str(apk)], text=True, encoding='utf8')
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", output)
    if not package or package[1] != 'pro.logoff.wms.tsd' or int(package[2]) != expected_version:
        raise ValueError('APK package/version differs from the release metadata')
    return {'passed': True, 'versionCode': int(package[2]), 'versionName': package[3],
            'ozonUiCallsVerified': True, 'quantityFieldsVerified': True,
            'dexSha256': {name: hashlib.sha256(data).hexdigest() for name, data in dex_files.items()}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', required=True)
    parser.add_argument('--aapt', required=True)
    parser.add_argument('--expected-version', required=True, type=int)
    args = parser.parse_args()
    print(json.dumps(verify(args.apk, args.aapt, args.expected_version)))
