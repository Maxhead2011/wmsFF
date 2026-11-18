import json
import unittest
from release_env import environment_equal

class EnvironmentComparisonTest(unittest.TestCase):
    # TEST: Docker reorders the environment without changing effective settings.
    def test_reordered_environment_is_unchanged(self):
        self.assertTrue(environment_equal(json.dumps(['A=1', 'B=x=y']), json.dumps(['B=x=y', 'A=1'])))

    def test_changed_value_is_rejected(self):
        self.assertFalse(environment_equal(json.dumps(['A=1']), json.dumps(['A=2'])))

    def test_added_or_removed_settings_are_rejected(self):
        self.assertFalse(environment_equal(json.dumps(['A=1']), json.dumps(['A=1', 'B=2'])))
        self.assertFalse(environment_equal(json.dumps(['A=1', 'B=2']), json.dumps(['A=1'])))

if __name__ == '__main__':
    unittest.main()
