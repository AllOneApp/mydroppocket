## Eesmärk

Laiendan olemasolevat profiilipõhist Google Drive'i loogikat samamoodi Google Calendarile ja lisan mõlemale võimaluse sünkroonida tagantjärele kõik olemasolevad kirjed ühe nupuvajutusega. Olemasolev Drive'i loogika, AI OCR, automaattäitmine, Dashboard ja dokumentide lisamise voog jäävad puutumata.

## 1. Andmemudel (1 migratsioon)

`google_calendar_connections`:

- Lisa `profile_id uuid null references user_profiles(id) on delete cascade`.
- Asenda vana `user_id` unique kahe osalise indeksiga:
  - `(user_id) where profile_id is null` – põhikonnektor
  - `(user_id, profile_id) where profile_id is not null` – profiili-spetsiifiline
- Lisa `calendar_mode text` profiili tasandil pole vaja — režiim tuleneb sellest, kas eraldi rida on olemas.

`user_profiles`:

- Lisa `calendar_mode text not null default 'shared'` (`'shared' | 'separate'`) — sümmeetriline `drive_mode`-ga.

`calendar_events`:

- Lisa `profile_id uuid null` + backfill vaikeprofiilile.
- Uuenda unique-i nii, et see hõlmab `profile_id`-d, et vältida ristprofiili duplikaate.

## 2. Serverikiht (`src/lib/google-calendar.server.ts` + `.functions.ts`)

- `resolveProfileCalendarConnection(userId, profileId)` – shared režiimis põhikonnektor, separate režiimis profiili oma. Peegeldab `resolveProfileDriveTarget`-i.
- `signCalendarState` / `verifyCalendarState` võtab kaasa `profileId`.
- OAuth callback (`/api/public/google-calendar/callback`) salvestab tokenid profiili-spetsiifilise reaga.
- Kõik olemasolevad sünkroonijad (`syncInstallmentForUser`, `syncRecurringForUser`, `syncWarrantyForUser`, `syncAgreementEndForUser`, `removeSourceEventsForUser`) võtavad optsionaalse `profileId` parameetri ning kirjutavad sündmused ainult sellele profiilile määratud kalendrisse. `calendar_events` päringud filtreerivad alati `profile_id`-ga.
- Uus `syncAllForProfile(userId, profileId)` – itereerib profiili garantiid + lepingud + püsimaksed + järelmaksud ja loob sündmused idempotentselt. Tagastab loenduri (`{ warranties, agreements, recurring, installments }`).

## 3. Server functions (`google-calendar.functions.ts`)

- `startGoogleCalendarConnect({ origin, profileId? })` – kui profileId antud ja profiil pole vaikeprofiil, algatab eraldi OAuthi.
- `getGoogleCalendarStatus({ profileId? })` – tagastab režiimi (`shared` / `separate`) + connectioni infot antud profiili kontekstis.
- `setProfileCalendarMode({ profileId, mode })` – shared/separate lülitus (separate → suunab OAuthi; shared → kustutab profiili eraldi connectioni valikuliselt).
- `disconnectGoogleCalendar({ profileId? })` – kustutab õige rea.
- `updateProfileCalendarSettings({ profileId, ...reminders })` – meeldetuletuste päevad + iga tüübi lülitid, hoitakse `google_calendar_connections` real.
- `syncExistingCalendarEntries({ profileId })` – käivitab `syncAllForProfile` ja tagastab loenduri UI-le.

Iga mooduli (`agreements.tsx`, `warranties.tsx`, `recurring.tsx`, `InstallmentsCard.tsx`) sünkroonimise kutse edastab nüüd `activeProfileId` — sama muster nagu Drive.

## 4. UI

