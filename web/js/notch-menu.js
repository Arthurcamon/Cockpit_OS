/**
 * Cockpit OS — Sur-menu de la notch (header) : ouverture/fermeture au tap et
 * interactivité des contrôles (étapes 2 et 3 — cette dernière ajoute le
 * scale-up/fade depuis la position de la notch fermée, symétrique à la
 * fermeture). Réutilise EXACTEMENT les mêmes commandes que le mini-lecteur
 * (Media.*, app-commands.js) et le même flux de confirmation que les
 * actions système de Raccourcis (ShortcutsController.confirmGenericAction)
 * — pas de logique séparée à maintenir. Dépend de app-core.js (el/setText),
 * app-commands.js (Media), app-ws.js (State, playPreviousQueueTrack/
 * playNextQueueTrack) et shortcuts.js (ShortcutsController).
 */

'use strict';

// Durée de la transition scale/opacity du panneau (.notch-menu, style.css)
// — gardée ici pour resynchroniser le nettoyage du transform-origin après
// la fermeture (voir closeNotchMenu).
var NOTCH_MENU_TRANSITION_MS = 280;

// Calcule et pose le point d'origine du scale-up sur #notch-menu, en % de
// SA PROPRE boîte non transformée (offsetWidth/Height, insensibles au
// transform) — même principe que .modal-card--from-origin (shortcuts.js) :
// le panneau semble alors grandir depuis le centre exact de la notch
// fermée, quelle que soit l'échelle en cours (transform:translate(-50%,
// -50%) reste indépendant de cette origine, cf. spec CSS transform-origin).
function setNotchMenuOriginFromNotch() {
  var notch = el('header-notch');
  var menu = el('notch-menu');
  if (!notch || !menu) return;

  var notchRect = notch.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var menuCenterX = menuRect.left + menuRect.width / 2;
  var menuCenterY = menuRect.top + menuRect.height / 2;
  var naturalW = menu.offsetWidth;
  var naturalH = menu.offsetHeight;
  if (!naturalW || !naturalH) return;

  var notchCenterX = notchRect.left + notchRect.width / 2;
  var notchCenterY = notchRect.top + notchRect.height / 2;

  var originX = 50 + ((notchCenterX - menuCenterX) / naturalW) * 100;
  var originY = 50 + ((notchCenterY - menuCenterY) / naturalH) * 100;
  menu.style.transformOrigin = originX + '% ' + originY + '%';
}

function openNotchMenu() {
  var scrim = el('notch-menu-scrim');
  var menu = el('notch-menu');
  var notch = el('header-notch');
  if (!menu) return;

  clearTimeout(menu._resetOriginTimer);
  // Mesuré AVANT d'ajouter .is-open : le panneau est encore à son échelle
  // "fermée" (0.35, transform-origin remis à 50%/50% par la fermeture
  // précédente, voir plus bas) — un scale uniforme autour du centre
  // préserve le centre réel, donc la mesure reste fiable à chaque ouverture.
  setNotchMenuOriginFromNotch();

  if (notch) notch.classList.add('is-menu-open');
  if (scrim) scrim.classList.add('is-open');
  menu.classList.add('is-open');
}

function closeNotchMenu() {
  var scrim = el('notch-menu-scrim');
  var menu = el('notch-menu');
  var notch = el('header-notch');
  if (scrim) scrim.classList.remove('is-open');
  if (menu) menu.classList.remove('is-open');
  if (notch) notch.classList.remove('is-menu-open');

  // Remet l'origine à 50%/50% une fois la fermeture terminée (le panneau
  // est alors invisible, aucun à-coup visuel) — garantit que la PROCHAINE
  // mesure d'ouverture reparte d'un état neutre plutôt que de l'origine
  // décentrée de cette fois-ci, qui fausserait le calcul suivant.
  if (menu) {
    menu._resetOriginTimer = setTimeout(function() {
      menu.style.transformOrigin = '';
    }, NOTCH_MENU_TRANSITION_MS);
  }
}

