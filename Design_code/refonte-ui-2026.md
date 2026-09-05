# Refonte UI Cockpit OS — journal de direction

Ce fichier est le point de repère vivant de la refonte visuelle en cours. Il
remplace `cockpit-os-design-system.md` ("Soft Glass") comme référence pour
tout nouveau travail d'UI : ce dernier documente l'ancien système, gardé tel
quel pour l'historique, mais ses prescriptions (blur systématique, halos,
dégradé pastel par élément) ne s'appliquent plus aux onglets déjà migrés.

Chaque onglet est repris un par un (Raccourcis → Médias → Deezer → lanceur
Automobile → ravalement visuel Dashboard/Endurance). Ce document capture :
les principes qui ne bougent pas, les patterns réutilisables déjà établis, et
un journal par onglet des ajustements demandés au fil des allers-retours —
pour que les onglets suivants héritent directement des décisions prises sur
les précédents, sans repartir de zéro à chaque fois.

## Principes directeurs (ne changent pas d'un onglet à l'autre)

- Dark UI bleu nuit / gris très sombre, un seul accent bleu pour les états actifs.
- Couleur réservée aux états (actif, danger, avertissement, succès) — jamais décorative.
- Beaucoup d'espace négatif **entre** les éléments (respiration), mais sans
  laisser l'écran sous-exploité : les groupes fonctionnels doivent utiliser
  toute la largeur/hauteur disponible de la tablette (pas de colonne étroite
  centrée dans du vide) — l'espace négatif vient de la marge autour des
  éléments dimensionnés généreusement, pas d'un contenu qui reste petit.
  Peu d'éléments visibles simultanément reste vrai : on agrandit les groupes
  existants, on n'en ajoute pas pour combler le vide.
- Cartes plates : un bord discret + une ombre douce, pas de blur/glow systématique.
- **Tout le contenu d'un onglet reste sur la page** — aucune fonctionnalité de
  consultation/navigation n'est cachée derrière une modale, aussi volumineuse
  soit-elle (revu le 2026-09-01 : Jeux était en modale, jugé "tiroir" et
  réintégré en pleine page). La modale est réservée à une seule chose :
  faire confirmer une action destructrice avant qu'elle ne parte (redémarrer,
  éteindre...), jamais pour "ranger" du contenu qu'on pourrait simplement
  agrandir ou faire défiler.
- Hiérarchie visuelle par fréquence d'usage : ce qui est tapé souvent est
  grand (Macros), ce qui est occasionnel/à risque est compact et à part
  (Système) — la taille elle-même communique l'importance, pas seulement
  la position sur la page.
- Cibles tactiles généreuses (≥44px), retour tactile au tap (scale/assombrissement), jamais de dépendance au hover.
- Coins arrondis mais sans excès.

## Tokens (source de vérité UNIQUE : `web/css/design-tokens.css`)

