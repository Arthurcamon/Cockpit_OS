# Cockpit OS — Design System « Soft Glass »

Ce document décrit le langage visuel « Soft Glass », qui s'applique au **cœur de l'app**
uniquement : les onglets **Raccourcis**, **Médias** et **Deezer**. Référence visuelle
vivante : `pc-raccourcis-glass-v2.html` (onglet Raccourcis, déjà dans ce style).

## 0. Périmètre — Soft Glass vs Automobile

Cockpit OS a deux systèmes visuels distincts et volontairement séparés :

- **Soft Glass** (ce document) — Raccourcis / Médias / Deezer. Le style « principal » de
  l'app, celui décrit ci-dessous.
- **Automobile** — Dashboard (`#tab-dashboard`, onglet « Cockpit ») + Endurance
  (`#tab-endurance`). Extension de l'app avec sa propre charte, pensée comme un habitacle
  de tableau de bord automobile plutôt que comme un OS tactile. N'hérite d'aucun token
  Soft Glass et n'est pas documentée ici (tokens dédiés dans `style.css`, section
  « Automotive Cockpit UI Theme », scopée à `#tab-dashboard` ; Endurance a sa propre
  feuille de style embarquée dans `endurance.html`).

**Règle** : ne jamais faire fuiter un token/composant Soft Glass dans Dashboard/Endurance,
ni l'inverse. Un composant qui a besoin d'exister dans les deux univers doit être stylé
deux fois, une par système — jamais partagé tel quel.

## 1. Direction artistique (résumé en une phrase)

> Interface tactile premium en verre fumé, inspirée des tableaux de bord automobiles haut
> de gamme et des tablettes futuristes : grands arrondis organiques, gradients fluides,
> halos lumineux diffus, ombres très douces, boutons circulaires et capsules, beaucoup
> d'espace. Jamais de cyberpunk/gaming, jamais de néon agressif, jamais de bordure visible.

Chaque widget doit ressembler à un **objet physique flottant**, pas à un panneau CSS.

## 2. Tokens

### Couleurs de base
| Token | Valeur | Usage |
|---|---|---|
| `--graphite-1` | `#191a1e` | fond, haut du dégradé |
| `--graphite-2` | `#101114` | fond, bas du dégradé |
| `--glass-a` | `rgba(255,255,255,0.10)` | haut du dégradé de verre |
| `--glass-b` | `rgba(255,255,255,0.035)` | bas du dégradé de verre |
| `--text` | `#f4f3f6` | texte principal |
| `--text-soft` | `rgba(244,243,246,0.62)` | texte secondaire |
| `--text-faint` | `rgba(244,243,246,0.36)` | légendes, métadonnées |
| `--mint` | `#a9e8cf` | succès, statut "en direct" |

### Accents (un par élément, jamais partagés globalement)
Chaque carte/app/scène a **sa propre paire** `--pc1` (clair) / `--pc2` (foncé) utilisée en
dégradé 155deg. Les accents sont pastel et désaturés — jamais une couleur de marque saturée
brute. Exemples déjà utilisés : ambre (`#f3e0b8`→`#dba86a`), bleu (`#b8d3f2`→`#5a7fc4`),
lilas (`#c9c2f2`→`#8577d9`), corail (`#f2b8b0`→`#d9614a`), sarcelle (`#b8e8e0`→`#4fb8ab`),
vert (`#c9ecd6`→`#5cb37e`).

**Règle sémantique** : bleu/lilas froid = action sûre. Ambre → orange → rouge corail
(intensité croissante) = action de plus en plus sensible/destructive.

### Rayons
- `--r-xl: 36–46px` — écran / conteneur global
- `--r-lg: 26–28px` — grandes cartes (widgets)
- `--r-md: 18–22px` — cartes moyennes, aperçus
- boutons d'action, tags, tabs → toujours `border-radius: 999px` (capsule)
- icônes → cercle parfait ou "pebble" (14–22px de rayon sur un carré)

