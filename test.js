/*
  Ruhepol – Technik-Test (Bauschritt 1)

  Aufbau dieser Datei:
    1. Protokoll und Antworten (localStorage, bleibt nur auf dem Gerät)
    2. Speicher für die Aufnahme (IndexedDB)
    3. Zustand anzeigen (App-Modus, Internet, Offline-Kopie, Speicher)
    4. Aufnehmen und Abspielen (MediaRecorder)
    5. Ton bei abgedunkeltem / gesperrtem Bildschirm (Wake Lock, Ereignisse)
    6. Ja/Nein-Fragen und Ergebnis kopieren
    7. Start

  Datenschutz: Nichts davon verlässt das Gerät. Es gibt keinen einzigen
  Netzwerkaufruf außer dem Laden der eigenen Dateien. Das Ergebnis wird nur
  in die Zwischenablage kopiert, wenn du selbst auf den Knopf tippst.
  Text wird ausschließlich über textContent gesetzt (kein innerHTML).
*/
"use strict";

const $ = (id) => document.getElementById(id);

/** Stand dieser Testseite. Muss zu VERSION in sw.js passen (dort "technik-test-v4"). */
const BUILD = "v4";

/*
  Kam diese Seite aus der Offline-Kopie? Das lässt sich nur JETZT, beim Laden,
  sicher sagen. Später kann der Service Worker die Seite übernehmen, obwohl
  sie aus dem Netz kam (Befund Codex Nr. 7).
*/
const KAM_AUS_OFFLINE_KOPIE = Boolean(navigator.serviceWorker?.controller);

/* ---------- 1. Protokoll und Antworten ---------- */

const PROTOKOLL_KEY = "ruhepol-test-protokoll";
const ANTWORT_KEY = "ruhepol-test-antworten";
const MAX_EINTRAEGE = 200;

function leseJson(key, ersatz) {
  try {
    const wert = JSON.parse(localStorage.getItem(key));
    return wert ?? ersatz;
  } catch {
    return ersatz;
  }
}

function schreibeJson(key, wert) {
  try {
    localStorage.setItem(key, JSON.stringify(wert));
  } catch {
    /* Speicher voll oder gesperrt – das Protokoll ist dann nur im Fenster sichtbar */
  }
}

function uhrzeit(datum = new Date()) {
  return datum.toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Schreibt eine Zeile ins Protokoll (mit Uhrzeit) und zeigt sie an. */
function protokoll(text) {
  const liste = leseJson(PROTOKOLL_KEY, []);
  liste.push({ t: Date.now(), text: String(text) });
  while (liste.length > MAX_EINTRAEGE) liste.shift();
  schreibeJson(PROTOKOLL_KEY, liste);
  zeigeProtokoll();
}

function zeigeProtokoll() {
  const ol = $("protokoll");
  ol.replaceChildren();
  const liste = leseJson(PROTOKOLL_KEY, []);
  for (let i = liste.length - 1; i >= 0; i--) {
    const li = document.createElement("li");
    li.textContent = `${uhrzeit(new Date(liste[i].t))} – ${liste[i].text}`;
    ol.append(li);
  }
}

/* ---------- 2. Speicher für die Aufnahme (IndexedDB) ---------- */

const DB_NAME = "ruhepol-technik-test";
const DB_STORE = "aufnahmen";
const AUFNAHME_ID = "test";

function oeffneDb() {
  return new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      anfrage.result.createObjectStore(DB_STORE, { keyPath: "id" });
    };
    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => reject(anfrage.error);
  });
}

/** Führt eine Aktion im Speicher aus und wartet, bis sie wirklich abgeschlossen ist. */
async function imSpeicher(modus, aktion) {
  const db = await oeffneDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, modus);
      const anfrage = aktion(tx.objectStore(DB_STORE));
      let ergebnis;
      anfrage.onsuccess = () => { ergebnis = anfrage.result; };
      tx.oncomplete = () => resolve(ergebnis);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/*
  Die Aufnahme wird als ArrayBuffer (rohe Bytes) plus Dateityp gespeichert,
  nicht als Blob. Grund: Ältere Safari-Versionen hatten Fehler beim Ablegen
  von Blobs in IndexedDB; rohe Bytes gehen überall.
*/
const speichereAufnahme = (eintrag) => imSpeicher("readwrite", (s) => s.put(eintrag));
const ladeAufnahme = () => imSpeicher("readonly", (s) => s.get(AUFNAHME_ID));
const loescheAufnahme = () => imSpeicher("readwrite", (s) => s.delete(AUFNAHME_ID));

