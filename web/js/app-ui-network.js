/**
 * Cockpit OS — Rendu UI du widget Réseau (onglet Setup) : cartes Wi-Fi/
 * Bluetooth (clic court = bascule activé/désactivé) et sur-menu étendu
 * (appui long = liste des réseaux/appareils, appui long simulé au clavier
 * inexistant sur tablette donc pointerdown/up avec délai).
 * Étend `UI` par assignation — DOIT être chargé après app-ui-core.js et
 * app-ui-audio.js (réutilise UI.toggleBluetoothPower / .toggleBluetoothDeviceConnection).
 * Bluetooth : données réelles déjà diffusées dans audio.state.bluetooth.
 * Wi-Fi : données réelles diffusées dans wifi.state (services/wifi_service.py).
 */

'use strict';

var NET_LONGPRESS_MS = 450;
var _netCardsInited = false;

function signalBarsHtml(pct) {
  var p = typeof pct === 'number' ? pct : 0;
  var heights = [40, 65, 100];
  var thresholds = [1, 40, 70];
  var html = '<div class="signal-bars">';
  for (var i = 0; i < 3; i++) {
    html += '<span class="' + (p >= thresholds[i] ? 'active' : '') + '" style="height:' + heights[i] + '%;"></span>';
  }
  html += '</div>';
  return html;
}

function renderWifiOverlayColumn(state) {
  var sw = el('net-switch-wifi');
  var list = el('net-list-wifi');
  var enabled = !!(state && state.enabled);
  if (sw) sw.classList.toggle('on', enabled);
  if (!list) return;

  if (!state || state.error) {
    list.innerHTML = '<div class="empty-state"><div class="ic">📶</div><div class="t">Wi-Fi indisponible</div><div class="s">' +
      esc((state && state.error) || 'Adaptateur introuvable') + '</div></div>';
    return;
  }
  if (!enabled) {
    list.innerHTML = '<div class="empty-state"><div class="ic">📶</div><div class="t">Wi-Fi désactivé</div><div class="s">Activez le Wi-Fi pour voir les réseaux à proximité.</div></div>';
    return;
  }
  if (state.location_disabled) {
    list.innerHTML = '<div class="empty-state"><div class="ic">📍</div><div class="t">Réseaux non détectables</div><div class="s">Activez les Services de localisation sur le PC (Confidentialité et sécurité) pour voir les réseaux Wi-Fi à proximité.</div></div>';
    return;
  }
  var networks = state.networks || [];
  if (!networks.length) {
    list.innerHTML = '<div class="empty-state"><div class="ic">📶</div><div class="t">Aucun réseau détecté</div><div class="s">Aucun réseau Wi-Fi à proximité pour le moment.</div></div>';
    return;
  }

  list.innerHTML = networks.map(function(net) {
    var isConnected = !!(state.connected && state.ssid && net.ssid === state.ssid);
    return '<div class="net-list-row" data-ssid="' + esc(net.ssid) + '">' +
      '<div class="name">' + esc(net.ssid) + '</div>' +
      '<div class="meta' + (isConnected ? ' on' : '') + '">' + (isConnected ? 'Connecté' : '') + '</div>' +
      signalBarsHtml(net.signal_pct) +
    '</div>';
  }).join('');

  var rows = list.querySelectorAll('.net-list-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].addEventListener('click', function() {
      var ssid = this.getAttribute('data-ssid');
      if (state.connected && state.ssid === ssid) return; // déjà connecté
      UI.connectWifiNetwork(ssid);
    });
  }
}

function renderBluetoothOverlayColumn(bt) {
  var sw = el('net-switch-bluetooth');
  var list = el('net-list-bluetooth');
  var enabled = !!(bt && bt.enabled);
  if (sw) sw.classList.toggle('on', enabled);
  if (!list) return;

  if (!enabled) {
    list.innerHTML = '<div class="empty-state"><div class="ic">⚡</div><div class="t">Bluetooth désactivé</div><div class="s">Activez le Bluetooth pour voir les appareils appairés.</div></div>';
    return;
  }
  var devices = (bt && bt.devices) || [];
  if (!devices.length) {
    list.innerHTML = '<div class="empty-state"><div class="ic">⚡</div><div class="t">Aucun appareil connu</div><div class="s">Les appareils déjà appairés au PC apparaîtront ici.</div></div>';
    return;
  }

  list.innerHTML = devices.map(function(dev) {
    return '<div class="net-list-row" data-bt-id="' + esc(dev.id) + '" data-connected="' + (dev.connected ? '1' : '0') + '">' +
      '<div class="name">' + esc(dev.name) + '</div>' +
      '<div class="meta' + (dev.connected ? ' on' : '') + '">' + (dev.connected ? 'Connecté' : 'Déconnecté') + '</div>' +
    '</div>';
  }).join('');

  var rows = list.querySelectorAll('.net-list-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].addEventListener('click', function() {
      var id = this.getAttribute('data-bt-id');
      var connected = this.getAttribute('data-connected') === '1';
      UI.toggleBluetoothDeviceConnection(id, !connected);
    });
  }
}

