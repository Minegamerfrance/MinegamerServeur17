import copy
import hashlib
import json
import zipfile
from pathlib import Path


def main():
    workspace = Path(__file__).resolve().parents[1]
    updates = workspace / ".distribution-repo/updates"
    version = "1.8.89"
    previous = updates / "files/game-servers/20/1.8.88/mng-fifa20-server-1.8.88.zip"
    destination = updates / "files/game-servers/20" / version
    destination.mkdir(parents=True, exist_ok=True)
    archive_path = destination / f"mng-fifa20-server-{version}.zip"
    if archive_path.exists():
        raise FileExistsError("Published packages must not be replaced")
    with zipfile.ZipFile(previous) as source:
        manifest = json.loads(source.read("localfut20-manifest.json"))
        manifest.update(version=version, release="XP du catalogue EAS FC persistante : 100 XP par match terminé, +50 XP par victoire FUT, 1000 XP par niveau. Rapports natifs de matchs hors FUT pris en charge lorsqu'ils confirment une fin de match. Récompenses et démarrage normal conservés.")
        replacements = {name: (workspace / name).read_bytes() for name in ("easfc_catalog.py", "catalogue_xp.py")}
        for name, data in replacements.items():
            compile(data, name, "exec")
        replacements["localfut20-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        replacements["assets/easfc/catalogue-xp.md"] = (workspace / "catalogue-xp.md").read_bytes()
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for entry in source.infolist():
                if entry.filename not in replacements:
                    target.writestr(copy.copy(entry), source.read(entry.filename))
            for name, data in replacements.items():
                target.writestr(name, data)
        with zipfile.ZipFile(archive_path) as packaged:
            assert packaged.testzip() is None
            assert set(packaged.namelist()) == set(source.namelist()) | set(replacements)
            for name in source.namelist():
                assert packaged.read(name) == replacements.get(name, source.read(name))
            assert not any(name.startswith("runtime/data/") for name in packaged.namelist())
    manifest_path = updates / "game-servers-manifest.json"
    release_manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    entry = next(package for package in release_manifest["packages"] if package["gameId"] == "20")
    entry.update(version=version,
                 source=f"https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/files/game-servers/20/{version}/{archive_path.name}",
                 sha256=hashlib.sha256(archive_path.read_bytes()).hexdigest(), size=archive_path.stat().st_size)
    manifest_path.write_text(json.dumps(release_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(entry))


if __name__ == "__main__":
    main()
