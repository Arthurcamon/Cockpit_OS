/**
 * Cockpit OS — Rendu UI mixeur audio (applications, périphériques) et Bluetooth.
 * Étend `UI` par assignation — DOIT être chargé après app-ui-core.js.
 * Dépend de app-core.js et app-commands.js (Media).
 */

'use strict';

// ── Applications audio & Mixeur Volume ─────────────────────────────────────
UI.updateAudioApps = function(state) {
  var container = el('audio-apps-list');
  var masterVol = state.master_volume !== undefined ? Math.round(state.master_volume * 100) : 100;
  var masterMuted = !!state.muted;
  var activeEl = document.activeElement;

  if (typeof appMutes !== 'undefined') {
    appMutes['master'] = masterMuted;
  }

  // Toujours synchroniser le bouton Mute principal du lecteur média et de l'onglet Endurance
  var btnMaster = el('vol-mute-master');
  if (btnMaster) btnMaster.classList.toggle('muted', masterMuted);
  var btnMedia = el('media-mute');
  if (btnMedia) btnMedia.classList.toggle('muted', masterMuted);

  // Toujours synchroniser le slider de volume principal du lecteur média
  var mediaTabSlider = el('media-tab-volume-slider');
  if (mediaTabSlider && activeEl !== mediaTabSlider) {
    mediaTabSlider.value = masterVol;
    mediaTabSlider.style.setProperty('background', sliderFillBackground(masterVol), 'important');
  }

  // Toujours synchroniser le slider Général de l'onglet Endurance
  var enduranceMasterSlider = el('vol-slider-master');
  var enduranceMasterText = el('vol-val-master');
  if (enduranceMasterSlider && activeEl !== enduranceMasterSlider) {
    enduranceMasterSlider.value = masterVol;
    enduranceMasterSlider.style.setProperty('background', sliderFillBackground(masterVol), 'important');
  }
  if (enduranceMasterText) {
    enduranceMasterText.textContent = masterVol + '%';
  }
  if (typeof appVolumes !== 'undefined') {
    appVolumes['master'] = masterVol;
  }

  // Synchroniser les canaux spécifiques (Musique, Vocal, Jeu) depuis la liste des applications
  var rawAppsList = state.applications || [];
  rawAppsList.forEach(function(appItem) {
    if (!appItem || !appItem.name) return;
    var nm = String(appItem.name).toLowerCase();
    var avol = Math.round((appItem.volume || 0) * 100);
    var amuted = !!appItem.muted;
    var targetKey = null;

    if (nm.indexOf('deezer') !== -1 || nm.indexOf('spotify') !== -1 || nm === 'musique') targetKey = 'musique';
    else if (nm.indexOf('discord') !== -1 || nm === 'vocal') targetKey = 'vocal';
    else if (nm === 'jeu' || nm === 'simu') targetKey = 'jeu';

    if (targetKey) {
      if (typeof appVolumes !== 'undefined') appVolumes[targetKey] = avol;
      if (typeof appMutes !== 'undefined') appMutes[targetKey] = amuted;

      var endSlider = el('vol-slider-' + targetKey);
      var endText = el('vol-val-' + targetKey);
      var endMute = el('vol-mute-' + targetKey);

      if (endSlider && activeEl !== endSlider) {
        endSlider.value = avol;
        endSlider.style.setProperty('background', sliderFillBackground(avol), 'important');
      }
      if (endText) endText.textContent = avol + '%';
      if (endMute) endMute.classList.toggle('muted', amuted);
    }
  });

  if (!container) return;

  var rawApps = state.applications || [];

  // Filtrer les entrées système & dédupliquer par nom d'application (ex: 1 seule entrée Deezer / Chrome)
  var excludedNames = ['system', 'system audio', 'windows audio', 'audiodg', 'idle', 'host', 'volume principal'];
  var seenNames = {};
  var apps = [];

  rawApps.forEach(function(app) {
    if (!app || !app.name) return;
    var nameLower = String(app.name).trim().toLowerCase();
    if (excludedNames.indexOf(nameLower) !== -1) return;
    if (seenNames[nameLower]) return;
    seenNames[nameLower] = true;
    apps.push(app);
  });

  var appItems = container.querySelectorAll('.audio-app-item-modern');

  // Mettre à jour sur place si la structure DOM existe déjà
  if (appItems.length === apps.length && appItems.length > 0) {
    apps.forEach(function(app) {
      var slider = container.querySelector('.audio-app-slider-modern[data-pid="' + app.pid + '"]');
      if (slider && activeEl !== slider) {
        var vol = Math.round((app.volume || 0) * 100);
        slider.value = vol;
        var wrapper = slider.closest('.app-item-slider-wrapper');
        if (wrapper) {
          var valLabel = wrapper.querySelector('.audio-app-value-modern');
          if (valLabel) valLabel.textContent = vol + '%';
        }
        slider.style.setProperty('background', sliderFillBackground(vol), 'important');
      }
      var muteBtn = container.querySelector('.audio-app-mute-btn[data-pid="' + app.pid + '"]');
      if (muteBtn) {
        muteBtn.classList.toggle('muted', !!app.muted);
      }
    });
    return;
  }

  container.innerHTML = '';

  // Fonctions d'envoi réseau limitées en fréquence (40ms) pour une glissière 100% fluide
  if (!window._sendMasterVolThrottled) {
    window._sendMasterVolThrottled = createThrottled(function(vol) {
      Media.setVolume(vol);
    }, 40);
  }
  if (!window._sendAppVolThrottled) {
    window._sendAppVolThrottled = createThrottled(function(pid, appName, vol) {
      send({
        type: 'audio.command',
        command: 'audio.app.volume.set',
        pid: pid,
        name: appName,
        value: vol / 100,
      });
    }, 40);
  }

  // Applications Audio uniquement
  if (!apps.length) {
    var emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-state';
    emptyMsg.textContent = 'Aucune application audio active';
    container.appendChild(emptyMsg);
    return;
  }

  apps.forEach(function(app) {
    var div = document.createElement('div');
    div.className = 'audio-app-item-modern fade-in';
    var vol = Math.round((app.volume || 0) * 100);

    var icon = '🔊';
    var nameLower = (app.name || '').toLowerCase();
    if (nameLower.indexOf('spotify') !== -1) icon = '🎵';
    else if (nameLower.indexOf('deezer') !== -1) icon = '🎧';
    else if (nameLower.indexOf('chrome') !== -1 || nameLower.indexOf('edge') !== -1 || nameLower.indexOf('firefox') !== -1) icon = '🌐';
    else if (nameLower.indexOf('vlc') !== -1) icon = '🍊';
    else if (nameLower.indexOf('discord') !== -1) icon = '💬';

    div.innerHTML =
      '<div class="app-item-info">' +
        '<button class="sim-mixer-icon-btn audio-app-mute-btn ' + (app.muted ? 'muted' : '') + '" data-pid="' + app.pid + '" title="Mute/Démute ' + esc(app.name) + '" style="width:36px!important;height:36px!important;min-width:36px!important;border-radius:50%!important;padding:0;margin-right:6px;">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px!important;height:18px!important;">' +
            '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>' +
          '</svg>' +
        '</button>' +
        '<span class="app-item-icon">' + icon + '</span>' +
        '<span class="audio-app-name-modern">' + esc(getDisplayNameForApp(app.name)) + '</span>' +
      '</div>' +
      '<div class="app-item-slider-wrapper">' +
        '<input type="range" class="audio-app-slider-modern" data-pid="' + app.pid + '" min="0" max="100" value="' + vol + '" />' +
        '<span class="audio-app-value-modern font-mono-value">' + vol + '%</span>' +
      '</div>';

    var slider = div.querySelector('.audio-app-slider-modern');
    var valLabel = div.querySelector('.audio-app-value-modern');
    var appMuteBtn = div.querySelector('.audio-app-mute-btn');

    if (appMuteBtn) {
      appMuteBtn.addEventListener('click', function() {
        var isCurrentlyMuted = appMuteBtn.classList.contains('muted');
        var targetMuted = !isCurrentlyMuted;
        appMuteBtn.classList.toggle('muted', targetMuted);
        send({
          type: 'audio.command',
          command: 'audio.app.mute.toggle',
          pid: app.pid,
          name: app.name,
          muted: targetMuted
        });
      });
    }

    function updateSliderBg() {
      var v = parseFloat(slider.value) || 0;
      slider.style.setProperty('background', sliderFillBackground(v), 'important');
    }
    updateSliderBg();

    slider.addEventListener('input', function() {
      updateSliderBg();
      valLabel.textContent = slider.value + '%';
      window._sendAppVolThrottled(app.pid, app.name, parseInt(slider.value, 10));
    });

    container.appendChild(div);
  });
};

