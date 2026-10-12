import struct
import unittest

from tools.configure_fifa20_steam_models import patch_shortcut, read_shortcuts


def text(key, value):
    return b"\x01" + key.encode() + b"\0" + value.encode() + b"\0"


def fixture(options="-windowed"):
    entry = (b"\x000\0\x02appid\0" + struct.pack("<I", 3000000000)
             + text("AppName", "FIFA20") + text("Exe", '"C:\\Games\\FIFA20.exe"')
             + text("LaunchOptions", options) + b"\x08")
    return b"\x00shortcuts\0" + entry + b"\x001\0" + text("AppName", "Other") + text("Exe", '"C:\\Other.exe"') + text("LaunchOptions", "-keep") + b"\x08\x08\x08"


class SteamModelOptionsTests(unittest.TestCase):
    def test_only_target_options_change(self):
        original = fixture()
        updated, identifier, options = patch_shortcut(original, r"C:\Games\FIFA20.exe")
        before, _ = read_shortcuts(original)
        after, _ = read_shortcuts(updated)
        self.assertEqual(after["shortcuts"]["1"], before["shortcuts"]["1"])
        self.assertEqual(options, '-windowed -dataPath "ModData\\Default"')
        self.assertEqual(identifier, str((3000000000 << 32) | 0x02000000))

    def test_replaces_model_path_and_is_idempotent(self):
        original = fixture('-windowed -dataPath "old path"')
        updated, _, options = patch_shortcut(original, r"C:\Games\FIFA20.exe")
        self.assertNotIn("old path", options)
        self.assertEqual(patch_shortcut(updated, r"C:\Games\FIFA20.exe")[0], updated)

    def test_missing_target_and_malformed_data_fail(self):
        with self.assertRaises(ValueError):
            patch_shortcut(fixture(), r"C:\Missing.exe")
        with self.assertRaises(ValueError):
            read_shortcuts(fixture()[:-1])


if __name__ == "__main__":
    unittest.main()