Depuis le 2026-09-01, `design-tokens.css` est le seul fichier qui déclare des
tokens partagés — `web/css/style.css` (chrome app : header/nav/tab-panel) n'a
plus son propre `:root` et consomme directement ceux-ci (fini la copie à
resynchroniser à la main entre deux fichiers, qui avait déjà fait dériver
`--transition` — 180ms d'un côté, 160ms de l'autre — sans qu'on s'en
aperçoive). Ne pas dupliquer les valeurs ici, elles peuvent évoluer. Rappel
des rôles : `--bg-app` (fond page) · `--bg-surface`/`-2`/`-3` (carte / survol
/ actif) · `--accent`/`-strong`/`-soft`/`-glow` (bleu, un seul accent d'état)
· `--tile-blue`/`-violet`/`-amber`/`-green`/`-red`/`-cyan`/`-pink`/`-indigo`
(palette d'**identité**, une couleur pleine par élément — apps du dock,
macros — jamais pour un état) · `--text-primary`/`-secondary`/`-muted` ·
`--success`/`-warning`/`-danger` (états/gravité uniquement) ·
`--radius-lg`/`-md`/`-sm`/`-pill` · `--shadow-card` (une seule ombre, pas de
glow) · `--header-h`/`--nav-w`/`--footer-h` (dimensions du chrome). Quelques
alias legacy (`--radius`, `--bg-player-card`, `--r-lg` etc.) restent définis
pour les fichiers pas encore migrés (Deezer, Média) — à retirer quand ces
onglets seront repris. Dashboard/Endurance/Automobile gardent leur propre
système de tokens scopé (`#tab-dashboard { ... }` etc.), volontairement non
fusionné — voir règle de non-fuite dans `cockpit-os-design-system.md`.

**Distinction identité vs état** : deux palettes de couleur existent, pour
deux usages différents, à ne jamais confondre. `--tile-*` = identité visuelle
d'un élément dans une collection (chaque app, chaque macro a "sa" couleur,
stable, choisie par hash de son id — sert à distinguer d'un coup d'œil, pas à
informer d'un danger). `--success`/`-warning`/`-danger` = gravité d'une
action (verrouiller = neutre, redémarrer = avertissement, éteindre = danger
— la couleur prévient d'une conséquence). Une tuile Système ne reçoit
jamais une couleur d'identité ; une tuile Macro ne reçoit jamais une couleur
de gravité.

## Patterns réutilisables établis

- **`.glass`** : carte plate de base (fond `--bg-surface`, bordure `--border`, `--shadow-card`, pas de `backdrop-filter`).
- **Toute carte custom porte `box-shadow: var(--shadow-card)`** : `.glass` l'a par défaut, mais une carte codée à la main dans un fichier d'onglet (résumé, tuile...) doit l'ajouter explicitement — oublié en v2 sur les tuiles Macros et la carte Jeux, elles restaient plaquées au fond sans aucune profondeur. Réflexe à vérifier sur toute nouvelle carte.
- **`.modal-overlay` / `.modal-card`** (`design-tokens.css`) : modale générique unique (scrim léger, carte plate, header icône+titre+croix, body, footer d'actions). Réservée à la confirmation d'actions destructrices (voir principe "tout le contenu reste sur la page" ci-dessus) — plus jamais utilisée pour ranger de la consultation/navigation dans cet onglet depuis le retrait de la modale Jeux en v4.
- **Grille en `auto-fill`/`minmax(min, 1fr)`, jamais un nombre de colonnes figé et jamais `minmax(min, max-fixe)`** : `repeat(2,1fr)` suppose un compte exact et casse dès que la liste change de taille (bug v2→v3). Un `max` fixe dans le `minmax()` (ex. `minmax(190px,240px)`) pose un autre piège : le test "combien de colonnes tiennent" du navigateur se fait avec la valeur **max**, pas min — sur une plage étroite ça sous-estime le nombre de colonnes qui tiendraient réellement et laisse un vide à droite (bug v3→v4, corrigé en `minmax(190px, 1fr)`). Toujours utiliser `1fr` comme deuxième valeur pour que l'ajustement se fasse sur le min et que l'espace restant soit redistribué plutôt que laissé vide.
- **Deux gabarits de tuile selon la fréquence d'usage** — `.shortcuts-tile` : grande tuile carrée (icône ronde 56px centrée + libellé 16px dessous, `min-height:180px`) pour une collection tapée souvent (Macros). `.shortcuts-system-pill` : bande compacte (icône ronde 34px + libellé en ligne, `min-height:56px`, forme pilule) pour une collection occasionnelle/à risque (Système) — volontairement un gabarit visuellement différent, pas juste une version réduite du même composant, pour que l'œil traite les deux zones différemment et limiter les taps accidentels sur une action destructrice.
- **Icônes neutres par défaut, couleur uniquement pour distinguer ou signaler** : deux usages distincts de la couleur sur une icône (voir section Tokens ci-dessus) — identité (`--tile-*`, plein, une par élément, icône blanche dessus) pour une collection à distinguer visuellement (apps, macros), ou gravité (`--warning`/`--danger` sur le glyph seul, fond neutre `--bg-surface-2` inchangé) pour une collection d'actions à risque variable (Système). Ne jamais mélanger les deux logiques sur la même collection.
- **Flux vertical naturel, pas de remplissage forcé** : chaque section (dock, macros, système...) prend la largeur pleine du panneau et la hauteur que son contenu réclame ; `.tab-panel` scrolle si le total dépasse l'écran. Une tentative en v2 de forcer un remplissage exact de la hauteur (`flex:1` en cascade + rows `1fr`) fonctionnait en paysage mais produisait des cartes absurdement hautes en portrait (la ressource rare s'y inverse : largeur au lieu de hauteur) et a provoqué les deux bugs `min-height` ci-dessous — abandonné en v3 au profit d'un flux naturel + grilles `auto-fill`, qui utilisent tout autant la largeur disponible sans la fragilité du forçage vertical.
- **Pièges `min-height`/`min-width` auto** : un enfant flex/grid dont le contenu (texte, icône) demande plus de place que la taille allouée par `1fr` refuse de rétrécir par défaut (taille minimale automatique = taille du contenu) — soit il fait déborder tout le parent (cf. bug de largeur du lecteur média du 2026-09-01), soit, pire, s'écrase complètement à 0px de haut si le flex-shrink peut aller jusque-là (cf. bug des descriptions de macros invisibles du même jour, en v2). Réflexe systématique sur toute carte/tuile dimensionnée en `flex:1`/`1fr` (si on en recroise le besoin) : `min-height:0; min-width:0; overflow:hidden;` sur le conteneur, `flex:0 0 auto` sur les enfants texte qui ne doivent jamais être écrasés.

## Chrome applicatif (header, rail de navigation)

Partagé par tous les onglets — `web/css/style.css`, tokens `--nav-w`/`--header-h`/`--footer-h` dans `design-tokens.css`.

**2026-09-01** : le rail de navigation gauche a été jugé "trop petit pour la
tablette" à deux reprises. La première correction (`--nav-w` 108→128px,
icône 26→30px) n'avait **aucun effet visible** sur les résolutions réellement
testées (~600-800px de haut) : une règle `@media (max-height: 850px)`
(pensée à l'origine pour compacter l'onglet Média, pas le rail) réécrasait
silencieusement `--nav-w` à 76px et les icônes à 20px — et cette plage de
hauteur couvre justement tout usage paysage de la Galaxy Tab A8. Corrigé en
retirant l'override de nav-w/icône/libellé de cette media query (elle ne
touche plus que `--header-h` et le padding de l'onglet Média, son objectif
d'origine) et en portant les valeurs de base à `--nav-w:156px`, icône 36px,
libellé 14.5px, boutons passés de `aspect-ratio:1/1` (forçait une hauteur
égale à la largeur — dangereux dès que la largeur augmente sur un écran bas)
à une hauteur fixe indépendante (`min-height:92px`) pour éviter tout
débordement vertical futur si la largeur est encore augmentée.

**Piège à retenir** : une media query `max-height` peut s'appliquer très
largement sur une tablette utilisée en paysage (toute hauteur ≤ ~850px en
est la cible) — avant de conclure qu'un changement visuel "n'a pas
fonctionné", vérifier qu'aucune media query en aval ne réécrase la valeur
sur la résolution réellement testée.

**2026-09-03** : header étendu de 2 à 3 zones (`grid-template-columns: 1fr
auto 1fr`) — fil d'ariane (nom app + onglet actif, mis à jour par
`activateTab()`/`TAB_CRUMB_LABELS`, `app.js`) à gauche, notch média
(`#header-notch`, masqué tant qu'aucune lecture n'est en cours —
`UI.updateHeaderNotch`, `app-ui-core.js`) au centre, statut PC + horloge/date
à droite. `--header-h` monté de 38 à 64px (52px sous `max-height:850px`) pour
loger le notch. Voir v5 du journal Raccourcis ci-dessous pour la justification
de la dérogation glow/dégradé sur ce composant précis.

