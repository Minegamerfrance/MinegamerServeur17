import hashlib
import json
import os
import zipfile
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    workspace = Path(__file__).resolve().parents[1]
    repository = workspace / ".distribution-repo"
    server = Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server")
    game = Path(r"E:\FIFA\FIFA 20\FIFA 20")
    native = server / "assets/native-models"
    native.mkdir(exist_ok=True)
    files = []
    links = [{"path": "Data", "kind": "directory"}]
    if (game / "Update").is_dir():
        links.append({"path": "Update", "kind": "directory"})
    with zipfile.ZipFile(native / "robben-game-data.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((game / "ModData/Default/Patch").rglob("*")):
            if not path.is_file() or path.name == "mods.json":
                continue
            relative = path.relative_to(game / "ModData/Default").as_posix()
            original = game / relative
            if original.is_file() and os.path.samefile(path, original):
                links.append({"path": relative, "kind": "file", "size": path.stat().st_size})
                continue
            data = path.read_bytes()
            if original.is_file() and original.read_bytes() == data:
                links.append({"path": relative, "kind": "file", "size": len(data)})
                continue
            archive.writestr(relative, data)
            files.append({"path": relative, "size": len(data), "sha256": digest(data)})
    model_manifest = {
        "version": 1, "game": "FIFA20", "gameHead": 793449,
        "baseLayoutSha256": digest((game / "Patch/layout.toc").read_bytes()),
        "archiveSha256": digest((native / "robben-game-data.zip").read_bytes()),
        "files": files, "links": links,
    }
    (native / "robben-native-files.json").write_text(json.dumps(model_manifest, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(native / "robben-game-data.zip") as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(files)
        for file in files:
            assert digest(archive.read(file["path"])) == file["sha256"]
    server_manifest = json.loads((server / "localfut20-manifest.json").read_text(encoding="utf-8"))
    server_manifest.update(version="1.8.87", release="Catalogue persistant, Lewandowski Flashback, carrousel et Robben icône 86 en prêt 10 matchs au niveau 22. Données du modèle natif incluses ; rendu en jeu encore à confirmer.")
    replacements = {path.name: path.read_bytes() for path in server.glob("*.py")}
    replacements["localfut20-manifest.json"] = (json.dumps(server_manifest, ensure_ascii=False, indent=2) + "\n").encode()
    for folder in ("assets",):
        for path in (server / folder).rglob("*"):
            if path.is_file() and "backup" not in path.name.lower() and path.suffix != ".fbmod" and path.stem != "mng-identities-2051":
                replacements[path.relative_to(server).as_posix()] = path.read_bytes()
    replacements["assets/native-models/Install-RobbenNativeModel.ps1"] = (workspace / "tools/Install-RobbenNativeModel.ps1").read_bytes()
    destination = repository / "updates/files/game-servers/20/1.8.87"
    destination.mkdir(parents=True, exist_ok=True)
    package = destination / "mng-fifa20-server-1.8.87.zip"
    with zipfile.ZipFile(repository / "updates/files/game-servers/20/1.8.86/mng-fifa20-server-1.8.86.zip") as previous:
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in previous.infolist():
                if entry.filename not in replacements:
                    archive.writestr(entry, previous.read(entry.filename))
            for name, data in replacements.items():
                archive.writestr(name, data)
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assert not any(name.endswith((".sqlite3", ".log", ".done")) for name in archive.namelist())
        for name, data in replacements.items():
            assert archive.read(name) == data
            if name.endswith(".py"):
                compile(data, name, "exec")
    launcher_dir = repository / "updates/files/launcher/1.3.12"
    launcher_dir.mkdir(parents=True, exist_ok=True)
    launcher_package = launcher_dir / "MNG-FUT-V1-1.3.12-public-update.zip"
    with zipfile.ZipFile(repository / "updates/files/launcher/1.3.10/MNG-FUT-V1-1.3.10-public-update.zip") as previous:
        with zipfile.ZipFile(launcher_package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in previous.infolist():
                if entry.filename != "MNG FUT.exe":
                    archive.writestr(entry, previous.read(entry.filename))
            archive.writestr("MNG FUT.exe", (workspace / "release/launcher-1.3.12/MNG FUT.exe").read_bytes())
    launcher_manifest = json.loads((repository / "updates/launcher-manifest.json").read_text(encoding="utf-8"))
    launcher_manifest.update(version="1.3.12", source="files/launcher/1.3.12/" + launcher_package.name,
                             sha256=digest(launcher_package.read_bytes()), size=launcher_package.stat().st_size,
                             notes="Correctif FIFA 20 : préparation du modèle Robben inclus avec le serveur 1.8.87 et démarrage direct avec ModData, sans ouvrir Frosty. Corrections cumulatives du lanceur 1.3.11 incluses.")
    (repository / "updates/launcher-manifest.json").write_text(json.dumps(launcher_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public_server = json.loads((repository / "updates/game-servers-manifest.json").read_text(encoding="utf-8"))
    for entry in public_server["packages"]:
        if entry["gameId"] == "20":
            entry.update(version="1.8.87", source="https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/files/game-servers/20/1.8.87/" + package.name,
                         sha256=digest(package.read_bytes()), size=package.stat().st_size)
    (repository / "updates/game-servers-manifest.json").write_text(json.dumps(public_server, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"launcher": launcher_manifest["version"], "server": "1.8.87", "serverBytes": package.stat().st_size,
                      "nativeFiles": len(files), "nativeLinks": len(links)}))


if __name__ == "__main__":
    main()
