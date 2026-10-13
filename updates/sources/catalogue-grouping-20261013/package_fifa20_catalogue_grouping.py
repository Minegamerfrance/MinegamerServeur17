import copy
import hashlib
import json
import sys
import zipfile
from pathlib import Path


def main():
    workspace = Path(__file__).resolve().parents[1]
    staging = Path(sys.argv[1]).resolve()
    updates = workspace / ".distribution-repo/updates"
    version = "1.8.92"
    destination = updates / "files/game-servers/20" / version
    destination.mkdir(parents=True, exist_ok=True)
    package = destination / f"mng-fifa20-server-{version}.zip"
    if package.exists():
        raise FileExistsError("Released packages must not be replaced")
    names = ("catalogue_dante.py", "catalogue_lewandowski.py", "catalogue_localization.py",
             "catalogue_grouping.py", "easfc_catalog.py", "roster_update.py",
             "assets/squads/mng-identities-2054.bin", "assets/squads/mng-identities-2054.json")
    replacements = {name: (staging / name).read_bytes() for name in names}
    for name, data in replacements.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
    previous_path = updates / "files/game-servers/20/1.8.91/mng-fifa20-server-1.8.91.zip"
    with zipfile.ZipFile(previous_path) as previous:
        manifest = json.loads(previous.read("localfut20-manifest.json"))
        manifest.update(version=version, release="Dante Moments 86 et Lewandowski Flashback 85 regroupés sous leurs joueurs d'origine, clones supprimés de la base native 2054, anciennes références compatibles. Descriptions catalogue traduites FR/EN/DE/ES/IT/PT/PL. Dante utilise la même icône native que Lewandowski. Cartes, progression et attributions conservées.")
        replacements["localfut20-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        replacements["assets/easfc/catalogue-grouping.md"] = (workspace / "catalogue-grouping.md").read_bytes()
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
        raise ValueError("Package exceeds the GitHub file size limit")
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
