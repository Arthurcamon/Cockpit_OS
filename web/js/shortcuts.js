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
    steam: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>',
    window: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v16"/></svg>',
    scene: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };

  // Icônes par app, retrouvées via le champ icon_class renvoyé par
  // /shortcuts/apps ("icon-discord", "icon-browser"...) — un pictogramme
  // distinct par app plutôt que la même icône générique répétée partout.
  var APP_ICONS = {
    'icon-discord': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M16 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M6.5 6.5C9 5 15 5 17.5 6.5 19 9 19.5 12.5 19 16c-1.8 1.3-3.6 2-5.5 2l-.7-1.4"/><path d="M6.5 6.5C5 9 4.5 12.5 5 16c1.8 1.3 3.6 2 5.5 2l.7-1.4"/><path d="M9 17.5c1.8.7 4.2.7 6 0"/></svg>',
    'icon-browser': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M4 12h17"/><path d="M12 3.5c2.4 2.3 3.7 5.3 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.3-3.7-8.5S9.6 5.8 12 3.5Z"/></svg>',
    'icon-folder': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2c.5 0 .9.2 1.2.6l1 1.2c.3.4.7.6 1.2.6H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.4H5A1.5 1.5 0 0 1 3.5 18Z"/></svg>',
    'icon-music': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 10c5-1.5 9-1 12 1"/><path d="M6.5 13.5c4-1 7.5-.7 10 1"/><path d="M7 17c3-.7 5.5-.5 7.5.6"/></svg>',
    'icon-gauge': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/></svg>',
    'icon-headset': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="4" height="7" rx="1.5"/><rect x="17.5" y="13" width="4" height="7" rx="1.5"/></svg>'
  };
  function appIcon(app) {
    return (app.icon_class && APP_ICONS[app.icon_class]) || ICONS.app;
  }

  // Icônes par fenêtre — /shortcuts/windows renvoie un champ icon_url qui,
  // en pratique, n'est pas une URL mais un mot-clé de type de fenêtre
  // ("game", "chat", "browser", "gauge", "music"). On réutilise les
  // pictogrammes d'APP_ICONS quand le concept est identique (navigateur,
  // jauge SimHub, musique) et on ajoute les deux qui n'ont pas d'équivalent.
  var WINDOW_ICONS = {
    'game': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>',
    'chat': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v11H9l-4 3.5v-3.5H4Z"/></svg>',
    'browser': APP_ICONS['icon-browser'],
    'gauge': APP_ICONS['icon-gauge'],
    'music': APP_ICONS['icon-music']
  };
  // En usage réel (core/shortcuts.py::get_real_windows, énumération Win32),
  // icon_url vaut toujours littéralement "window" pour chaque fenêtre — la
  // liste MOCK_WINDOWS avec des icon_url variés ("game", "chat"...) ne sert
  // que de repli quand l'énumération échoue. Sans ceci, WINDOW_ICONS ne
  // différencierait donc jamais rien en pratique : on ajoute un second repli
  // par mots-clés reconnus dans le titre de la fenêtre.
  var TITLE_ICON_HINTS = [
    { re: /chrome|edge|firefox|opera|navigateur|browser/i, icon: APP_ICONS['icon-browser'] },
    { re: /deezer|spotify|musique|music/i, icon: APP_ICONS['icon-music'] },
    { re: /discord|teams|slack/i, icon: WINDOW_ICONS.chat },
    { re: /explorateur|explorer|fichiers|files/i, icon: APP_ICONS['icon-folder'] },
    { re: /simhub|dashboard|télémétrie|telemetry|crew ?chief/i, icon: APP_ICONS['icon-gauge'] },
    { re: /steam|assetto|iracing|rfactor|automobilista|rally|f1 /i, icon: WINDOW_ICONS.game }
  ];

  function windowIconFromTitle(title) {
    if (!title) return null;
    for (var i = 0; i < TITLE_ICON_HINTS.length; i++) {
      if (TITLE_ICON_HINTS[i].re.test(title)) return TITLE_ICON_HINTS[i].icon;
    }
    return null;
  }

  function windowIcon(win) {
    if (win.icon_url && WINDOW_ICONS[win.icon_url]) return WINDOW_ICONS[win.icon_url];
    return windowIconFromTitle(win.title) || ICONS.window;
  }

  // Icônes par scène, par id (cf. MOCK_SCENES côté backend).
  var SCENE_ICONS = {
    'race_mode': APP_ICONS['icon-gauge'],
    'cinema_mode': '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 6l3-3.5M12 6l3-3.5M17.5 6l2-2.5"/></svg>',
    'work_mode': '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 17v3.5"/></svg>',
    'night_mode': '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/></svg>'
  };
  function sceneIcon(sc) {
    return (sc.id && SCENE_ICONS[sc.id]) || ICONS.scene;
  }

  function toast(message, isError) {
    var toastEl = document.getElementById('shortcuts-toast');
    if (!toastEl) return;
    toastEl.textContent = message;
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
          { id: 'discord', name: 'Discord', icon_class: 'icon-discord' },
          { id: 'browser', name: 'Navigateur', icon_class: 'icon-browser' },
          { id: 'explorer', name: 'Explorateur', icon_class: 'icon-folder' },
          { id: 'spotify', name: 'Spotify', icon_class: 'icon-music' },
          { id: 'simhub', name: 'SimHub', icon_class: 'icon-gauge' },
          { id: 'crewchief', name: 'Crew Chief', icon_class: 'icon-headset' }
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
                '<div class="shortcuts-app-icon">' + appIcon(app) + '</div>' +
                '<div class="shortcuts-app-text">' +
                  '<span class="shortcuts-app-name">' + (app.name || app.id) + '</span>' +
                  (app.category ? '<span class="shortcuts-app-info">' + app.category + '</span>' : '') +
                '</div>' +
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
                '<div class="shortcuts-window-icon">' + windowIcon(win) + '</div>' +
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
                  '<div class="shortcuts-scene-icon">' + sceneIcon(sc) + '</div>' +
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
    var activeBtn = null;
    for (var i = 0; i < subTabs.length; i++) {
      var t = subTabs[i];
      var btn = document.getElementById('mfd-tab-btn-' + t);
      var pane = document.getElementById('mfd-pane-' + t);
      if (t === subTabName) {
        if (btn) btn.classList.add('is-active');
        if (pane) pane.classList.add('is-active');
        activeBtn = btn;
      } else {
        if (btn) btn.classList.remove('is-active');
        if (pane) pane.classList.remove('is-active');
      }
    }
    positionSegIndicator(activeBtn);
  }

  // Fait glisser #shortcuts-mfd-indicator (.seg-indicator) sur le bouton actif.
  function positionSegIndicator(btn) {
    var tabs = document.getElementById('shortcuts-mfd-tabs');
    var indicator = document.getElementById('shortcuts-mfd-indicator');
    if (!tabs || !indicator || !btn) return;
    var tabsRect = tabs.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    indicator.style.width = btnRect.width + 'px';
    indicator.style.transform = 'translateX(' + (btnRect.left - tabsRect.left - 5) + 'px)';
  }

  // --- LIFECYCLE DE L'ONGLET ---
  function onActivate() {
    isTabActive = true;

    fetchApps();
    fetchSteamGames();
    fetchWindows();
    fetchScenes();

    // Repositionne l'indicateur au premier affichage (dimensions indisponibles
    // tant que l'onglet Raccourcis n'a jamais été rendu visible au moins une fois).
    var currentActive = document.querySelector('.shortcuts-mfd-tab-btn.is-active') || document.getElementById('mfd-tab-btn-steam');
    positionSegIndicator(currentActive);

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