### Typographie
Police unique : **Manrope** (Google Fonts), poids 300 à 800.
- Titres de page : 24–26px, weight 600
- Titres de carte : 13.5–14.5px, weight 600
- Corps / labels : 12.5–13.5px, weight 500–600
- Légendes / métadonnées : 10–11.5px, weight 500, souvent en `--text-faint`

## 3. La matière : surface "verre"

Chaque carte est un bloc translucide flou, jamais un aplat opaque, jamais de bordure dure.

```css
.glass {
  background: linear-gradient(160deg, var(--glass-a), var(--glass-b));
  backdrop-filter: blur(26px) saturate(160%);
  border-radius: var(--r-lg);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.16),   /* liseré lumineux en haut, simule le bord du verre */
    inset 0 -14px 30px -24px rgba(0,0,0,0.5), /* creux en bas pour la profondeur */
    0 22px 48px -22px rgba(0,0,0,0.55);       /* ombre douce, l'objet flotte */
}
```

Aucune bordure `border: 1px solid …` visible nulle part. Toute séparation se fait par
l'espace, l'ombre ou ce léger liseré interne.

## 4. Halos lumineux diffus

Le fond de l'écran porte 2 à 3 taches de couleur très floutées (`filter: blur(90–140px)`),
opacité 0.2–0.3, positionnées en coin. Elles donnent l'impression que la lumière vient de
derrière l'interface, comme un éclairage d'habitacle. Elles ne doivent jamais gêner la
lecture du contenu au premier plan.

