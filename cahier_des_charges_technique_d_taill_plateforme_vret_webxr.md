# Cahier des Charges Technique Détaillé : Plateforme VRET WebXR (Architecture Locale)

## 1. Contexte, Objectifs et Périmètre
Conception et développement d'une plateforme légère, universelle et 100 % locale de **Thérapie par Exposition en Réalité Virtuelle (VRET)**.

Le système repose sur un **PC hôte local** qui héberge le serveur applicatif, la base de données et sert trois interfaces web distinctes sur le réseau local (LAN/Wi-Fi), sans dépendance à Internet :
1. **Client VR (Casque autonome)** : Rendu 3D WebXR (Three.js), audio spatialisé, échelles de Likert en immersion et streaming vidéo.
2. **Contrôleur Mobile (Smartphone Praticien)** : Pilotage temps réel des séances, modulation des stimuli, suivi vidéo et bouton d'urgence.
3. **Dashboard Admin (PC Praticien)** : Démarrage/supervision, appairage par QR Code, analyse post-séance et export des rapports.

---

## 2. Architecture Système, Réseau et Sécurité Locale

### 2.1 Topologie et Flux Réseau
```text
                  [ PC PRATICIEN (Serveur Local) ]
         Node.js (HTTPS :8443 + WSS + API REST + SQLite)
                                 |
                    (Ethernet Gigabit recommandé)
                                 |
                    [ Routeur Wi-Fi 5/6 Local ]
                     /                       \
         (Wi-Fi Local)                       (Wi-Fi Local)
               /                                   \
 [ SMARTPHONE PRATICIEN ]                 [ CASQUE VR PATIENT ]
  Navigateur Mobile (PWA)                  Navigateur WebXR (Quest/Pico)
  URL: https://<ip>:8443/mobile            URL: https://<ip>:8443/vr
```

### 2.2 Gestion Critique du HTTPS Local
Les API navigateurs **WebXR**, **Web Audio**, **WebRTC** et **Screen Wake Lock** exigent impérativement un contexte sécurisé (`https://`).
* **Solution principale (100 % hors-ligne)** : Utilisation de `mkcert` lors de l'installation initiale sur le PC pour générer une Autorité de Certification locale (`rootCA.pem`) et un certificat serveur couvrant l'IP locale fixe du PC et le nom mDNS (`vret.local`). Le fichier `rootCA.pem` est installé une seule fois sur le casque VR et le smartphone.
* **Découverte réseau** : Exposition du serveur via mDNS (`bonjour-service` en Node.js) sur `https://vret.local:8443`, avec repli automatique sur l'adresse IPv4 locale affichée dans les QR Codes du Dashboard PC.
* **Pare-feu** : Le script d'installation doit prévoir l'ouverture du port TCP `8443` (HTTPS/WSS) et des ports UDP dynamiques sur le réseau privé (pour WebRTC).

### 2.3 Mécanisme d'Appairage (Pairing)
* Au lancement du serveur, un **code de session à 4 chiffres** est généré (ou réutilisé sur la journée).
* Le Dashboard PC affiche deux QR Codes contenant l'URL avec le token pré-rempli (ex. `https://192.168.1.50:8443/mobile?pin=4829`).
* Le serveur n'autorise qu'**un seul casque VR actif** et **un contrôleur mobile actif** simultanément par salle de session (`roomId`), afin d'éviter les commandes conflictuelles.

---

## 3. Protocole Temps Réel (WebSockets & WebRTC)

### 3.1 Principe d'Architecture : "Single Source of Truth"
Le **Serveur PC détient l'état canonique** de la séance en cours (`SessionState`).
* Le smartphone envoie des *intentions* (`CMD_*`).
* Le serveur valide, met à jour l'état, enregistre l'événement dans SQLite et diffuse le nouvel état au casque VR et au smartphone.
* En cas de reconnexion d'un client, le serveur lui envoie immédiatement un paquet `STATE_SYNC` complet pour une resynchronisation transparente.

