/* ═══════════════════════════════════════════════════════════════════════════
   COCKPIT OS — SHORTCUTS TAB CONTROLLER (ShortcutsController)
   Phase 2 : Logique JS complète scopée
   ═══════════════════════════════════════════════════════════════════════════ */
window.ShortcutsController = (function() {
  var isTabActive = false;
  var windowsPollInterval = null;
  var currentActionModal = null;

  // Icons SVG string helpers
  var ICONS = {
    app: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    steam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="4"/></svg>',
    window: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v16"/></svg>',
    scene: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };

  function toast(message, isError) {
    var toastEl = document.getElementById('shortcuts-toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.style.borderColor = isError ? 'rgba(239, 68, 68, 0.6)' : 'rgba(56, 189, 248, 0.4)';
    toastEl.style.color = isError ? '#fca5a5' : '#38bdf8';
    toastEl.classList.add('is-visible');
    setTimeout(function() {
      toastEl.classList.remove('is-visible');
    }, 2500);
  }

  // --- 1. APPS RAPIDES ---
  function fetchApps() {
    var container = document.getElementById('shortcuts-apps-grid');
    if (!container) return;

    fetch('/shortcuts/apps')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(apps) {
        renderApps(apps);
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching apps:', err);
        renderApps([
          { id: 'discord', name: 'Discord' },
          { id: 'browser', name: 'Navigateur' },
          { id: 'explorer', name: 'Explorateur' },
          { id: 'spotify', name: 'Spotify' },
          { id: 'simhub', name: 'SimHub' },
          { id: 'crewchief', name: 'Crew Chief' }
        ]);
      });
  }

  function renderApps(apps) {
    var container = document.getElementById('shortcuts-apps-grid');
    if (!container) return;

    if (!apps || apps.length === 0) {
      container.innerHTML = '<div class="shortcuts-status-msg">Aucune application configurée</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < apps.length; i++) {
      var app = apps[i];
      html += '<button class="shortcuts-app-btn" id="shortcuts-app-' + app.id + '" onclick="ShortcutsController.launchApp(\'' + app.id + '\', \'' + (app.name || app.id) + '\')">' +
                '<div class="shortcuts-app-icon">' + ICONS.app + '</div>' +
                '<span class="shortcuts-app-name">' + (app.name || app.id) + '</span>' +
              '</button>';
    }
    container.innerHTML = html;
  }

  function launchApp(appId, appName) {
    var btn = document.getElementById('shortcuts-app-' + appId);
    if (btn && btn.classList.contains('is-loading')) return;

    if (btn) btn.classList.add('is-pressed', 'is-loading');

    fetch('/shortcuts/launch/' + encodeURIComponent(appId), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('Erreur lancement');
        return res.json();
      })
      .then(function(data) {
        toast('Lancement de ' + appName + '...', false);
        setTimeout(function() {
          if (btn) btn.classList.remove('is-pressed', 'is-loading');
        }, 1200);
      })
      .catch(function(err) {
        toast('Échec du lancement : ' + appName, true);
        if (btn) btn.classList.remove('is-pressed', 'is-loading');
      });
  }

  // --- 2. JEUX STEAM ---
  function fetchSteamGames() {
    var container = document.getElementById('shortcuts-steam-list');
    if (!container) return;

    fetch('/shortcuts/steam-games')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(games) {
        renderSteamGames(games);
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching steam games:', err);
        container.innerHTML = '<div class="shortcuts-status-msg"><span>Erreur de chargement des jeux</span><button class="shortcuts-sysbtn shortcuts-sysbtn--neutral" style="padding:4px 12px; font-size:11px;" onclick="ShortcutsController.fetchSteamGames()">Réessayer</button></div>';
      });
  }

  function renderSteamGames(games) {
    var container = document.getElementById('shortcuts-steam-list');
    if (!container) return;

    if (!games || games.length === 0) {
      container.innerHTML = '<div class="shortcuts-status-msg">Aucun jeu détecté</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      var safeName = (game.name || '').replace(/'/g, "\\'");
      html += '<div class="shortcuts-steam-item" id="steam-game-' + game.app_id + '" onclick="ShortcutsController.launchSteamGame(\'' + game.app_id + '\', \'' + safeName + '\')">' +
                '<div class="shortcuts-steam-icon">' + ICONS.steam + '</div>' +
                '<span class="shortcuts-steam-name">' + game.name + '</span>' +
              '</div>';
    }
    container.innerHTML = html;
  }

  function launchSteamGame(appId, gameName) {
    var el = document.getElementById('steam-game-' + appId);
    if (el && el.classList.contains('is-loading')) return;

    if (el) el.classList.add('is-pressed', 'is-loading');

    fetch('/shortcuts/steam/launch/' + encodeURIComponent(appId), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('Erreur Steam');
        return res.json();
      })
      .then(function(data) {
        toast('Démarrage de ' + gameName + '...', false);
        setTimeout(function() {
          if (el) el.classList.remove('is-pressed', 'is-loading');
        }, 1500);
      })
      .catch(function(err) {
        toast('Échec du démarrage de ' + gameName, true);
        if (el) el.classList.remove('is-pressed', 'is-loading');
      });
  }

  // --- 3. ACTIONS SYSTÈME & MODALE ---
  function handleSystemAction(action) {
    fetch('/shortcuts/system/' + encodeURIComponent(action), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        toast('Action ' + action + ' exécutée', false);
      })
      .catch(function(err) {
        toast('Erreur action système : ' + action, true);
      });
  }

  function confirmSystemAction(action, title) {
    currentActionModal = action;
    var modal = document.getElementById('shortcuts-confirm-modal');
    var titleEl = document.getElementById('shortcuts-modal-title');
    var confirmBtn = document.getElementById('shortcuts-modal-confirm-btn');

    if (titleEl) titleEl.textContent = 'Confirmer ' + title + ' ?';
    if (modal) modal.classList.add('is-active');

    if (confirmBtn) {
      confirmBtn.onclick = function() {
        closeModal();
        handleSystemAction(action);
      };
    }
  }

  function closeModal() {
    var modal = document.getElementById('shortcuts-confirm-modal');
    if (modal) modal.classList.remove('is-active');
    currentActionModal = null;
  }

  // --- 4. FENÊTRES OUVERTES (TASK SWITCHER) ---
  function fetchWindows() {
    var container = document.getElementById('shortcuts-windows-list');
    if (!container) return;

    fetch('/shortcuts/windows')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(windows) {
        renderWindows(windows);
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching windows:', err);
        if (container.children.length === 0 || container.querySelector('.shortcuts-status-msg')) {
          container.innerHTML = '<div class="shortcuts-status-msg">Aucune fenêtre active</div>';
        }
      });
  }

  function renderWindows(windows) {
    var container = document.getElementById('shortcuts-windows-list');
    if (!container) return;

    if (!windows || windows.length === 0) {
      container.innerHTML = '<div class="shortcuts-status-msg">Aucune fenêtre active</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < windows.length; i++) {
      var win = windows[i];
      var safeTitle = (win.title || '').replace(/'/g, "\\'");
      html += '<div class="shortcuts-window-item" id="win-item-' + win.hwnd + '" onclick="ShortcutsController.focusWindow(' + win.hwnd + ', \'' + safeTitle + '\')">' +
                '<div class="shortcuts-window-icon">' + ICONS.window + '</div>' +
                '<span class="shortcuts-window-title">' + win.title + '</span>' +
              '</div>';
    }
    container.innerHTML = html;
  }

  function focusWindow(hwnd, title) {
    var el = document.getElementById('win-item-' + hwnd);
    if (el) el.classList.add('is-pressed');

    fetch('/shortcuts/windows/focus/' + encodeURIComponent(hwnd), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        toast('Focus : ' + title, false);
        setTimeout(function() {
          if (el) el.classList.remove('is-pressed');
        }, 300);
      })
      .catch(function(err) {
        toast('Erreur focus fenêtre', true);
        if (el) el.classList.remove('is-pressed');
      });
  }

  // --- 5. SCÈNES & MACROS ---
  function fetchScenes() {
    var container = document.getElementById('shortcuts-scenes-grid');
    if (!container) return;

    fetch('/shortcuts/scenes')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(scenes) {
        renderScenes(scenes);
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching scenes:', err);
        renderScenes([
          { id: 'race_mode', name: 'Mode Course', description: 'SimHub + CrewChief + Casque' },
          { id: 'cinema_mode', name: 'Mode Cinéma', description: 'Mute Micro + Luminosité 30%' },
          { id: 'work_mode', name: 'Mode Travail', description: 'VSCode + Chrome + Calme' },
          { id: 'night_mode', name: 'Mode Nuit', description: 'Luminosité min + Vol 40%' }
        ]);
      });
  }

  function renderScenes(scenes) {
    var container = document.getElementById('shortcuts-scenes-grid');
    if (!container) return;

    if (!scenes || scenes.length === 0) {
      container.innerHTML = '<div class="shortcuts-status-msg">Aucune scène disponible</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      var safeName = (sc.name || '').replace(/'/g, "\\'");
      html += '<button class="shortcuts-scene-btn" id="scene-btn-' + sc.id + '" onclick="ShortcutsController.runScene(\'' + sc.id + '\', \'' + safeName + '\')">' +
                '<div class="shortcuts-scene-header">' +
                  '<div class="shortcuts-scene-icon">' + ICONS.scene + '</div>' +
                  '<span class="shortcuts-scene-name" id="scene-title-' + sc.id + '">' + sc.name + '</span>' +
                '</div>' +
                '<span class="shortcuts-scene-desc" id="scene-desc-' + sc.id + '">' + (sc.description || '') + '</span>' +
              '</button>';
    }
    container.innerHTML = html;
  }

  function runScene(sceneId, sceneName) {
    var btn = document.getElementById('scene-btn-' + sceneId);
    var titleEl = document.getElementById('scene-title-' + sceneId);
    var descEl = document.getElementById('scene-desc-' + sceneId);

    if (btn && btn.classList.contains('is-loading')) return;

    var origTitle = titleEl ? titleEl.textContent : sceneName;
    var origDesc = descEl ? descEl.textContent : '';

    if (btn) btn.classList.add('is-pressed', 'is-loading');
    if (titleEl) titleEl.textContent = 'En cours...';
    if (descEl) descEl.textContent = 'Exécution macro...';

    toast('Lancement de ' + sceneName + '...', false);

    fetch('/shortcuts/scenes/' + encodeURIComponent(sceneId) + '/run', { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        toast('Scène ' + sceneName + ' activée !', false);
      })
      .catch(function(err) {
        toast('Erreur exécution ' + sceneName, true);
      })
      .finally(function() {
        if (btn) btn.classList.remove('is-pressed', 'is-loading');
        if (titleEl) titleEl.textContent = origTitle;
        if (descEl) descEl.textContent = origDesc;
      });
  }

  // --- SUB-TAB SWITCHING (MFD_RACCOURCIS) ---
  function switchSubTab(subTabName) {
    var subTabs = ['steam', 'windows', 'scenes'];
    for (var i = 0; i < subTabs.length; i++) {
      var t = subTabs[i];
      var btn = document.getElementById('mfd-tab-btn-' + t);
      var pane = document.getElementById('mfd-pane-' + t);
      if (t === subTabName) {
        if (btn) btn.classList.add('is-active');
        if (pane) pane.classList.add('is-active');
      } else {
        if (btn) btn.classList.remove('is-active');
        if (pane) pane.classList.remove('is-active');
      }
    }
  }

  // --- LIFECYCLE DE L'ONGLET ---
  function onActivate() {
    isTabActive = true;

    fetchApps();
    fetchSteamGames();
    fetchWindows();
    fetchScenes();

    // Start 5-second polling for active windows while tab is active
    if (!windowsPollInterval) {
      windowsPollInterval = setInterval(function() {
        if (isTabActive) {
          fetchWindows();
        }
      }, 5000);
    }
  }

  function onDeactivate() {
    isTabActive = false;
    if (windowsPollInterval) {
      clearInterval(windowsPollInterval);
      windowsPollInterval = null;
    }
    closeModal();
  }

  return {
    onActivate: onActivate,
    onDeactivate: onDeactivate,
    switchSubTab: switchSubTab,
    fetchApps: fetchApps,
    launchApp: launchApp,
    fetchSteamGames: fetchSteamGames,
    launchSteamGame: launchSteamGame,
    handleSystemAction: handleSystemAction,
    confirmSystemAction: confirmSystemAction,
    closeModal: closeModal,
    fetchWindows: fetchWindows,
    focusWindow: focusWindow,
    fetchScenes: fetchScenes,
    runScene: runScene
  };
})();