// ── Périphériques Audio (Sortie & Entrée) ────────────────────────────────
UI.updateAudioDevices = function(state) {
  if (!state) return;

  var outputs = state.output_devices || [];
  var inputs = state.input_devices || [];

  var outContainer = el('audio-output-devices');
  if (outContainer) {
    outContainer.innerHTML = '';
    if (!outputs.length) {
      outContainer.innerHTML = '<span class="empty-state" style="padding:4px;font-size:12px;">Aucun périphérique de sortie</span>';
    } else {
      outputs.forEach(function(dev) {
        var button = document.createElement('button');
        button.className = 'device-pill' + (dev.active ? ' device-pill--active' : '');
        button.setAttribute('data-id', dev.id);
        button.innerHTML = (dev.icon || '🔊') + ' ' + esc(dev.name) + (dev.active ? ' <span class="active-badge" style="font-size:10px;opacity:0.8;margin-left:4px;">(Actif)</span>' : '');
        button.title = "Cliquer pour définir comme périphérique par défaut";
        button.addEventListener('click', function() {
          UI.selectAudioDevice(dev.id, 'output');
        });
        outContainer.appendChild(button);
      });
    }
  }

  var inContainer = el('audio-input-devices');
  if (inContainer) {
    inContainer.innerHTML = '';
    if (!inputs.length) {
      inContainer.innerHTML = '<span class="empty-state" style="padding:4px;font-size:12px;">Aucun périphérique d\'entrée</span>';
    } else {
      inputs.forEach(function(dev) {
        var button = document.createElement('button');
        button.className = 'device-pill' + (dev.active ? ' device-pill--active' : '');
        button.setAttribute('data-id', dev.id);
        button.innerHTML = (dev.icon || '🎙️') + ' ' + esc(dev.name) + (dev.active ? ' <span class="active-badge" style="font-size:10px;opacity:0.8;margin-left:4px;">(Actif)</span>' : '');
        button.title = "Cliquer pour définir comme périphérique par défaut";
        button.addEventListener('click', function() {
          UI.selectAudioDevice(dev.id, 'input');
        });
        inContainer.appendChild(button);
      });
    }
  }
};