### 3.2 Contrat d'Interface JSON (WebSocket)
Tous les messages respectent l'enveloppe standard :
```json
{
  "type": "NOM_EVENEMENT",
  "timestamp": 1732270000000,
  "payload": {}
}
```

#### Table des Messages Clés
| Direction | `type` | Payload & Rôle |
| :--- | :--- | :--- |
| Client $\to$ Serveur | `AUTH` | `{ "role": "vr" \| "mobile" \| "pc", "pin": "4829" }` |
| Serveur $\to$ Client | `STATE_SYNC` | `{ "sessionId": 12, "sceneId": "elevator", "safeSpace": false, "params": { ... }, "activeLikert": null \| { ... }, "vrStatus": { "inVR": true, "fps": 72, "battery": 0.85 } }` |
| Mobile $\to$ Serveur | `SCENE_LOAD` | `{ "sceneId": "acrophobia" \| "arachnophobia" \| "elevator" }` |
| Mobile $\to$ Serveur | `PARAM_UPDATE` | `{ "key": "height_floor", "value": 15 }` *(Throttlé côté mobile à 1 envoi / 50 ms max)* |
| Mobile $\to$ Serveur | `SAFE_SPACE_TOGGLE` | `{ "active": true }` *(Priorité absolue, coupe les stimuli)* |
| Mobile $\to$ Serveur | `LIKERT_TRIGGER` | `{ "promptId": "uuid", "question": "Niveau d'anxiété ?", "scaleMin": 0, "scaleMax": 10, "labels": ["Calme", "Panique"] }` |
| VR $\to$ Serveur | `LIKERT_RESPONSE` | `{ "promptId": "uuid", "value": 7, "responseTimeMs": 3200 }` |
| VR $\to$ Serveur | `TELEMETRY` | `{ "inVR": true, "fps": 88, "trackingLost": false, "headPose": { "y": 1.65 } }` *(Envoyé toutes les 2 secondes)* |
| Bidirectionnel | `RTC_SIGNAL` | `{ "target": "mobile" \| "vr", "signal": { "type": "offer" \| "answer" \| "candidate", ... } }` |

### 3.3 Retour Vidéo (WebRTC Local)
* **Capture côté VR** : Utilisation de `renderer.domElement.captureStream(20)` (plafonné à **20 FPS** et résolution réduite à **640×360** via un canvas secondaire ou paramètres `RTCRtpSender` afin de ne jamais impacter le framerate 72–90 FPS du casque).
* **Configuration ICE** : Aucun serveur STUN/TURN externe requis (réseau local pur, `iceServers: []`).
* **Activation à la demande** : Le flux vidéo n'est démarré que lorsque le praticien active la prévisualisation sur le mobile ou le PC, pour économiser la batterie et le GPU du casque.

---

## 4. Modèle de Données et Persistance (SQLite)

Base de données locale embarquée (`better-sqlite3`) stockée dans un fichier local chiffré ou protégé par l'OS (`./data/vret.db`).

### 4.1 Schéma SQL
```sql
CREATE TABLE patients (
    id TEXT PRIMARY KEY,          -- Pseudonyme ex: "PAT-2026-001"
    created_at INTEGER NOT NULL,
    notes TEXT
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL REFERENCES patients(id),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    initial_scene TEXT,
    summary_notes TEXT
);

CREATE TABLE events_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    timestamp INTEGER NOT NULL,   -- Epoch ms
    event_type TEXT NOT NULL,     -- 'SCENE_CHANGE', 'PARAM_CHANGE', 'SAFE_SPACE_ON', 'SAFE_SPACE_OFF'
    scene_id TEXT NOT NULL,
    payload_json TEXT NOT NULL    -- Détail exact de la modification
);

CREATE TABLE likert_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    timestamp INTEGER NOT NULL,
    scene_id TEXT NOT NULL,
    question TEXT NOT NULL,
    scale_min INTEGER NOT NULL,
    scale_max INTEGER NOT NULL,
    score INTEGER NOT NULL,
    response_time_ms INTEGER,
    active_params_json TEXT NOT NULL -- Snapshot complet des stimuli à l'instant T
);
```

