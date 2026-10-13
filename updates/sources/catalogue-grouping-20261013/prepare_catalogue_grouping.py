import hashlib
import json
import struct
import sys
from copy import deepcopy
from pathlib import Path


def main():
    server = Path(sys.argv[1]).resolve()
    if server == Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server"):
        raise ValueError("Use an isolated staging directory")
    sys.path.insert(0, str(server))
    from fifa20_fut_roster import player_records, table_rows
    from fifa20_squad_names import columns, integer
    from squad_payload import build_database, compress, database_crc, decompress, read_database

    assets = server / "assets/squads"
    original = read_database(decompress((assets / "mng-identities-2053.bin").read_bytes()))
    tables = deepcopy(original)
    native = {table["shortname"]: table for table in tables}
    records = player_records(native["CZUM"])
    removed = {500005, 500006}
    if not removed <= records.keys():
        raise ValueError("Expected catalogue clones missing")
    remaining = {identifier: record for identifier, record in records.items() if identifier not in removed}
    native["CZUM"]["records"] = b"".join(remaining.values())
    link_fields = columns(native["RrqT"])
    links = table_rows(native["RrqT"])
    native["RrqT"]["records"] = b"".join(row for row in links if integer(row, link_fields["ykFq"]) not in removed)
    version = bytearray(native["DbIl"]["records"])
    if struct.unpack_from("<H", version, 2)[0] + 1 != 2053:
        raise ValueError("Unexpected source roster version")
    struct.pack_into("<H", version, 2, 2054 - 1)
    native["DbIl"]["records"] = bytes(version)
    for before, after in zip(original, tables):
        if before["shortname"] not in {"CZUM", "RrqT", "DbIl"} and before != after:
            raise ValueError("Unrelated native table changed")
    if any(remaining[identifier] != record for identifier, record in records.items() if identifier not in removed):
        raise ValueError("An original player changed")
    payload = compress(build_database(tables))
    if read_database(decompress(payload)) != tables:
        raise ValueError("Grouping roster round trip failed")
    report = json.loads((assets / "mng-identities-2053.json").read_text(encoding="utf-8"))
    checksum = database_crc(tables)
    report.update(version=2054, size=len(payload), sha256=hashlib.sha256(payload).hexdigest(),
                  databaseSize=len(decompress(payload)), players=len(remaining),
                  databaseCRC=checksum if checksum < 0x80000000 else checksum - 0x100000000,
                  removedCatalogueClones=sorted(removed), scope="Remove duplicate catalogue player identities; retain all original players and FUT card ownership")
    for key in ("catalogueDanteNativeId", "catalogueLewandowskiNativeId"):
        report.pop(key, None)
    (assets / "mng-identities-2054.bin").write_bytes(payload)
    (assets / "mng-identities-2054.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path = server / "roster_update.py"
    source = path.read_text(encoding="utf-8")
    if source.count("VERSION = 2053") != 1:
        raise ValueError("Unexpected roster updater")
    path.write_text(source.replace("2053", "2054"), encoding="utf-8")
    print(json.dumps({"version": 2054, "removedClones": sorted(removed), "originalPlayersPreserved": len(remaining)}))


if __name__ == "__main__":
    main()