// Barre de progression — tap pour aller directement à une position, drag
// pour scruber en continu (pointer events : couvre souris ET tactile,
// setPointerCapture évite de perdre le geste si le doigt sort de la barre).
// Commit réel (Media.seek) seulement au relâchement, l'affichage pendant le
// drag est purement local (transform/position, pas de reflow ailleurs).
function initNotchMenuSeekDrag() {
  var bar = el('notchmenu-progress-bar');
  if (!bar) return;
  var dragging = false;

  function pctFromEvent(evt) {
    var rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
  }
  function paint(pct) {
    var fill = el('notchmenu-progress-fill');
    var thumb = el('notchmenu-progress-thumb');
    if (fill) fill.style.width = (pct * 100) + '%';
    if (thumb) thumb.style.left = (pct * 100) + '%';
  }

  bar.addEventListener('pointerdown', function(evt) {
    var duration = State.mediaState ? State.mediaState.duration : 0;
    if (!duration) return;
    dragging = true;
    bar.setPointerCapture(evt.pointerId);
    paint(pctFromEvent(evt));
  });
  bar.addEventListener('pointermove', function(evt) {
    if (!dragging) return;
    paint(pctFromEvent(evt));
  });
  bar.addEventListener('pointerup', function(evt) {
    if (!dragging) return;
    dragging = false;
    var duration = State.mediaState ? State.mediaState.duration : 0;
    if (duration > 0) Media.seek(pctFromEvent(evt) * duration);
  });
  bar.addEventListener('pointercancel', function() { dragging = false; });
}

document.addEventListener('DOMContentLoaded', function() {
  var notch = el('header-notch');
  if (notch) notch.addEventListener('click', openNotchMenu);

  var closeBtn = el('notch-menu-close');
  if (closeBtn) closeBtn.addEventListener('click', closeNotchMenu);

  var scrim = el('notch-menu-scrim');
  if (scrim) scrim.addEventListener('click', closeNotchMenu);

  // --- Transport — mêmes commandes que #mini-prev/#mini-play/#mini-next
  // (app.js) : jamais de réimplémentation séparée. ---
  var prevBtn = el('notchmenu-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', function() {
      if (State.customQueueActive) playPreviousQueueTrack();
      else Media.command('previous');
    });
  }
  var playBtn = el('notchmenu-play');
  if (playBtn) playBtn.addEventListener('click', function() { Media.command('toggle'); });
  var nextBtn = el('notchmenu-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', function() {
      if (State.customQueueActive) playNextQueueTrack();
      else Media.command('next');
    });
  }
  var shuffleBtn = el('notchmenu-shuffle');
  if (shuffleBtn) shuffleBtn.addEventListener('click', function() { Media.command('shuffle.toggle'); });
  var repeatBtn = el('notchmenu-repeat');
  if (repeatBtn) repeatBtn.addEventListener('click', function() { Media.command('repeat.cycle'); });

  initNotchMenuSeekDrag();

  // --- "Fermer le jeu" — action sensible, jamais directe (même flux de
  // confirmation plein écran que Redémarrer/Éteindre/Fermer session). ---
  var quitBtn = el('notchmenu-quit-btn');
  if (quitBtn) {
    quitBtn.addEventListener('click', function(evt) {
      if (quitBtn.disabled || !window.ShortcutsController) return;
      var gameName = (State.steamRunning && State.steamRunning.name) || 'le jeu';
      ShortcutsController.confirmGenericAction(
        evt,
        'Fermer ' + gameName + ' ?',
        // Avertissement honnête : aucune commande de fermeture réelle
        // n'existe côté serveur pour l'instant (voir gap signalé) — ce
        // bouton ne fait que réinitialiser l'indicateur "en cours" de
        // l'app, il ne termine pas le processus sur le PC.
        'Cockpit OS ne peut pas encore fermer un jeu à distance sur le PC. Cette action réinitialise seulement l’indicateur "en cours" de l’application.',
        function() {
          State.steamRunning = null;
          UI.updateHeaderGame({ status: 'idle' });
        }
      );
    });
  }
});