/* ---------- 3. Zustand anzeigen ---------- */

function setzeWert(id, text, gut) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("gut", gut === true);
  el.classList.toggle("schlecht", gut === false);
}

function istAlsAppGeoeffnet() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function zeigeNetz() {
  setzeWert("z-netz", navigator.onLine ? "verbunden" : "aus (offline)", null);
}

// Jede Speicherabfrage einzeln abgefangen: Fehler erscheinen sichtbar statt still (Befund Codex Nr. 9).
async function zeigeSpeicher() {
  if (!navigator.storage?.persisted) {
    setzeWert("z-persist", "nicht unterstützt", false);
  } else {
    try {
      const dauerhaft = await navigator.storage.persisted();
      setzeWert("z-persist", dauerhaft ? "ja, gewährt" : "nein (noch nicht)", dauerhaft);
    } catch (f) {
      setzeWert("z-persist", `Fehler: ${f?.name}`, false);
      protokoll(`persisted() fehlgeschlagen: ${f?.name}`);
    }
  }
  if (!navigator.storage?.estimate) {
    setzeWert("z-belegt", "unbekannt", null);
    return;
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const mb = (b) => (b / 1024 / 1024).toFixed(1).replace(".", ",");
    setzeWert("z-belegt", `${mb(usage)} MB von ${mb(quota)} MB`, null);
  } catch (f) {
    setzeWert("z-belegt", `Fehler: ${f?.name}`, false);
    protokoll(`estimate() fehlgeschlagen: ${f?.name}`);
  }
}

async function frageDauerhaftenSpeicher() {
  if (!navigator.storage?.persist) {
    protokoll("Dauerhafter Speicher: Funktion nicht vorhanden");
    return;
  }
  try {
    const gewaehrt = await navigator.storage.persist();
    protokoll(`Dauerhafter Speicher angefragt: ${gewaehrt ? "gewährt" : "nicht gewährt"}`);
  } catch (f) {
    protokoll(`persist() fehlgeschlagen: ${f?.name}`);
  }
  await zeigeSpeicher();
}

/*
  Audio-Sitzung (nur neuere Safari-Versionen): legt fest, ob die Seite nur
  abspielt ("playback") oder auch aufnimmt ("play-and-record"). Wir setzen sie
  vor dem Abspielen auf "playback" – so wird die spätere App es auch tun – und
  schreiben den Wert ins Protokoll (Befund Codex Nr. 4).
*/
function setzeAudioSitzung(typ) {
  if (!navigator.audioSession) return "nicht vorhanden";
  try {
    navigator.audioSession.type = typ;
  } catch (f) {
    protokoll(`Audio-Sitzung „${typ}“ nicht setzbar: ${f?.name}`);
  }
  return navigator.audioSession.type;
}

function geraeteText() {
  // Nur Systemversion und Browser, keine Kennung des Geräts.
  const ua = navigator.userAgent;
  const ios = ua.match(/OS (\d+)[_.](\d+)/);
  const safari = ua.match(/Version\/([\d.]+)/);
  if (ios) return `iOS ${ios[1]}.${ios[2]}${safari ? ` · Safari ${safari[1]}` : ""}`;
  return ua.includes("Edg/") ? "Edge (Rechner)" : "anderer Browser";
}

async function richteOfflineKopieEin() {
  if (!("serviceWorker" in navigator)) {
    setzeWert("z-sw", "nicht unterstützt", false);
    protokoll("Service Worker nicht unterstützt");
    return;
  }
  /*
    Neue Version erkannt: Hatte die Seite schon eine Offline-Kopie und übernimmt
    jetzt eine neuere, einmal neu laden – damit nicht der alte Stand getestet wird.
    Der Merker in sessionStorage verhindert eine Neuladeschleife.
  */
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!KAM_AUS_OFFLINE_KOPIE) return; // erster Besuch: nichts neu laden
    let schonNeu = false;
    try { schonNeu = sessionStorage.getItem("ruhepol-test-neu") === BUILD; } catch { /* egal */ }
    if (schonNeu) return;
    try { sessionStorage.setItem("ruhepol-test-neu", BUILD); } catch { /* egal */ }
    protokoll("Neue Version der Testseite gefunden – lade neu");
    location.reload();
  });
  try {
    const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
    reg.update().catch(() => { /* offline: keine neue Version prüfbar, ist in Ordnung */ });
    await navigator.serviceWorker.ready;
    setzeWert("z-sw", KAM_AUS_OFFLINE_KOPIE ? "bereit, Seite kam daraus" : "angelegt (wirkt ab nächstem Öffnen)", true);
  } catch (fehler) {
    setzeWert("z-sw", "Fehler", false);
    protokoll(`Offline-Kopie fehlgeschlagen: ${fehler.name}`);
  }
}

