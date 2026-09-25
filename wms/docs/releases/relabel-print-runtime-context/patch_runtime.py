"""Restore only reviewed relabel/queue fragments to the pinned live service."""
import hashlib
import json
from pathlib import Path
import sys

BASE_SHA256 = '3c9cabb7372ad63b56f66d3464e7969caf261bf0a50087f148ea6664ac056949'
target = Path(sys.argv[1]) / 'modules/marketplace-connections/marketplace-connections.service.js'
assert hashlib.sha256(target.read_bytes()).hexdigest() == BASE_SHA256, 'Unexpected runtime: inspect newer release first'
parts = json.loads(Path(__file__).with_name('runtime-fragments.json').read_text(encoding='utf-8'))
text = target.read_text(encoding='utf-8')

def replace(old, new):
    global text
    assert text.count(old) == 1, ('Ambiguous patch anchor', old[:100])
    text = text.replace(old, new)

# FIX: keep newer shipment, routing and Ozon logic outside these fragments intact.
replace('    throwFbsTsdTaskStale(task, user) {', parts['context'] + '    throwFbsTsdTaskStale(task, user) {')
start = text.index('    async claimFbsPrintJob(')
end = text.index('    async finishFbsPrintJob(', start)
replace(text[start:end], parts['claim'])
replace("action: success ? 'FBS_TWO_LABELS_PRINTED' : 'FBS_TWO_LABELS_PRINT_FAILED'",
        "action: job.source === 'TSD_RELABEL' ? (success ? 'TSD_RELABEL_TWO_LABELS_PRINTED' : 'TSD_RELABEL_TWO_LABELS_PRINT_FAILED') : (success ? 'FBS_TWO_LABELS_PRINTED' : 'FBS_TWO_LABELS_PRINT_FAILED')")
replace("if (success && (0, wb_order_stock_lifecycle_1.wbOrderStockLifecycleEnabled)() && job.deviceCode?.startsWith('SOS-WB:'))",
        "if (success && job.source !== 'TSD_RELABEL' && (0, wb_order_stock_lifecycle_1.wbOrderStockLifecycleEnabled)() && job.deviceCode?.startsWith('SOS-WB:'))")
replace('const fbs_sorting_label_1 = require("./fbs-sorting-label");',
        'const fbs_sorting_label_1 = require("./fbs-sorting-label");\nconst fbs_lukin_batch_1 = require("./fbs-lukin-batch");')
start = text.rindex('        const requests = [...choices.values()]', 0, text.index('        const currentHasScans ='))
text = text[:start] + text[start:].replace('const requests =', 'let requests =', 1)
anchor='        const currentHasScans = Boolean(current && (current.boxId || current.barcode || current.kiz));\n'
replace(anchor, anchor + parts['batch'])
anchor='        }\n        const clientFilter = selectedRequest?.clientId ?? this.clientScopes.resolveClientFilter(user);'
replace(anchor, parts['guard'] + anchor)
with target.open('w', encoding='utf-8', newline='\n') as output:
    output.write(text)
print(hashlib.sha256(target.read_bytes()).hexdigest())
