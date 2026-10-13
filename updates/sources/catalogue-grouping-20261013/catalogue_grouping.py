from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import catalogue_dante
import catalogue_lewandowski


def normalize_path(raw_path):
    parsed = urlsplit(raw_path)
    if not parsed.path.lower().startswith(("/ut/game/fifa20/", "/ut/ut/game/fifa20/")):
        return raw_path
    players = {catalogue_dante.NATIVE_ID: catalogue_dante.ASSET_ID,
               catalogue_lewandowski.NATIVE_ID: catalogue_lewandowski.ASSET_ID}
    cards = {catalogue_dante.NATIVE_RESOURCE_ID: catalogue_dante.RESOURCE_ID,
             catalogue_lewandowski.NATIVE_RESOURCE_ID: catalogue_lewandowski.RESOURCE_ID}
    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower() in {"defid", "definitionid", "assetid", "maskeddefid"} and value.isdigit():
            value = str(players.get(int(value), cards.get(int(value), int(value))))
        elif key.lower() == "excldef":
            value = ",".join(str(cards.get(int(identifier), int(identifier))) if identifier.isdigit() else identifier
                             for identifier in value.split(","))
        query.append((key, value))
    if query == parse_qsl(parsed.query, keep_blank_values=True):
        return raw_path
    return urlunsplit(parsed._replace(query=urlencode(query)))