/* ---------- 4. Aufnehmen und Abspielen ---------- */

const MAX_AUFNAHME_SEK = 60;
let rekorder = null;
let aufnahmeTimer = null;
const spieler = new Audio();
let spielerUrl = null;

/** Wählt ein Format, das der Browser aufnehmen kann. iPhone: meist audio/mp4 (AAC). */
function waehleFormat() {
  const kandidaten = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return kandidaten.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

async function starteAufnahme() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    $("aufnahme-status").textContent = "Aufnehmen wird hier nicht unterstützt.";
    protokoll("Aufnahme: MediaRecorder fehlt");
    return;
  }
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (fehler) {
    $("aufnahme-status").textContent = "Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben.";
    protokoll(`Mikrofon verweigert: ${fehler.name}`);
    return;
  }

  const format = waehleFormat();
  const stuecke = [];
  const beginn = performance.now();

  /** Räumt bei jedem Fehler auf: Timer aus, Mikrofon frei, Knopf zurück (Befund Codex Nr. 5). */
  const abbrechen = (wo, fehler) => {
    clearInterval(aufnahmeTimer);
    strom.getTracks().forEach((spur) => spur.stop());
    rekorder = null;
    $("btn-aufnahme").textContent = "Aufnahme starten";
    $("aufnahme-status").textContent = "Aufnahme ging nicht. Details im Protokoll.";
    protokoll(`Aufnahme-Fehler (${wo}): ${fehler?.name ?? "unbekannt"}`);
  };

  try {
    rekorder = new MediaRecorder(strom, format ? { mimeType: format } : undefined);
  } catch (f) {
    abbrechen("Rekorder anlegen", f);
    return;
  }
  const dieser = rekorder; // fester Bezug, auch wenn "rekorder" nach einem Fehler schon null ist
  let fehlgeschlagen = false;
  dieser.onerror = (e) => { fehlgeschlagen = true; abbrechen("während der Aufnahme", e.error); };

  dieser.ondataavailable = (e) => { if (e.data.size > 0) stuecke.push(e.data); };
  dieser.onstop = async () => {
    strom.getTracks().forEach((spur) => spur.stop()); // Mikrofon sofort freigeben
    clearInterval(aufnahmeTimer);
    if (fehlgeschlagen) return; // halbe Aufnahme nach Fehler nicht speichern
    const dauer = Math.round((performance.now() - beginn) / 1000);
    const typ = dieser.mimeType || format || "audio/mp4";
    const blob = new Blob(stuecke, { type: typ });
    try {
      await speichereAufnahme({
        id: AUFNAHME_ID, typ, dauer, erstellt: Date.now(), bytes: await blob.arrayBuffer(),
      });
      protokoll(`Aufnahme gespeichert: ${dauer} s, ${typ}, ${Math.round(blob.size / 1024)} KB`);
    } catch (fehler) {
      protokoll(`Speichern fehlgeschlagen: ${fehler?.name}`);
    }
    rekorder = null;
    $("btn-aufnahme").textContent = "Neu aufnehmen";
    await zeigeAufnahme();
    await zeigeSpeicher();
  };

  try {
    rekorder.start();
  } catch (f) {
    abbrechen("Start", f);
    return;
  }
  protokoll(`Aufnahme gestartet (${rekorder.mimeType || "Standardformat"}, Audio-Sitzung: ${navigator.audioSession?.type ?? "nicht vorhanden"})`);
  $("btn-aufnahme").textContent = "Aufnahme beenden";
  aufnahmeTimer = setInterval(() => {
    const sek = Math.round((performance.now() - beginn) / 1000);
    $("aufnahme-status").textContent = `Aufnahme läuft … ${sek} s`;
    if (sek >= MAX_AUFNAHME_SEK) rekorder?.stop();
  }, 500);
}

function aufnahmeKnopf() {
  if (rekorder?.state === "recording") rekorder.stop();
  else starteAufnahme();
}

