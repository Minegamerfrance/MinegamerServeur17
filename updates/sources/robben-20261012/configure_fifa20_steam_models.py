import argparse
import copy
import json
import os
import re
import struct
import subprocess
from pathlib import Path


def read_shortcuts(data):
    position = 0
    ranges = {}

    def string():
        nonlocal position
        end = data.index(b"\0", position)
        value = data[position:end].decode("utf-8")
        position = end + 1
        return value

    def dictionary(path):
        nonlocal position
        result = {}
        while position < len(data):
            kind = data[position]
            position += 1
            if kind == 8:
                return result
            key = string()
            if key in result:
                raise ValueError("Duplicate shortcut key")
            if kind == 0:
                value = dictionary(path + (key,))
            elif kind == 1:
                start = position
                value = string()
                ranges[path + (key,)] = (start, position)
            elif kind in (2, 3, 4, 6, 7):
                size = 8 if kind == 7 else 4
                if position + size > len(data):
                    raise ValueError("Truncated shortcut scalar")
                value = struct.unpack_from("<Q" if size == 8 else "<I", data, position)[0]
                position += size
            else:
                raise ValueError(f"Unsupported shortcut value type: {kind}")
            result[key] = value
        raise ValueError("Unterminated shortcut dictionary")

    result = dictionary(())
    if position != len(data):
        raise ValueError("Trailing shortcut bytes")
    return result, ranges


def patch_shortcut(data, executable):
    original, ranges = read_shortcuts(data)
    matches = [(key, entry) for key, entry in original["shortcuts"].items()
               if os.path.normcase(entry.get("Exe", "").strip('"')) == os.path.normcase(str(executable))]
    if len(matches) != 1:
        raise ValueError("Expected one Steam shortcut for the selected FIFA20.exe")
    key, entry = matches[0]
    arguments = re.sub(r'(?i)(?:^|\s)-dataPath\s+(?:"[^"]*"|\S+)', '', entry["LaunchOptions"]).strip()
    arguments = (arguments + ' -dataPath "ModData\\Default"').strip()
    start, end = ranges[("shortcuts", key, "LaunchOptions")]
    updated = data[:start] + arguments.encode("utf-8") + b"\0" + data[end:]
    checked, _ = read_shortcuts(updated)
    expected = copy.deepcopy(original)
    expected["shortcuts"][key]["LaunchOptions"] = arguments
    if checked != expected:
        raise ValueError("Unrelated Steam shortcut data changed")
    return updated, str((entry["appid"] << 32) | 0x02000000), arguments


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("shortcuts", type=Path)
    parser.add_argument("executable", type=Path)
    parser.add_argument("settings", type=Path)
    parser.add_argument("backup", type=Path)
    arguments = parser.parse_args()
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                             "if (Get-Process steam,FIFA20,'MNG FUT' -ErrorAction SilentlyContinue) { exit 1 }"], capture_output=True)
    if result.returncode:
        raise RuntimeError("Close Steam, FIFA20 and MNG FUT before updating their launch settings")
    data = arguments.shortcuts.read_bytes()
    updated, identifier, options = patch_shortcut(data, arguments.executable)
    settings_data = arguments.settings.read_bytes()
    settings = json.loads(settings_data.decode("utf-8-sig"))
    settings.update(Fifa20SteamGameId=identifier, Fifa20SteamTarget=str(arguments.executable))
    arguments.backup.mkdir(parents=True, exist_ok=False)
    (arguments.backup / "shortcuts.vdf").write_bytes(data)
    (arguments.backup / "launcher-oneclick.json").write_bytes(settings_data)
    if arguments.shortcuts.read_bytes() != data or arguments.settings.read_bytes() != settings_data:
        raise RuntimeError("Launch settings changed during preparation")
    arguments.shortcuts.write_bytes(updated)
    arguments.settings.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if arguments.shortcuts.read_bytes() != updated:
        raise RuntimeError("Steam shortcut write failed")
    print(json.dumps({"gameId": identifier, "launchOptions": options, "otherShortcutsPreserved": True}))


if __name__ == "__main__":
    main()
