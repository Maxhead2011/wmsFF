"""TEST: prevent per-box history queries during initial migration."""
from pathlib import Path
import unittest


class ReceiptIndexBackfillTest(unittest.TestCase):
    def test_backfill_aggregates_once(self):
        sql = (Path(__file__).parents[2] / 'apps/api/prisma/migrations/'
               '20261008120000_receipt_stock_identity/migration.sql').read_text()
        backfill = sql.split('-- Initial backfill', 1)[1]
        self.assertNotIn('wms_refresh_receipt_stock_identity(', backfill)
        self.assertEqual(backfill.count('FROM "StockMovement"'), 1)
        self.assertEqual(backfill.count('FROM "TsdOperation"'), 1)
        self.assertIn('LEFT JOIN movements', backfill)
        self.assertIn('LEFT JOIN openings', backfill)


if __name__ == '__main__':
    unittest.main()