/** Lädt die gespeicherte Aufnahme in den Spieler und zeigt Datum und Dauer an. */
async function zeigeAufnahme() {
  let eintrag;
  try {
    eintrag = await ladeAufnahme();
  } catch (fehler) {
    $("aufnahme-status").textContent = "Speicher nicht lesbar.";
    protokoll(`Speicher lesen fehlgeschlagen: ${fehler?.name}`);
    return null;
  }
  if (spielerUrl) URL.revokeObjectURL(spielerUrl);
  spielerUrl = null;
  if (!eintrag) {
    $("aufnahme-status").textContent = "Noch keine Aufnahme gespeichert.";
    $("btn-abspielen").disabled = true;
    $("btn-loeschen").hidden = true;
    return null;
  }
  spielerUrl = URL.createObjectURL(new Blob([eintrag.bytes], { type: eintrag.typ }));
  spieler.src = spielerUrl;
  $("aufnahme-status").textContent =
    `Aufnahme: ${eintrag.dauer} s, gespeichert am ${uhrzeit(new Date(eintrag.erstellt))}`;
  $("btn-abspielen").disabled = false;
  $("btn-loeschen").hidden = false;
  return eintrag;
}

function abspielen() {
  spieler.loop = false;
  spieler.currentTime = 0;
  spieler.play().catch((f) => protokoll(`Abspielen fehlgeschlagen: ${f.name}`));
}

/** Hält einen Spieler an und trennt ihn von seiner Tonquelle (damit nichts weiterpuffert). */
function leereSpieler(s) {
  s.pause();
  s.removeAttribute("src");
  s.load();
}

async function aufnahmeLoeschen() {
  // Beide Spieler stoppen – die Aufnahme kann auch im Dauerton-Test laufen (Befund Codex Nr. 10).
  stoppeDauerton("Aufnahme gelöscht");
  leereSpieler(spieler);
  leereSpieler(tonSpieler);
  await loescheAufnahme();
  protokoll("Aufnahme gelöscht");
  await zeigeAufnahme();
  await zeigeSpeicher();
}

/* ---------- 5. Ton bei abgedunkeltem / gesperrtem Bildschirm ---------- */

/*
  Testtöne: leise, weiche Sinustöne, die über ihre ganze Länge sanft an- und
  abschwellen (beginnen und enden in Stille – kein Knacken, keine plötzlichen
  Töne, Lautstärke höchstens 15 %). Sie werden hier im Gerät berechnet, keine
  Datei aus dem Netz.
    - "Ein Ton":  220 Hz, 4 s, in Schleife.
    - "Wechsel":  220 Hz und 165 Hz, je 10 s, lösen sich ab. Jeder Wechsel ist
      ein neuer Tonstart – so wie später Stimme → Klang. Genau das ist bei
      gesperrtem iPhone fehleranfällig (Befund Codex Nr. 4, WebKit 261554).
*/
function erzeugeTestton(hz = 220, sekunden = 4) {
  const rate = 22050;
  const n = rate * sekunden;
  const puffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(puffer);
  const schreibe = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  schreibe(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); schreibe(8, "WAVE");
  schreibe(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  schreibe(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const huelle = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / sekunden); // von Stille an- und wieder abschwellen
    const probe = Math.sin(2 * Math.PI * hz * t) * huelle * 0.15;
    v.setInt16(44 + i * 2, Math.round(probe * 32767), true);
  }
  return URL.createObjectURL(new Blob([puffer], { type: "audio/wav" }));
}

const tonSpieler = new Audio();
let testtonUrl = null;
let wechselUrls = null; // [220 Hz, 165 Hz], je 10 s
let wechselModus = false;
let wechselZaehler = 0;
let wachSperre = null;
let tonGestartet = 0;

async function starteDauerton(anlass) {
  let quelle = document.querySelector('input[name="quelle"]:checked').value;
  spieler.pause();
  if (quelle === "aufnahme") {
    const eintrag = await zeigeAufnahme();
    if (eintrag) {
      tonSpieler.src = spielerUrl;
    } else {
      protokoll("Keine Aufnahme vorhanden – nehme einen Testton");
      quelle = "ton";
    }
  }
  if (quelle === "ton") {
    testtonUrl ??= erzeugeTestton(220, 4);
    tonSpieler.src = testtonUrl;
  }
  wechselModus = quelle === "wechsel";
  wechselZaehler = 0;
  if (wechselModus) {
    wechselUrls ??= [erzeugeTestton(220, 10), erzeugeTestton(165, 10)];
    tonSpieler.src = wechselUrls[0];
  }
  tonSpieler.loop = !wechselModus;
  tonSpieler.volume = 1;
  const sitzung = setzeAudioSitzung("playback");
  try {
    await tonSpieler.play();
    tonGestartet = Date.now();
    protokoll(`Ton gestartet (${anlass}, ${{ wechsel: "Wechsel", ton: "ein Ton", aufnahme: "Aufnahme" }[quelle]}, Audio-Sitzung: ${sitzung})`);
  } catch (f) {
    protokoll(`Ton starten fehlgeschlagen: ${f.name}`);
  }
}

