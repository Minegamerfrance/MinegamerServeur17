import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import flashback_skill_fix as fix


class SkillInstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = Path("E:/FIFA/FIFA 20/FIFA 20/CardsDLL_Win64_retail.dll").read_bytes()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.runtime = self.root / "runtime"
        self.game = self.root / "game"
        self.game.mkdir()
        (self.game / "FIFA20.exe").touch()
        self.target = self.game / "CardsDLL_Win64_retail.dll"
        self.target.write_bytes(self.original)
        (self.runtime / "data").mkdir(parents=True)
        (self.runtime / "data/catalogue-client-fix.json").write_text(json.dumps({
            "libraryPath": str(self.game / "powdll_Win64_retail.dll")}), encoding="utf-8")

    def test_running_defers(self):
        with patch.object(fix, "game_running", return_value=True):
            self.assertEqual(fix.install(self.runtime), "pending_game_exit")
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertFalse((self.runtime / "data/native-flashback-backups").exists())

    def test_install_backup_and_idempotence(self):
        with patch.object(fix, "game_running", return_value=False):
            self.assertEqual(fix.install(self.runtime), "installed")
            self.assertEqual(fix.install(self.runtime), "already_installed")
        self.assertEqual(hashlib.sha256(self.target.read_bytes()).hexdigest(), fix.PATCHED_SHA256)
        backup = self.runtime / "data/native-flashback-backups" / (fix.ORIGINAL_SHA256 + ".dll")
        self.assertEqual(backup.read_bytes(), self.original)

    def test_running_during_preparation_defers(self):
        with patch.object(fix, "game_running", side_effect=[False, True]):
            self.assertEqual(fix.install(self.runtime), "pending_game_exit")
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertFalse(list(self.game.glob(".mng-skills-*")))

    def test_unknown_build_refused(self):
        self.target.write_bytes(b"unsupported")
        with self.assertRaises(ValueError):
            fix.install(self.runtime)
        self.assertEqual(self.target.read_bytes(), b"unsupported")

    def test_corrupt_backup_refused(self):
        backup = self.runtime / "data/native-flashback-backups" / (fix.ORIGINAL_SHA256 + ".dll")
        backup.parent.mkdir()
        backup.write_bytes(b"corrupt")
        with patch.object(fix, "game_running", return_value=False), self.assertRaises(ValueError):
            fix.install(self.runtime)
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_corrupt_patch_refused(self):
        manifest = {"originalSize": len(self.original), "changes": [], "appendHex": "00"}
        with patch.object(fix.json, "loads", return_value=manifest), self.assertRaises(ValueError):
            fix.patched_bytes(self.original)

    def test_unconfigured_no_changes(self):
        self.assertEqual(fix.install(self.root / "missing"), "not_configured")
        self.assertEqual(self.target.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
