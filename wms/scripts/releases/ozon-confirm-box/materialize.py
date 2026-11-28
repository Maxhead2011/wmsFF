"""Apply the same label-control binding as the deployed cargo validation."""
from pathlib import Path
import sys
old = b'(0, ozon_label_control_1.ozonLabelControlEnabled)()'
new = b'ozonLabelControl.ozonLabelControlEnabled()'
if __name__ == '__main__':
    module = Path(sys.argv[1])
    source = module.read_bytes()
    assert source.count(old) == 1 and b"const ozonLabelControl=require('../tsd/ozon-label-control');" in source
    module.write_bytes(source.replace(old, new))
