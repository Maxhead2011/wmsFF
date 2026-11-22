from pathlib import Path
import sys

def prepare(source):
    # FIX: freshness of the open FBS screen is independent of scheduled warehouse operations.
    before = 'Date.now() - Date.parse(value.fetchedAt) >= FBS_ORDERS_CACHE_TTL_MS'
    after = 'Date.now() - Date.parse(value.fetchedAt) >= 60_000'
    if source.count(before) != 1:
        raise ValueError('Unexpected runtime display refresh condition')
    return source.replace(before, after)

if __name__ == '__main__':
    Path(sys.argv[2]).write_bytes(prepare(Path(sys.argv[1]).read_text(encoding='utf-8')).encode())
