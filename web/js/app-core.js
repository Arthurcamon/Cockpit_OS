/**
 * Cockpit OS — Fondations partagées : polyfills, config, état global, utilitaires DOM.
 * Doit être chargé en premier (tous les autres fichiers app-*.js en dépendent).
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// Polyfills de compatibilité iPad 2 (Safari iOS 9.3.5)
// ═══════════════════════════════════════════════════════════════════════════

if (window.NodeList && !NodeList.prototype.forEach) {
  NodeList.prototype.forEach = Array.prototype.forEach;
}

if (!Element.prototype.matches) {
  Element.prototype.matches =
    Element.prototype.matchesSelector ||
    Element.prototype.mozMatchesSelector ||
    Element.prototype.msMatchesSelector ||
    Element.prototype.oMatchesSelector ||
    Element.prototype.webkitMatchesSelector ||
    function(s) {
      var matches = (this.document || this.ownerDocument).querySelectorAll(s);
      var i = matches.length;
      while (--i >= 0 && matches.item(i) !== this) {}
      return i > -1;
    };
}

if (!Element.prototype.closest) {
  Element.prototype.closest = function(s) {
    var el = this;
    do {
      if (Element.prototype.matches.call(el, s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

function createThrottled(fn, delay) {
  var lastCall = 0;
  var scheduled = null;
  return function() {
    var args = arguments;
    var now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(null, args);
    } else {
      if (scheduled) clearTimeout(scheduled);
      scheduled = setTimeout(function() {
        lastCall = Date.now();
        fn.apply(null, args);
      }, delay - (now - lastCall));
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mise à l'échelle du canevas 1920x1200 (#app-shell, index.html)
// La maquette de référence est un fichier figé à 1920x1200px (unités fixes,
// pas de %/vw) — ce script applique un transform:scale() calculé pour que ce
// canevas tienne, centré, dans n'importe quelle fenêtre/écran réel, en
// préservant EXACTEMENT ses proportions (letterboxing si le ratio diffère)
// plutôt que de laisser les valeurs en pixels fixes du chrome se retrouver
// disproportionnées sur une fenêtre plus petite/différente. Sur la
// résolution cible réelle (tablette, 1920x1200), scale=1 : aucun effet.
// ═══════════════════════════════════════════════════════════════════════════
var APP_CANVAS_WIDTH = 1920;
var APP_CANVAS_HEIGHT = 1200;

function applyAppScale() {
  var shell = document.getElementById('app-shell');
  if (!shell) return;
  var scale = Math.min(window.innerWidth / APP_CANVAS_WIDTH, window.innerHeight / APP_CANVAS_HEIGHT);
  var offsetX = (window.innerWidth - APP_CANVAS_WIDTH * scale) / 2;
  var offsetY = (window.innerHeight - APP_CANVAS_HEIGHT * scale) / 2;
  shell.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
}

// Même principe que _APP_META (services/process_monitor.py) — noms alignés
// entre les deux tables pour les applis communes aux deux widgets (Setup).
var PROCESS_NAME_MAP = {
  'firefox': 'Firefox',
  'msedge': 'Microsoft Edge',
  'msedgewebview2': 'Microsoft Edge',
  'chrome': 'Google Chrome',
  'brave': 'Brave',
  'opera': 'Opera',
  'vlc': 'VLC Media Player',
  'spotify': 'Spotify',
  'discord': 'Discord',
  'steam': 'Steam',
  'steamwebhelper': 'Steam',
  'deezer': 'Deezer',
  'obs64': 'OBS Studio',
  'obs32': 'OBS Studio',
  'simhub': 'SimHub',
  'simhub64': 'SimHub',
  'claude': 'Claude',
  'foobar2000': 'foobar2000',
  'mpc-hc': 'MPC-HC',
  'mpc-hc64': 'MPC-HC',
  'wmplayer': 'Windows Media Player',
  'groove': 'Groove Musique'
};

function getDisplayNameForApp(rawName) {
  if (!rawName) return 'Application';
  var cleanName = rawName.replace(/\.exe$/i, '').trim();
  var lower = cleanName.toLowerCase();
  if (PROCESS_NAME_MAP[lower]) {
    return PROCESS_NAME_MAP[lower];
  }
  if (cleanName.length > 2) {
    return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
  }
  return cleanName || rawName;
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

var CONFIG = {
  // Utilise wss:// automatiquement si la page est servie en HTTPS (évite les erreurs mixed-content)
  // Le token (injecté par le serveur dans window.AUTH_TOKEN) authentifie la connexion WebSocket.
  WS_URL: (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws?token=' + encodeURIComponent(window.AUTH_TOKEN || ''),
  WS_RECONNECT_DELAY_BASE: 2000, // ms de base avant reconnexion (croissance exponentielle)
  WS_RECONNECT_DELAY_MAX: 30000, // plafond de la reconnexion
  WS_MAX_RECONNECTS: 20,
  SEARCH_DEBOUNCE: 500,          // ms d'attente après la frappe
};

// ═══════════════════════════════════════════════════════════════════════════
// État global (lecture seule depuis l'extérieur)
// ═══════════════════════════════════════════════════════════════════════════

var State = {
  ws: null,
  reconnectCount: 0,
  reconnectTimer: null,
  mediaState: {},
  // Jeu actuellement "en cours" (mémoire optimiste, pas de détection PC
  // réelle — voir ShortcutsController.launchGame, qui l'alimente, et
  // UI.updateHeaderGame, qui en dérive la notch/le sur-menu du header).
  // { appId, name } ou null si aucun jeu lancé depuis le démarrage de l'app.
  // Nom de champ conservé (steamRunning) malgré la suppression de la
  // détection Steam le 2026-09-14 — renommer toucherait aussi
  // app-ui-core.js et notch-menu.js pour un gain purement cosmétique.
  steamRunning: null,
  currentFilter: 'track',
  searchDebounceTimer: null,
  currentView: 'playlists',
  breadcrumb: [{ label: 'Accueil', view: 'playlists', data: null }],
  originalTracks: [],
  sortedTracks: [],
  tracksContext: {},
  allPlaylists: [],
  playlistsExpanded: false,
  customQueue: null,
  customQueueIndex: 0,
  customQueueActive: false,
  queueTransitionTriggered: false,
  lastPlayInitiatedAt: 0,
  lastRecoveryAttemptAt: 0,
  lastQueueNavigationAt: 0,
  playPlaylistInstantlyOnArrival: null,
  playlistSortMode: 'recent',
};

/**
 * Dégradé de remplissage pour un slider de volume — lilas → violet
 * (même paire que .media-cover-container), pour relier visuellement le
 * volume à l'identité du lecteur média plutôt qu'introduire une couleur
 * de plus. `pct` est le pourcentage rempli (0–100).
 */