## Journal par onglet

### Onglet Raccourcis (`web/tabs/shortcuts.html`, `web/css/shortcuts.css`, `web/js/shortcuts.js`)

**v1 — 2026-09-01** : passage de la grille bento 3 colonnes (avec listes à
scroll imbriqué) à un flux vertical : dock Apps rapides inchangé (icônes
aplaties) → grille Macros 2×2 toujours visible → 2 cartes-résumé Jeux/Système
ouvrant chacune une modale pour le détail (bibliothèque de jeux complète,
liste des 5 actions système). Modale de confirmation existante migrée sur le
composant générique `.modal-overlay`/`.modal-card`.

**v2 — 2026-09-01** : retour utilisateur — la v1 restait centrée dans une
colonne étroite (`max-width:900px`) et gâchait l'espace disponible sur la
tablette. Réagencement complet en paysage :
- Dock "Apps rapides" : passe d'une bande horizontale à scroll à une grille
  pleine largeur (`repeat(auto-fit, minmax(84px,1fr))`) qui répartit les
  icônes sur toute la largeur au lieu de les tasser à gauche.
- Rangée principale en 2 colonnes qui se partagent toute la hauteur restante :
  Macros (grille 2×2) à gauche, Jeux + Système (cartes-résumé qui s'étirent,
  `flex:1` chacune) empilées à droite — même hauteur totale que la colonne
  Macros, plus de cases qui flottent en haut avec du vide en dessous.