UI.selectAudioDevice = function(deviceId, direction) {
  var containerId = direction === 'output' ? 'audio-output-devices' : 'audio-input-devices';
  var container = el(containerId);
  if (container) {
    var pills = container.querySelectorAll('.device-pill');
    pills.forEach(function(pill) {
      var isTarget = pill.getAttribute('data-id') === deviceId;
      pill.classList.toggle('device-pill--active', isTarget);
      var badge = pill.querySelector('.active-badge');
      if (isTarget) {
        if (!badge) {
          var bSpan = document.createElement('span');
          bSpan.className = 'active-badge';
          bSpan.style.cssText = 'font-size:10px;opacity:0.8;margin-left:4px;';
          bSpan.textContent = '(Actif)';
          pill.appendChild(bSpan);
        }
      } else {
        if (badge) badge.remove();
      }
    });
  }
  send({
    type: 'audio.command',
    command: 'audio.device.set_default',
    device_id: deviceId,
    direction: direction
  });
  UI.showToast("Périphérique " + (direction === 'output' ? 'de sortie' : 'd\'entrée') + " sélectionné", "info");
};

// ── Options & Gestion Bluetooth ──────────────────────────────────────────
UI.updateBluetooth = function(state) {
  if (!state || !state.bluetooth) return;
  var bt = state.bluetooth;
  var isEnabled = !!bt.enabled;
  var rawDevices = bt.devices || [];

  // Seuls les éléments déjà connus / appairés par l'ordinateur
  var devices = rawDevices.filter(function(dev) {
    return dev && dev.paired !== false;
  });

  // Dédupliquer les sous-protocoles/transports ayant le même nom nettoyé
  var seenNames = {};
  var uniqueDevices = [];
  devices.forEach(function(dev) {
    var normName = (dev.name || '').toLowerCase().trim();
    if (!seenNames[normName]) {
      seenNames[normName] = dev;
      uniqueDevices.push(dev);
    } else {
      // Si une entrée avec le même nom est connectée, mettre à jour le statut global
      if (dev.connected) {
        seenNames[normName].connected = true;
        seenNames[normName].id = dev.id;
      }
    }
  });
  devices = uniqueDevices;

  // Trier la liste pour placer les appareils CONNECTÉS EN PREMIER
  devices.sort(function(a, b) {
    if (a.connected && !b.connected) return -1;
    if (!a.connected && b.connected) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  var badge = el('bluetooth-status-badge');
  if (badge) {
    badge.textContent = isEnabled ? 'Activé' : 'Désactivé';
    badge.className = 'bluetooth-status-badge' + (isEnabled ? '' : ' bluetooth-status-badge--disabled');
  }

  var toggle = el('bluetooth-power-toggle');
  if (toggle && document.activeElement !== toggle) {
    toggle.checked = isEnabled;
  }

  var container = el('bluetooth-devices-list');
  if (!container) return;

  container.innerHTML = '';

  if (!isEnabled) {
    container.innerHTML = '<p class="empty-state" style="padding:16px 0;">Le Bluetooth est désactivé</p>';
    return;
  }

  if (!devices.length) {
    container.innerHTML = '<p class="empty-state" style="padding:16px 0;">Aucun appareil Bluetooth connu</p>';
    return;
  }

  devices.forEach(function(dev) {
    var item = document.createElement('div');
    item.className = 'bluetooth-item' + (dev.connected ? ' bluetooth-item--active' : '');
    item.setAttribute('data-bt-id', dev.id);

    var icon = dev.icon || '📶';
    var statusText = dev.connected ? 'Connecté' : (dev.paired ? 'Appairé' : 'Non connecté');
    var batteryText = dev.battery !== null && dev.battery !== undefined ? '🔋 ' + dev.battery + '%' : '';

    item.innerHTML =
      '<span class="bluetooth-item__icon">' + icon + '</span>' +
      '<div class="bluetooth-item__info">' +
        '<span class="bluetooth-item__name">' + esc(dev.name) + '</span>' +
        '<div class="bluetooth-item__meta">' +
          '<span class="bt-status-label">' + statusText + '</span>' +
          (batteryText ? '<span class="bluetooth-item__battery">' + batteryText + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<button class="bluetooth-item__btn ' + (dev.connected ? 'bluetooth-item__btn--disconnect' : 'bluetooth-item__btn--connect') + '">' +
        (dev.connected ? 'Déconnecter' : 'Connecter') +
      '</button>';

    var btn = item.querySelector('.bluetooth-item__btn');
    if (btn) {
      btn.addEventListener('click', function() {
        UI.toggleBluetoothDeviceConnection(dev.id, !dev.connected);
      });
    }

    container.appendChild(item);
  });
};

UI.toggleBluetoothPower = function(enabled) {
  send({
    type: 'bluetooth.command',
    command: 'bluetooth.toggle',
    enabled: enabled
  });
  UI.showToast("Bluetooth " + (enabled ? "activé" : "désactivé"), "info");
};

UI.scanBluetooth = function() {
  send({
    type: 'bluetooth.command',
    command: 'bluetooth.scan'
  });
  UI.showToast("Recherche des appareils Bluetooth...", "info");
};

UI.toggleBluetoothDeviceConnection = function(deviceId, connect) {
  var container = el('bluetooth-devices-list');
  if (container) {
    var item = container.querySelector('[data-bt-id="' + deviceId + '"]');
    if (item) {
      item.classList.toggle('bluetooth-item--active', connect);
      var btn = item.querySelector('.bluetooth-item__btn');
      if (btn) {
        btn.textContent = connect ? 'Déconnecter' : 'Connecter';
        btn.className = 'bluetooth-item__btn ' + (connect ? 'bluetooth-item__btn--disconnect' : 'bluetooth-item__btn--connect');
      }
      var metaStatus = item.querySelector('.bt-status-label');
      if (metaStatus) {
        metaStatus.textContent = connect ? 'Connecté' : 'Non connecté';
      }
    }
  }
  send({
    type: 'bluetooth.command',
    command: connect ? 'bluetooth.connect' : 'bluetooth.disconnect',
    device_id: deviceId
  });
  UI.showToast((connect ? "Connexion" : "Déconnexion") + " en cours...", "info");
};
