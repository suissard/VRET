# Plateforme VRET WebXR — Architecture 100 % Locale

Plateforme de **Thérapie par Exposition en Réalité Virtuelle (VRET)** fonctionnant intégralement sur réseau local (LAN/Wi-Fi), sans dépendance à Internet ni au cloud.

## Fonctionnalités Implémentées

1. **Serveur Local HTTPS / WSS / REST / SQLite (`server/`)** :
   - Génération automatique de la PKI locale (`rootCA.pem` + certificat serveur SAN multi-IPs via `mkcert` ou `openssl`).
   - Serveur d'onboarding HTTP sur `:8080` (`/setup`, `/ca.crt`) pour installer facilement le certificat CA sur Meta Quest, Pico, iOS et Android.
   - Annonce mDNS (`https://vret.local:8443`) + QR Codes d'appairage avec PIN à 4 chiffres.
   - Base de données locale SQLite (`node:sqlite` dans `./data/vret.db`) journalisant patients, séances, événements et réponses Likert avec snapshot complet des stimuli.
2. **Client VR WebXR & Simulateur 3D (`/vr`)** :
   - Three.js WebXR + synthétiseur Web Audio API procédural (zéro asset externe requis).
   - **Safe Space** préchargé en permanence en RAM avec transition par fondu noir `< 500 ms` (`150 ms` fade-in + swap + `250 ms` fade-out).
   - **3 Environnements d'Exposition** :
     - *Claustrophobie (`elevator`)* : taille cabine modulable, luminosité, foule 0–6 avatars, portes ouvertes/fermées/bloquées, clignotement néon, arrêt mécanique.
     - *Acrophobie (`acrophobia`)* : 1er au 40e étage, opacité garde-corps, plancher de verre transparent, vent spatialisé, météo clair/brouillard/nuit.
     - *Arachnophobie (`arachnophobia`)* : 0 à 20 araignées articulées, taille, style cartoon/réaliste, vitesse, et bulle de sécurité `min_distance` autour du patient.
   - **Échelle de Likert 3D** (`LikertUI`) avec raycasting manette + mode **Gaze (1,5 s)** automatique sans manettes.
3. **Contrôleur Mobile Praticien PWA (`/mobile`)** :
   - Ergonomie à une main, Screen Wake Lock API, reconnexion exponentielle automatique.
   - Bouton rouge d'urgence **SAFE SPACE** permanent sans confirmation.
   - Paliers cliniques 1–4, sliders throttlés à 50 ms, déclenchement Likert + timer auto, marqueurs cliniques et vue vidéo patient.
4. **Dashboard Admin & Analytique PC (`/pc`)** :
   - Appairage par QR Codes, gestion des dossiers patients pseudonymisés, démarrage/clôture de séance, console de pilotage PC directe.
   - Graphiques multi-axes synchronisés (SUDs Likert + intensité stimulus clé + zones Safe Space + marqueurs), export **CSV** et rapport **PDF** (`@media print`).

## Démarrage Rapide

```bash
# 1. Installer les dépendances (une seule fois)
npm install

# 2. (Optionnel) Pré-générer les certificats locaux
npm run setup-certs

# 3. Lancer le serveur local
npm start
```

Ouvrez ensuite le Dashboard PC affiché dans le terminal (ex. `https://127.0.0.1:8443/pc`).

## Tests Automatisés

```bash
npm test
```

## Documentation Complémentaire

- [Cahier des charges initial](file:///home/suissard/PROGRAMMATIONS/VRET/cahier_des_charges_technique_d_taill_plateforme_vret_webxr.md)
- [Analyse critique senior et adaptations](file:///home/suissard/PROGRAMMATIONS/VRET/ARCHITECTURE_ET_ADAPTATIONS.md)