// Wechsel-Test: Ist ein Ton zu Ende, startet sofort der andere.
tonSpieler.addEventListener("ended", async () => {
  if (!wechselModus || !tonGestartet) return;
  wechselZaehler++;
  tonSpieler.src = wechselUrls[wechselZaehler % 2];
  try {
    await tonSpieler.play();
    protokoll(`Wechsel ${wechselZaehler} geklappt (Seite ${document.visibilityState === "visible" ? "sichtbar" : "verdeckt/gesperrt"})`);
  } catch (f) {
    protokoll(`Wechsel ${wechselZaehler} gescheitert: ${f.name} (Seite ${document.visibilityState === "visible" ? "sichtbar" : "verdeckt/gesperrt"})`);
  }
});

function stoppeDauerton(grund) {
  const lief = tonGestartet;
  tonGestartet = 0; // zuerst zurücksetzen, damit das folgende "pause" nicht als Systemstopp zählt
  if (!tonSpieler.paused) tonSpieler.pause();
  if (lief) {
    protokoll(`Ton angehalten (${grund}) nach ${Math.round((Date.now() - lief) / 1000)} s${wechselModus ? `, ${wechselZaehler} Wechsel` : ""}`);
  }
}

async function holeWachSperre() {
  if (!("wakeLock" in navigator)) {
    protokoll("Wake Lock nicht vorhanden – Bildschirm kann ausgehen");
    return;
  }
  try {
    wachSperre = await navigator.wakeLock.request("screen");
    protokoll("Bildschirm wird wach gehalten (Wake Lock)");
    wachSperre.addEventListener("release", () => protokoll("Wake Lock wurde freigegeben"));
  } catch (f) {
    protokoll(`Wake Lock abgelehnt: ${f.name}`);
  }
}

async function abdunkeln() {
  await starteDauerton("abdunkeln");
  await holeWachSperre();
  $("dunkel").hidden = false;
  $("dunkel-stopp").focus();
}

async function abdunkelnBeenden() {
  $("dunkel").hidden = true;
  stoppeDauerton("Abdunkeln beendet");
  if (wachSperre) {
    await wachSperre.release().catch(() => {});
    wachSperre = null;
  }
}

// Diese Ereignisse zeigen im Protokoll, wann das iPhone den Ton oder die Seite anhält.
tonSpieler.addEventListener("pause", () => {
  // Ein zu Ende gespielter Ton meldet auch "pause" – das ist kein Stopp durch das System.
  if (tonGestartet && !tonSpieler.ended) protokoll(`Ton wurde vom System angehalten (Seite ${document.visibilityState === "visible" ? "sichtbar" : "verdeckt"})`);
});
document.addEventListener("visibilitychange", async () => {
  const lief = tonGestartet && !tonSpieler.paused;
  protokoll(`Bildschirm/Seite: ${document.visibilityState === "visible" ? "wieder sichtbar" : "verdeckt oder gesperrt"}${tonGestartet ? ` · Ton ${lief ? "läuft" : "steht"}` : ""}${tonGestartet && wechselModus ? ` · ${wechselZaehler} Wechsel bisher` : ""}`);
  // Nach dem Zurückkommen die Wachsperre erneuern, falls noch abgedunkelt.
  if (document.visibilityState === "visible" && !$("dunkel").hidden && wachSperre?.released !== false) {
    await holeWachSperre();
  }
});
window.addEventListener("pagehide", () => protokoll("Seite wird geschlossen oder eingefroren"));
window.addEventListener("online", () => { zeigeNetz(); protokoll("Internet: verbunden"); });
window.addEventListener("offline", () => { zeigeNetz(); protokoll("Internet: aus"); });

/* ---------- 6. Ja/Nein-Fragen und Ergebnis ---------- */

