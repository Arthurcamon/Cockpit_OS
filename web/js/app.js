/**
 * Cockpit OS — Application JavaScript principale
 * Toute la communication passe par WebSocket.
 * Ce fichier ne contient aucune logique métier.
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
  WS_URL: (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws',
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

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket — Connexion & messagerie
// ═══════════════════════════════════════════════════════════════════════════

function connectWS() {
  UI.setStatus('connecting', 'Connexion…');

  var ws = new WebSocket(CONFIG.WS_URL);
  State.ws = ws;

  ws.onopen = function() {
    State.reconnectCount = 0;
    UI.setStatus('connected', 'Connecté');
    // Demande de l'état initial au démarrage
    send({ type: 'media.state.request' });
    send({ type: 'audio.state.request' });
    send({ type: 'deezer.playlists' });
  };

  ws.onmessage = function(event) {
    var data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    handleMessage(data);
  };

  ws.onerror = function() {
    UI.setStatus('disconnected', 'Erreur');
  };

  ws.onclose = function() {
    UI.setStatus('disconnected', 'Déconnecté');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (State.reconnectCount >= CONFIG.WS_MAX_RECONNECTS) {
    UI.setStatus('disconnected', 'Reconnexion impossible');
    return;
  }
  State.reconnectCount++;
  // Backoff exponentiel avec gigue pour éviter les tempêtes de reconnexion
  var jitter = Math.random() * 500;
  var delay = Math.min(
    CONFIG.WS_RECONNECT_DELAY_BASE * Math.pow(1.5, State.reconnectCount - 1) + jitter,
    CONFIG.WS_RECONNECT_DELAY_MAX
  );
  clearTimeout(State.reconnectTimer);
  UI.setStatus('connecting', 'Reconnexion dans ' + Math.round(delay / 1000) + 's…');
  State.reconnectTimer = setTimeout(connectWS, delay);
}

/** Envoie un objet JSON via WebSocket. */
function send(obj) {
  if (State.ws && State.ws.readyState === WebSocket.OPEN) {
    State.ws.send(JSON.stringify(obj));
  }
}

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
// Gestion des messages entrants
// ═══════════════════════════════════════════════════════════════════════════

function handleCustomQueueState(state) {
  if (!State.customQueueActive || !State.customQueue || !State.customQueue.length) {
    return;
  }

  // BUG FIX: Période de grâce de 3 secondes déplacée au tout début de la fonction.
  // Pendant les 3 secondes qui suivent le lancement d'un morceau, on ignore totalement la vérification des titres de la file.
  // Cela évite que l'ancien titre (qui transite encore) ne soit détecté à tort comme un morceau "suivant" ou "inattendu".
  if (Date.now() - State.lastPlayInitiatedAt <= 3000) {
    console.log("[Queue] État de la file ignoré, dans la période de grâce post-lancement (" + (Date.now() - State.lastPlayInitiatedAt) + "ms)");
    return;
  }

  var expectedTrack = State.customQueue[State.customQueueIndex];
  if (!expectedTrack) {
    console.log("[Queue] Aucun morceau attendu à l'index", State.customQueueIndex);
    State.customQueueActive = false;
    return;
  }

  var currentTitle = (state.title || '').trim().toLowerCase();
  var expectedTitle = (expectedTrack.title || '').trim().toLowerCase();

  var nextTrack = State.customQueue[State.customQueueIndex + 1];
  var nextTitle = nextTrack ? (nextTrack.title || '').trim().toLowerCase() : '';

  // Vérification de la correspondance du titre pour éviter de dévier vers un mix automatique ou désactiver par erreur
  if (currentTitle && expectedTitle) {
    var isCurrentMatch = currentTitle === expectedTitle || currentTitle.indexOf(expectedTitle) !== -1 || expectedTitle.indexOf(currentTitle) !== -1;
    
    if (isCurrentMatch) {
      // Le morceau en cours correspond au morceau attendu. On réinitialise l'état de tentative de reprise.
      if (State.lastRecoveryAttemptAt > 0) {
        console.log("[Queue] Titre attendu retrouvé ('" + state.title + "'). Reprise réussie.");
        State.lastRecoveryAttemptAt = 0;
      }
    } else {
      // Ce n'est pas le morceau attendu. Est-ce le morceau suivant prévu dans notre file ?
      var isNextMatch = nextTitle && (currentTitle === nextTitle || currentTitle.indexOf(nextTitle) !== -1 || nextTitle.indexOf(currentTitle) !== -1);
      
      if (isNextMatch) {
        // C'est le morceau suivant ! Deezer a enchaîné directement ou nous avons manqué la fin précise du morceau.
        console.log("[Queue] Détection du morceau suivant en lecture ('" + state.title + "'). Recalage de l'index de la file.");
        State.customQueueIndex++;
        State.queueTransitionTriggered = false;
        State.lastPlayInitiatedAt = Date.now();
        State.lastRecoveryAttemptAt = 0;
        highlightActiveTrackInUI(nextTrack.id);
      } else {
        // Titre inattendu ! Ni le morceau actuel ni le morceau suivant.
        // Puisque nous sommes en dehors des 3 secondes de grâce, on traite le mismatch
        
        // Si on a déjà tenté une reprise récemment et que le titre externe persiste, on considère que l'utilisateur a changé de morceau
        if (State.lastRecoveryAttemptAt > 0 && Date.now() - State.lastRecoveryAttemptAt < 10000) {
          console.log("[Queue] Mismatch persistant après tentative de reprise (Reçu: '" + state.title + "', Attendu: '" + expectedTrack.title + "'). Désactivation définitive de la file Cockpit.");
          State.customQueueActive = false;
          State.lastRecoveryAttemptAt = 0;
          return;
        }
        
        // Première détection d'écart : on tente une reprise immédiate en lançant le morceau suivant
        console.log("[Queue] Titre inattendu détecté (Reçu: '" + state.title + "', Attendu: '" + expectedTrack.title + "'). Tentative de reprise de la file avec le morceau suivant.");
        State.lastRecoveryAttemptAt = Date.now();
        playNextQueueTrack();
        return;
      }
    }
  }

  // Détection de fin de piste pour enchaîner
  if (!State.queueTransitionTriggered) {
    var isFinished = false;

    // A) Statut arrêté ou terminé
    if (state.status === 'stopped' || state.status === 'ended') {
      isFinished = true;
    }
    // B) Position >= durée - 2 secondes (avec durée > 0)
    else if (state.duration > 0 && state.position >= state.duration - 2) {
      isFinished = true;
    }

    if (isFinished) {
      State.queueTransitionTriggered = true;
      console.log("[Queue] Fin de piste détectée pour '" + expectedTrack.title + "' (position=" + state.position + "/" + state.duration + ", status=" + state.status + "). Enchaînement automatique.");
      playNextQueueTrack();
    }
  }
}

function playNextQueueTrack() {
  if (!State.customQueueActive || !State.customQueue) return;

  // PROTECTION ANTI-DOUBLE-APPEL (limite à un appel par 500ms)
  var now = Date.now();
  if (State.lastQueueNavigationAt && (now - State.lastQueueNavigationAt < 500)) {
    console.log("[Queue] playNextQueueTrack() ignoré pour éviter un double-déclenchement.");
    return;
  }
  State.lastQueueNavigationAt = now;

  State.customQueueIndex++;
  if (State.customQueueIndex >= State.customQueue.length) {
    console.log("[Queue] Fin de la file d'attente personnalisée.");
    State.customQueueActive = false;
    return;
  }

  var nextTrack = State.customQueue[State.customQueueIndex];
  console.log("[Queue] Enchaînement morceau suivant (" + (State.customQueueIndex + 1) + "/" + State.customQueue.length + ") : " + nextTrack.title);
  
  State.queueTransitionTriggered = false;
  State.lastPlayInitiatedAt = Date.now();
  
  highlightActiveTrackInUI(nextTrack.id);
  Deezer.playTrackIsolated(nextTrack.id, nextTrack.title);
}

