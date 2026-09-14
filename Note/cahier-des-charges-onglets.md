# Cockpit OS — Cahier des charges des onglets
*Version 2 — mise à jour après arbitrage des 5 onglets.*

## Contexte et principe directeur

L'app tourne sur une Galaxy Tab A8 montée en cockpit (voiture ou simulateur).
Elle sert à la fois de télécommande PC et de plateforme média, dans l'esprit
Android Auto / Tesla, **avec une ambition supplémentaire : se comporter par
endroits comme un Stream Deck** — pas juste une liste figée de boutons, mais
un outil personnalisable avec du feedback d'état en temps réel.

La notch (header) couvre déjà en permanence, sur tous les onglets :
lecture/pause, morceau en cours, jeu Steam en cours, accès au sur-menu
complet (transport, volume, fermeture de jeu). **Tout le reste de l'app doit
se positionner par rapport à ça** : ne pas dupliquer ce que la notch fait
déjà, et apporter une vraie valeur ajoutée propre à chaque onglet.

## État des décisions par onglet

| Onglet | Statut |
|---|---|
| Raccourcis | ✅ Verrouillé tel quel, aucune modification |
| Médias → **Setup** | 🔨 Reconversion totale, spec détaillée ci-dessous |
| Deezer | ✅ Verrouillé tel quel, aucune modification |
| Automobile | ⏸ Reporté à plus tard |
| Réglages | 🤔 En réflexion, pas encore décidé |

---

## Principes transverses "Stream Deck" (à appliquer partout où c'est pertinent)

1. **Mode édition** : sur les grilles de raccourcis (apps, macros), un
   appui long doit permettre de réorganiser, ajouter ou retirer des
   tuiles — sans passer par un écran de configuration séparé.
2. **Feedback d'état par tuile** : une tuile ne doit pas être un bouton
   muet (ex. indicateur "app déjà lancée", micro coupé, macro active).
3. **Pagination plutôt que débordement** : toute liste qui peut dépasser
   l'espace disponible utilise la pagination par points, jamais de scroll.
4. **Pas de duplication avec la notch** : ne pas réafficher à l'identique
   ce que la notch montre déjà (lecture/pause, morceau, jeu en cours).

---

## 1. Onglet RACCOURCIS — verrouillé

Aucun changement. Reste tel qu'on l'a construit : Apps Rapides, Macros,
Steam, Actions Système, alimentés par la notch en permanence pour la partie
média/jeu.

---

## 2. Onglet SETUP *(anciennement Médias — reconversion totale)*

### Rôle
Supervision et contrôle système du PC : ce qui tourne, ce que ça consomme,
et la connectivité — un vrai petit "gestionnaire de tâches + panneau réseau"
tactile, dans l'esprit cockpit plutôt qu'un lecteur média (déjà couvert par
la notch).

### Layout proposé — 4 quadrants (cohérent avec le pattern déjà validé sur Raccourcis)

**Haut-gauche — Applications ouvertes**
- Liste des apps/fenêtres actuellement ouvertes sur le PC (icône, nom).
- Un bouton **"Fermer de force"** par ligne — action destructive (risque de
  perte de données non sauvegardées) : doit passer par la même modale de
  confirmation plein écran que les Actions Système (Annuler / Confirmer),
  jamais d'exécution directe au tap.
- Pagination par points si la liste dépasse l'espace visible (pas de
  scroll), même logique que Steam.

**Haut-droite — Système**
- Jauges d'utilisation en temps réel : Processeur, RAM, et éventuellement
  GPU/température/disque si la donnée existe côté backend.
- Traitement visuel cohérent avec la hiérarchie typographique déjà en
  place : valeur en grand (ex. "60%") + label discret en dessous
  ("PROCESSEUR"), plutôt qu'un graphique complexe à lire d'un coup d'œil.
- *À vérifier avant implémentation : cette donnée est-elle déjà remontée
  par le backend (WebSocket) ? Si non, le signaler avant d'inventer des
  valeurs factices.*

**Bas-gauche — Mixeur de volume par application**
- Une ligne par application qui émet du son sur le PC : icône/nom, bouton
  muet, curseur de volume individuel (tactile, avec poignée de saisie
  comme sur le slider de la notch).

**Bas-droite — Réseau**
- **Wi-Fi** : interrupteur + statut (réseau connecté, ou "Déconnecté").
- **Bluetooth** : interrupteur + liste des appareils appairés (icône selon
  type d'appareil, nom, état connecté/déconnecté, bouton connecter/
  déconnecter).
- *Point à confirmer : ces contrôles Wi-Fi/Bluetooth pilotent-ils le PC à
  distance (cohérent avec le Bluetooth déjà prévu pour les périphériques du
  PC dans l'ancien doc), ou la tablette elle-même ? Je pars du principe que
  c'est le PC, comme pour le Bluetooth déjà documenté — à corriger si ce
  n'est pas le cas.*

### Points de vigilance
- Toutes les actions destructives (fermeture forcée d'app) suivent le même
  système de confirmation que le reste de l'app — pas de nouvelle logique.
- Cibles tactiles (boutons fermer, interrupteurs, curseurs) alignées sur
  les mêmes tailles minimales que le reste de l'app (44-48px, plus pour les
  actions importantes).
- Nom de l'onglet dans la nav à changer de "Médias" à "Setup" partout
  (icône à revoir aussi si l'icône actuelle représentait un lecteur audio).

---

## 3. Onglet DEEZER — verrouillé

Aucun changement fondamental. Reste tel que documenté à l'origine
(recherche, filtres, Mon Flow, playlists, panneau de détail, fil d'ariane).

---

## 4. Onglet AUTOMOBILE — reporté

Traité dans une prochaine session. Pas de spec à ce stade.

---

## 5. Onglet RÉGLAGES — en réflexion

Pas encore tranché. À réévaluer une fois Setup en place — certaines options
qui auraient pu y atterrir (ex. mode édition des raccourcis) n'ont pas de
foyer clair tant que ce point n'est pas décidé.