### 4.2 API REST Locale (Pour le Dashboard PC)
* `GET /api/patients` & `POST /api/patients` : Gestion des dossiers pseudonymisés.
* `GET /api/sessions?patientId=...` : Liste des séances.
* `GET /api/sessions/:id/details` : Récupération complète (timeline des paramètres + points Likert) pour générer les courbes.
* `GET /api/sessions/:id/export.csv` : Export brut horodaté pour tableur / recherche clinique.

---

## 5. Spécifications Techniques du Client VR (Three.js / WebXR)

### 5.1 Cycle de Vie WebXR et Audio
* **Page d'accueil VR** : Écran épuré affichant le statut de connexion au PC, le champ PIN (si non fourni en URL) et un gros bouton **"Entrer en VR"**.
* **Déblocage Audio** : Le clic sur "Entrer en VR" instancie et appelle obligatoirement `AudioContext.resume()` pour autoriser la lecture de `THREE.PositionalAudio`.
* **Gestion des événements de session** :
  * `session.addEventListener('visibilitychange', ...)` : Si le patient retire le casque (`hidden`), mise en pause automatique des animations/sons et alerte envoyée au smartphone via `TELEMETRY`.
  * `session.addEventListener('end', ...)` : Nettoyage propre et notification au praticien.

### 5.2 Architecture Modulaire des Scènes (`BaseScene`)
Chaque environnement 3D hérite d'une classe abstraite commune afin de standardiser le pilotage et garantir l'absence de fuites mémoire :
```javascript
class BaseScene {
  constructor(renderer, audioListener) {}
  async preload(assetManager) {}      // Chargement .glb (Draco/KTX2) et sons
  onEnter(initialParams) {}           // Construction de la THREE.Scene
  setParam(key, targetValue) {}       // Stocke la cible (interpolation douce dans update)
  update(deltaTime, xrCamera) {}      // Boucle 72-90Hz (lerp des paramètres, animations)
  onExit() {}                         // Arrêt des sons
  dispose() {}                        // Parcours récursif : geometry/material/texture.dispose()
}
```
* **Interpolation (Smoothing)** : Les variations reçues des sliders mobiles ne doivent jamais provoquer de "sauts" visuels brusques (source de cybercinétose). Les paramètres continus (hauteur, luminosité, volume du vent) utilisent une interpolation linéaire (`THREE.MathUtils.lerp`) dans la boucle `update(dt)`.

### 5.3 Préchargement Permanent du "Safe Space"
* La scène `SafeSpaceScene` est chargée **une seule fois au démarrage** et conservée en mémoire vive en permanence (scène ultra-légère : skybox pastel/plage minimaliste + bruit blanc/vagues doux).
* Lors de l'activation du bouton d'urgence :
  1. Fondu au noir rapide de `150 ms` (sphère noire autour de la caméra) pour éviter le choc visuel.
  2. Bascule instantanée du pointeur `activeScene = safeSpaceScene` et mise en sourdine immédiate de la scène anxiogène.
  3. Fondu d'ouverture en `250 ms`. **Temps total garanti < 500 ms**.