function baueFragen() {
  const antworten = leseJson(ANTWORT_KEY, {});
  document.querySelectorAll(".frage").forEach((feld) => {
    const schluessel = feld.dataset.frage;
    const text = document.createElement("span");
    text.className = "frage-text";
    text.textContent = feld.dataset.text;
    feld.append(text);
    for (const wert of ["Ja", "Nein"]) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = wert;
      knopf.setAttribute("aria-pressed", String(antworten[schluessel] === wert));
      knopf.addEventListener("click", () => {
        const neu = leseJson(ANTWORT_KEY, {});
        neu[schluessel] = wert;
        schreibeJson(ANTWORT_KEY, neu);
        feld.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === knopf)));
        protokoll(`Antwort „${feld.dataset.text}“: ${wert}`);
      });
      feld.append(knopf);
    }
  });
}

function ergebnisText() {
  const antworten = leseJson(ANTWORT_KEY, {});
  const zeilen = [`Ruhepol Technik-Test ${BUILD} – Ergebnis`, `Stand: ${uhrzeit()}`, ""];
  for (const id of ["z-app", "z-netz", "z-sw", "z-persist", "z-belegt", "z-geraet"]) {
    const zeile = $(id).closest(".zeile");
    zeilen.push(`${zeile.querySelector("dt").textContent}: ${$(id).textContent}`);
  }
  zeilen.push("", `Aufnahme: ${$("aufnahme-status").textContent}`, "");
  document.querySelectorAll(".frage").forEach((f) => {
    zeilen.push(`${f.dataset.text} ${antworten[f.dataset.frage] ?? "– nicht beantwortet"}`);
  });
  zeilen.push("", "Protokoll:");
  for (const e of leseJson(PROTOKOLL_KEY, [])) zeilen.push(`${uhrzeit(new Date(e.t))} ${e.text}`);
  return zeilen.join("\n");
}

async function ergebnisKopieren() {
  const text = ergebnisText();
  try {
    await navigator.clipboard.writeText(text);
    $("ergebnis-text").hidden = true;
    $("kopier-status").textContent = "Kopiert. Jetzt in die Nachricht einfügen.";
  } catch {
    // Rückfall: den ganzen Text sichtbar machen, zum Markieren (Befund Codex Nr. 11)
    $("ergebnis-text").textContent = text;
    $("ergebnis-text").hidden = false;
    $("kopier-status").textContent = "Kopieren ging nicht. Halte den Finger auf den Text unten, dann „Alles auswählen“ und „Kopieren“.";
  }
}

function allesLeeren() {
  schreibeJson(PROTOKOLL_KEY, []);
  schreibeJson(ANTWORT_KEY, {});
  document.querySelectorAll(".frage button").forEach((b) => b.setAttribute("aria-pressed", "false"));
  zeigeProtokoll();
}

/* ---------- 7. Start ---------- */

async function start() {
  const alsApp = istAlsAppGeoeffnet();
  setzeWert("z-app", alsApp ? "ja, vom Home-Bildschirm" : "nein, im Browser", alsApp);
  $("installhinweis").hidden = alsApp;
  setzeWert("z-geraet", geraeteText(), null);
  $("version").textContent = `· Test ${BUILD}`;
  zeigeNetz();
  baueFragen();
  zeigeProtokoll();
  protokoll(`Geöffnet, Test ${BUILD} (${alsApp ? "als App" : "im Browser"}, ${navigator.onLine ? "online" : "offline"}, ${KAM_AUS_OFFLINE_KOPIE ? "aus Offline-Kopie" : "aus dem Netz"}, Audio-Sitzung: ${navigator.audioSession?.type ?? "nicht vorhanden"})`);

  $("btn-persist").addEventListener("click", frageDauerhaftenSpeicher);
  $("btn-aufnahme").addEventListener("click", aufnahmeKnopf);
  $("btn-abspielen").addEventListener("click", abspielen);
  $("btn-loeschen").addEventListener("click", aufnahmeLoeschen);
  $("btn-abdunkeln").addEventListener("click", abdunkeln);
  $("dunkel-stopp").addEventListener("click", abdunkelnBeenden);
  $("btn-tonsperre").addEventListener("click", () => starteDauerton("Sperrtest"));
  $("btn-tonstopp").addEventListener("click", () => stoppeDauerton("von Hand"));
  $("btn-kopieren").addEventListener("click", ergebnisKopieren);
  $("btn-protokoll-leeren").addEventListener("click", allesLeeren);

  await Promise.all([zeigeAufnahme(), zeigeSpeicher(), richteOfflineKopieEin()]);
}

start();
