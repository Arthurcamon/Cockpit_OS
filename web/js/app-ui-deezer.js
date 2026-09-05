/**
 * Cockpit OS — Rendu UI Deezer (playlists, morceaux, albums, recherche,
 * sélecteur de session) + composants réutilisables (cartes, items résultat).
 * Étend `UI` par assignation — DOIT être chargé après app-ui-core.js.
 * Dépend de app-core.js, app-navigation.js (showView) et app-commands.js (Deezer).
 */

'use strict';

// ── Playlists Deezer ─────────────────────────────────────────────────────
UI.renderPlaylists = function(playlists) {
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
};

// ── Morceaux d'une playlist/album ────────────────────────────────────────
UI.renderTracks = function(tracks, context) {
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
};

UI.renderTracksOnly = function(tracks, context) {
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
};

// ── Albums d'un artiste ──────────────────────────────────────────────────
UI.renderAlbums = function(albums) {
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
};

// ── Résultats de recherche ────────────────────────────────────────────────
UI.renderSearchResults = function(results, filter) {
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
};

// ── Sélecteur de sessions média ──────────────────────────────────────────
UI.renderSessionPicker = function(sessions) {
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