function playPreviousQueueTrack() {
  console.log("[Queue] playPreviousQueueTrack() appelée. State.customQueueActive =", State.customQueueActive, "Index actuel =", State.customQueueIndex);
  if (!State.customQueueActive || !State.customQueue) {
    console.log("[Queue] Retour prématuré : file inactive ou inexistante.");
    return;
  }

  // PROTECTION ANTI-DOUBLE-APPEL (limite à un appel par 500ms)
  var now = Date.now();
  if (State.lastQueueNavigationAt && (now - State.lastQueueNavigationAt < 500)) {
    console.log("[Queue] playPreviousQueueTrack() ignoré pour éviter un double-déclenchement.");
    return;
  }
  State.lastQueueNavigationAt = now;

  var oldIndex = State.customQueueIndex;
  if (State.customQueueIndex <= 0) {
    console.log("[Queue] Premier morceau déjà atteint. Relance le premier morceau.");
    State.customQueueIndex = 0;
  } else {
    State.customQueueIndex--;
  }
  console.log("[Queue] Index décrémenté de " + oldIndex + " à " + State.customQueueIndex);

  var prevTrack = State.customQueue[State.customQueueIndex];
  if (!prevTrack) {
    console.warn("[Queue] Morceau précédent introuvable à l'index " + State.customQueueIndex);
    return;
  }

  console.log("[Queue] Recul morceau précédent (" + (State.customQueueIndex + 1) + "/" + State.customQueue.length + ") : " + prevTrack.title);
  
  State.queueTransitionTriggered = false;
  State.lastPlayInitiatedAt = Date.now();
  
  highlightActiveTrackInUI(prevTrack.id);
  Deezer.playTrackIsolated(prevTrack.id, prevTrack.title);
}

function highlightActiveTrackInUI(trackId) {
  var list = el('dz-tracks-list');
  if (!list) return;

  if (State.currentlyHighlightedTrackEl) {
    try {
      State.currentlyHighlightedTrackEl.classList.remove('track-item--active');
    } catch (e) {}
    State.currentlyHighlightedTrackEl = null;
  }

  var activeEl = list.querySelector('.track-item[data-track-id="' + trackId + '"]');
  if (!activeEl) {
    // Si le morceau n'est pas encore rendu dans le DOM (chargement paresseux)
    // On force le rendu paresseux des morceaux restants jusqu'à son index
    if (State.sortedTracks && State.sortedTracks.length > 0 && typeof State.renderNextTracksToIncludeId === 'function') {
      State.renderNextTracksToIncludeId(trackId);
      activeEl = list.querySelector('.track-item[data-track-id="' + trackId + '"]');
    }
  }

  if (activeEl) {
    activeEl.classList.add('track-item--active');
    State.currentlyHighlightedTrackEl = activeEl;
  } else {
    var found = false;
    var items = list.querySelectorAll('.track-item');
    for (var i = 0; i < items.length; i++) {
      var itemEl = items[i];
      if (itemEl.getAttribute('data-track-id') == trackId) {
        itemEl.classList.add('track-item--active');
        State.currentlyHighlightedTrackEl = itemEl;
        found = true;
      } else {
        itemEl.classList.remove('track-item--active');
      }
    }
  }
}