### 5.4 Spécifications de l'Échelle de Likert 3D (UX & Technique)
* **Positionnement dynamique** : À l'apparition, le panneau se place à **$1,8\text{ m}$** devant la caméra VR, aligné sur l'axe horizontal du regard (yaw uniquement, sans inclinaison roll/pitch gênante), à hauteur des yeux. Il reste ensuite fixe dans l'espace (*World-Space*) pour ne pas "coller" au visage du patient (confort visuel).
* **Anti-Clipping (Toujours visible)** : Le matériau du panneau utilise `depthTest: false` et un `renderOrder = 999` élevé afin qu'il ne soit jamais coupé par un mur étroit (ex. dans l'ascenseur).
* **Rendu Net** : Dessin sur un `<canvas>` HTML haute résolution (`1024×512`) mappé sur un `THREE.CanvasTexture` avec filtrage anisotropique. Mise à jour du canvas uniquement lors d'un survol (hover) ou changement d'état.
* **Double Mode d'Interaction** :
  1. **Raycasting Manette** : Rayon laser visible issu de la manette dominante + validation par gâchette (`selectstart`).
  2. **Suivi du Regard (Gaze / Mains libres)** : Activé automatiquement si aucune manette n'est détectée (ou forcé par le praticien). Un petit réticule discret apparaît au centre de la vue ; fixer une note pendant **$1,5\text{ s}$** remplit un anneau circulaire et valide le choix avec un léger retour sonore ("bip" doux).

