"""Regression checks for the canonical TSD release base."""
import sys
import unittest
from unittest.mock import patch
import verify


class PublishedBaseTest(unittest.TestCase):
    # TEST: an unqualified build must start from the server-choice APK.
    def test_default_channel(self):
        with patch.object(sys, "argv", ["verify.py"]), patch.object(
            verify, "verify_channel", return_value={}
        ) as check, patch("builtins.print") as output:
            verify.main()
        self.assertEqual(check.call_args.args[0], "servers")
        self.assertEqual(output.call_args.args[0].name, "logoff-tsd-server-choice.apk")

    def test_reject_unverified_apk(self):
        with patch.object(verify, "read", side_effect=[
            b'{"packageId":"pro.logoff.wms.tsd.servers","sha256":"","size":1}', b"x"
        ]):
            with self.assertRaises(ValueError):
                verify.verify_channel("servers", ["first/", "second/"])
