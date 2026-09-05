/**
 * Cockpit OS — Chargement des fragments d'onglets, délégation d'événements
 * globaux, horloge, point d'entrée. Chargé en dernier : dépend de tous les
 * autres fichiers app-*.js (UI, Media, Deezer, State, navigation).
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// Chargement des onglets HTML (sans fetch, sans async/await pour Safari 9)
// ═══════════════════════════════════════════════════════════════════════════

function ajaxGet(url) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(xhr.statusText || 'Status: ' + xhr.status));
        }
      }
    };
    xhr.onerror = function() {
      reject(new Error('Network error'));
    };
    xhr.send();
  });
}

function loadTabs() {
  var v = (window.APP_VERSION && window.APP_VERSION.indexOf('__') === -1) ? window.APP_VERSION : Date.now();
  var tabs = [
    { id: 'tab-dashboard',   url: '/tabs/dashboard.html?v=' + v },
    { id: 'tab-deezer',      url: '/tabs/deezer.html?v=' + v },
    { id: 'tab-media',       url: '/tabs/media.html?v=' + v  },
    { id: 'tab-endurance',   url: '/tabs/endurance.html?v=' + v },
    { id: 'tab-shortcuts',   url: '/tabs/shortcuts.html?v=' + v },
    { id: 'tab-automobile',  url: '/tabs/automobile.html?v=' + v }
  ];

  var promises = [];
  for (var i = 0; i < tabs.length; i++) {
    (function(tab) {
      var p = ajaxGet(tab.url)
        .then(function(html) {
          var container = el(tab.id);
          if (container) {
            container.innerHTML = html;
            // Execute inline and external scripts manually since innerHTML does not run them
            var sList = container.getElementsByTagName('script');
            var scripts = [];
            for (var j = 0; j < sList.length; j++) {
              scripts.push(sList[j]);
            }
            for (var j = 0; j < scripts.length; j++) {
              var oldScript = scripts[j];
              var newScript = document.createElement('script');
              for (var k = 0; k < oldScript.attributes.length; k++) {
                var attr = oldScript.attributes[k];
                newScript.setAttribute(attr.name, attr.value);
              }
              newScript.text = oldScript.innerHTML || oldScript.textContent || oldScript.text || '';
              if (oldScript.parentNode) {
                oldScript.parentNode.replaceChild(newScript, oldScript);
              }
            }
          }
        })
        .catch(function(err) {
          console.error('Impossible de charger l\'onglet ' + tab.url + ' :', err);
        });
      promises.push(p);
    })(tabs[i]);
  }
  return Promise.all(promises);
}

// ═══════════════════════════════════════════════════════════════════════════
// Initialisation des événements
// ═══════════════════════════════════════════════════════════════════════════

// Active l'onglet `tabName` : bouton de rail + panneau correspondants,
// plus les effets de bord habituels (mini-player, cycle de vie Raccourcis).
// Réutilisée à la fois par le clic direct sur le rail et par le lanceur
// Automobile (qui active "dashboard"/"endurance" sans bouton de rail dédié).
var TAB_CRUMB_LABELS = {
  shortcuts: 'Raccourcis',
  media: 'Médias',
  deezer: 'Deezer',
  automobile: 'Automobile',
  dashboard: 'Cockpit',
  endurance: 'Endurance'
};

function activateTab(tabName) {
  document.querySelectorAll('.tab-nav__btn').forEach(function(b) {
    b.classList.remove('tab-nav__btn--active');
  });
  var navBtn = document.querySelector('.tab-nav__btn[data-tab="' + tabName + '"]');
  if (navBtn) navBtn.classList.add('tab-nav__btn--active');

  var tabEl = el('tab-' + tabName);
  var previousEl = document.querySelector('.tab-panel--active');

  // Crossfade entre onglets (groupe 5) — les deux panneaux restent
  // superposés (position:absolute) le temps du fondu (voir .tab-panel--
  // leaving/--entering, style.css), puis l'ancien repasse à display:none.
  if (previousEl && previousEl !== tabEl) {
    (function(leavingEl) {
      leavingEl.classList.remove('tab-panel--active');
      leavingEl.classList.add('tab-panel--leaving');
      setTimeout(function() {
        leavingEl.classList.remove('tab-panel--leaving');
      }, 220);
    })(previousEl);
  }
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    if (p !== tabEl && p !== previousEl) p.classList.remove('tab-panel--active');
  });

  if (tabEl) {
    if (tabEl !== previousEl) {
      tabEl.classList.add('tab-panel--entering');
      tabEl.classList.add('tab-panel--active');
      void tabEl.offsetWidth; // reflow forcé pour repartir d'opacity:0
      tabEl.classList.remove('tab-panel--entering');
    } else {
      tabEl.classList.add('tab-panel--active');
    }
  }

  setText('header-crumb', TAB_CRUMB_LABELS[tabName] || tabName);

  // Gérer la visibilité du mini-player pour l'onglet média
  if (tabName === 'media') {
    document.body.classList.add('media-tab-active');
    // Rafraîchir les widgets de l'onglet média
    if (State.audioState) {
      UI.updateBluetooth(State.audioState);
      UI.updateAudioDevices(State.audioState);
    }
  } else {
    document.body.classList.remove('media-tab-active');
  }

  // Masquer le mini-player pour tous les onglets
  var mini = el('mini-player');
  if (mini) mini.style.display = 'none';

  // Gérer le cycle de vie de l'onglet Raccourcis
  if (tabName === 'shortcuts') {
    if (window.ShortcutsController && typeof window.ShortcutsController.onActivate === 'function') {
      window.ShortcutsController.onActivate();
    }
  } else {
    if (window.ShortcutsController && typeof window.ShortcutsController.onDeactivate === 'function') {
      window.ShortcutsController.onDeactivate();
    }
  }
}

// Ouvre Cockpit ("dashboard") ou Endurance ("endurance") en plein écran
// depuis le lanceur de l'onglet Automobile : masque header + rail de nav.
function enterAutomobileFullscreen(dashName) {
  activateTab(dashName);
  // Le bouton "Automobile" du rail reste actif (le rail est masqué en plein
  // écran, mais l'état reste cohérent si on en ressort).
  var autoBtn = document.querySelector('.tab-nav__btn[data-tab="automobile"]');
  if (autoBtn) autoBtn.classList.add('tab-nav__btn--active');
  document.body.classList.add('automobile-fullscreen');
}

// Quitte le plein écran et revient au lanceur Automobile.
function exitAutomobileFullscreen() {
  document.body.classList.remove('automobile-fullscreen');
  activateTab('automobile');
}

function initEvents() {
  // ── Navigation par onglets ──────────────────────────────────────────────
  document.querySelectorAll('.tab-nav__btn[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  // ── Lanceur "Automobile" (Cockpit / Endurance en plein écran) ───────────
  document.addEventListener('click', function(e) {
    var launchBtn = e.target.closest('[data-launch]');
    if (launchBtn) {
      enterAutomobileFullscreen(launchBtn.getAttribute('data-launch'));
      return;
    }
    if (e.target.closest('#automobile-exit-btn')) {
      exitAutomobileFullscreen();
    }
  });

  // ── Mini-player ─────────────────────────────────────────────────────────
  var miniPrev = el('mini-prev');
  if (miniPrev) {
    miniPrev.addEventListener('click', function() {
      console.log("[Click Handler] Clic sur #mini-prev détecté. State.customQueueActive =", State.customQueueActive, "State.customQueueIndex =", State.customQueueIndex);
      if (State.customQueueActive) {
        playPreviousQueueTrack();
        console.log("[Click Handler] Après playPreviousQueueTrack() sur #mini-prev. State.customQueueIndex =", State.customQueueIndex);
      } else {
        Media.command('previous');
      }
    });
  }
  var miniPlay = el('mini-play');
  if (miniPlay) {
    miniPlay.addEventListener('click', function() { Media.command('toggle'); });
  }
  var miniNext = el('mini-next');
  if (miniNext) {
    miniNext.addEventListener('click', function() {
      if (State.customQueueActive) {
        playNextQueueTrack();
      } else {
        Media.command('next');
      }
    });
  }

  // OPTIMISATION 5 : Consolidation des écouteurs 'click' et 'input' globaux
  document.addEventListener('click', function(e) {
    // 1. Boutons de contrôle média
    if (e.target.closest('#media-prev') || e.target.closest('#dash-media-prev') || e.target.closest('#dz-media-prev')) {
      var btnEl = e.target.closest('#media-prev') || e.target.closest('#dash-media-prev') || e.target.closest('#dz-media-prev');
      var btnId = btnEl ? btnEl.id : 'unknown-prev';
      console.log("[Click Handler] Clic sur #" + btnId + " détecté. State.customQueueActive =", State.customQueueActive, "State.customQueueIndex =", State.customQueueIndex);
      if (State.customQueueActive) {
        playPreviousQueueTrack();
      } else {
        Media.command('previous');
      }
      return;
    }
    if (e.target.closest('#media-play') || e.target.closest('#dash-media-play') || e.target.closest('#dz-media-play')) {
      Media.command('toggle');
      return;
    }
    if (e.target.closest('#media-next') || e.target.closest('#dash-media-next') || e.target.closest('#dz-media-next')) {
      if (State.customQueueActive) {
        playNextQueueTrack();
      } else {
        Media.command('next');
      }
      return;
    }
    // NOTE : #media-mute a déjà un onclick="toggleAppMute('master')" inline dans media.html,
    // qui envoie une commande explicite avec la valeur cible calculée. Un ancien gestionnaire
    // ici appelait EN PLUS Media.toggleMute() (bascule "à l'aveugle" sans valeur) sur le même
    // clic — les deux commandes arrivaient presque en même temps et le serveur basculait le
    // mute deux fois, s'annulant un coup sur deux. Supprimé : laisser le onclick inline gérer
    // seul ce bouton.
    if (e.target.closest('#media-shuffle')) { Media.command('shuffle.toggle'); return; }
    if (e.target.closest('#media-repeat')) { Media.command('repeat.cycle'); return; }
    if (e.target.closest('#audio-refresh')) { send({ type: 'audio.state.request' }); return; }
    if (e.target.closest('#dz-refresh-playlists')) { Deezer.loadPlaylists(); return; }

    // 2. Boutons Retour de navigation (général, sheets et overlay)
    if (
      e.target.closest('#dz-back-btn') ||
      e.target.closest('#dz-back-btn-tracks') ||
      e.target.closest('#dz-back-btn-albums') ||
      e.target.closest('#dz-sheet-overlay')
    ) {
      goBack();
      return;
    }

    // 3. Bouton Afficher tout / Réduire les playlists
    if (e.target.closest('#dz-toggle-playlists')) {
      State.playlistsExpanded = !State.playlistsExpanded;
      UI.renderPlaylists(State.allPlaylists || []);
      return;
    }

    // 4. Lecture Flow Deezer
    if (e.target.closest('#dz-play-flow')) {
      Deezer.playFlow();
      return;
    }

    // 5. Seek sur barre de progression
    var bar = e.target.closest('#media-progress-bar') || e.target.closest('#dz-media-progress-bar') || e.target.closest('#dash-media-progress-bar');
    if (bar) {
      var rect = bar.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      var duration = State.mediaState ? State.mediaState.duration : 0;
      if (duration > 0) Media.seek(pct * duration);
      return;
    }

    // 6. Effacer la recherche
    if (e.target.id === 'dz-search-clear') {
      var input = el('dz-search-input');
      if (input) {
        input.value = '';
        var ev;
        if (typeof Event === 'function') {
          ev = new Event('input');
        } else {
          ev = document.createEvent('Event');
          ev.initEvent('input', true, true);
        }
        input.dispatchEvent(ev);
      }
      e.target.classList.remove('search-bar__clear--visible');
      return;
    }

    // 7. Filtres de recherche
    if (e.target.classList.contains('filter-btn')) {
      document.querySelectorAll('.filter-btn').forEach(function(b) {
        b.classList.remove('filter-btn--active');
      });
      e.target.classList.add('filter-btn--active');
      State.currentFilter = e.target.getAttribute('data-filter');
      var searchInput = el('dz-search-input');
      if (searchInput && searchInput.value.trim()) {
        Deezer.search(searchInput.value.trim(), State.currentFilter);
      }
      return;
    }
  });

  // Consolidé : 'input'
  document.addEventListener('input', function(e) {
    // NOTE : la gestion de #media-tab-volume-slider a été retirée d'ici — ce bloc dupliquait
    // le oninput="setAppVolume('master', this.value)" déjà présent sur l'élément dans
    // media.html, avec son propre throttle indépendant (window._sendMasterVolThrottled).
    // Les deux se déclenchaient sur CHAQUE mouvement du slider, envoyant potentiellement deux
    // commandes réseau non coordonnées à chaque tick throttlé — c'était la vraie cause du
    // slider "pas fluide". L'id "media-volume" qu'il vérifiait aussi n'existe nulle part dans
    // le HTML (référence morte, UI plus ancienne) : ce bloc entier peut être retiré sans risque.

    if (e.target.id === 'dz-search-input') {
      var query = e.target.value.trim();
      var clearBtn = el('dz-search-clear');

      if (clearBtn) clearBtn.classList.toggle('search-bar__clear--visible', query.length > 0);

      if (!query) {
        showView('playlists');
        State.breadcrumb = [{ label: 'Accueil', view: 'playlists' }];
        renderBreadcrumb();
        return;
      }

      clearTimeout(State.searchDebounceTimer);
      State.searchDebounceTimer = setTimeout(function() {
        showView('search');
        Deezer.search(query, State.currentFilter);
      }, CONFIG.SEARCH_DEBOUNCE);
      return;
    }
  });

  // Changement de tri dans la playlist (nouveau) et tri des playlists
  document.addEventListener('change', function(e) {
    if (e.target.id === 'dz-sort-select') {
      var val = e.target.value;
      sortTracks(val);
    } else if (e.target.id === 'dz-playlists-sort-select') {
      var val = e.target.value;
      console.log("[Deezer] Tri des playlists modifié pour :", val);
      State.playlistSortMode = val;
      UI.renderPlaylists(State.allPlaylists || []);
    }
  });

  // Touche Entrée dans la recherche
  document.addEventListener('keydown', function(e) {
    if (e.target.id === 'dz-search-input' && e.key === 'Enter') {
      var query = e.target.value.trim();
      if (query) {
        clearTimeout(State.searchDebounceTimer);
        showView('search');
        Deezer.search(query, State.currentFilter);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Horloge
// ═══════════════════════════════════════════════════════════════════════════

var CLOCK_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
var CLOCK_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function startClock() {
  var lastDay = -1;
  function tick() {
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var h = (hours < 10 ? '0' : '') + hours;
    var m = (minutes < 10 ? '0' : '') + minutes;
    setText('clock', h + ':' + m);

    var day = now.getDate();
    if (day !== lastDay) {
      lastDay = day;
      setText('header-date', CLOCK_DAYS[now.getDay()] + ' ' + day + ' ' + CLOCK_MONTHS[now.getMonth()]);
    }
  }
  tick();
  setInterval(tick, 10000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Démarrage
// ═══════════════════════════════════════════════════════════════════════════

function init() {
  startClock();
  loadTabs().then(function() {
    initEvents();
    connectWS();
    // Raccourcis est actif par défaut dans le HTML statique (tab-panel--active),
    // mais sans être jamais passé par activateTab() au chargement initial :
    // ni son cycle de vie (ShortcutsController.onActivate, qui charge
    // apps/jeux/fenêtres/scènes) ni l'état visuel actif du bouton de nav
    // (.tab-nav__btn--active, jamais posé dans le HTML statique) ne se
    // déclenchaient donc avant le premier changement d'onglet manuel — bug
    // constaté le 2026-09-03 (sidebar sans aucun onglet actif visible tant
    // qu'on n'avait pas cliqué). activateTab() couvre les deux.
    activateTab('shortcuts');
  });
}

document.addEventListener('DOMContentLoaded', init);
