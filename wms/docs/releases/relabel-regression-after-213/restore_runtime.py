"""Restore verified relabel wiring while preserving all other files of the newer release."""
import hashlib
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parents[3]
target = Path(sys.argv[1])
expected = {
    'modules/marketplace-connections/marketplace-connections.service.js': '3c9cabb7372ad63b56f66d3464e7969caf261bf0a50087f148ea6664ac056949',
    'modules/tsd/tsd-device.controller.js': 'ede8d051ee0c0db374f3b7bb300a5cdf611cb0209338b62fec2e40c7d45f99c3',
    'modules/tsd/tsd.module.js': '666be8c5c302e758b7694813d3b6dcb03774a2f0322284c7db33f17c987e201c',
}
for name, sha in expected.items():
    assert hashlib.sha256((target/name).read_bytes()).hexdigest() == sha, ('Newer runtime requires review', name)
# FIX: reviewed diff: these three files lost only the previously accepted relabel/queue code.
# New source-box routing and all other newer modules remain byte-for-byte intact.
with tarfile.open(root/'baselines/our-wms/2026-09-25-relabel-213/api-runtime.tar.gz', 'r:gz') as archive:
    payload = {name: archive.extractfile(name).read() for name in expected}
for name, data in payload.items():
    (target/name).write_bytes(data)
print('Restored three reviewed files; source-box routing modules preserved.')