Un widget important (le "poste de pilotage" central d'un onglet) peut avoir en plus son
propre halo interne (`::before` positionné dans un coin de la carte), pour donner
l'impression que sa couleur signature émane de l'intérieur.

## 5. Composants réutilisables (voir `design-tokens.css`)

| Composant | Classe | Description |
|---|---|---|
| Carte verre | `.glass` | conteneur de base de tout widget |
| Icône "pebble" | `.pebble` | icône ronde/squircle en dégradé + reflet spéculaire, pour une app ou une action |
| Bouton capsule | `.capsule-btn` | pilule pleine largeur, icône + label, utilisée pour toute action |
| Carte avec halo interne | `.glow-card` | carte dont la couleur semble émaner d'un coin (apps, favoris, items à forte identité) |
| Onglets glissants | `.segmented` + `.seg-indicator` | tabs internes avec un fond qui glisse vers l'onglet actif |
| Toast | `.toast` | notification pilule discrète en bas d'écran |
| Modale de confirmation | `.confirm-overlay` / `.confirm-card` | plein écran flouté, pour toute action irréversible |
| État actif/live | `.active` + `glow-pulse` (keyframes) | halo qui pulse doucement sur l'élément actuellement actif (scène, appareil allumé…) |

## 6. Règles d'usage — à toujours respecter

1. Jamais de bordure visible (`border` dur) — utiliser ombre + espace.
2. Jamais de coin droit — tout est arrondi, souvent en capsule.
3. Un accent couleur par élément à forte identité (app, scène, action) — pas de dégradé
   arc-en-ciel global.
4. Les actions destructrices/sensibles ont un halo chaud + nécessitent une confirmation
   plein écran (icône alerte, message clair, Annuler / Confirmer en capsules).
5. Les interactions ont un retour tactile léger : `translateY(-2px à -4px)` au survol,
   `scale(.95–.98)` au clic, transitions 150–250ms.
6. Beaucoup d'espace : padding généreux (16–34px), gap entre widgets 14–22px minimum.
7. Ne jamais dépasser 2 informations par ligne (icône + titre, ou icône + titre + action) —
   la lisibilité prime sur la densité.

## 7. Checklist de conformité — à vérifier avant de livrer un onglet

Avant de considérer un onglet terminé, relire visuellement **chaque** carte/panneau/contrôle
et répondre à ces questions. Si une seule réponse est "oui", l'onglet n'est pas conforme et
doit être corrigé avant livraison.

- [ ] Un composant a-t-il une **bordure visible** (`border: 1px solid`, `outline`, une ligne
      de séparation nette sous un header) ? → remplacer par `.glass` (ombre + liseré interne
      uniquement).
- [ ] Un fond de carte est-il un **aplat opaque** (une seule couleur pleine, sans dégradé ni
      transparence) ? → doit utiliser le dégradé translucide + `backdrop-filter: blur(26px)
      saturate(160%)`.
- [ ] Le fond de l'écran est-il un **noir/gris uni**, sans aucune tache de couleur floutée
      derrière les widgets ? → ajouter au moins 2 `.halo` (`blur(90px)` ou plus), positionnés
      en coin, sur un fond en dégradé graphite (jamais un noir plat).
- [ ] Le **rail de navigation** touche-t-il les bords de l'écran, ou est-il un rectangle
      plutôt qu'une capsule flottante détachée avec sa propre marge ?
- [ ] Une **icône d'app/action** est-elle un pictogramme générique/fallback identique répété
      sur plusieurs éléments différents (ex. la même icône "grille" pour Discord, Navigateur,
      Explorateur...) ? → chaque élément doit avoir sa propre icône et son propre couple
      `--pc1/--pc2`.
- [ ] Un **onglet interne** (segmented control) change-t-il d'état par un simple aplat gris,
      sans pastille qui glisse (`.seg-indicator` animé en `transform`) ?
- [ ] Une **grille d'éléments similaires** (jeux, playlists, fenêtres) est-elle rendue avec des
      tuiles identiques et grises, sans couleur/visuel propre à chacune ?
- [ ] Un **slider, une barre de progression ou un toggle** garde-t-il le style par défaut du
      navigateur/framework plutôt que le style du design system (piste en dégradé, poignée
      douce, sans contour) ?
- [ ] Reste-t-il un **angle droit visible** quelque part (hors icônes/texte) ?

### Cause la plus fréquente — à vérifier en premier

La plupart des régressions viennent des composants **Card / Panel / Input par défaut du
framework** (souvent avec `border` et fond plein déjà définis dans un fichier de base ou une
librairie UI), sur lesquels les couleurs et icônes du design system sont ajoutées *par-dessus*
sans retirer le style d'origine. **Avant** de styler un nouvel onglet : ouvrir le CSS des
composants partagés et retirer tout `border` / fond plein hérité, plutôt que d'empiler du
style par-dessus.

## 8. Comment briefer Claude Code

Donner à Claude Code, dans une seule tâche :
1. Ce fichier (`cockpit-os-design-system.md`)
2. `design-tokens.css`
3. Le mockup de référence déjà validé (`pc-raccourcis-glass-v2.html`) comme "vérité visuelle"
4. Le fichier/composant réel de l'onglet à retravailler

Exemple de prompt à copier-coller :

> Voici le design system de mon application (`cockpit-os-design-system.md` +
> `design-tokens.css`) et une référence visuelle interactive déjà validée
> (`pc-raccourcis-glass-v2.html`). Applique exactement ce même langage visuel à l'onglet
> **[NOM DE L'ONGLET]**, situé dans `[chemin du fichier]`. Conserve la structure, la
> logique et toutes les fonctionnalités existantes — ne change que la couche visuelle.
> Réutilise en priorité les tokens et classes de `design-tokens.css` plutôt que d'en
> inventer de nouveaux. Si un élément de cet onglet n'a pas d'équivalent direct dans le
> design system, adapte le pattern existant le plus proche (carte en verre, icône pebble,
> bouton capsule, halo interne) plutôt que d'improviser un nouveau style. Avant de rendre la
> main, repasse la checklist de conformité (section 7 du design system) sur chaque écran
> modifié et corrige tout point qui échoue.

Traiter les onglets **un par un**, dans des tâches séparées : ça garde le diff lisible et
ça permet de valider visuellement chaque onglet avant de passer au suivant.
