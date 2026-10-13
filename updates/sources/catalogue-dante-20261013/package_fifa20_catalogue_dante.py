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
    version = "1.8.91"
    destination = updates / "files/game-servers/20" / version
    destination.mkdir(parents=True, exist_ok=True)
    package = destination / f"mng-fifa20-server-{version}.zip"
    if package.exists():
        raise FileExistsError("Released packages must not be replaced")
    names = (
        "catalogue_dante.py", "easfc_catalog.py", "roster_update.py",
        "assets/squads/mng-identities-2053.bin", "assets/squads/mng-identities-2053.json",
        "assets/easfc/dante-moments.dds", "assets/easfc/dante-moments-small.dds",
        "assets/easfc/storeitem_dante_moment.png", "assets/easfc/dante-moments-reference.png",
        "assets/playerheads/p553806753.dds",
    )
    replacements = {name: (staging / name).read_bytes() for name in names}
    for name, data in replacements.items():
        if name.endswith(".py"):
            compile(data, name, "exec")
    previous_path = updates / "files/game-servers/20/1.8.90/mng-fifa20-server-1.8.90.zip"
    with zipfile.ZipFile(previous_path) as previous:
        manifest = json.loads(previous.read("localfut20-manifest.json"))
        manifest.update(version=version, release="Catalogue niveau 15 : Dante Moments 86 du Bayern, 70/62/75/72/87/85, non échangeable et récupérable une fois. Portrait dynamique, écusson Dante_GFX fourni et profil natif isolé 2053. XP et récompenses existantes conservées. Affichage de l'écusson personnalisé à confirmer dans FIFA.")
        replacements["localfut20-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        replacements["assets/easfc/dante-moments.md"] = (workspace / "catalogue-dante.md").read_bytes()
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
