import copy
import hashlib
import json
import zipfile
from pathlib import Path


def main():
    workspace = Path(__file__).resolve().parents[1]
    original = Path("E:/FIFA/FIFA 20/FIFA 20/CardsDLL_Win64_retail.dll").read_bytes()
    prepared = (workspace / ".analysis-flashback-skill-candidate-20261013/CardsDLL_Win64_retail.dll").read_bytes()
    changes = []
    offset = 0
    while offset < len(original):
        if original[offset] == prepared[offset]:
            offset += 1
            continue
        start = offset
        while offset < len(original) and original[offset] != prepared[offset]:
            offset += 1
        changes.append({"offset": start, "hex": prepared[start:offset].hex()})
    patch = {"originalSize": len(original), "changes": changes, "appendHex": prepared[len(original):].hex()}
    patch_data = (json.dumps(patch, indent=2) + "\n").encode()
    (workspace / "flashback-skill-patch.json").write_bytes(patch_data)
    from flashback_skill_fix import patched_bytes
    assert patched_bytes(original) == prepared
    updates = workspace / ".distribution-repo/updates"
    version = "1.8.93"
    destination = updates / "files/game-servers/20" / version
    destination.mkdir(parents=True, exist_ok=True)
    package = destination / f"mng-fifa20-server-{version}.zip"
    if package.exists():
        raise FileExistsError("Released packages must not be replaced")
    replacements = {name: (workspace / name).read_bytes() for name in
                    ("easfc_catalog.py", "flashback_skill_fix.py", "flashback-skill-patch.json")}
    for name, data in replacements.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
    with zipfile.ZipFile(updates / "files/game-servers/20/1.8.92/mng-fifa20-server-1.8.92.zip") as previous:
        manifest = json.loads(previous.read("localfut20-manifest.json"))
        manifest.update(version=version, release="Correctif ciblé 3 gestes techniques pour Lewandowski Flashback 85, 4 mauvais pied et carte Or conservés. Installation native avec sauvegarde au démarrage du serveur, uniquement FIFA fermé et sur bibliothèque compatible. Testé en isolation, validation en jeu requise. Aucun changement des options de lancement.")
        replacements["localfut20-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for entry in previous.infolist():
                if entry.filename not in replacements:
                    target.writestr(copy.copy(entry), previous.read(entry.filename))
            for name, data in replacements.items():
                target.writestr(name, data)
        with zipfile.ZipFile(package) as target:
            assert target.testzip() is None
            for name in target.namelist():
                assert target.read(name) == (replacements[name] if name in replacements else previous.read(name))
            assert not any(name.startswith("runtime/data/") for name in target.namelist())
    if package.stat().st_size >= 100 * 1024 * 1024:
        raise ValueError("Package exceeds GitHub size limit")
    manifest_path = updates / "game-servers-manifest.json"
    public = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    entry = next(entry for entry in public["packages"] if entry["gameId"] == "20")
    entry.update(version=version,
                 source=f"https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/files/game-servers/20/{version}/{package.name}",
                 sha256=hashlib.sha256(package.read_bytes()).hexdigest(), size=package.stat().st_size)
    manifest_path.write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(entry))


if __name__ == "__main__":
    main()