// ── Cartes compactes (grille principale) ────────────────────────────────
UI.updateSetupWifi = function(state) {
  State.wifiState = state;
  var card = el('net-card-wifi');
  if (card) {
    var enabled = !!(state && state.enabled);
    card.classList.toggle('on', enabled);
    var sub = card.querySelector('.s');
    var stateEl = card.querySelector('.state');
    if (!state || state.error) {
      if (sub) sub.textContent = 'Indisponible';
      if (stateEl) stateEl.textContent = '—';
    } else if (!enabled) {
      if (sub) sub.textContent = '';
      if (stateEl) stateEl.textContent = 'Désactivé';
    } else if (state.connected && state.ssid) {
      if (sub) sub.textContent = state.ssid;
      if (stateEl) stateEl.textContent = 'Activé';
    } else {
      if (sub) sub.textContent = state.location_disabled ? 'Réseau non détectable' : 'Non connecté';
      if (stateEl) stateEl.textContent = 'Activé';
    }
  }
  renderWifiOverlayColumn(state);
  initNetCards();
};

UI.updateSetupBluetooth = function(audioState) {
  var bt = (audioState && audioState.bluetooth) || null;
  var card = el('net-card-bluetooth');
  if (card) {
    var enabled = !!(bt && bt.enabled);
    card.classList.toggle('on', enabled);
    var sub = card.querySelector('.s');
    var stateEl = card.querySelector('.state');
    var devices = (bt && bt.devices) || [];
    if (sub) sub.textContent = enabled ? (devices.length ? devices.length + ' appareil' + (devices.length > 1 ? 's' : '') : 'Aucun appareil') : '';
    if (stateEl) stateEl.textContent = enabled ? 'Activé' : 'Désactivé';
  }
  renderBluetoothOverlayColumn(bt);
  initNetCards();
};

// ── Actions ──────────────────────────────────────────────────────────────
UI.toggleWifiPower = function(enabled) {
  send({ type: 'wifi.command', command: 'wifi.toggle', enabled: enabled });
  UI.showToast('Wi-Fi ' + (enabled ? 'activé' : 'désactivé'), 'info');
};

UI.connectWifiNetwork = function(ssid) {
  send({ type: 'wifi.command', command: 'wifi.connect', ssid: ssid });
  UI.showToast('Connexion à ' + ssid + '…', 'info');
};

UI.openNetOverlay = function() {
  var overlay = el('net-overlay');
  if (overlay) overlay.classList.add('is-open');
};

UI.closeNetOverlay = function() {
  var overlay = el('net-overlay');
  if (overlay) overlay.classList.remove('is-open');
};

// ── Cartes : clic court = bascule, appui long = sur-menu étendu ─────────
function initNetCards() {
  if (_netCardsInited) return;
  var wifiCard = el('net-card-wifi');
  var btCard = el('net-card-bluetooth');
  var overlay = el('net-overlay');
  if (!wifiCard || !btCard || !overlay) return; // setup.html pas encore injecté, réessaiera au prochain état
  _netCardsInited = true;

  [wifiCard, btCard].forEach(function(card) {
    var pressTimer = null;
    var longPressed = false;

    function clearTimer() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    card.addEventListener('pointerdown', function() {
      longPressed = false;
      clearTimer();
      pressTimer = setTimeout(function() {
        longPressed = true;
        UI.openNetOverlay();
      }, NET_LONGPRESS_MS);
    });

    card.addEventListener('pointerup', function() {
      clearTimer();
      if (longPressed) return; // l'appui long a déjà ouvert le sur-menu
      if (card === wifiCard) {
        UI.toggleWifiPower(!card.classList.contains('on'));
      } else {
        UI.toggleBluetoothPower(!card.classList.contains('on'));
      }
    });

    card.addEventListener('pointerleave', clearTimer);
    card.addEventListener('pointercancel', clearTimer);
    card.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  });

  var closeBtn = el('net-overlay-close');
  if (closeBtn) closeBtn.addEventListener('click', UI.closeNetOverlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) UI.closeNetOverlay();
  });

  var swWifi = el('net-switch-wifi');
  if (swWifi) swWifi.addEventListener('click', function() {
    UI.toggleWifiPower(!swWifi.classList.contains('on'));
  });
  var swBt = el('net-switch-bluetooth');
  if (swBt) swBt.addEventListener('click', function() {
    UI.toggleBluetoothPower(!swBt.classList.contains('on'));
  });
}
