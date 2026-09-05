/**
 * Cockpit OS — Commandes sortantes (média, audio, Deezer). Dépend de app-core.js
 * et app-ws.js (send), et de app-ui-*.js (skeletons/toast) au moment de l'appel.
 */

'use strict';

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
    UI.showToast("Chargement de " + title, "info");
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
