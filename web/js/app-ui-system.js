/**
 * Cockpit OS — Rendu UI du panneau Système (onglet Setup).
 * Étend `UI` par assignation — DOIT être chargé après app-ui-core.js.
 * Dépend de app-core.js (el()) et app-ws.js (State).
 *
 * Mise à jour incrémentale (pas de réinjection complète du DOM à chaque
 * tick, ~1x/s) : chaque composant garde sa ligne, on ne réécrit que le
 * texte/la largeur de barre/les points du sparkline — coût minimal pour le
 * SoC modeste de la Tab A8.
 */

'use strict';

UI._systemPanelInitialized = false;

// Convertit un historique de valeurs (0-100) en liste de points SVG pour un
// viewBox 100x58, avec une petite marge haut/bas pour ne jamais clipper la
// ligne pile sur les bords.
function buildSparklinePoints(history) {
  history = history || [];
  if (!history.length) return '';
  var n = history.length;
  var step = n > 1 ? 100 / (n - 1) : 0;
  var pts = [];
  for (var i = 0; i < n; i++) {
    var v = Math.max(0, Math.min(100, history[i] || 0));
    var x = i * step;
    var y = 54 - (v / 100) * 50;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return pts.join(' ');
}

UI.updateSystemPanel = function(state) {
  var container = el('sys-list');
  if (!container) return;
  initDetailBack();

  if (!state || state.error) {
    container.innerHTML = '<div class="rc-status-msg">' +
      (state && state.error ? esc(state.error) : 'État système indisponible') +
      '</div>';
    UI._systemPanelInitialized = false;
    return;
  }

  var components = state.components || [];

  // Vide le contenu d'exemple de la maquette (ou un précédent message
  // d'erreur) une seule fois, au tout premier état système réel reçu.
  if (!UI._systemPanelInitialized) {
    container.innerHTML = '';
    UI._systemPanelInitialized = true;
  }

  if (!components.length) {
    container.innerHTML = '<div class="rc-status-msg">Aucun composant détecté</div>';
    return;
  }

  var seenIds = {};
  components.forEach(function(comp) {
    seenIds[comp.id] = true;
    var row = document.getElementById('sys-row-' + comp.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'sys-row';
      row.id = 'sys-row-' + comp.id;
      row.setAttribute('data-sys-id', comp.id);
      row.addEventListener('click', function() {
        // Re-taper la ligne déjà sélectionnée referme le sur-menu (bascule),
        // plutôt que de forcer à passer par "‹ Retour".
        if (UI._openDetailId === comp.id) {
          UI.closeComponentDetail();
        } else {
          UI.openComponentDetail(comp.id);
        }
      });
      row.innerHTML =
        '<div class="sys-graph"><svg viewBox="0 0 100 58" preserveAspectRatio="none"><polyline fill="none" stroke-width="2.5"/></svg></div>' +
        '<div class="sys-body">' +
          '<div class="sys-name"></div>' +
          '<div class="sys-sub"></div>' +
          '<div class="sys-bar"><div class="sys-bar-fill"></div></div>' +
        '</div>' +
        '<div class="sys-chevron">›</div>';
      container.appendChild(row);
    }

    var nameEl = row.querySelector('.sys-name');
    var subEl = row.querySelector('.sys-sub');
    var fillEl = row.querySelector('.sys-bar-fill');
    var polyEl = row.querySelector('polyline');

    if (nameEl.textContent !== comp.name) nameEl.textContent = comp.name;
    if (subEl.textContent !== comp.sub) subEl.textContent = comp.sub;
    fillEl.style.width = Math.max(0, Math.min(100, comp.percent || 0)) + '%';
    fillEl.style.background = comp.color;
    polyEl.setAttribute('stroke', comp.color);
    polyEl.setAttribute('points', buildSparklinePoints(comp.history));
  });

  // Retire les lignes des composants disparus (disque démonté, GPU perdu...)
  var existingRows = container.querySelectorAll('.sys-row[data-sys-id]');
  for (var i = 0; i < existingRows.length; i++) {
    var id = existingRows[i].getAttribute('data-sys-id');
    if (!seenIds[id]) existingRows[i].remove();
  }

  updateSelectedRowHighlight();

  // Vue détaillée ouverte : la garder à jour en direct sur chaque nouvel
  // état système (mêmes sparklines/valeurs que le reste de l'onglet).
  if (UI._openDetailId) {
    renderComponentDetail(UI._openDetailId, state);
  }
};

// Surligne la ligne du panneau Système dont le composant est actuellement
// affiché dans le sur-menu détaillé — retirée de toutes les autres.
function updateSelectedRowHighlight() {
  var container = el('sys-list');
  if (!container) return;
  var rows = container.querySelectorAll('.sys-row[data-sys-id]');
  for (var i = 0; i < rows.length; i++) {
    var isSelected = rows[i].getAttribute('data-sys-id') === UI._openDetailId;
    rows[i].classList.toggle('is-selected', isSelected);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue détaillée d'un composant Système (étape 6)
// ═══════════════════════════════════════════════════════════════════════════

UI._openDetailId = null;

function formatUptime(seconds) {
  if (typeof seconds !== 'number') return '—';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return h + ':' + pad(m) + ':' + pad(s);
}

function formatGhz(v) {
  return (typeof v === 'number') ? (v.toFixed(2).replace('.', ',') + ' GHz') : '—';
}

function detailStatHtml(label, value) {
  return '<div class="detail-stat"><div class="l">' + esc(label) + '</div><div class="v">' + esc(value) + '</div></div>';
}

function specRowHtml(label, value) {
  return '<div class="spec-row"><span class="l">' + esc(label) + '</span><span class="v">' + esc(value) + '</span></div>';
}

// Construit (une seule fois) puis met à jour en place un graphique en aire
// remplie + ligne (beaucoup plus lisible qu'une grille de mini-sparklines
// par sous-unité, cf. retour utilisateur — la grille par cœur logique a été
// essayée puis abandonnée). Mise à jour "en place" comme le reste du
// panneau Système : pas de reconstruction du SVG à chaque tick.
function ensureDetailGraphSvg() {
  var container = el('detail-graph');
  if (!container) return null;
  if (!container.querySelector('svg')) {
    container.innerHTML =
      '<svg viewBox="0 0 100 58" preserveAspectRatio="none">' +
        '<defs><linearGradient id="detail-graph-fill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-opacity="0.5"/>' +
          '<stop offset="100%" stop-opacity="0.04"/>' +
        '</linearGradient></defs>' +
        '<polygon fill="url(#detail-graph-fill)" stroke="none"/>' +
        '<polyline fill="none" stroke-width="1.8"/>' +
      '</svg>';
  }
  return container;
}

function updateDetailGraph(history, color) {
  var container = ensureDetailGraphSvg();
  if (!container) return;
  var pts = buildSparklinePoints(history);
  var stops = container.querySelectorAll('stop');
  for (var i = 0; i < stops.length; i++) stops[i].setAttribute('stop-color', color);

  var polyline = container.querySelector('polyline');
  polyline.setAttribute('stroke', color);
  polyline.setAttribute('points', pts);

  var polygon = container.querySelector('polygon');
  if (!pts) {
    polygon.setAttribute('points', '');
    return;
  }
  var parts = pts.split(' ');
  var firstX = parts[0].split(',')[0];
  var lastX = parts[parts.length - 1].split(',')[0];
  polygon.setAttribute('points', pts + ' ' + lastX + ',58 ' + firstX + ',58');
}

function renderComponentDetail(componentId, state) {
  var comp = null;
  var components = (state && state.components) || [];
  for (var i = 0; i < components.length; i++) {
    if (components[i].id === componentId) { comp = components[i]; break; }
  }

  // Composant disparu (disque démonté, GPU perdu...) pendant que sa vue
  // détaillée était ouverte : on ne peut plus rien y afficher de réel,
  // retour à la vue normale plutôt que de laisser des données figées.
  if (!comp) {
    UI.closeComponentDetail();
    return;
  }

  var titleEl = el('detail-title');
  var modelEl = el('detail-model');
  var statsEl = el('detail-stats');
  var specsEl = el('detail-specs');
  if (!titleEl) return; // setup.html pas encore injecté

  if (titleEl.textContent !== comp.name) titleEl.textContent = comp.name;
  updateDetailGraph(comp.history, comp.color);

  var detail = comp.detail;

  if (detail) {
    // ── Processeur : seul composant avec des specs matérielles exactes
    // (WMI, voir system_monitor.py) — les autres retombent sur le cas
    // générique ci-dessous, sans rien inventer. ─────────────────────────
    if (modelEl) modelEl.textContent = detail.model || '';
    if (statsEl) {
      statsEl.innerHTML =
        detailStatHtml('Utilisation', Math.round(comp.percent) + '%') +
        detailStatHtml('Vitesse', formatGhz(detail.current_ghz)) +
        detailStatHtml('Processus', (detail.processes != null ? detail.processes : '—')) +
        detailStatHtml('Threads', (detail.threads != null ? detail.threads : '—')) +
        detailStatHtml('Durée', formatUptime(detail.uptime_s));
    }
    if (specsEl) {
      var specs = detail.specs || {};
      specsEl.innerHTML =
        specRowHtml('Vitesse de base', formatGhz(specs.base_ghz)) +
        specRowHtml('Cœurs', specs.cores != null ? specs.cores : '—') +
        specRowHtml('Processeurs logiques', specs.logical_processors != null ? specs.logical_processors : '—') +
        specRowHtml('Virtualisation', specs.virtualization === true ? 'Activée' : (specs.virtualization === false ? 'Désactivée' : '—')) +
        specRowHtml('Cache L2', specs.l2_cache_mb != null ? (specs.l2_cache_mb + ' Mo') : '—') +
        specRowHtml('Cache L3', specs.l3_cache_mb != null ? (specs.l3_cache_mb + ' Mo') : '—');
    }
    return;
  }

  // ── Composant sans specs matérielles disponibles pour l'instant
  // (Mémoire/Disque/Wi-Fi/GPU) — plutôt que d'inventer des specs. ────────
  if (modelEl) modelEl.textContent = '';
  if (statsEl) {
    statsEl.innerHTML =
      detailStatHtml('Utilisation', Math.round(comp.percent) + '%') +
      detailStatHtml('Détail', comp.sub);
  }
  if (specsEl) specsEl.innerHTML = '';
}

UI.openComponentDetail = function(componentId) {
  UI._openDetailId = componentId;
  var panel = el('setup-detail');
  if (panel) panel.classList.add('is-open');
  updateSelectedRowHighlight();
  renderComponentDetail(componentId, State.systemState);
};

UI.closeComponentDetail = function() {
  UI._openDetailId = null;
  var panel = el('setup-detail');
  if (panel) panel.classList.remove('is-open');
  updateSelectedRowHighlight();
};

// Bouton "‹ Retour" — écouteur posé une seule fois, l'élément vit dans
// setup.html (injecté par loadTabs) donc pas garanti présent au chargement
// de ce script ; on réessaie via le prochain rendu du panneau Système
// (comme initNetCards/initAppsSwipe, même principe dans ce fichier).
UI._detailBackInited = false;
function initDetailBack() {
  if (UI._detailBackInited) return;
  var backBtn = el('detail-back');
  if (!backBtn) return;
  UI._detailBackInited = true;
  backBtn.addEventListener('click', UI.closeComponentDetail);
}

// ═══════════════════════════════════════════════════════════════════════════
// Applications ouvertes — grille paginée (étape 3)
// ═══════════════════════════════════════════════════════════════════════════

var APPS_PAGE_SIZE = 6; // grille 3x2, cf. maquette
UI._appsList = [];
UI._appsPage = 0;
UI._appsGridInitialized = false;

function setupAuthFetch(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = 'Bearer ' + (window.AUTH_TOKEN || '');
  return fetch(url, opts);
}

function fmtNum(n, decimals) {
  return n.toFixed(decimals).replace('.', ',');
}

function renderAppDots(pageCount, currentPage) {
  var pager = el('app-dots');
  if (!pager) return;
  if (pageCount <= 1) {
    pager.innerHTML = '';
    return;
  }
  var html = '';
  for (var i = 0; i < pageCount; i++) {
    html += '<div class="d' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '"></div>';
  }
  pager.innerHTML = html;
  var dots = pager.querySelectorAll('.d');
  for (var j = 0; j < dots.length; j++) {
    dots[j].addEventListener('click', (function(pageIndex) {
      return function() {
        var dir = pageIndex > UI._appsPage ? 'next' : 'prev';
        UI._appsPage = pageIndex;
        renderAppsPage(dir);
      };
    })(j));
  }
}

function appsPageCount() {
  return Math.max(1, Math.ceil(UI._appsList.length / APPS_PAGE_SIZE));
}

// direction : 'next'/'prev', pilote le sens de la transition d'entrée
// (.app-grid.is-sliding-*, setup.css) ; omis au premier rendu ou lors d'un
// simple rafraîchissement périodique (pas de transition à jouer depuis rien
// ni à chaque tick de 2s). Même mécanique que shortcuts.js::renderGamesPage.
function renderAppsPage(direction) {
  var container = el('app-grid');
  if (!container) return;

  var total = UI._appsList.length;
  if (total === 0) {
    container.innerHTML = '<div class="rc-status-msg">Aucune application détectée</div>';
    renderAppDots(0, 0);
    return;
  }

  var pageCount = Math.max(1, Math.ceil(total / APPS_PAGE_SIZE));
  UI._appsPage = Math.max(0, Math.min(UI._appsPage, pageCount - 1));
  var start = UI._appsPage * APPS_PAGE_SIZE;
  var pageApps = UI._appsList.slice(start, start + APPS_PAGE_SIZE);

  var html = '';
  for (var i = 0; i < pageApps.length; i++) {
    var app = pageApps[i];
    var diskVal = (app.disk_mb_s === null || app.disk_mb_s === undefined) ? '—' : fmtNum(app.disk_mb_s, 1) + ' Mo/s';
    var netVal = (app.net_mb_s === null || app.net_mb_s === undefined) ? '—' : fmtNum(app.net_mb_s, 1) + ' Mb/s';
    html +=
      '<div class="app-card">' +
        '<div class="app-card-left"><span class="ic">' + esc(app.icon) + '</span><span class="name">' + esc(app.name) + '</span></div>' +
        '<div class="app-card-right">' +
          '<div class="app-table">' +
            '<div class="app-stat"><span class="lbl">CPU</span><span class="val">' + fmtNum(app.cpu_pct, 1) + '%</span></div>' +
            '<div class="app-stat"><span class="lbl">RAM</span><span class="val">' + app.mem_mb.toFixed(0) + ' Mo</span></div>' +
            '<div class="app-stat"><span class="lbl">Disque</span><span class="val">' + diskVal + '</span></div>' +
            '<div class="app-stat"><span class="lbl">Réseau</span><span class="val">' + netVal + '</span></div>' +
          '</div>' +
          '<div class="close-badge" data-pid="' + app.pid + '" data-name="' + esc(app.name) + '">✕ Fermer l\'app</div>' +
        '</div>' +
      '</div>';
  }
  container.innerHTML = html;

  var badges = container.querySelectorAll('.close-badge');
  for (var k = 0; k < badges.length; k++) {
    badges[k].addEventListener('click', function() {
      UI.confirmCloseApp(parseInt(this.getAttribute('data-pid'), 10), this.getAttribute('data-name'));
    });
  }

  if (direction) {
    container.classList.add('is-sliding-' + direction);
    void container.offsetWidth;
    container.classList.remove('is-sliding-next', 'is-sliding-prev');
  }

  renderAppDots(pageCount, UI._appsPage);
  initAppsSwipe();
}

// --- Swipe/balayage tactile entre pages (mêmes principes que
// shortcuts.js::initGamesSwipe — Pointer Events, un seul chemin de code
// souris/tactile, résistance légère en bout de piste, clic consommé après
// un swipe pour ne pas déclencher "Fermer l'app" sous le doigt). ---
var appsSwipeInited = false;
var appsSwipe = { active: false, moved: false, startX: 0, startY: 0, pointerId: null };
var appsSwipeConsumeNextClick = false;
var APPS_SWIPE_THRESHOLD = 40; // px de déplacement horizontal avant de compter comme un swipe

function initAppsSwipe() {
  if (appsSwipeInited) return;
  var grid = el('app-grid');
  if (!grid) return;
  appsSwipeInited = true;

  grid.addEventListener('pointerdown', function(e) {
    if (appsSwipe.active || !e.isPrimary) return;
    appsSwipe.active = true;
    appsSwipe.moved = false;
    appsSwipe.startX = e.clientX;
    appsSwipe.startY = e.clientY;
    appsSwipe.pointerId = e.pointerId;
  });

  grid.addEventListener('pointermove', function(e) {
    if (!appsSwipe.active || e.pointerId !== appsSwipe.pointerId) return;
    var dx = e.clientX - appsSwipe.startX;
    var dy = e.clientY - appsSwipe.startY;
    if (!appsSwipe.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    appsSwipe.moved = true;
    var atStart = UI._appsPage === 0 && dx > 0;
    var atEnd = UI._appsPage === appsPageCount() - 1 && dx < 0;
    var followed = (atStart || atEnd) ? dx * 0.35 : dx;
    grid.classList.add('is-dragging');
    grid.style.transform = 'translateX(' + followed + 'px)';
  });

  function endSwipe(e) {
    if (!appsSwipe.active || (e && e.pointerId !== appsSwipe.pointerId)) return;
    var dx = e ? (e.clientX - appsSwipe.startX) : 0;
    var wasMoved = appsSwipe.moved;
    appsSwipe.active = false;
    appsSwipe.moved = false;
    grid.classList.remove('is-dragging');
    grid.style.transform = '';

    if (!wasMoved) return;

    appsSwipeConsumeNextClick = true;

    var pageCount = appsPageCount();
    if (dx <= -APPS_SWIPE_THRESHOLD && UI._appsPage < pageCount - 1) {
      UI._appsPage += 1;
      renderAppsPage('next');
    } else if (dx >= APPS_SWIPE_THRESHOLD && UI._appsPage > 0) {
      UI._appsPage -= 1;
      renderAppsPage('prev');
    }
    // Sinon : le retrait du transform inline ci-dessus suffit, la
    // transition normale de .app-grid (280ms) fait revenir en place.
  }

  grid.addEventListener('pointerup', endSwipe);
  grid.addEventListener('pointercancel', endSwipe);

  grid.addEventListener('click', function(e) {
    if (appsSwipeConsumeNextClick) {
      appsSwipeConsumeNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

UI.updateAppsGrid = function(state) {
  var container = el('app-grid');
  if (!container) return;

  if (!state || state.error) {
    container.innerHTML = '<div class="rc-status-msg">' + (state && state.error ? esc(state.error) : 'Applications indisponibles') + '</div>';
    renderAppDots(0, 0);
    UI._appsGridInitialized = false;
    return;
  }

  UI._appsGridInitialized = true;
  UI._appsList = state.apps || [];
  renderAppsPage();
};

// --- Confirmation de fermeture d'application (modale dédiée Setup) ---
// Composant visuel identique à la confirmation d'actions système de
// l'onglet Raccourcis (voir web/tabs/setup.html pour l'explication du choix
// d'une modale dupliquée plutôt que partagée entre onglets).
UI.confirmCloseApp = function(pid, appName) {
  var titleEl = el('setup-modal-title');
  var subtitleEl = el('setup-modal-subtitle');
  var confirmBtn = el('setup-modal-confirm-btn');

  if (titleEl) titleEl.textContent = 'Fermer ' + appName + ' ?';
  if (subtitleEl) subtitleEl.textContent = 'Toute donnée non enregistrée dans ' + appName + ' sera perdue.';

  var modal = el('setup-confirm-modal');
  if (modal) modal.classList.add('is-open');

  if (confirmBtn) {
    confirmBtn.onclick = function() {
      UI.closeSetupModal();
      // Pas de toast dédié ici (celui de Raccourcis est scopé à cet onglet,
      // invisible depuis Setup, cf. commentaire de la modale dans
      // setup.html) — la carte disparaît de la grille au prochain tick une
      // fois l'app réellement fermée, ce qui sert de confirmation visuelle.
      setupAuthFetch('/setup/apps/close/' + pid, { method: 'POST' })
        .catch(function(err) {
          console.warn('[Setup] Échec de la fermeture de ' + appName + ' :', err);
        });
    };
  }
};

UI.closeSetupModal = function() {
  var modal = el('setup-confirm-modal');
  if (modal) modal.classList.remove('is-open');
};
