# ČSFD – osoby a filmografia

Addon pre AIOStreams, Stremio a Nuvio. Vyhľadávanie osôb, biografia a filmografia používajú TMDB (vyžadujú vlastný kľúč). ČSFD dopĺňa hodnotenie a odkaz v detaile filmu alebo seriálu. Názov addonu neznamená natívne vyhľadávanie v databáze osôb ČSFD.

## AIOStreams: podporované rozhranie

Overené podľa [People API](https://aiostreams.org/reference/addon-protocol/people/) a [implementácie klienta](https://github.com/Viren070/AIOStreams/blob/113ab6bfd5888f494f78370e2b7fe5ee39897e1d/packages/core/src/jellyfin/people.ts), 16. novembra 2026. Podpora person metas a people search bola pridaná vo [v2.37](https://aiostreams.org/changelog/v2.37/). Staršie inštancie nemusia podporovať tento tok.

1. Pridajte URL addonu končiacu `/manifest.json` ako vlastný addon v konfigurácii AIOStreams a povoľte katalógy aj metadata.
2. Importujte alebo obnovte katalógy a povoľte `👤 Osoby` pre vyhľadávanie. Po zmene manifestu obnovte konfiguráciu addonu.
3. V klientovi s podporou vyhľadávania osôb použite people search. AIOStreams vyhľadávanie titulov **nevolá person katalógy**. V bežnom vyhľadávaní filmov možno použiť existujúce filmografické katalógy a zadať meno osoby.
4. Výsledok osoby sa otvorí cez `meta/person/{id}.json`. Podporované klienty zobrazia biografiu, dátumy a klikateľné filmy/seriály z poľa `credits`.

Príklady protokolu:

```text
/catalog/person/csfd-people/search=Brad%20Pitt.json
/meta/person/tmdb:287.json
/meta/person/person:287.json
```

Nové výsledky používajú štandardné `tmdb:287` a provider `ids`. Staršie odkazy `person:287` zostávajú funkčné a detail vráti pôvodné ID. Filmografia používa IMDb ID, ak je dostupné, inak `tmdb:movie:ID` alebo `tmdb:series:ID`; addon vie obslúžiť ich detaily. Dostupnosť prehrávania závisí od stream addonov a ich podpory ID. Chyba jedného titulu nezablokuje celý profil.

Podľa dokumentácie Stremio zobrazuje osoby vo výsledkoch, ale ich stránka nemá streamy. Vykreslenie klikateľnej filmografie závisí od klienta; vlastné `/people/*` endpointy ani rozšírenie `nuvio` nie sú podmienkou AIOStreams kompatibility.

## Zachované katalógy

Všetkých deväť existujúcich katalógov ostáva pod pôvodnými ID:

| Typ | ID | Obsah |
| --- | --- | --- |
| person | csfd-people | Osoby |
| movie | csfd-person-movies | Herectvo – filmy |
| series | csfd-person-series | Herectvo – seriály |
| movie | csfd-person-creator-movies | Réžia/produkcia – filmy |
| series | csfd-person-creator-series | Réžia/produkcia – seriály |
| movie | csfd-person-upcoming-movies | Pripravované filmy |
| series | csfd-person-upcoming-series | Pripravované seriály |
| movie | csfd-person-special-movies | Dokumenty a krátke filmy |
| series | csfd-person-documentary-series | Dokumentárne seriály |

Všetky vyžadujú `search`; filmografické katalógy podporujú `skip` a stránky po 20 tituloch. Príklady: `Tom Hanks`, `herec: Brad Pitt`, `režisér: Christopher Nolan`. Profilová filmografia je kompletný deduplikovaný zoznam práce osoby; vynecháva talk/news relácie, archívne a čestné kredity. Katalógy majú svoje doterajšie filtre.

## Lokálne spustenie a testy

Node.js 20:

```sh
npm ci
cp .env.example .env
# nastavte TMDB_API_KEY alebo TMDB_READ_ACCESS_TOKEN v .env
npm start
npm test
```

Predvolená adresa je `http://127.0.0.1:10000/manifest.json`. `/health` kontroluje konfiguráciu a dostupnosť TMDB, `/stats` vracia cache štatistiky. Kľúče necommitujte.

Testy používajú deterministické odpovede TMDB: kontrolujú vyhľadávanie cez HTTP, otvorenie osoby, filmografiu a otvorenie detailu titulu, legacy ID, filtrovanie/deduplikáciu a cache. Nepredstavujú skúšku používateľského rozhrania konkrétnej AIOStreams inštancie ani živého TMDB účtu.

Repozitár obsahuje `render.yaml`. Zmeny tohto PR nevyžadujú zmenu Render služieb; nasadenie je samostatný krok.