### 5.5 Locomotion et Confort
* **Room-scale natif** : Le patient peut marcher librement dans sa zone physique.
* **Téléportation parabolique** : Déclenchée par le stick/bouton de la manette, restreinte à un `NavMesh` (surface marchable définie par scène, empêchant par exemple de traverser le garde-corps dans la scène d'acrophobie).
* **Vignettage dynamique** : Option activable en cas de mouvement de scène (ex. montée de l'ascenseur).

### 5.6 Budgets de Performance Stricts (Cible : Meta Quest 2/3, Pico 4)
Pour maintenir **72 FPS minimum** sans baisse de cadence :
* **Draw Calls** : $< 80$ par frame (fusion des géométries statiques + `THREE.InstancedMesh` pour les objets répétés).
* **Triangles visibles** : $< 150\,000$ triangles par scène.
* **Format des Assets** : `.glb` compressés **Draco** + textures **KTX2 (Basis Universal)** max `1024×1024` (ou `2048×2048` pour les skyboxes).
* **Éclairage** : Zéro ombre temps réel (`castShadow = false`). Éclairage ambiant + *Lightmapping* pré-calculé (baked dans Blender).

---

## 6. Catalogue Détaillé des Scènes et Paramètres

Chaque scène déclare un schéma de paramètres (utilisé pour générer automatiquement les contrôles sur l'application mobile).

### 6.1 Claustrophobie — `elevator` (Ascenseur)
| Clé JSON | Type | Plage / Valeurs | Défaut | Effet dans la scène 3D |
| :--- | :--- | :--- | :--- | :--- |
| `cabin_size` | `float` | `0.6` à `1.5` (échelle) | `1.2` | Resserrement progressif des parois et du plafond. |
| `light_level` | `float` | `0.0` à `1.0` | `1.0` | Intensité de l'éclairage cabine (0 = pénombre/veilleuse). |
| `crowd_count` | `int` | `0` à `6` | `0` | Apparition d'avatars statiques (low-poly) dans la cabine. |
| `door_state` | `enum` | `open`, `closed`, `stuck` | `open` | Ouverture/fermeture des portes ; `stuck` simule un blocage. |
| `incident_flicker` | `bool` | `true` / `false` | `false` | Clignotement du néon + grésillement électrique spatialisé. |
| `incident_stop` | `bool` | `true` / `false` | `false` | Secousse visuelle légère + bruit de frein mécanique + arrêt. |

### 6.2 Acrophobie — `acrophobia` (Terrasse / Passerelle)
| Clé JSON | Type | Plage / Valeurs | Défaut | Effet dans la scène 3D |
| :--- | :--- | :--- | :--- | :--- |
| `height_floor` | `int` | `1` à `40` (étages) | `2` | Translation verticale douce de la plateforme (3 m / étage). |
| `railing_opacity` | `float` | `0.0` à `1.0` | `1.0` | Opacité du garde-corps (1 = opaque rassurant, 0.2 = verre, 0 = absent). |
| `floor_glass` | `bool` | `true` / `false` | `false` | Transforme la dalle sous les pieds en plancher de verre transparent. |
| `wind_intensity` | `float` | `0.0` à `1.0` | `0.1` | Volume du vent spatialisé + particules de poussière/nuages. |
| `weather` | `enum` | `clear`, `fog`, `night` | `clear` | Change la skybox et le brouillard (`THREE.FogExp2`). |

### 6.3 Arachnophobie — `arachnophobia` (Pièce d'exposition)
| Clé JSON | Type | Plage / Valeurs | Défaut | Effet dans la scène 3D |
| :--- | :--- | :--- | :--- | :--- |
| `spider_count` | `int` | `0` à `20` | `1` | Nombre d'individus actifs (via `InstancedMesh` ou pool d'objets). |
| `spider_scale` | `float` | `0.2` à `3.0` | `0.5` | Taille des araignées (de très petite à mygale imposante). |
| `realism_level` | `enum` | `cartoon`, `realistic` | `cartoon` | Swap du modèle/matériau (stylisé vers réaliste poilu). |
| `movement_speed` | `float` | `0.0` à `1.0` | `0.0` | Vitesse de déplacement aléatoire sur la table/les murs (0 = immobile). |
| `min_distance` | `float` | `0.5` à `4.0` (mètres) | `3.0` | Rayon de sécurité infranchissable autour de la position du patient. |

---

## 7. Spécifications des Interfaces Praticien (Mobile & PC)

### 7.1 Contrôleur Mobile (PWA)
Conçu pour un usage **à une main**, en regardant le patient plutôt que l'écran :
* **Bandeau supérieur fixe (Sticky Header)** :
  * Indicateur de connexion (pastille verte/rouge) + FPS/Batterie du casque.
  * **Bouton rouge "SAFE SPACE"** large, accessible en permanence (sans fenêtre de confirmation pour la réactivité).
* **Zone centrale (Onglets simples)** :
  * *Stimuli* : Sliders larges (hauteur tactile $\ge 48\text{ px}$) générés dynamiquement selon la scène active.
  * *Likert* : Boutons de déclenchement rapide ("Anxiété 0–10", "Envie de fuir 1–5") + option de timer automatique (ex. toutes les 2 min) + affichage en gros de la dernière note reçue.
  * *Vue Patient* : Toggle pour afficher le flux vidéo WebRTC.
* **Prévention de mise en veille** : Utilisation de la **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) pour empêcher le smartphone de se verrouiller en pleine séance.

### 7.2 Dashboard PC (Administration & Analyse)
* **Écran d'accueil** : Statut du serveur, IP locale, QR Codes d'appairage, sélecteur de patient (pseudonyme) et bouton "Démarrer / Clôturer la séance".
* **Écran Analyse** : Graphique synchronisé (ex. `Chart.js`) affichant sur le même axe temporel :
  * En courbe principale : les scores **Likert (SUDs)**.
  * En courbes secondaires / zones : l'évolution des paramètres clés (ex. hauteur de l'étage, nombre d'araignées) et les marqueurs de *Safe Space*.
* **Export** : Génération d'un rapport **PDF** propre côté navigateur (`window.print()` avec feuille de style `@media print` dédiée) et téléchargement **CSV**.

---

## 8. Structure du Projet (Arborescence Monorepo)

Pour faciliter la maintenance et le partage des types/schémas entre le serveur et les clients :
```text
vret-platform/
├── package.json                 # Workspaces ou scripts unifiés
├── certs/                       # Certificats SSL locaux (mkcert, ignorés par git)
├── data/                        # Base SQLite (vret.db, ignorée par git)
├── shared/
│   ├── protocol.js              # Constantes des types de messages WS
│   └── scenes-schema.js         # Définition des paramètres par scène (partagé Mobile/VR/Serveur)
├── server/
│   ├── index.js                 # Serveur HTTPS (Express/Fastify) + WSS + mDNS
│   ├── sessionManager.js        # Machine à états (Single Source of Truth)
│   ├── db.js                    # Couche SQLite (better-sqlite3)
│   └── routes/api.js            # Endpoints REST pour le Dashboard PC
├── client-vr/                   # Build Vite (Three.js + WebXR)
│   ├── index.html
│   ├── src/
│   │   ├── main.js              # Initialisation WebXR, Renderer, Audio, WS
│   │   ├── network/wsClient.js  # Reconnexion auto & WebRTC streamer
│   │   ├── core/LikertUI.js     # Panneau 3D CanvasTexture + Raycast/Gaze
│   │   ├── core/Locomotion.js   # Téléportation parabolique
│   │   └── scenes/              # BaseScene, SafeSpace, Elevator, Acrophobia, Arachnophobia
│   └── public/assets/           # Modèles .glb (Draco), textures .ktx2, sons .mp3/.ogg
├── client-mobile/               # Interface PWA Praticien (HTML/CSS/JS léger ou Preact/Vue)
└── client-pc/                   # Dashboard Admin & Graphiques (HTML/CSS/JS + Chart.js)
```

---

## 9. Gestion des Cas Limites (Edge Cases) et Résilience

| Scénario Critique | Comportement Attendu |
| :--- | :--- |
| **Micro-coupure Wi-Fi sur le mobile** | Affichage d'un bandeau "Reconnexion..." ; boucle de reconnexion exponentielle (1s, 2s, 4s). Dès retour, réception de `STATE_SYNC` et mise à jour des sliders. La scène VR continue sans interruption. |
| **Micro-coupure Wi-Fi sur le casque VR** | Le casque continue de rendre la scène localement à 72-90 FPS (aucun gel d'image). Alerte immédiate sur le smartphone. Resynchronisation automatique au retour. |
| **Le patient retire le casque en séance** | L'événement WebXR `visibilitychange` met en pause l'audio et alerte le praticien sur le mobile ("Casque retiré / en veille"). |
| **Manettes déchargées ou non tenues** | Bascule transparente de l'échelle de Likert en mode **Gaze (suivi du regard)** sans bloquer l'évaluation. |
| **Changement rapide de scène par le praticien** | Verrouillage temporaire des boutons de scène sur le mobile (spinner) jusqu'à réception de l'accusé `SCENE_READY` du casque, évitant les chargements concurrents et les crashs mémoire. |
| **Fermeture accidentelle du navigateur PC** | Le serveur Node.js tourne en tâche de fond (exécutable / tray app) indépendamment de l'onglet Dashboard PC ; la séance en cours n'est pas interrompue. |

---

## 10. Roadmap et Critères d'Acceptation

1. **Lot 1 — Socle Réseau & Sécurité (PoC)**
   * *Livrables* : Serveur Node.js HTTPS (`mkcert`), mDNS, WebSockets avec `STATE_SYNC`, arborescence monorepo, scène de test Three.js WebXR + *Safe Space* + streaming WebRTC vers mobile.
   * *Validation* : Bascule *Safe Space* mesurée $< 500\text{ ms}$ ; reconnexion automatique validée après coupure Wi-Fi de 5 s.
2. **Lot 2 — Cœur Thérapeutique (MVP)**
   * *Livrables* : Scène *Ascenseur* complète, module `LikertUI` (Raycast + Gaze), interface mobile dynamique basée sur `scenes-schema.js`, enregistrement SQLite et export CSV.
   * *Validation* : 72 FPS constants sur Meta Quest 2/3 pendant 20 min sans augmentation de la mémoire RAM (test de fuite mémoire).
3. **Lot 3 — Catalogue V1 & Analytique**
   * *Livrables* : Scènes *Acrophobie* et *Arachnophobie*, audio spatialisé complet, Dashboard PC avec graphiques croisés Likert/Stimuli et export PDF.
4. **Lot 4 — Packaging & Déploiement Cabinet**
   * *Livrables* : Script d'installation simplifié / exécutable PC, guide pas-à-pas d'installation du certificat `rootCA.pem` sur Quest/Pico/iOS/Android, manuel praticien.