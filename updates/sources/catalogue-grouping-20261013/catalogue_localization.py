import copy
from urllib.parse import parse_qs, urlsplit


TEXTS = {
    "fr": (
        "Recevez Robert Lewandowski Flashback 85 dans les éléments non attribués de FUT. Non échangeable, récupérable une seule fois.",
        "Choisi par Dante_GFX, en l’honneur du triplé remporté avec le FC Bayern lors de la saison 2012-2013.",
        "Récompense déjà récupérée.", "{name} récupéré. Retrouvez-le dans les éléments non attribués de FUT.", "Récompense du niveau 10"),
    "en": (
        "Receive Robert Lewandowski Flashback 85 in your FUT unassigned items. Untradeable, redeemable once.",
        "Selected by Dante_GFX, in honour of the treble won with FC Bayern in the 2012-2013 season.",
        "Reward already redeemed.", "{name} redeemed. Find him in your FUT unassigned items.", "Level 10 reward"),
    "de": (
        "Erhalte Robert Lewandowski Flashback 85 unter deinen nicht zugewiesenen FUT-Objekten. Unverkäuflich, einmal einlösbar.",
        "Ausgewählt von Dante_GFX, zu Ehren des Triples mit dem FC Bayern in der Saison 2012-2013.",
        "Belohnung bereits eingelöst.", "{name} erhalten. Du findest ihn unter deinen nicht zugewiesenen FUT-Objekten.", "Belohnung für Level 10"),
    "es": (
        "Recibe a Robert Lewandowski Flashback 85 en tus artículos sin asignar de FUT. Intransferible, canjeable una sola vez.",
        "Elegido por Dante_GFX, en honor al triplete conseguido con el FC Bayern en la temporada 2012-2013.",
        "Recompensa ya canjeada.", "Has recibido a {name}. Lo encontrarás en tus artículos sin asignar de FUT.", "Recompensa del nivel 10"),
    "it": (
        "Ricevi Robert Lewandowski Flashback 85 tra i tuoi oggetti non assegnati di FUT. Non scambiabile, riscattabile una sola volta.",
        "Scelto da Dante_GFX, in onore del triplete conquistato con il FC Bayern nella stagione 2012-2013.",
        "Premio già riscattato.", "Hai ricevuto {name}. Lo trovi tra i tuoi oggetti non assegnati di FUT.", "Premio del livello 10"),
    "pt": (
        "Recebe Robert Lewandowski Flashback 85 nos teus itens não atribuídos do FUT. Intransferível, resgatável uma única vez.",
        "Escolhido por Dante_GFX, em homenagem à tríplice coroa conquistada com o FC Bayern na época 2012-2013.",
        "Recompensa já resgatada.", "Recebeste {name}. Encontra-o nos teus itens não atribuídos do FUT.", "Recompensa do nível 10"),
    "pl": (
        "Odbierz Roberta Lewandowskiego Flashback 85 w nieprzypisanych kartach FUT. Niewymienny, do odebrania tylko raz.",
        "Wybrany przez Dante_GFX, na cześć potrójnej korony zdobytej z FC Bayern w sezonie 2012-2013.",
        "Nagroda została już odebrana.", "Odebrano {name}. Znajdziesz go w nieprzypisanych kartach FUT.", "Nagroda za poziom 10"),
}


def language(value, fallback="fr"):
    code = str(value or "").split(",", 1)[0].split(";", 1)[0].lower().replace("_", "-").split("-", 1)[0]
    return code if code in TEXTS else fallback


def request_language(headers, raw_path, fallback="fr"):
    query = parse_qs(urlsplit(raw_path).query)
    normalized = {str(key).lower(): str(value) for key, value in (headers or {}).items()}
    value = next((query[key][0] for key in ("language", "locale", "lang") if query.get(key)), "")
    return language(value or normalized.get("x-ut-language") or normalized.get("accept-language"), fallback)


def reward(entry, locale):
    if entry["itemId"] not in {2, 15}:
        return entry
    result = copy.deepcopy(entry)
    texts = TEXTS[locale]
    description = texts[0] if entry["itemId"] == 2 else texts[1]
    result["description"] = texts[4] if entry["itemId"] == 2 else description
    for attribute in result["attributes"]:
        if attribute["name"] == "itemDescription":
            attribute["value"] = description
    return result


def claim_message(entry, result, locale):
    texts = TEXTS[locale]
    return texts[2] if result["alreadyClaimed"] else texts[3].format(name=entry["name"])
