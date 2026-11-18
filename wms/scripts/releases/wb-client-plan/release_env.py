import json

def environment_equal(before, after):
    # FIX: order is not configuration; changed, added or removed values still fail.
    return sorted(json.loads(before)) == sorted(json.loads(after))
