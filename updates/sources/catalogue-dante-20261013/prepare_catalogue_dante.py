import hashlib
import json
import shutil
import struct
import sys
import xml.etree.ElementTree as ET
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


def main():
    workspace = Path(__file__).resolve().parents[1]
    server = Path(sys.argv[1]).resolve()
    if server == Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server"):
        raise ValueError("Prepare Dante in an isolated staging directory")
    sys.path.extend((str(workspace), str(server)))
    from catalogue_dante import ASSET_ID, NATIVE_ID, RESOURCE_ID, install_player
    from fifa20_fut_roster import player_records, table_rows
    from fifa20_squad_names import columns, integer, set_integer
    from squad_payload import build_database, compress, database_crc, decompress, read_database
    from package_fifa20_season_pass_rewards import dynamic_portrait

    downloads = Path(r"C:\Users\Mineg\Downloads")
    destination = server / "assets/easfc"
    destination.mkdir(parents=True, exist_ok=True)
    source_icon = downloads / "storeitem_dante_moment.png"
    shutil.copy2(source_icon, destination / "storeitem_dante_moment.png")
    with Image.open(source_icon) as source:
        if source.size != (512, 512) or source.convert("RGBA").getextrema()[3] != (0, 255):
            raise ValueError("Expected the user's transparent 512x512 Dante shield")
        output = BytesIO()
        source.convert("RGBA").save(output, format="DDS", pixel_format="DXT5")
        (destination / "dante-moments.dds").write_bytes(output.getvalue())
        output = BytesIO()
        source.convert("RGBA").resize((128, 128), Image.Resampling.LANCZOS).save(output, format="DDS", pixel_format="DXT5")
        (destination / "dante-moments-small.dds").write_bytes(output.getvalue())
    portrait = dynamic_portrait(downloads / "dantemoment.png", (server / "assets/playerheads/p50551331.dds").read_bytes())
    (server / f"assets/playerheads/p{RESOURCE_ID}.dds").write_bytes(portrait)
    shutil.copy2(downloads / "Dante.png", destination / "dante-moments-reference.png")

    assets = server / "assets/squads"
    tables = read_database(decompress((assets / "mng-identities-2052.bin").read_bytes()))
    original = deepcopy(tables)
    native = {table["shortname"]: table for table in tables}
    players = native["CZUM"]
    fields = columns(players)
    records = player_records(players)
    original_players = records.copy()
    if NATIVE_ID in records or len(records) >= 26000:
        raise ValueError("Dante native player collision or capacity exceeded")
    definitions = {int(key): value for key, value in json.loads((server / "localfut20/players.json").read_text(encoding="utf-8")).items()}
    module = SimpleNamespace(PLAYER_DB=definitions)
    install_player(module)
    card = module.PLAYER_DB[RESOURCE_ID]
    metadata_path = Path(r"E:\FIFA\FIFA SERVEUR\20 fichier frosty\data\db\cards_ng_db-meta.xml")
    descriptors = ET.fromstring(metadata_path.read_text(encoding="utf-8-sig")).find(".//table[@name='players']")
    metadata = {field.get("name"): (field.get("shortname"), int(field.get("rangelow", 0))) for field in descriptors.findall("./fields/field")}
    values = {"playerid": NATIVE_ID, "headassetid": ASSET_ID, "overallrating": 86,
              "potential": 86, "skillmoves": card["skillMoves"] - 1,
              "weakfootabilitytypecode": card["weakFoot"]}
    values.update({name.lower(): max(1, value) for name, value in card["attributes"].items() if name != "gkSpeed"})
    record = records[ASSET_ID]
    for name, value in values.items():
        shortname, minimum = metadata[name]
        record = set_integer(record, fields[shortname], value - minimum)
        if integer(record, fields[shortname]) + minimum != value:
            raise ValueError(f"Dante native attribute round trip failed: {name}")
    records[NATIVE_ID] = record
    players["records"] = b"".join(records.values())
    links = native["RrqT"]
    link_fields = columns(links)
    memberships = table_rows(links)
    templates = [row for row in memberships if integer(row, link_fields["ykFq"]) == ASSET_ID]
    if len(templates) != 1 or len(memberships) >= 27000:
        raise ValueError("Unexpected native Dante club link or capacity exceeded")
    membership = set_integer(templates[0], link_fields["ykFq"], NATIVE_ID)
    membership = set_integer(membership, link_fields["mCXg"], card["teamid"] - 1)
    next_key = max(integer(row, link_fields["JMld"]) for row in memberships) + 1
    memberships.append(set_integer(membership, link_fields["JMld"], next_key))
    links["records"] = b"".join(memberships)
    version = bytearray(native["DbIl"]["records"])
    if len(version) != 48 or struct.unpack_from("<H", version, 2)[0] + 1 != 2052:
        raise ValueError("Unexpected source roster version")
    struct.pack_into("<H", version, 2, 2053 - 1)
    native["DbIl"]["records"] = bytes(version)
    for before, after in zip(original, tables):
        if before["shortname"] not in {"CZUM", "RrqT", "DbIl"} and before != after:
            raise ValueError("Unrelated native table changed")
    if any(records[identifier] != prior for identifier, prior in original_players.items()):
        raise ValueError("Existing native player changed")
    database = build_database(tables)
    payload = compress(database)
    if read_database(decompress(payload)) != tables:
        raise ValueError("Dante native roster round trip failed")
    checksum = database_crc(tables)
    report = json.loads((assets / "mng-identities-2052.json").read_text(encoding="utf-8"))
    report.update(version=2053, databaseCRC=checksum if checksum < 0x80000000 else checksum - 0x100000000,
                  sha256=hashlib.sha256(payload).hexdigest(), size=len(payload), databaseSize=len(database),
                  players=len(records), catalogueDanteNativeId=NATIVE_ID, catalogueDanteResourceId=RESOURCE_ID,
                  scope="Add isolated Dante Moments 86 Bayern profile: 70/62/75/72/87/85; preserve every existing player and account")
    (assets / "mng-identities-2053.bin").write_bytes(payload)
    (assets / "mng-identities-2053.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    roster_path = server / "roster_update.py"
    roster = roster_path.read_text(encoding="utf-8")
    if not ((roster.count("VERSION = 2052") == 1 and "mng-identities-2052.bin" in roster)
            or (roster.count("VERSION = 2053") == 1 and "mng-identities-2053.bin" in roster)):
        raise ValueError("Unexpected roster updater")
    roster_path.write_text(roster.replace("2052", "2053"), encoding="utf-8")
    for name in ("catalogue_dante.py", "easfc_catalog.py"):
        shutil.copy2(workspace / name, server / name)
    print(json.dumps({"roster": 2053, "nativeId": NATIVE_ID, "face": card["face"],
                      "existingPlayersPreserved": len(original_players), "staging": str(server)}))


if __name__ == "__main__":
    main()
