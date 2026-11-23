# Analyse Critique Senior & Adaptations du Cahier des Charges

Le cahier des charges initial (`cahier_des_charges_technique_d_taill_plateforme_vret_webxr.md`) pose une architecture saine et pragmatique (serveur local unique, WebXR + Three.js, PWA mobile, SQLite, protocole *Single Source of Truth*). Toutefois, l'implémentation directe en conditions réelles de cabinet clinique hors-ligne révèle **6 angles morts techniques** qui ont été corrigés et améliorés dans cette réalisation.

---

## 1. PKI & HTTPS Local Souverain + Port HTTP d'Onboarding (`:8080`)
* **Limite du CDC** : Le document impose `mkcert` (souvent absent sur les postes cliniques Linux/Windows sans gestionnaire de paquets) et suppose une IP fixe unique. De plus, un casque Meta Quest ou Pico neuf ne peut pas télécharger `rootCA.pem` depuis un serveur uniquement HTTPS (`:8443`) tant qu'il rejette précisément ce certificat.
* **Adaptation implémentée** :
  * [server/certs.js](file:///home/suissard/PROGRAMMATIONS/VRET/server/certs.js) détecte dynamiquement toutes les interfaces IPv4 locales actives (`os.networkInterfaces()`), utilise `mkcert` s'il est disponible, ou bascule de manière transparente sur `openssl` en générant une CA racine persistante (`certs/rootCA.pem`, validité 10 ans) et un certificat serveur SAN couvrant `localhost`, `vret.local` et **toutes les IPv4 détectées**. Si le PC change de réseau Wi-Fi/Ethernet, seul le certificat serveur est régénéré sans invalider la CA déjà installée sur les casques.
  * [server/index.js](file:///home/suissard/PROGRAMMATIONS/VRET/server/index.js) expose un serveur HTTP compagnon léger sur le port `:8080` (`/setup` et `/ca.crt`), associé à un 3e QR Code sur le Dashboard PC pour installer le certificat sur casque ou smartphone en une étape.

## 2. Serveur Unifié Single-Origin (Zéro Dépendance Internet / CDN)
* **Limite du CDC** : L'arborescence suggérait un serveur de build Vite séparé pour `/vr` et l'utilisation de bibliothèques externes (ex. Chart.js) potentiellement chargées par CDN.
* **Adaptation implémentée** :
  * Le serveur Express HTTPS (`:8443`) sert sur une **origine unique** `/vr`, `/mobile`, `/pc`, `/shared` et `/vendor/three` (directement depuis `node_modules/three`).
  * Le Client VR utilise `<script type="importmap">` natif du navigateur pour charger Three.js localement sans étape de compilation ni connexion Internet.
  * Le Dashboard PC embarque son propre moteur de graphique clinique haute résolution Canvas 2D ([client-pc/chart.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-pc/chart.js)) sans aucune dépendance externe.

## 3. SQLite Natif (`node:sqlite`) au lieu de `better-sqlite3`
* **Limite du CDC** : `better-sqlite3` repose sur un module natif C++ (`node-gyp`) qui échoue fréquemment lors des montées de version de Node.js (ex. Node 26.x) ou sur des postes Windows/Linux sans chaîne de compilation complète.
* **Adaptation implémentée** :
  * [server/db.js](file:///home/suissard/PROGRAMMATIONS/VRET/server/db.js) exploite le module intégré `node:sqlite` (`DatabaseSync`) en mode `WAL` avec clés étrangères activées, zéro compilation native requise.

## 4. Moteur 3D Procédural, Audio Web Audio Synthétique & Simulateur Desktop
* **Limite du CDC** : Le CDC référençait des assets externes `.glb` (Draco), `.ktx2` et `.mp3/.ogg` inexistants dans le dépôt, rendant l'application non exécutable sans pipeline Blender préalable. De plus, le développement et les démonstrations sans casque WebXR branché n'étaient pas couverts.
* **Adaptation implémentée** :
  * Les 4 scènes ([SafeSpaceScene.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-vr/src/scenes/SafeSpaceScene.js), [ElevatorScene.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-vr/src/scenes/ElevatorScene.js), [AcrophobiaScene.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-vr/src/scenes/AcrophobiaScene.js), [ArachnophobiaScene.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-vr/src/scenes/ArachnophobiaScene.js)) sont construites de manière **100 % procédurale** en respectant strictement le budget Quest/Pico (< 50 draw calls via `InstancedMesh`, zéro ombre temps réel, interpolation douce sur 72–90 Hz).
  * [SoundEngine.js](file:///home/suissard/PROGRAMMATIONS/VRET/client-vr/src/audio/SoundEngine.js) synthétise en Web Audio API les vagues apaisantes (bruit rose + LFO), le vent modulé, le bourdonnement d'ascenseur, le grésillement néon, le choc mécanique et les bips Likert, avec coupure d'urgence < 20 ms.
  * `/vr` intègre un **Mode Immersion Écran / Simulateur 3D** complet (souris + ZQSD + Gaze + raccourcis 0–9) utilisable immédiatement sur n'importe quel navigateur.

## 5. Complétude du Protocole & Paliers Cliniques d'Exposition
* **Limite du CDC** : `SCENE_READY` était cité en section 9 mais absent de la table 3.2 ; aucune commande de palier thérapeutique ni d'annotation clinique horodatée n'était prévue.
* **Adaptation implémentée** :
  * [shared/protocol.js](file:///home/suissard/PROGRAMMATIONS/VRET/shared/protocol.js) complète le contrat JSON avec `AUTH_OK`, `AUTH_ERROR`, `SCENE_READY`, `PRESET_APPLY`, `LIKERT_CANCEL`, `CLINICAL_MARKER`, `VIDEO_STREAM_TOGGLE` et `VIDEO_FRAME`.
  * [shared/scenes-schema.js](file:///home/suissard/PROGRAMMATIONS/VRET/shared/scenes-schema.js) ajoute **4 paliers cliniques gradués** par scène pour ajuster l'exposition en 1 tap sans erreur de manipulation, ainsi que 4 marqueurs cliniques rapides.

## 6. Retour Vidéo Hybride (WebRTC P2P + Relais Frame Fallback)
* **Limite du CDC** : Certains routeurs Wi-Fi de cabinet activent l'isolation client (*AP Isolation*) ou bloquent les candidats ICE locaux mDNS sur casque Android.
* **Adaptation implémentée** :
  * Le client VR et les interfaces praticien tentent d'abord le flux WebRTC local (`captureStream(20)`), tout en activant un relais JPEG basse résolution (`320×180` à 8 FPS via `VIDEO_FRAME`) sur la connexion WebSocket déjà authentifiée. Le flux reste coupé par défaut pour préserver l'autonomie et les 72–90 FPS du casque.
