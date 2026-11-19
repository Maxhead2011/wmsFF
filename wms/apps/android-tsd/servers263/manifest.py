import struct
OLD=b'0.1.261-receipt-draft'
NEW=b'0.1.264-packing-modes'
def manifest(data):
    # FIX: identify android:versionCode by resource ID, never by numeric byte search.
    out = bytearray(data)
    old_name,new_name=OLD,NEW
    if out.count(old_name)==0:
        old_name,new_name=OLD.decode().encode('utf-16le'),NEW.decode().encode('utf-16le')
    if out.count(old_name) != 1 or len(old_name) != len(new_name):
        raise ValueError('Unexpected manifest version name')
    resources, offset, changes = [], 8, 0
    while offset < len(out):
        kind, header, size = struct.unpack_from('<HHI', out, offset)
        if size < header or offset + size > len(out):
            raise ValueError('Invalid binary XML chunk')
        if kind == 0x180:
            resources = list(struct.unpack_from('<' + 'I' * ((size-header)//4), out, offset+header))
        if kind == 0x102:
            ext = offset + 16
            start, stride, count = struct.unpack_from('<HHH', out, ext+8)
            for n in range(count):
                pos = ext + start + n*stride
                name = struct.unpack_from('<I', out, pos+4)[0]
                if name < len(resources) and resources[name] == 0x0101021b:
                    if out[pos+15] != 0x10 or struct.unpack_from('<I', out, pos+16)[0] != 261:
                        raise ValueError('Unexpected versionCode')
                    struct.pack_into('<I', out, pos+16, 264)
                    changes += 1
        offset += size
    if changes != 1:
        raise ValueError('Expected exactly one versionCode')
    return bytes(out).replace(old_name, new_name)