`**src/routes/_authenticated/profiles.tsx**` – iga profiili kaardile lisandub sektsioon **Google Calendar** (peegeldab olemasolevat Drive'i sektsiooni):

- Kaks raadionuppu: „Kasuta põhiprofiili Google Calendarit" / „Ühenda teine Google Calendar".
- Kui ühendatud (separate): kuva `🟢 nimi@gmail.com`, kalendri nimi, „Katkesta ühendus".
- Meeldetuletuste seaded (checkbox'id: 30 / 14 / 7 / 1 päev) garantiide ja lepingute jaoks.
- Nupp „Sünkrooni olemasolevad sündmused" (kutsub `syncExistingCalendarEntries`).
- Post-connect dialog: „📅 Google Calendar ühendatud! Selles profiilis on X garantiid ja Y lepingut, mida pole veel sünkroonitud. Sünkroonida?" — nupud „Jah" / „Hiljem". Edenemine + kokkuvõte.

**Google Drive – analoogne täiendus** samas failis:

- Pärast edukat Drive'i ühendumist käivitab post-connect kontroll (kas profiili peale on kirjeid, mille `drive_file_id is null`).
- Kui jah, kuvatakse dialog „☁️ Google Drive ühendatud! Sünkrooni olemasolevad dokumendid?" — nupud „Jah" / „Hiljem".
- Seadetes lisandub alaline nupp „Sünkrooni olemasolevad dokumendid" (Drive) ja „Sünkrooni olemasolevad sündmused" (Calendar).
- Edenemisriba (loenduri sõnum „37 / 185 dokumenti sünkroonitud") + lõpu kokkuvõte („85 kuludokumenti, 23 garantiid, 8 lepingut").

**Uus komponent** `src/components/SyncProgressDialog.tsx` – jagatud edenemisriba (kasutame nii Drive kui Calendar sünkroonimise ajal).

## 5. Bulk-sünkroonimise implementatsioon

- Drive: uus server fn `syncExistingDriveDocuments({ profileId })` – itereerib `expenses`, `warranties`, `agreements`, `agreement_attachments` kirjed selle profiili all, kus `drive_file_id is null` või `sync_status != 'synced'`. Iga faili laadib storage'ist ja kutsub olemasoleva `syncFileToGoogleDrive` loogika. Ebaõnnestunud failid kogutakse listi. Idempotentne — enne üleslaadimist kontrollib olemasolu (kasutame juba salvestatud `drive_file_id`).
- Streamib progressi läbi kliendipoolse polling'i (server fn tagastab `{ total, done, failed }` jooksva olekuga kuni valmis; teeme lihtsa versiooni: server fn töötab sünkroonselt ja klient kutsub batchidena á 10 faili).
- Calendar: `syncAllForProfile` on juba idempotentne (`upsertSourceEvents` teeb `onConflict`).

## 6. Ei muuda

- Drive'i tuumfunktsionaalsust (kaustastruktuur, resolver, callback) – lisandub ainult „sync existing" täiendus.
- AI OCR / automaattäitmine.
- Dashboard, Ülevaade, järelmaksude arvutus.
- Dokumentide lisamise dialoogid.

## Muudetavad failid

- **Migratsioon** (1 tk): profile_id veerud + unikaalsuse indeksid + backfill.
- `src/lib/google-calendar.server.ts` – resolver + profileId kõikjale.
- `src/lib/google-calendar.functions.ts` – uued server fn-id.
- `src/routes/api/public/google-calendar/callback.ts` – profileId state'ist.
- `src/lib/google-drive.functions.ts` – lisandub `syncExistingDriveDocuments`.
- `src/routes/_authenticated/profiles.tsx` – Calendar sektsioon + bulk-sync UI + post-connect dialog (Drive'ile samuti).
- `src/components/SyncProgressDialog.tsx` – uus.
- `src/routes/_authenticated/agreements.tsx`, `warranties.tsx`, `recurring.tsx`, `InstallmentsCard.tsx` – edastavad `activeProfileId` ka Calendari sünkroonimisele.
- `src/i18n/locales/et.json`, `en.json` – uued tekstid.

## Testiplaan

1. Loo profiil „Ema", vali „Ühenda teine Google Calendar" → OAuth → sündmused ilmuvad Ema Google Calendarisse, mitte põhiprofiili omasse.
2. Lülita „Ema" tagasi shared'ile → uued sündmused lähevad põhikalendrisse; vanad Ema kalendris ei kustu (ainult connection eemaldatakse).
3. Ühenda Calendar profiilile, kus on juba 5 garantiid – dialog pakub sünkroonimist → 5 sündmust luuakse.
4. Ühenda Drive profiilile, kus on 40 varasemat kuludokumenti – dialog pakub sünkroonimist → progressiribaga laaditakse üles, duplikaate ei teki.
5. Ühenduse katkemisel: „Sünkrooni olemasolevad" nupp seadetes jätkab (idempotentne).
6. Profiili vahetamisel Calendari sündmused ega Drive'i failid ei sega omavahel.lisaksin 5 täiendust
  ## 1. Google Calendari ka nimi võiks olla nähtav
  Praegu kirjutab ta:
  > Google konto
  ja
  > kalendri nimi
  Ma täpsustaksin selle ära.
  Näiteks:
  ```

  ```
  ```
  Google Calendar

  🟢 Ühendatud

  Google konto:

  ema@gmail.com

  Kalender:

  Primary Calendar

  või

  MyDropPocket Calendar
  ```
  See aitab kasutajal kohe aru saada, kuhu sündmused lähevad.
  ---
  # 2. Kui profiil nimetatakse ümber
  Me juba tegime Drive'i jaoks selle otsuse.
  Täpselt sama võiks kehtida Calendarile.
  Näiteks:
  ```

  ```
  ```
  Ema

  ↓

  Ema Mari
  ```
  siis võiks kõik tulevased sündmused minna endiselt sellele profiilile.
  Sündmused ei tohiks kaduda ega hakata kuhugi mujale tekkima.
  Selle võiks lihtsalt ühe lausena juurde kirjutada.
  ---
  # 3. Drive + Calendar võiks olla ühes kohas
  Praegu jääb mulje nagu oleks kaks täiesti erinevat seadistust.
  Mina paneks seadetes näiteks:
  ```

  ```
  ```
  Pilveteenused

  Google Drive

  Google Calendar
  ```
  ehk ühe sektsiooni alla.
  Kasutajal on palju loogilisem.
  ---
  # 4. Väga oluline asi
  Seda ei ole üldse kirjas.
  Kui kasutaja teeb:
  ```

  ```
  ```
  Katkesta ühendus
  ```
  kas:
  -   
  Google Drive failid kustutatakse?  

  või
  -   
  Google Calendar sündmused kustutatakse?  

  **Minu arvates EI TOHI.**
  Need peavad alles jääma.
  Katkestatakse ainult tulevane sünkroonimine.
  Seda soovitaksin kindlasti täpsustada.
  Näiteks:
  > Google Drive või Google Calendar ühenduse katkestamine ei kustuta kasutaja Google kontol juba olemasolevaid faile ega kalendrisündmusi. Katkestatakse ainult edasine automaatne sünkroonimine.
  See on väga oluline kasutaja usalduse jaoks.
  ---
  # 5. Kõige olulisem täiendus
  See jäi üldse välja.
  Kui kasutaja ühendab:
  ```

  ```
  ```
  Google Drive

  Google Calendar
  ```
  ja valib
  ```

  ```
  ```
  shared
  ```
  siis võiks kohe olla näha:
  ```

  ```
  ```
  Kasutab põhiprofiili ühendust

  Google konto:

  eelika@gmail.com
  ```
  mitte lihtsalt
  ```

  ```
  ```
  shared
  ```
  Muidu kasutaja ei tea üldse, millise konto külge ta parasjagu ühendatud on. Enne rakendamist palun lisa veel järgmised täiendused:
  - kuva alati ühendatud Google konto ja kasutatav Google Calendar/Drive ka siis, kui profiil kasutab "Kasuta põhiprofiili" režiimi;
  - ühenduse katkestamine ei tohi kustutada juba Google Drive'i üles laaditud faile ega Google Calendarisse loodud sündmusi, vaid lõpetab ainult edasise automaatse sünkroonimise;
  - koonda Google Drive ja Google Calendar seadetes ühe "Pilveteenused" sektsiooni alla, et kasutajale oleks loogilisem;
  - profiili ümbernimetamisel peab ühendus säilima ning tulevased sündmused ja dokumendid peavad jätkuvalt kuuluma samale profiilile.