function sliderFillBackground(pct) {
  return 'linear-gradient(90deg, #c9c2f2 0%, #8577d9 ' + pct + '%, rgba(255,255,255,0.10) ' + pct + '%, rgba(255,255,255,0.10) 100%)';
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitaires DOM
// ═══════════════════════════════════════════════════════════════════════════

function el(id) { return document.getElementById(id); }

function setText(id, text) {
  var node = el(id);
  if (node) node.textContent = text;
}

function setImg(id, src) {
  var node = el(id);
  if (node && src) { node.src = src; node.style.display = 'block'; }
}

function esc(str) {
  return String(str !== undefined && str !== null ? str : '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  var s = Math.floor(seconds);
  var m = Math.floor(s / 60);
  var rem = s % 60;
  return m + ':' + (rem < 10 ? '0' : '') + rem;
}

function debounce(fn, delay) {
  var timer;
  return function() {
    var context = this;
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() {
      fn.apply(context, args);
    }, delay);
  };
}

// Appliquée tout de suite (le DOM de #app-shell existe déjà : ce script est
// chargé en toute fin de <body>) pour éviter un flash non mis à l'échelle,
// puis réappliquée au redimensionnement (rotation tablette, fenêtre PC).
applyAppScale();
window.addEventListener('resize', createThrottled(applyAppScale, 100));