- Container `.shortcuts-tab-container` passé en `flex:1` (remplit tout le
  panneau) au lieu d'un flux qui ne prenait que la hauteur de son contenu.
- A révélé les deux pièges `min-height`/`min-width` auto documentés
  ci-dessus (largeur puis hauteur) — corrigés, pattern noté pour éviter de
  reproduire l'erreur sur les onglets suivants.

**v3 — 2026-09-01** : deuxième retour utilisateur, 7 corrections :
1. Rail de navigation trop petit → `--nav-w` 108→128px, icônes 26→30px, libellé 12→13px (`design-tokens.css`, `style.css`).
2. Icônes des apps du dock et des macros recolorées en aplat plein, une couleur distincte par élément (nouvelle palette `--tile-*`, hachage stable de l'id — voir pattern "identité vs état" ci-dessus). Système ne suit pas cette règle, volontairement (voir point 3).
3. Macros passées de cartes rectangulaires (icône + titre + description) à des tuiles carrées icône-ronde-centrée + libellé — description supprimée, `.shortcuts-macro-tile*` remplacé par `.shortcuts-tile`/`.shortcuts-tile--macro`.
4. Carte-résumé "Système" + sa modale **supprimées** : les 5 actions (Verrouiller/Veille/Fermer session/Redémarrer/Éteindre) sont redevenues des tuiles directement visibles (mêmes `.shortcuts-tile`, sans couleur d'identité — glyph `--warning`/`--danger` sur fond neutre, logique inchangée). Jeux reste seul derrière une modale (bibliothèque parcourue volontairement).
5. `design-tokens.css` et `style.css` fusionnés en un seul système de tokens (`style.css` n'a plus de `:root` du tout) — au passage, `--transition` avait dérivé (160ms vs 180ms) sans que personne ne le voie : exactement le risque que la fusion élimine.
6. Grille de macros/système passée de `repeat(2,1fr)` figé à `repeat(auto-fill, minmax(110px,150px))` — s'adapte au nombre réel d'éléments.
7. `box-shadow: var(--shadow-card)` ajouté sur les tuiles et la carte Jeux (manquant depuis la v1/v2 — nouveau réflexe noté dans les patterns ci-dessus).
8. Vérifié : `confirmSystemAction()` n'ouvre jamais deux `.modal-overlay` en même temps — devenu structurellement impossible une fois la modale Système supprimée (point 4), plus besoin de fermeture explicite entre les deux.

Effet de bord : la grille bento 2 colonnes en `flex:1` de la v2 a été
abandonnée au profit d'un flux vertical naturel (voir pattern "Flux vertical
naturel" ci-dessus) — plus simple, plus robuste, et le rendu plein-écran
recherché en v2 est en fait obtenu ici par l'ajout de la section Système
(plus de contenu réel) plutôt que par un étirement forcé.

**v4 — 2026-09-01** : troisième retour — l'utilisateur juge les corrections
de v3 trop cosmétiques ("petites corrections") et demande une refonte de
structure, avec un exemple concret : Jeux caché dans une modale ("un tiroir")
ne lui plaît pas. Deux décisions actées avant de coder (via question posée) :
Jeux devient une grille complète en pleine page (pas un carrousel), et les
sections adoptent une hiérarchie de taille par fréquence d'usage plutôt que
des tuiles uniformes partout. Résultat :
- **Jeux sort de la modale** : grille de jeux directement sur la page, section à part entière avec en-tête "Jeux" + compteur — la modale `.shortcuts-games-modal` et les fonctions `openGamesModal`/`closeGamesModal` sont supprimées. La modale générique ne sert plus qu'à la confirmation d'actions destructrices dans cet onglet (voir principe mis à jour ci-dessus).
- **Macros agrandies** : `.shortcuts-tile` passe de 110-150px à `min-height:180px`, icône 44→56px, libellé 13→16px — devient visuellement la section la plus proéminente de l'onglet (la plus utilisée).
- **Système recompacté en bande** : abandon des tuiles carrées au profit de `.shortcuts-system-pill` (pilules horizontales, icône 34px + libellé en ligne, `min-height:56px`) — gabarit délibérément différent de Macros, pas juste plus petit, pour que Système se lise comme "une autre catégorie" et non "les mêmes tuiles en réduction".
- **Ordre de la page revu** : Apps rapides → Macros (le plus fréquent) → Jeux (bibliothèque consultée régulièrement) → Système (le plus rare, en bas) — l'ordre suit maintenant la fréquence d'usage plutôt qu'un regroupement arbitraire.
- Corrigé au passage : `minmax(190px,240px)` sur la grille Macros laissait un vide à droite à certaines largeurs (le navigateur teste l'ajustement des colonnes avec la valeur **max** du `minmax`, pas la min — piège documenté dans les patterns ci-dessus) → passé en `minmax(190px, 1fr)`.

**v5 — 2026-09-03** : pivot de direction — un nouveau design a été validé par
l'utilisateur en dehors de ce projet (maquette de référence fournie en pièce
jointe) et remplace le flux vertical de la v4 par une **grille fixe en 4
zones** (Apps rapides haut-gauche, Macros haut-droite, Jeux bas-gauche,
Système bas-droite), chacune occupant un quart d'écran sans scroll. Décisions
actées avant de coder (4 questions posées à l'utilisateur, toutes tranchées
en faveur de l'option recommandée) :
- **Jeux redevient paginé (3 vignettes/page + points)** — reviens sciemment
  sur la décision v4 "Jeux devient une grille complète en pleine page (pas un
  carrousel)" : la nouvelle maquette impose ce format et l'utilisateur l'a
  validé explicitement, mais à noter pour la suite si un futur retour
  redemande une grille continue — ce n'est pas un oubli, c'est un aller-retour
  documenté.
- **Apps rapides passe aussi en grille paginée** (4×2 + points, masqués tant
  que ≤8 apps) — la maquette prévoit ce gabarit même si la config actuelle
  (6 apps) tient sur une seule page.
- **Notch média dans le header** (nouveau, `style.css`) : bordure en dégradé
  bleu/violet + glow (`--accent-2`/`--notch-border`/`--notch-glow`,
  `design-tokens.css`) — **déroge sciemment** aux principes directeurs
  "couleur réservée aux états" et "pas de blur/glow systématique" : c'est une
  identité visuelle ponctuelle voulue par la maquette pour ce composant
  précis, pas un précédent à généraliser ailleurs.
- **Badge "app déjà lancée"** : nouvel endpoint `GET /shortcuts/apps/status`
  (réutilise la détection Win32 déjà en place pour `/launch`), polling client
  toutes les 6s pendant que l'onglet est actif.
- Grilles Apps rapides / Macros / Système repassées en colonnes **figées**
  (`repeat(4,1fr)`/`repeat(2,1fr)`, pas `auto-fill`) pour coller exactement à
  la maquette — dérogation consciente au pattern "jamais un nombre de
  colonnes figé" (voir Patterns réutilisables) : le risque documenté (liste
  qui grandit et casse le layout) est couvert différemment ici, par la
  pagination plutôt que par la grille élastique.
- Étape suivante (non commencée à ce stade) : groupes d'animations 1 à 5
  listés séparément par l'utilisateur (tap feedback, macros actives, notch/
  égaliseur, swipe Steam, toasts/modale/transitions d'onglets).

**v5 (correction de fidélité) — 2026-09-03** : premier passage jugé trop
éloigné de la maquette (tailles, couleurs) par retour utilisateur direct,
capture d'écran à l'appui. Deuxième dérogation actée aux tokens d'identité,
en plus du notch : **Apps rapides perd sa pastille de couleur par app**
(icône neutre `--text-secondary`, 56px) et **Macros perd sa couleur par
macro** au profit d'un lavis accent unique (`--accent-wash`/`-border`,
nouveaux tokens) sur les 4 tuiles — la maquette de référence n'a jamais eu
de couleur d'identité sur ces deux collections, contrairement à l'ancien
système v1-v4. Chrome applicatif aligné sur les valeurs littérales de la
maquette (même résolution de référence, 1920×1200) : `--header-h` 64→96px,
fil d'ariane 26px/300, horloge 34px/300, statut sans pilule (texte+point
seul), notch 380→540px large (thumb 60px), rail latéral sans fond en pilule
sur l'onglet actif (couleur seule), repère ◆ en contour (pas rempli).
Panels/tuiles reviennent aux rayons et espacements littéraux de la maquette
(24px panel, 18-20px tuiles, paddings 26-30px). Rappel : ces dérogations sont
scopées à Raccourcis (+ chrome partagé) — ne pas les reproduire par réflexe
sur Médias/Deezer sans vérifier d'abord ce que montre leur propre maquette.

**Ajustements demandés (en cours)** :
_(rien de nouveau en attente pour l'instant — prêt pour le prochain retour utilisateur)_

### Médias, Deezer, Automobile, Dashboard/Endurance

Pas encore commencés — en attente de la validation finale de Raccourcis.
