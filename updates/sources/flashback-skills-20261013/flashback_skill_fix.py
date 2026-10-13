import hashlib
import json
import os
import tempfile
from pathlib import Path

from catalogue_client_fix import game_running


ORIGINAL_SHA256 = "6a7078eb2b707fefb271c66b76ae0af03051da94170c68b832e0e99064ddc783"
PATCHED_SHA256 = "5544e5dbea480571df89b3fd6af54f5b3bda6cc16ecf502a55acd4bde923a54f"


def patched_bytes(original):
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256:
        raise ValueError("Unsupported CardsDLL build; no changes made")
    patch = json.loads(Path(__file__).with_name("flashback-skill-patch.json").read_text(encoding="utf-8"))
    if len(original) != patch["originalSize"]:
        raise ValueError("Unexpected original library size")
    result = bytearray(original)
    previous_end = 0
    for change in patch["changes"]:
        offset = change["offset"]
        replacement = bytes.fromhex(change["hex"])
        if offset < previous_end or offset + len(replacement) > len(original):
            raise ValueError("Invalid patch range")
        result[offset:offset + len(replacement)] = replacement
        previous_end = offset + len(replacement)
    result.extend(bytes.fromhex(patch["appendHex"]))
    if hashlib.sha256(result).hexdigest() != PATCHED_SHA256:
        raise ValueError("Prepared skills fix integrity mismatch")
    return bytes(result)


def install(runtime_root):
    root = Path(runtime_root)
    config = root / "data/catalogue-client-fix.json"
    if not config.is_file():
        return "not_configured"
    settings = json.loads(config.read_text(encoding="utf-8"))
    library = Path(settings["libraryPath"]).resolve()
    if library.name != "powdll_Win64_retail.dll" or not (library.parent / "FIFA20.exe").is_file():
        raise ValueError("Invalid FIFA library location")
    target = library.with_name("CardsDLL_Win64_retail.dll")
    original = target.read_bytes()
    if hashlib.sha256(original).hexdigest() == PATCHED_SHA256:
        return "already_installed"
    replacement = patched_bytes(original)
    if game_running():
        return "pending_game_exit"
    backup = root / "data/native-flashback-backups" / (ORIGINAL_SHA256 + ".dll")
    backup.parent.mkdir(parents=True, exist_ok=True)
    if backup.exists() and hashlib.sha256(backup.read_bytes()).hexdigest() != ORIGINAL_SHA256:
        raise ValueError("Skills backup integrity mismatch")
    if not backup.exists():
        with backup.open("xb") as output:
            output.write(original)
            output.flush()
            os.fsync(output.fileno())
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".mng-skills-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(replacement)
            output.flush()
            os.fsync(output.fileno())
        if game_running():
            return "pending_game_exit"
        if target.read_bytes() != original:
            raise ValueError("Library changed during patch preparation")
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    if hashlib.sha256(target.read_bytes()).hexdigest() != PATCHED_SHA256:
        raise ValueError("Installed skills fix verification failed")
    return "installed"
