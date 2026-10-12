import hashlib
import json
import zipfile
from pathlib import Path


def main():
    workspace = Path(__file__).resolve().parents[1]
    repository = workspace / ".distribution-repo"
    server = Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server")
    server_directory = repository / "updates/files/game-servers/20/1.8.88"
    server_directory.mkdir(parents=True, exist_ok=True)
    server_package = server_directory / "mng-fifa20-server-1.8.88.zip"
    with zipfile.ZipFile(repository / "updates/files/game-servers/20/1.8.87/mng-fifa20-server-1.8.87.zip") as previous:
        manifest = json.loads(previous.read("localfut20-manifest.json"))
        manifest.update(version="1.8.88", release="Rétablissement du lancement normal de FIFA 20 : chargement du modèle expérimental désactivé par défaut. Robben icône 86 en prêt 10 matchs au niveau 22 et sauvegardes conservés.")
        replacements = {
            "Launch.ps1": (server / "Launch.ps1").read_bytes(),
            "localfut20-manifest.json": (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
        }
        with zipfile.ZipFile(server_package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in previous.infolist():
                archive.writestr(entry, replacements.get(entry.filename, previous.read(entry.filename)))
    with zipfile.ZipFile(server_package) as archive, zipfile.ZipFile(repository / "updates/files/game-servers/20/1.8.87/mng-fifa20-server-1.8.87.zip") as previous:
        assert archive.testzip() is None
        for name in previous.namelist():
            assert archive.read(name) == replacements.get(name, previous.read(name))
    launcher_directory = repository / "updates/files/launcher/1.3.13"
    launcher_directory.mkdir(parents=True, exist_ok=True)
    launcher_package = launcher_directory / "MNG-FUT-V1-1.3.13-public-update.zip"
    with zipfile.ZipFile(repository / "updates/files/launcher/1.3.12/MNG-FUT-V1-1.3.12-public-update.zip") as previous:
        with zipfile.ZipFile(launcher_package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in previous.infolist():
                data = ((workspace / "release/launcher-1.3.13/MNG FUT.exe").read_bytes()
                        if entry.filename == "MNG FUT.exe" else previous.read(entry.filename))
                archive.writestr(entry, data)
    with zipfile.ZipFile(launcher_package) as archive:
        assert archive.testzip() is None
    public_launcher = json.loads((repository / "updates/launcher-manifest.json").read_text(encoding="utf-8"))
    public_launcher.update(version="1.3.13", source="files/launcher/1.3.13/" + launcher_package.name,
                           size=launcher_package.stat().st_size, sha256=hashlib.sha256(launcher_package.read_bytes()).hexdigest(),
                           notes="Chargement du modèle expérimental désactivé par défaut pour rétablir le lancement normal de FIFA 20. Récompenses et sauvegardes conservées.")
    (repository / "updates/launcher-manifest.json").write_text(json.dumps(public_launcher, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public_servers = json.loads((repository / "updates/game-servers-manifest.json").read_text(encoding="utf-8"))
    for entry in public_servers["packages"]:
        if entry["gameId"] == "20":
            entry.update(version="1.8.88", source="https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/files/game-servers/20/1.8.88/" + server_package.name,
                         size=server_package.stat().st_size, sha256=hashlib.sha256(server_package.read_bytes()).hexdigest())
    (repository / "updates/game-servers-manifest.json").write_text(json.dumps(public_servers, indent=2) + "\n", encoding="utf-8")
    (server / "localfut20-manifest.json").write_bytes(replacements["localfut20-manifest.json"])
    print(json.dumps({"launcher": "1.3.13", "server": "1.8.88", "modelLoadingDefault": False,
                      "serverBytes": server_package.stat().st_size, "otherPackageFilesUnchanged": True}))


if __name__ == "__main__":
    main()
