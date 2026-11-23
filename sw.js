/*
  Ruhepol – Technik-Test, Service Worker (Offline-Kopie)

  Was er tut:
    - Beim Einrichten legt er alle Dateien der Testseite im Gerät ab.
    - Danach beantwortet er jede Anfrage aus dieser Ablage ("Cache zuerst").
      So öffnet die Seite auch im Flugmodus.
    - Anfragen an fremde Adressen beantwortet er nicht – es gibt keine.
  Wird eine Datei geändert, VERSION hochzählen: dann wird die Ablage erneuert.
*/
"use strict";

// Muss mit BUILD in test.js übereinstimmen. Präfix schützt Ablagen anderer Seiten derselben Adresse.
const PRAEFIX = "technik-test-";
const VERSION = `${PRAEFIX}v4`;
const DATEIEN = [
  "./",
  "./index.html",
  "./style.css",
  "./test.js",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const ablage = await caches.open(VERSION);
      await ablage.addAll(DATEIEN); // scheitert eine Datei, wird gar nicht installiert
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Nur eigene, alte Ablagen löschen – nie die der späteren Ruhepol-App.
        if (name.startsWith(PRAEFIX) && name !== VERSION) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const anfrage = event.request;
  // Nur eigene Dateien und nur Lesen. Alles andere geht unverändert durch.
  if (anfrage.method !== "GET" || new URL(anfrage.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const ablage = await caches.open(VERSION);
      // Aufruf der Seite selbst (auch mit ?… oder #…): immer die abgelegte Startseite.
      if (anfrage.mode === "navigate") {
        return (await ablage.match("./index.html")) ?? fetch(anfrage);
      }
      const treffer = await ablage.match(anfrage, { ignoreSearch: true });
      return treffer ?? fetch(anfrage);
    })(),
  );
});
