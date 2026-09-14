/**
 * Cockpit OS — Connexion WebSocket, routage des messages entrants, file
 * d'attente Deezer personnalisée. Dépend de app-core.js.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket — Connexion & messagerie
// ═══════════════════════════════════════════════════════════════════════════

function connectWS() {
  UI.setStatus('connecting', 'Connexion…');

  var ws = new WebSocket(CONFIG.WS_URL);
  State.ws = ws;

  ws.onopen = function() {
    State.reconnectCount = 0;
    UI.setStatus('connected', 'Connecté au PC');
    // Demande de l'état initial au démarrage
    send({ type: 'media.state.request' });
    send({ type: 'audio.state.request' });
    send({ type: 'system.state.request' });
    send({ type: 'apps.state.request' });
    send({ type: 'wifi.state.request' });
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
      UI.updateHeaderNotch(data);
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
      UI.updateSetupBluetooth(data);
      break;

    case 'system.state':
      State.systemState = data;
      UI.updateSystemPanel(data);
      break;

    case 'wifi.state':
      State.wifiState = data;
      UI.updateSetupWifi(data);
      break;

    case 'wifi.error':
      if (data.message) UI.showToast(data.message, 'error');
      break;

    case 'apps.state':
      State.appsState = data;
      UI.updateAppsGrid(data);
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
          UI.showToast("Lecture de " + tracks[0].title, "info");
        } else {
          UI.showToast("La playlist est vide", "error");
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