function handleMessage(data) {
  switch (data.type) {

    case 'media.state':
      State.mediaState = data;
      UI.updateMediaPlayer(data);
      UI.updateMiniPlayer(data);
      UI.updateDashboardMedia(data);
      UI.updateDeezerMedia(data);
      UI.renderSessionPicker(data.sessions || []);
      handleCustomQueueState(data);
      break;

    case 'audio.state':
      State.audioState = data;
      UI.updateAudioApps(data);
      UI.updateAudioDevices(data);
      UI.updateBluetooth(data);
      break;

    case 'deezer.playlists.results':
      var playlistsResult = data.playlists || [];
      console.log("[Deezer] Playlists reçues dans le navigateur :", playlistsResult.map(function(p) { return p.id + ' - ' + p.title; }));
      UI.renderPlaylists(playlistsResult);
      break;

    case 'deezer.playlist.tracks.results':
      var playlistId = data.playlist_id;
      var tracks = data.tracks || [];
      var isPartial = data.is_partial || false;

      // 1. Initialiser le cache s'il n'existe pas
      if (!State.playlistTracksCache) {
        State.playlistTracksCache = {};
      }

      // 2. Mettre à jour le cache
      if (isPartial) {
        // On stocke le partiel uniquement si on n'a pas déjà un cache complet
        if (!State.playlistTracksCache[playlistId] || State.playlistTracksCache[playlistId].isPartial) {
          State.playlistTracksCache[playlistId] = { tracks: tracks, isPartial: true };
        }
      } else {
        // On écrase avec la version complète définitive
        State.playlistTracksCache[playlistId] = { tracks: tracks, isPartial: false };
      }

      // 3. Traiter la lecture instantanée ou l'affichage de l'UI
      if (State.playPlaylistInstantlyOnArrival === playlistId) {
        State.playPlaylistInstantlyOnArrival = null;
        if (tracks.length > 0) {
          console.log("[Queue] Lecture instantanée de la playlist " + playlistId + " : " + tracks.length + " morceaux.");
          State.customQueue = tracks.slice();
          State.customQueueIndex = 0;
          State.customQueueActive = true;
          State.queueTransitionTriggered = false;
          State.lastPlayInitiatedAt = Date.now();
          
          Deezer.playTrackIsolated(tracks[0].id, tracks[0].title);
          showToast("Lecture de " + tracks[0].title, "info");
        } else {
          showToast("La playlist est vide", "error");
        }
      } else {
        // Mettre à jour l'affichage uniquement si l'utilisateur regarde actuellement cette playlist
        if (State.currentView === 'tracks' && State.tracksContext && String(State.tracksContext.playlistId) === String(playlistId)) {
          if (State.isPlaylistTransitionActive) {
            console.log("[Deezer] Transition en cours, le rendu des morceaux de la playlist est différé.");
            break;
          }
          var currentRenderedLength = State.originalTracks ? State.originalTracks.length : 0;
          // Ne pas écraser les données complètes par des données partielles arrivées tardivement
          if (isPartial && currentRenderedLength > tracks.length) {
            break;
          }

          // OPTIMISATION 3 : Préservation de la position de défilement lors du remplacement de la liste partielle par la liste complète
          var listEl = el('dz-tracks-list');
          var savedScrollTop = (listEl && currentRenderedLength > 0 && listEl.scrollTop > 0) ? listEl.scrollTop : 0;

          UI.renderTracks(tracks, { playlistId: playlistId });

          if (savedScrollTop > 0 && listEl) {
            if (typeof State.renderNextTracksToScrollPos === 'function') {
              State.renderNextTracksToScrollPos(savedScrollTop);
            }
            listEl.scrollTop = savedScrollTop;
          }
        }
      }
      break;

    case 'deezer.album.tracks.results':
      UI.renderTracks(data.tracks || [], { albumId: data.album_id });
      break;

    case 'deezer.artist.albums.results':
      UI.renderAlbums(data.albums || []);
      break;

    case 'deezer.search.results':
      UI.renderSearchResults(data.results || [], data.filter);
      break;

    case 'deezer.player.launched':
      UI.showToast('▶ ' + (data.title || 'Piste') + ' lancé dans Deezer Desktop');
      break;

    case 'deezer.player.error':
      UI.showToast(data.message, 'error');
      break;

    case 'audio.volume.updated':
      if (data.value !== undefined) {
        var masterVol = Math.round(data.value * 100);
        var activeEl = document.activeElement;
        
        var mediaTabSlider = el('media-tab-volume-slider');
        if (mediaTabSlider && activeEl !== mediaTabSlider) {
          mediaTabSlider.value = masterVol;
          mediaTabSlider.style.setProperty('background', sliderFillBackground(masterVol), 'important');
        }
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
      }
      break;

    case 'audio.mute.updated':
      if (data.muted !== undefined) {
        var isMuted = !!data.muted;
        if (typeof appMutes !== 'undefined') appMutes['master'] = isMuted;
        var btnMaster = el('vol-mute-master');
        if (btnMaster) btnMaster.classList.toggle('muted', isMuted);
        var btnMedia = el('media-mute');
        if (btnMedia) btnMedia.classList.toggle('muted', isMuted);
      }
      break;

    case 'audio.app.mute.updated':
      if (data.muted !== undefined) {
        var isAppMuted = !!data.muted;
        var appKey = (data.appKey || data.name || data.app || '').toLowerCase();
        
        var mappedKey = null;
        if (appKey.indexOf('deezer') !== -1 || appKey.indexOf('spotify') !== -1 || appKey === 'musique') mappedKey = 'musique';
        else if (appKey.indexOf('discord') !== -1 || appKey === 'vocal') mappedKey = 'vocal';
        else if (appKey === 'jeu' || appKey === 'simu') mappedKey = 'jeu';

        if (mappedKey) {
          if (typeof appMutes !== 'undefined') appMutes[mappedKey] = isAppMuted;
          var endMuteBtn = el('vol-mute-' + mappedKey);
          if (endMuteBtn) endMuteBtn.classList.toggle('muted', isAppMuted);
        }

        if (data.pid) {
          var appMuteBtn = document.querySelector('.audio-app-mute-btn[data-pid="' + data.pid + '"]');
          if (appMuteBtn) appMuteBtn.classList.toggle('muted', isAppMuted);
        }
      }
      break;

    case 'audio.app.volume.updated':
      if (data.value !== undefined) {
        var appVol = Math.round(data.value * 100);
        var appName = (data.name || data.app || '').toLowerCase();
        
        if (data.pid) {
          var appSlider = document.querySelector('.audio-app-slider-modern[data-pid="' + data.pid + '"]');
          if (appSlider && document.activeElement !== appSlider) {
            appSlider.value = appVol;
            var wrapper = appSlider.closest('.app-item-slider-wrapper');
            if (wrapper) {
              var valLabel = wrapper.querySelector('.audio-app-value-modern');
              if (valLabel) valLabel.textContent = appVol + '%';
            }
            appSlider.style.setProperty('background', sliderFillBackground(appVol), 'important');
          }
        }

        var endKey = null;
        if (appName.indexOf('deezer') !== -1 || appName.indexOf('spotify') !== -1 || appName === 'musique') {
          endKey = 'musique';
        } else if (appName.indexOf('discord') !== -1 || appName === 'vocal') {
          endKey = 'vocal';
        } else if (appName === 'jeu') {
          endKey = 'jeu';
        }

        if (endKey) {
          var endSlider = el('vol-slider-' + endKey);
          var endText = el('vol-val-' + endKey);
          if (endSlider && document.activeElement !== endSlider) {
            endSlider.value = appVol;
            endSlider.style.setProperty('background', sliderFillBackground(appVol), 'important');
          }
          if (endText) endText.textContent = appVol + '%';
          if (typeof appVolumes !== 'undefined') appVolumes[endKey] = appVol;
        }
      }
      break;

    case 'system.connected':
      break;

    case 'error':
      console.warn('[Cockpit OS] Erreur serveur :', data.message);
      if (data.message) {
        UI.showToast(data.message, 'error');
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Commandes médias
// ═══════════════════════════════════════════════════════════════════════════

var Media = {
  command: function(cmd, extra) {
    if (extra === undefined) extra = {};
    var msg = { type: 'media.command', command: cmd };
    for (var k in extra) {
      if (extra.hasOwnProperty(k)) {
        msg[k] = extra[k];
      }
    }
    send(msg);
  },
  setVolume: function(val) {
    var v = Math.round(val);
    var activeEl = document.activeElement;

    // Synchroniser le slider de l'onglet Médias
    var mediaTabSlider = el('media-tab-volume-slider');
    if (mediaTabSlider && activeEl !== mediaTabSlider) {
      mediaTabSlider.value = v;
      mediaTabSlider.style.setProperty('background', sliderFillBackground(v), 'important');
    }

    // Synchroniser le slider Général de l'onglet Endurance
    var enduranceMasterSlider = el('vol-slider-master');
    var enduranceMasterText = el('vol-val-master');
    if (enduranceMasterSlider && activeEl !== enduranceMasterSlider) {
      enduranceMasterSlider.value = v;
      enduranceMasterSlider.style.setProperty('background', sliderFillBackground(v), 'important');
    }
    if (enduranceMasterText) {
      enduranceMasterText.textContent = v + '%';
    }
    if (typeof appVolumes !== 'undefined') {
      appVolumes['master'] = v;
    }

    send({ type: 'audio.command', command: 'audio.volume.set', value: v / 100 });
  },
  toggleMute: function() {
    send({ type: 'audio.command', command: 'audio.mute.toggle' });
  },
  seek: function(positionSeconds) {
    send({ type: 'media.command', command: 'seek', position: positionSeconds });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Commandes Deezer
// ═══════════════════════════════════════════════════════════════════════════

var Deezer = {
  playTrack: function(trackId, title, playlistId, index, queueTrackIds, albumId) {
    if (playlistId === undefined) playlistId = null;
    if (albumId === undefined) albumId = null;
    var msg = { type: 'deezer.play', track_id: trackId, title: title };
    if (playlistId != null) msg.playlist_id = playlistId;
    if (albumId != null) msg.album_id = albumId;
    if (index !== undefined && index !== null) msg.index = index;
    console.log("[Deezer] Envoi de deezer.play via WebSocket :", msg);
    send(msg);
  },
  playTrackIsolated: function(trackId, title) {
    var queueTrackIds = [];
    if (State.customQueueActive && State.customQueue && State.customQueue.length > 0) {
      if (State.customQueue[State.customQueueIndex] && String(State.customQueue[State.customQueueIndex].id) === String(trackId)) {
        var slice = State.customQueue.slice(State.customQueueIndex, State.customQueueIndex + 100);
        queueTrackIds = slice.map(function(t) { return t.id; });
      } else {
        var idx = State.customQueue.findIndex(function(t) { return String(t.id) === String(trackId); });
        if (idx !== -1) {
          State.customQueueIndex = idx;
          var slice = State.customQueue.slice(idx, idx + 100);
          queueTrackIds = slice.map(function(t) { return t.id; });
        } else {
          queueTrackIds = [trackId];
        }
      }
    } else {
      queueTrackIds = [trackId];
    }

    var msg = { 
      type: 'deezer.play', 
      track_id: trackId, 
      title: title, 
      source: 'queue_isolated', 
      queue_track_ids: queueTrackIds 
    };
    console.log("[Deezer] Envoi de deezer.play (isolé avec liste de queue) :", msg);
    send(msg);
  },
  playFlow: function() {
    send({ type: 'deezer.play', source: 'flow', title: 'Flow Deezer' });
  },
  playPlaylistInstantly: function(playlistId, title, coverUrl) {
    showToast("Chargement de " + title, "info");
    State.playPlaylistInstantlyOnArrival = playlistId;
    send({ type: 'deezer.playlist.tracks', playlist_id: playlistId });
  },
  openPlaylist: function(playlistId, title, coverUrl, meta) {
    // 1. Initialiser le cache client s'il n'existe pas
    if (!State.playlistTracksCache) {
      State.playlistTracksCache = {};
    }

    // Définir le tracksContext immédiatement pour que les messages websocket correspondants soient acceptés
    State.tracksContext = { playlistId: playlistId };
    State.isPlaylistTransitionActive = true;

    // Toujours afficher le squelette au début pour que la transition de la sheet soit légère et fluide
    UI.showTracksSkeleton();

    // Enregistre l'ouverture dans l'historique local pour le tri
    try {
      var history = JSON.parse(localStorage.getItem('dz_playlist_history') || '{}');
      history[playlistId] = Date.now();
      localStorage.setItem('dz_playlist_history', JSON.stringify(history));
    } catch (e) {
      console.warn('Erreur stockage historique playlist :', e);
    }

    // Met à jour le hero en attendant
    el('dz-tracks-title').textContent = title || 'Playlist';
    el('dz-tracks-meta').textContent = meta || '';
    setImg('dz-tracks-cover', coverUrl);
    showView('tracks');
    pushBreadcrumb(title || 'Playlist', 'tracks', { type: 'playlist', id: playlistId, title: title, coverUrl: coverUrl, meta: meta });

    // Rendu différé et requête après la transition de 380ms pour garantir un glissement à 60 FPS
    setTimeout(function() {
      State.isPlaylistTransitionActive = false;

      // S'assurer que l'utilisateur est toujours sur cette playlist
      if (State.currentView === 'tracks' && State.tracksContext && String(State.tracksContext.playlistId) === String(playlistId)) {
        var cached = State.playlistTracksCache[playlistId];
        if (cached && cached.tracks && cached.tracks.length > 0) {
          console.log("[Cache client] Rendu différé depuis le cache pour la playlist", playlistId);
          UI.renderTracks(cached.tracks, { playlistId: playlistId });
        }
        
        // Demander les données actualisées au serveur en arrière-plan
        send({ type: 'deezer.playlist.tracks', playlist_id: playlistId });
      }
    }, 400);
  },
  openAlbum: function(albumId, title, coverUrl, artistName) {
    UI.showTracksSkeleton(); // Affiche le squelette de chargement des morceaux de l'album
    send({ type: 'deezer.album.tracks', album_id: albumId });
    el('dz-tracks-title').textContent = title || 'Album';
    el('dz-tracks-meta').textContent = artistName || '';
    setImg('dz-tracks-cover', coverUrl);
    showView('tracks');
    pushBreadcrumb(title || 'Album', 'tracks', { type: 'album', id: albumId, title: title, coverUrl: coverUrl, artistName: artistName });
  },
  openArtist: function(artistId, name, imgUrl) {
    UI.showAlbumsSkeleton(); // Affiche le squelette de chargement des albums
    send({ type: 'deezer.artist.albums', artist_id: artistId });
    el('dz-artist-name').textContent = name || 'Artiste';
    setImg('dz-artist-img', imgUrl);
    showView('albums');
    pushBreadcrumb(name || 'Artiste', 'albums', { type: 'artist', id: artistId, name: name, imgUrl: imgUrl });
  },
  search: function(query, filter) {
    UI.showSearchResultsSkeleton(); // Affiche le squelette de chargement des résultats de recherche
    send({ type: 'deezer.search', query: query, filter: filter });
  },
  loadPlaylists: function() {
    UI.showPlaylistsSkeleton(); // Affiche le squelette de chargement des playlists
    send({ type: 'deezer.playlists' });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Navigation par vues
// ═══════════════════════════════════════════════════════════════════════════

var SHEET_VIEWS = ['tracks', 'albums'];

function initSheetWillChangeListeners() {
  SHEET_VIEWS.forEach(function(name) {
    var sheet = el('view-' + name);
    if (sheet && !sheet._hasWillChangeListener) {
      sheet._hasWillChangeListener = true;
      sheet.addEventListener('transitionend', function(e) {
        if (e.target === sheet && e.propertyName === 'transform') {
          sheet.style.willChange = 'auto';
        }
      });
    }
  });
}

function showView(viewName) {
  var isSheet = SHEET_VIEWS.indexOf(viewName) !== -1;
  var overlay = el('dz-sheet-overlay');
  var contentContainer = el('dz-content');

  initSheetWillChangeListeners();

  if (isSheet) {
    // C'est une sheet : promotion de calque de composition avant glissement
    var target = el('view-' + viewName);
    if (target) {
      target.style.willChange = 'transform';
      requestAnimationFrame(function() {
        target.classList.add('deezer-view--active');
      });
    }
    // Activer l'overlay
    if (overlay) {
      overlay.classList.add('deezer-sheet-overlay--active');
    }
    // Bloquer le scroll en arrière-plan
    if (contentContainer) {
      contentContainer.classList.add('deezer-content--no-scroll');
    }
  } else {
    // Ce n'est pas une sheet : on désactive toutes les sheets d'abord
    SHEET_VIEWS.forEach(function(name) {
      var sheet = el('view-' + name);
      if (sheet) {
        if (sheet.classList.contains('deezer-view--active')) {
          sheet.style.willChange = 'transform';
        }
        sheet.classList.remove('deezer-view--active');
      }
    });
    // Désactiver l'overlay
    if (overlay) {
      overlay.classList.remove('deezer-sheet-overlay--active');
    }
    // Débloquer le scroll
    if (contentContainer) {
      contentContainer.classList.remove('deezer-content--no-scroll');
    }

    // Gérer l'affichage exclusif des vues principales (playlists, search, etc.)
    document.querySelectorAll('.deezer-view').forEach(function(v) {
      // N'affecte pas les sheets (qui sont déjà gérées)
      var id = v.id;
      var name = id.replace('view-', '');
      if (SHEET_VIEWS.indexOf(name) === -1) {
        if (name === viewName) {
          v.classList.add('deezer-view--active');
          v.classList.add('fade-in');
        } else {
          v.classList.remove('deezer-view--active');
        }
      }
    });
  }

  State.currentView = viewName;
  updateBackButtonVisibility();
}

function pushBreadcrumb(label, view, data) {
  State.breadcrumb.push({ label: label, view: view, data: data });
  renderBreadcrumb();
}

function goBack() {
  if (State.breadcrumb.length > 1) {
    State.breadcrumb.pop();
    var prev = State.breadcrumb[State.breadcrumb.length - 1];
    renderBreadcrumb();
    showView(prev.view);
  } else if (State.currentView !== 'playlists') {
    showView('playlists');
    var input = el('dz-search-input');
    if (input) input.value = '';
    var clearBtn = el('dz-search-clear');
    if (clearBtn) clearBtn.classList.remove('search-bar__clear--visible');
  }
}

function updateBackButtonVisibility() {
  var btn = el('dz-back-btn');
  var navBar = el('dz-navigation-bar');
  if (btn) {
    if (State.currentView !== 'playlists') {
      btn.style.display = 'flex';
      if (navBar) navBar.style.display = 'flex';
    } else {
      btn.style.display = 'none';
      if (navBar) navBar.style.display = 'none';
    }
  }
}

function renderBreadcrumb() {
  var bc = el('dz-breadcrumb');
  updateBackButtonVisibility();
  if (!bc) return;
  bc.innerHTML = '';

  State.breadcrumb.forEach(function(item, i) {
    var btn = document.createElement('button');
    btn.className = 'breadcrumb__item' + (i === State.breadcrumb.length - 1 ? ' breadcrumb__item--active' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', function() {
      State.breadcrumb = State.breadcrumb.slice(0, i + 1);
      renderBreadcrumb();
      showView(item.view);
      updateBackButtonVisibility();
    });
    bc.appendChild(btn);
  });
}

function sortTracks(sortType) {
  if (!State.originalTracks) return;

  var tracks = State.originalTracks.slice();

  if (sortType === 'recent') {
    tracks.sort(function(a, b) {
      var tA = a.time_add || 0;
      var tB = b.time_add || 0;
      return tB - tA;
    });
  } else if (sortType === 'title') {
    tracks.sort(function(a, b) {
      var titleA = (a.title || '').toLowerCase();
      var titleB = (b.title || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });
  } else if (sortType === 'artist') {
    tracks.sort(function(a, b) {
      var nameA = ((a.artist ? a.artist.name : null) || a.artist || '').toLowerCase();
      var nameB = ((b.artist ? b.artist.name : null) || b.artist || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }

  State.sortedTracks = tracks;
  UI.renderTracksOnly(State.sortedTracks, State.tracksContext);
}

// ═══════════════════════════════════════════════════════════════════════════
// Interface utilisateur (UI)
// ═══════════════════════════════════════════════════════════════════════════

var UI = {

  // ── Statut de connexion ──────────────────────────────────────────────────
  setStatus: function(status, label) {
    var badge = el('ws-status');
    if (!badge) return;
    badge.className = 'status-badge status-badge--' + status;
    badge.querySelector('.status-badge__dot').className = 'status-badge__dot';
    badge.lastChild.textContent = ' ' + label;
  },

  // ── Lecteur principal (onglet Media) ─────────────────────────────────────
  updateMediaPlayer: function(state) {
    setText('media-title', state.title || 'Aucune lecture en cours');
    setText('media-artist', state.artist || '—');
    setText('media-album', state.album || '');
    setText('media-source-label', state.source === 'simulation' ? 'Mode simulation' : 'Windows Media Session');

    // Nom du lecteur source (ex: "Deezer Desktop")
    var playerEls = document.querySelectorAll('#media-player-name');
    playerEls.forEach(function(playerEl) {
      if (state.player === 'deezer') {
        playerEl.textContent = '🎵 Deezer Desktop';
      } else if (state.player && state.player !== 'windows' && state.source !== 'simulation') {
        playerEl.textContent = state.player;
      } else {
        playerEl.textContent = '';
      }
    });

    // Pochette
    var imgEls = document.querySelectorAll('#media-cover-img');
    var placeholderEls = document.querySelectorAll('#media-cover-placeholder');
    var cover = state.cover_b64 || state.cover_url || '';
    imgEls.forEach(function(imgEl) {
      if (cover) {
        imgEl.src = cover;
        imgEl.style.display = 'block';
      } else {
        imgEl.style.display = 'none';
      }
    });
    placeholderEls.forEach(function(placeholder) {
      if (cover) {
        placeholder.style.display = 'none';
      } else {
        placeholder.style.display = 'flex';
      }
    });

    // Rotation de la pochette (style vinyle)
    imgEls.forEach(function(imgEl) {
      var coverEl = imgEl.parentElement;
      if (coverEl) {
        if (state.status === 'playing') coverEl.classList.add('playing');
        else coverEl.classList.remove('playing');
      }
    });

    // Bouton play/pause
    var playIcons = document.querySelectorAll('#media-play-icon');
    playIcons.forEach(function(playIcon) {
      playIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    });

    // Bouton Shuffle
    var shuffleBtns = document.querySelectorAll('#media-shuffle');
    shuffleBtns.forEach(function(shuffleBtn) {
      shuffleBtn.classList.toggle('active', !!state.shuffle);
    });

    // Bouton Repeat — icône change selon le mode
    var repeatBtns = document.querySelectorAll('#media-repeat');
    repeatBtns.forEach(function(repeatBtn) {
      var isActive = state.repeat && state.repeat !== 'none';
      repeatBtn.classList.toggle('active', isActive);
    });

    var repeatIcons = document.querySelectorAll('#media-repeat-icon');
    repeatIcons.forEach(function(icon) {
      if (state.repeat === 'track') {
        // Repeat 1 : icône avec "1"
        icon.innerHTML =
          '<polyline points="17 1 21 5 17 9"/>' +
          '<path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
          '<polyline points="7 23 3 19 7 15"/>' +
          '<path d="M21 13v2a4 4 0 0 1-4 4H3"/>' +
          '<text x="11" y="14" font-size="7" fill="currentColor" font-family="sans-serif" font-weight="bold">1</text>';
      } else {
        // Repeat all ou none
        icon.innerHTML =
          '<polyline points="17 1 21 5 17 9"/>' +
          '<path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
          '<polyline points="7 23 3 19 7 15"/>' +
          '<path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
      }
    });

    // Progression
    this._updateProgress('media-progress-fill', 'media-progress-thumb', 'media-pos', 'media-dur', state);

    // Synchronisation de l'onglet Endurance (Sim) si présent
    setText('sim-media-title', state.title || 'Aucune lecture');
    setText('sim-media-artist', state.artist || '—');

    var simPlayIcon = el('sim-media-play-icon');
    if (simPlayIcon) {
      simPlayIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    }

    var simCover = el('sim-media-cover');
    var simPlaceholder = el('sim-media-cover-placeholder');
    var coverImg = state.cover_b64 || state.cover_url || '';
    if (simCover) {
      if (coverImg) {
        simCover.src = coverImg;
        simCover.style.display = 'block';
        if (simPlaceholder) simPlaceholder.style.display = 'none';
      } else {
        simCover.style.display = 'none';
        if (simPlaceholder) simPlaceholder.style.display = 'flex';
      }
    }
    this._updateProgress('sim-media-progress', null, 'sim-media-pos', 'sim-media-dur', state);
  },

  _updateProgress: function(fillId, thumbId, posId, durId, state) {
    var duration = state.duration || 0;
    var position = state.position || 0;
    var pct = duration > 0 ? (position / duration) * 100 : 0;

    var fills = document.querySelectorAll('#' + fillId);
    var thumbs = thumbId ? document.querySelectorAll('#' + thumbId) : [];
    var posEls = document.querySelectorAll('#' + posId);
    var durEls = document.querySelectorAll('#' + durId);

    fills.forEach(function(fill) { fill.style.width = pct + '%'; });
    thumbs.forEach(function(thumb) { thumb.style.left = pct + '%'; });
    posEls.forEach(function(posEl) { posEl.textContent = formatTime(position); });
    durEls.forEach(function(durEl) { durEl.textContent = formatTime(duration); });
  },

  // ── Mini-lecteur (footer) ────────────────────────────────────────────────
  updateMiniPlayer: function(state) {
    setText('mini-title', state.title || 'Aucune lecture');
    setText('mini-artist', state.artist || '—');

    var miniPlayIcon = el('mini-play-icon');
    if (miniPlayIcon) {
      miniPlayIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    }

    // Pochette mini
    var miniCover = el('mini-cover');
    var miniPlaceholder = el('mini-cover-placeholder');
    var cover = state.cover_b64 || state.cover_url || '';
    if (miniCover) {
      if (cover) {
        miniCover.src = cover;
        miniCover.style.display = 'block';
        if (miniPlaceholder) miniPlaceholder.style.display = 'none';
      } else {
        miniCover.style.display = 'none';
        if (miniPlaceholder) miniPlaceholder.style.display = 'flex';
      }
    }
  },

  // ── Tableau de Bord (Dashboard Media Update) ──────────────────────────────
  updateDashboardMedia: function(state) {
    setText('dash-media-title', state.title || 'Aucune lecture');
    setText('dash-media-artist', state.artist || '—');

    var dashPlayIcon = el('dash-media-play-icon');
    if (dashPlayIcon) {
      dashPlayIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    }

    var dashCover = el('dash-media-cover');
    var dashPlaceholder = el('dash-media-cover-placeholder');
    var cover = state.cover_b64 || state.cover_url || '';
    if (dashCover) {
      if (cover) {
        dashCover.src = cover;
        dashCover.style.display = 'block';
        if (dashPlaceholder) dashPlaceholder.style.display = 'none';
      } else {
        dashCover.style.display = 'none';
        if (dashPlaceholder) dashPlaceholder.style.display = 'flex';
      }
    }

    // Progression du widget
    this._updateProgress('dash-media-progress', null, 'dash-media-pos', 'dash-media-dur', state);
  },

  // ── Deezer Media Update ──────────────────────────────────────────────────
  updateDeezerMedia: function(state) {
    setText('dz-media-title', state.title || 'Aucune lecture');
    setText('dz-media-artist', state.artist || '—');

    var dzPlayIcon = el('dz-media-play-icon');
    if (dzPlayIcon) {
      dzPlayIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    }

    var dzCover = el('dz-media-cover');
    var dzPlaceholder = el('dz-media-cover-placeholder');
    var cover = state.cover_b64 || state.cover_url || '';
    if (dzCover) {
      if (cover) {
        dzCover.src = cover;
        dzCover.style.display = 'block';
        if (dzPlaceholder) dzPlaceholder.style.display = 'none';
      } else {
        dzCover.style.display = 'none';
        if (dzPlaceholder) dzPlaceholder.style.display = 'flex';
      }
    }

    // Progression du widget Deezer
    this._updateProgress('dz-media-progress', null, 'dz-media-pos', 'dz-media-dur', state);
  },

  // ── Skeletons loaders pour les transitions ──────────────────────────────
  showPlaylistsSkeleton: function() {
    var grid = el('dz-playlists-grid');
    if (grid) {
      grid.innerHTML = 
        '<div class="skeleton-grid">' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
        '</div>';
    }
  },

  showTracksSkeleton: function() {
    State.originalTracks = null;
    State.sortedTracks = null;
    var list = el('dz-tracks-list');
    if (list) {
      var html = '<div class="skeleton-list">';
      for (var i = 0; i < 8; i++) {
        html += 
          '<div class="skeleton-row" style="display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.02);">' +
            '<div class="skeleton-bar" style="width: 24px; height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
            '<div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">' +
              '<div class="skeleton-bar" style="width: 40%; height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
              '<div class="skeleton-bar" style="width: 25%; height: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
            '</div>' +
            '<div class="skeleton-bar" style="width: 40px; height: 16px; background: rgba(255,255,255,0.03); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
          '</div>';
      }
      html += '</div>';
      list.innerHTML = html;
    }
  },

  showAlbumsSkeleton: function() {
    var grid = el('dz-albums-grid');
    if (grid) {
      grid.innerHTML = 
        '<div class="skeleton-grid">' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
        '</div>';
    }
  },

  showSearchResultsSkeleton: function() {
    var list = el('dz-search-results');
    if (list) {
      var html = '<div class="skeleton-list">';
      for (var i = 0; i < 6; i++) {
        html += 
          '<div class="skeleton-row" style="display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.02);">' +
            '<div class="skeleton-bar" style="width: 48px; height: 48px; background: rgba(255,255,255,0.05); border-radius: 8px; animation: shimmer 1.5s infinite;"></div>' +
            '<div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">' +
              '<div class="skeleton-bar" style="width: 50%; height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
              '<div class="skeleton-bar" style="width: 30%; height: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; animation: shimmer 1.5s infinite;"></div>' +
            '</div>' +
          '</div>';
      }
      html += '</div>';
      list.innerHTML = html;
    }
  },

  // ── Playlists Deezer ─────────────────────────────────────────────────────
  renderPlaylists: function(playlists) {
    var grid = el('dz-playlists-grid');
    if (!grid) return;

    if (!playlists.length) {
      grid.innerHTML = '<p class="empty-state">Aucune playlist trouvée</p>';
      return;
    }

    // Sauvegarde dans l'état global
    State.allPlaylists = playlists;

    // Récupérer le mode de tri actuel de l'UI si disponible, sinon utiliser recent
    var sortSelectEl = el('dz-playlists-sort-select');
    if (sortSelectEl) {
      State.playlistSortMode = sortSelectEl.value;
    }

    console.log("[Deezer] Tri des playlists en cours. Mode =", State.playlistSortMode);

    try {
      if (State.playlistSortMode === 'opened') {
        // Tri par date de dernière ouverture (dz_playlist_history)
        var history = {};
        try {
          history = JSON.parse(localStorage.getItem('dz_playlist_history') || '{}');
        } catch (e) {}

        playlists.sort(function(a, b) {
          var openedA = parseInt(history[a.id] || 0, 10);
          var openedB = parseInt(history[b.id] || 0, 10);
          if (openedA !== openedB) {
            return openedB - openedA; // Plus récemment ouvert d'abord
          }
          // Fallback sur l'id ou la date de mod
          return (b.id || 0) - (a.id || 0);
        });
      } else if (State.playlistSortMode === 'alpha') {
        // Tri par ordre alphabétique A-Z
        playlists.sort(function(a, b) {
          var titleA = (a.title || '').toLowerCase();
          var titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
      } else if (State.playlistSortMode === 'tracks_desc') {
        // Tri par nombre de pistes décroissant
        playlists.sort(function(a, b) {
          var tracksA = parseInt(a.nb_tracks || 0, 10);
          var tracksB = parseInt(b.nb_tracks || 0, 10);
          return tracksB - tracksA;
        });
      } else {
        // Par défaut / recent : Tri par date d'activité ou modification récente
        playlists.sort(function(a, b) {
          var timeA = parseInt(a.last_track_added_at || 0, 10) * 1000;
          var timeB = parseInt(b.last_track_added_at || 0, 10) * 1000;

          // Si égal à 0, se replier sur creation_date
          if (timeA === 0) {
            if (a.creation_date) {
              if (typeof a.creation_date === 'string') {
                timeA = new Date(a.creation_date.replace(/-/g, '/')).getTime() || 0;
              } else if (typeof a.creation_date === 'number') {
                timeA = a.creation_date;
              }
            }
          }
          if (timeB === 0) {
            if (b.creation_date) {
              if (typeof b.creation_date === 'string') {
                timeB = new Date(b.creation_date.replace(/-/g, '/')).getTime() || 0;
              } else if (typeof b.creation_date === 'number') {
                timeB = b.creation_date;
              }
            }
          }

          if (timeA !== timeB) {
            return timeB - timeA; // Le plus actif/récemment modifié d'abord
          }
          return (b.id || 0) - (a.id || 0);
        });
      }
    } catch (e) {
      console.warn('Erreur lors du tri des playlists :', e);
    }

    // Gestion du nombre d'éléments à afficher (par défaut seuls 4)
    var playlistsToRender = playlists;
    if (!State.playlistsExpanded) {
      playlistsToRender = playlists.slice(0, 4);
    }

    console.log("[Deezer] Rendu des playlists : expanded =", State.playlistsExpanded, "nb_rendu =", playlistsToRender.length, "sur total =", playlists.length);

    grid.innerHTML = '';

    // Masquer ou afficher le sélecteur de tri en fonction de la taille
    var sortContainer = el('dz-playlists-sort-bar');
    if (sortContainer) {
      // On n'affiche le sélecteur de tri que si on a tout affiché (State.playlistsExpanded est true)
      sortContainer.style.display = State.playlistsExpanded ? 'flex' : 'none';
    }

    if (State.playlistsExpanded) {
      // --- NOUVELLE MISE EN FORME : Liste hyper pratique pour tablettes (Galaxy Tab A8) ---
      grid.className = 'list-playlists-modern';

      playlistsToRender.forEach(function(pl) {
        var cover = pl.picture_medium || pl.picture || '';
        var count = pl.nb_tracks ? pl.nb_tracks + ' pistes' : '0 piste';

        var row = document.createElement('div');
        row.className = 'playlist-row-item fade-in';
        row.innerHTML =
          '<div class="playlist-row-left" style="display: flex; align-items: center; gap: 16px; flex: 1; cursor: pointer; min-width: 0;">' +
            '<img class="playlist-row-cover" src="' + esc(cover) + '" style="width: 56px; height: 56px; border-radius: 12px; object-fit: cover; border: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;" />' +
            '<div class="playlist-row-details" style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">' +
              '<span class="playlist-row-title" style="font-size: 16px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + esc(pl.title || 'Playlist') + '</span>' +
              '<span class="playlist-row-meta" style="font-size: 13px; color: rgba(255,255,255,0.5);">' + esc(count) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="playlist-row-actions" style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">' +
            '<button class="playlist-row-play-btn" title="Lire la playlist directement" style="background: var(--accent, #7c6cf6); border: none; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; transition: all 0.2s; box-shadow: 0 4px 12px rgba(124, 108, 246, 0.3); outline: none;">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="transform: translateX(1px);"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
            '</button>' +
            '<button class="playlist-row-open-btn" title="Voir les morceaux" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px 16px; font-size: 13px; font-weight: 500; color: #ffffff; cursor: pointer; transition: all 0.2s; outline: none;">' +
              'Ouvrir' +
            '</button>' +
          '</div>';

        // Clic sur la partie gauche ou le bouton "Ouvrir" -> ouvre les morceaux
        var openPlaylistFn = function() {
          Deezer.openPlaylist(pl.id, pl.title, cover, count);
        };
        row.querySelector('.playlist-row-left').addEventListener('click', openPlaylistFn);
        row.querySelector('.playlist-row-open-btn').addEventListener('click', openPlaylistFn);

        // Clic sur le bouton de lecture directe
        row.querySelector('.playlist-row-play-btn').addEventListener('click', function(e) {
          e.stopPropagation();
          Deezer.playPlaylistInstantly(pl.id, pl.title, cover);
        });

        grid.appendChild(row);
      });
    } else {
      // Mode grille classique sur 1 ligne pour l'accueil (limité à 4 playlists)
      grid.className = 'grid-playlists-modern';

      playlistsToRender.forEach(function(pl) {
        var cover = pl.picture_medium || pl.picture || '';
        var count = pl.nb_tracks ? pl.nb_tracks + ' pistes' : '';
        var card = createCard({
          cover: cover,
          title: pl.title || 'Playlist',
          meta: count,
          onClick: function() { Deezer.openPlaylist(pl.id, pl.title, cover, count); },
        });
        grid.appendChild(card);
      });
    }

    // Enlever le défilement horizontal (grid--scrollable) pour afficher une grille nette sur 1 ligne (ou plusieurs si déployé)
    grid.classList.remove('grid--scrollable');

    // Synchroniser le bouton d'affichage (Tout afficher vs Afficher moins)
    var toggleBtn = el('dz-toggle-playlists');
    if (toggleBtn) {
      if (playlists.length <= 4) {
        toggleBtn.style.display = 'none';
      } else {
        toggleBtn.style.display = 'block';
        toggleBtn.textContent = State.playlistsExpanded ? 'Afficher moins' : 'Tout afficher';
      }
    }
  },

  // ── Morceaux d'une playlist/album ────────────────────────────────────────
  renderTracks: function(tracks, context) {
    tracks = tracks || [];
    context = context || {};

    // 1. Vérifier si la liste de morceaux actuellement affichée est strictement identique pour éviter de fatiguer le DOM
    if (State.originalTracks && State.originalTracks.length === tracks.length) {
      var isIdentical = true;
      for (var i = 0; i < tracks.length; i++) {
        if (String(State.originalTracks[i].id) !== String(tracks[i].id)) {
          isIdentical = false;
          break;
        }
      }
      var contextMatches = false;
      if (State.tracksContext) {
        if (context.playlistId !== undefined && context.playlistId !== null && String(State.tracksContext.playlistId) === String(context.playlistId)) {
          contextMatches = true;
        } else if (context.albumId !== undefined && context.albumId !== null && String(State.tracksContext.albumId) === String(context.albumId)) {
          contextMatches = true;
        }
      }
      if (isIdentical && contextMatches) {
        console.log("[Deezer] Liste de morceaux identique détectée, évitement d'un re-rendu inutile.");
        return;
      }
    }

    State.originalTracks = tracks;
    State.tracksContext = context;

    // Vérifier si des données d'ajout récent valides existent
    var hasRecentData = (tracks || []).some(function(t) {
      return t.time_add && t.time_add > 0;
    });

    var defaultSort = 'default';
    // Si nous sommes dans une playlist et qu'elle contient des dates d'ajout valides, on trie par "recent" par défaut
    if (context && context.playlistId !== undefined && context.playlistId !== null && hasRecentData) {
      defaultSort = 'recent';
    }

    State.sortedTracks = State.originalTracks.slice();

    // Reset sort select
    var sortSelect = el('dz-sort-select');
    if (sortSelect) {
      sortSelect.value = defaultSort;
      
      // Désactiver l'option d'ajout récent si aucun morceau n'a de date d'ajout valide
      var recentOption = sortSelect.querySelector('option[value="recent"]');
      if (recentOption) {
        if (hasRecentData) {
          recentOption.disabled = false;
          recentOption.textContent = 'Ajoutés récemment';
        } else {
          recentOption.disabled = true;
          recentOption.textContent = 'Ajoutés récemment (Non dispo)';
        }
      }
    }

    var sortBar = el('dz-tracks-sort-bar');
    if (sortBar) {
      if (context && context.playlistId !== undefined && context.playlistId !== null) {
        sortBar.style.display = 'flex';
      } else {
        sortBar.style.display = 'none';
      }
    }

    // Appliquer le tri par défaut si 'recent' est sélectionné
    if (defaultSort === 'recent') {
      State.sortedTracks.sort(function(a, b) {
        var tA = a.time_add || 0;
        var tB = b.time_add || 0;
        return tB - tA;
      });
    }

    this.renderTracksOnly(State.sortedTracks, State.tracksContext);
  },

  renderTracksOnly: function(tracks, context) {
    var list = el('dz-tracks-list');
    if (!list) return;

    if (!tracks.length) {
      list.innerHTML = '<p class="empty-state">Aucun morceau trouvé</p>';
      return;
    }

    var playlistId = context && context.playlistId !== undefined && context.playlistId !== null ? context.playlistId : null;
    var albumId = context && context.albumId !== undefined && context.albumId !== null ? context.albumId : null;

    var playAllBtn = el('dz-play-all');
    if (playAllBtn && tracks[0]) {
      playAllBtn.onclick = function() {
        console.log("[Queue] 'Lire tout' cliqué. Initialisation de la file avec " + tracks.length + " morceaux.");
        State.customQueue = tracks.slice();
        State.customQueueIndex = 0;
        State.customQueueActive = true;
        State.queueTransitionTriggered = false;
        State.lastPlayInitiatedAt = Date.now();
        
        highlightActiveTrackInUI(tracks[0].id);
        Deezer.playTrackIsolated(tracks[0].id, tracks[0].title);
      };
    }

    list.innerHTML = '';
    State.currentlyHighlightedTrackEl = null;

    // Incrémenter l'ID de rendu pour annuler l'éventuelle tâche asynchrone de rendu précédente
    State.activeTrackRenderId = (State.activeTrackRenderId || 0) + 1;
    var currentRenderId = State.activeTrackRenderId;

    var CHUNK_SIZE = 25; // Quantité de morceaux à injecter par lot (très fluide même sur appareils modestes)
    var index = 0;

    // Déterminer le morceau à mettre en surbrillance lors du rendu
    var activeTrackId = null;
    if (State.customQueueActive && State.customQueue && State.customQueue[State.customQueueIndex]) {
      activeTrackId = State.customQueue[State.customQueueIndex].id;
    } else if (State.mediaState && State.mediaState.track_id) {
      activeTrackId = State.mediaState.track_id;
    }

    // Supprimer l'ancien écouteur de scroll pour éviter les fuites de mémoire
    if (State.tracksScrollListener) {
      list.removeEventListener('scroll', State.tracksScrollListener);
      State.tracksScrollListener = null;
    }

    function renderNextChunk() {
      // Annulation propre si une autre playlist ou une recherche/tri a été déclenché entre temps
      if (State.activeTrackRenderId !== currentRenderId) {
        return;
      }

      var limit = Math.min(index + CHUNK_SIZE, tracks.length);
      var fragment = document.createDocumentFragment();

      for (var i = index; i < limit; i++) {
        var track = tracks[i];
        var item = document.createElement('div');
        
        var isActive = activeTrackId && String(track.id) === String(activeTrackId);
        // OPTIMISATION 2 : Limite l'animation "fade-in" aux 20 premiers éléments pour alléger le rendu sur tablette
        var animClass = (i < 20) ? ' fade-in' : '';
        item.className = 'track-item' + animClass + (isActive ? ' track-item--active' : '');
        item.setAttribute('data-track-id', track.id);

        if (isActive) {
          State.currentlyHighlightedTrackEl = item;
        }

        var artistName = (track.artist ? track.artist.name : null) || track.artist || '—';
        item.innerHTML =
          '<span class="track-item__num">' + (i + 1) + '</span>' +
          '<div class="track-item__info">' +
            '<p class="track-item__title">' + esc(track.title || '—') + '</p>' +
            '<p class="track-item__artist">' + esc(artistName) + '</p>' +
          '</div>' +
          '<span class="track-item__duration">' + formatTime(track.duration || 0) + '</span>';
        
        (function(trackIdx, trackObj) {
          item.addEventListener('click', function() {
            console.log("[Queue] Morceau cliqué à l'index " + trackIdx + ". Initialisation de la file avec " + tracks.length + " morceaux.");
            State.customQueue = tracks.slice();
            State.customQueueIndex = trackIdx;
            State.customQueueActive = true;
            State.queueTransitionTriggered = false;
            State.lastPlayInitiatedAt = Date.now();

            highlightActiveTrackInUI(trackObj.id);
            Deezer.playTrackIsolated(trackObj.id, trackObj.title);
          });
        })(i, track);

        fragment.appendChild(item);
      }

      list.appendChild(fragment);
      index = limit;
    }

    // Définir une fonction pour forcer le rendu jusqu'à un ID de morceau spécifique
    State.renderNextTracksToIncludeId = function(targetTrackId) {
      if (State.activeTrackRenderId !== currentRenderId) return;
      
      // Trouver l'index du morceau cible
      var targetIndex = -1;
      for (var j = 0; j < tracks.length; j++) {
        if (String(tracks[j].id) === String(targetTrackId)) {
          targetIndex = j;
          break;
        }
      }

      if (targetIndex !== -1 && targetIndex >= index) {
        console.log("[LazyLoad] Rendu forcé des pistes jusqu'à l'index " + targetIndex + " pour trouver le morceau actif.");
        while (index <= targetIndex && index < tracks.length) {
          renderNextChunk();
        }
      }
    };

    // OPTIMISATION 3 : Rendre assez de tranches pour couvrir une position de défilement ciblée
    State.renderNextTracksToScrollPos = function(targetScrollTop) {
      if (State.activeTrackRenderId !== currentRenderId) return;
      while (list.scrollHeight < targetScrollTop + list.clientHeight && index < tracks.length) {
        renderNextChunk();
      }
    };

    // Rendu différé du premier lot via requestAnimationFrame pour ne pas bloquer les premières frames de la transition du sheet
    requestAnimationFrame(function() {
      if (State.activeTrackRenderId === currentRenderId) {
        renderNextChunk();
      }
    });

    // Ecouteur de scroll pour charger les morceaux suivants de manière paresseuse (lazy load)
    if (index < tracks.length) {
      var onScroll = function() {
        if (State.activeTrackRenderId !== currentRenderId) {
          list.removeEventListener('scroll', onScroll);
          return;
        }
        // Se déclenche si l'utilisateur défile à moins de 350px du bas du conteneur
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 350) {
          renderNextChunk();
          if (index >= tracks.length) {
            list.removeEventListener('scroll', onScroll);
            if (State.tracksScrollListener === onScroll) {
              State.tracksScrollListener = null;
            }
          }
        }
      };
      State.tracksScrollListener = onScroll;
      list.addEventListener('scroll', onScroll);
    }
  },

  // ── Albums d'un artiste ──────────────────────────────────────────────────
  renderAlbums: function(albums) {
    var grid = el('dz-albums-grid');
    if (!grid) return;

    if (!albums.length) {
      grid.innerHTML = '<p class="empty-state">Aucun album trouvé</p>';
      return;
    }

    grid.innerHTML = '';
    albums.forEach(function(album) {
      var cover = album.cover_medium || album.cover || '';
      var card = createCard({
        cover: cover,
        title: album.title || 'Album',
        meta: album.release_date ? album.release_date.slice(0, 4) : '',
        onClick: function() { Deezer.openAlbum(album.id, album.title, cover, ''); },
      });
      grid.appendChild(card);
    });
  },

  // ── Résultats de recherche ────────────────────────────────────────────────
  renderSearchResults: function(results, filter) {
    var list = el('dz-search-results');
    var title = el('dz-search-title');
    if (!list) return;

    if (title) title.textContent = results.length + ' résultat' + (results.length > 1 ? 's' : '');

    if (!results.length) {
      list.innerHTML = '<p class="empty-state">Aucun résultat</p>';
      return;
    }

    list.innerHTML = '';
    results.forEach(function(item) {
      var elem = createResultItem(item, filter);
      list.appendChild(elem);
    });
  },

  // ── Sélecteur de sessions média ──────────────────────────────────────────
  renderSessionPicker: function(sessions) {
    var picker = el('session-picker');
    var list   = el('session-picker-list');
    if (!picker || !list) return;

    // Cache : ne redessine que si la liste a changé
    var key = JSON.stringify((sessions || []).map(function(s) { return s.source_id + s.status + s.is_selected; }));
    if (list.getAttribute('data-last-key') === key) return;
    list.setAttribute('data-last-key', key);

    // Masque le picker s'il y a 0 ou 1 session
    if (!sessions || sessions.length <= 1) {
      picker.style.display = 'none';
      return;
    }

    picker.style.display = '';
    list.innerHTML = '';

    sessions.forEach(function(s) {
      var btn = document.createElement('button');
      btn.className = 'session-chip' + (s.is_selected ? ' session-chip--active' : '');
      btn.setAttribute('data-source-id', s.source_id);
      btn.title = s.source_id;

      var dot = s.status === 'playing'
        ? '<span class="session-chip__dot session-chip__dot--playing"></span>'
        : '<span class="session-chip__dot"></span>';

      btn.innerHTML = dot + '<span class="session-chip__name">' + esc(s.player_name) + '</span>';
      btn.addEventListener('click', function() {
        Media.command('session.select', { source_id: s.source_id });
      });
      list.appendChild(btn);
    });
  },

  // ── Applications audio & Mixeur Volume ─────────────────────────────────────
  updateAudioApps: function(state) {
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
  },

  // ── Périphériques Audio (Sortie & Entrée) ────────────────────────────────
  updateAudioDevices: function(state) {
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
  },

  selectAudioDevice: function(deviceId, direction) {
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
  },

  // ── Options & Gestion Bluetooth ──────────────────────────────────────────
  updateBluetooth: function(state) {
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
  },

  toggleBluetoothPower: function(enabled) {
    send({
      type: 'bluetooth.command',
      command: 'bluetooth.toggle',
      enabled: enabled
    });
    UI.showToast("Bluetooth " + (enabled ? "activé" : "désactivé"), "info");
  },

  scanBluetooth: function() {
    send({
      type: 'bluetooth.command',
      command: 'bluetooth.scan'
    });
    UI.showToast("Recherche des appareils Bluetooth...", "info");
  },

  toggleBluetoothDeviceConnection: function(deviceId, connect) {
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
  },

  // ── Toast notifications ──────────────────────────────────────────────────
  showToast: function(msg, type) {
    if (type === undefined) type = 'info';
    UI.showToast(msg, type); // évite la récursion — voir implémentation ci-dessous
  },
};

// Séparation pour éviter la recursion dans showToast
UI.showToast = function(msg, type) {
  if (type === undefined) type = 'info';
  var toast = document.getElementById('cockpit-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cockpit-toast';
    toast.style.cssText =
      'position: fixed; bottom: calc(var(--footer-h) + 16px); left: 50%; transform: translateX(-50%); ' +
      'background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-pill); ' +
      'padding: 10px 20px; font-size: 13px; font-weight: 500; z-index: 9999; ' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5); transition: opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.color = type === 'error' ? 'var(--error)' : 'var(--text-primary)';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.style.opacity = '0'; }, 3000);
};

// ═══════════════════════════════════════════════════════════════════════════
// Composants réutilisables
// ═══════════════════════════════════════════════════════════════════════════

function createCard(options) {
  var cover = options.cover;
  var title = options.title;
  var meta = options.meta;
  var onClick = options.onClick;

  var div = document.createElement('div');
  div.className = 'card fade-in';
  div.innerHTML =
    '<div class="card__cover">' +
      (cover
        ? '<img src="' + esc(cover) + '" alt="' + esc(title) + '" loading="lazy" />'
        : '<div class="card__cover-placeholder">♪</div>'
      ) +
      '<div class="card__play-overlay">' +
        '<div class="card__play-btn">' +
          '<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card__info">' +
      '<p class="card__title">' + esc(title) + '</p>' +
      (meta ? '<p class="card__meta">' + esc(meta) + '</p>' : '') +
    '</div>';
  div.addEventListener('click', onClick);
  return div;
}

function createResultItem(item, filter) {
  var div = document.createElement('div');
  div.className = 'result-item fade-in';

  var cover = '', title = '', sub = '', onClick = function() {};

  if (filter === 'track') {
    cover = item.album ? item.album.cover_small : '';
    title = item.title || '';
    var artistName = item.artist ? item.artist.name : null;
    var albumTitle = item.album ? item.album.title : null;
    sub = [artistName, albumTitle].filter(Boolean).join(' • ');
    onClick = function() { Deezer.playTrack(item.id, item.title); };
  } else if (filter === 'artist') {
    cover = item.picture_small || item.picture || '';
    title = item.name || '';
    sub = item.nb_album ? item.nb_album + ' albums' : '';
    onClick = function() { Deezer.openArtist(item.id, item.name, item.picture_medium); };
  } else if (filter === 'album') {
    cover = item.cover_small || item.cover || '';
    title = item.title || '';
    sub = (item.artist ? item.artist.name : null) || '';
    var artistNameAlbum = item.artist ? item.artist.name : '';
    onClick = function() { Deezer.openAlbum(item.id, item.title, item.cover_medium, artistNameAlbum); };
  } else if (filter === 'playlist') {
    cover = item.picture_small || '';
    title = item.title || '';
    sub = item.nb_tracks ? item.nb_tracks + ' pistes' : '';
    onClick = function() { Deezer.openPlaylist(item.id, item.title, item.picture_medium, sub); };
  }

  div.innerHTML =
    (cover
      ? '<img class="result-item__img" src="' + esc(cover) + '" alt="' + esc(title) + '" loading="lazy" />'
      : '<div class="result-item__img" style="background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--text-muted)">♪</div>'
    ) +
    '<div class="result-item__info">' +
      '<p class="result-item__title">' + esc(title) + '</p>' +
      (sub ? '<p class="result-item__sub">' + esc(sub) + '</p>' : '') +
    '</div>' +
    '<div class="result-item__play">' +
      '<svg viewBox="0 0 24 24" fill="white" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
    '</div>';

  div.addEventListener('click', onClick);
  return div;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitaires
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
    { id: 'tab-dashboard', url: '/tabs/dashboard.html?v=' + v },
    { id: 'tab-deezer',    url: '/tabs/deezer.html?v=' + v },
    { id: 'tab-media',     url: '/tabs/media.html?v=' + v  },
    { id: 'tab-endurance', url: '/tabs/endurance.html?v=' + v },
    { id: 'tab-shortcuts', url: '/tabs/shortcuts.html?v=' + v }
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

function initEvents() {
  // ── Navigation par onglets ──────────────────────────────────────────────
  // [data-tab] exclut le bouton "Automobile", qui ne navigue pas lui-même :
  // il déplie/replie son sous-menu (Endurance / Cockpit), géré plus bas.
  document.querySelectorAll('.tab-nav__btn[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tabName = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-nav__btn').forEach(function(b) {
        b.classList.remove('tab-nav__btn--active');
      });
      document.querySelectorAll('.tab-panel').forEach(function(p) {
        p.classList.remove('tab-panel--active');
      });
      btn.classList.add('tab-nav__btn--active');
      var tabEl = el('tab-' + tabName);
      if (tabEl) tabEl.classList.add('tab-panel--active');

      // Le bouton "Automobile" reste mis en évidence quand un de ses
      // sous-onglets (Endurance / Cockpit) est l'onglet actif.
      var autoParentToggle = el('nav-toggle-automobile');
      if (autoParentToggle) {
        var isInAutoGroup = !!btn.closest('#nav-group-automobile');
        autoParentToggle.classList.toggle('tab-nav__btn--active', isInAutoGroup);
      }

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
    });
  });

  // ── Sous-menu "Automobile" (Endurance / Cockpit) ────────────────────────
  var autoToggle = el('nav-toggle-automobile');
  var autoGroup = el('nav-group-automobile');
  if (autoToggle && autoGroup) {
    autoToggle.addEventListener('click', function() {
      var isOpen = autoGroup.classList.toggle('tab-nav__group--open');
      autoToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

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

function startClock() {
  function tick() {
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var h = (hours < 10 ? '0' : '') + hours;
    var m = (minutes < 10 ? '0' : '') + minutes;
    setText('clock', h + ':' + m);
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
  });
}

document.addEventListener('DOMContentLoaded', init);

