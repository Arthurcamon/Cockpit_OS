/**
 * Cockpit OS — Objet UI (base) : statut connexion, widgets "état média"
 * (5 emplacements dans l'UI), skeleton loaders, notifications toast.
 * Déclare `var UI = {...}` — DOIT être chargé avant app-ui-deezer.js et
 * app-ui-audio.js, qui étendent cet objet par assignation (UI.xxx = ...).
 * Dépend de app-core.js.
 */

'use strict';

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

  // ── Config par widget "état média" — un seul point de vérité pour du HTML
  // qui apparaît à 5 endroits différents dans l'UI (onglet Média, mini-player,
  // Dashboard, Deezer, sync Endurance). Voir _renderMediaWidget ci-dessous.
  MEDIA_WIDGET_CONFIGS: {
    media: {
      titleId: 'media-title', artistId: 'media-artist', albumId: 'media-album',
      emptyTitle: 'Aucune lecture en cours',
      sourceLabelId: 'media-source-label', playerNameSelector: '#media-player-name',
      coverImgId: 'media-cover-img', coverPlaceholderId: 'media-cover-placeholder',
      vinylRotation: true, playIconId: 'media-play-icon',
      shuffleId: 'media-shuffle', repeatId: 'media-repeat', repeatIconId: 'media-repeat-icon',
      progress: { fillId: 'media-progress-fill', thumbId: 'media-progress-thumb', posId: 'media-pos', durId: 'media-dur' },
    },
    sim: {
      titleId: 'sim-media-title', artistId: 'sim-media-artist',
      coverImgId: 'sim-media-cover', coverPlaceholderId: 'sim-media-cover-placeholder',
      playIconId: 'sim-media-play-icon',
      progress: { fillId: 'sim-media-progress', posId: 'sim-media-pos', durId: 'sim-media-dur' },
    },
    mini: {
      titleId: 'mini-title', artistId: 'mini-artist',
      coverImgId: 'mini-cover', coverPlaceholderId: 'mini-cover-placeholder',
      playIconId: 'mini-play-icon',
    },
    notch: {
      titleId: 'notch-title', artistId: 'notch-sub',
      // Version raccourcie par rapport aux autres widgets média — la notch
      // a peu de place (25% du header, split avec le jeu), "en cours" ne
      // tenait plus sans tronquer une fois les tailles de police augmentées.
      emptyTitle: 'Aucune lecture',
      coverImgId: 'notch-cover', coverPlaceholderId: 'notch-cover-placeholder',
    },
    // Sur-menu de la notch (étape 1) — même source State.mediaState, mêmes
    // commandes Media.* que le mini-lecteur/l'onglet Média, juste un jeu
    // d'IDs à part pour ce widget-ci.
    notchMenu: {
      titleId: 'notchmenu-title', artistId: 'notchmenu-artist',
      emptyTitle: 'Aucune lecture en cours',
      coverImgId: 'notchmenu-cover', coverPlaceholderId: 'notchmenu-cover-placeholder',
      playIconId: 'notchmenu-play-icon',
      shuffleId: 'notchmenu-shuffle', repeatId: 'notchmenu-repeat', repeatIconId: 'notchmenu-repeat-icon',
      progress: { fillId: 'notchmenu-progress-fill', thumbId: 'notchmenu-progress-thumb', posId: 'notchmenu-pos', durId: 'notchmenu-dur' },
    },
    dashboard: {
      titleId: 'dash-media-title', artistId: 'dash-media-artist',
      coverImgId: 'dash-media-cover', coverPlaceholderId: 'dash-media-cover-placeholder',
      playIconId: 'dash-media-play-icon',
      progress: { fillId: 'dash-media-progress', posId: 'dash-media-pos', durId: 'dash-media-dur' },
    },
    deezer: {
      titleId: 'dz-media-title', artistId: 'dz-media-artist',
      coverImgId: 'dz-media-cover', coverPlaceholderId: 'dz-media-cover-placeholder',
      playIconId: 'dz-media-play-icon',
      progress: { fillId: 'dz-media-progress', posId: 'dz-media-pos', durId: 'dz-media-dur' },
    },
  },

  // ── Rendu générique d'un widget "état média", piloté par une config de
  // MEDIA_WIDGET_CONFIGS (ids optionnels selon ce que le widget affiche).
  _renderMediaWidget: function(config, state) {
    if (config.titleId) setText(config.titleId, state.title || config.emptyTitle || 'Aucune lecture');
    if (config.artistId) setText(config.artistId, state.artist || '—');
    if (config.albumId) setText(config.albumId, state.album || '');
    if (config.sourceLabelId) {
      setText(config.sourceLabelId, state.source === 'simulation' ? 'Mode simulation' : 'Windows Media Session');
    }

    // Nom du lecteur source (ex: "Deezer Desktop")
    if (config.playerNameSelector) {
      document.querySelectorAll(config.playerNameSelector).forEach(function(playerEl) {
        if (state.player === 'deezer') {
          playerEl.textContent = '🎵 Deezer Desktop';
        } else if (state.player && state.player !== 'windows' && state.source !== 'simulation') {
          playerEl.textContent = state.player;
        } else {
          playerEl.textContent = '';
        }
      });
    }

    // Pochette
    var cover = state.cover_b64 || state.cover_url || '';
    var imgEls = document.querySelectorAll('#' + config.coverImgId);
    var placeholderEls = document.querySelectorAll('#' + config.coverPlaceholderId);
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

    // Rotation de la pochette (style vinyle) — uniquement l'onglet Média
    if (config.vinylRotation) {
      imgEls.forEach(function(imgEl) {
        var coverEl = imgEl.parentElement;
        if (coverEl) {
          if (state.status === 'playing') coverEl.classList.add('playing');
          else coverEl.classList.remove('playing');
        }
      });
    }

    // Bouton play/pause
    document.querySelectorAll('#' + config.playIconId).forEach(function(playIcon) {
      playIcon.innerHTML = state.status === 'playing'
        ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    });

    // Bouton Shuffle
    if (config.shuffleId) {
      document.querySelectorAll('#' + config.shuffleId).forEach(function(shuffleBtn) {
        shuffleBtn.classList.toggle('active', !!state.shuffle);
      });
    }

    // Bouton Repeat — icône change selon le mode
    if (config.repeatId) {
      document.querySelectorAll('#' + config.repeatId).forEach(function(repeatBtn) {
        var isActive = state.repeat && state.repeat !== 'none';
        repeatBtn.classList.toggle('active', isActive);
      });
    }

    if (config.repeatIconId) {
      document.querySelectorAll('#' + config.repeatIconId).forEach(function(icon) {
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
    }

    // Progression
    if (config.progress) {
      this._updateProgress(config.progress.fillId, config.progress.thumbId || null, config.progress.posId, config.progress.durId, state);
    }
  },

  // ── Lecteur principal (onglet Media) ─────────────────────────────────────
  updateMediaPlayer: function(state) {
    this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.media, state);
    // Synchronisation de l'onglet Endurance (Sim) si présent
    this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.sim, state);
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
    this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.mini, state);
  },

  // ── Notch (header) — mémorise l'état de chaque moitié (musique/jeu) pour
  // pouvoir recalculer l'enveloppe commune (.notch--idle/--playing) sans
  // que les deux fonctions ci-dessous aient besoin de se connaître.
  _notchState: { music: 'idle', game: 'idle' },

  // Neutre uniquement si musique ET jeu sont tous les deux inactifs ; la
  // respiration du glow (.notch--playing) ne suit que la musique en
  // lecture réelle — le jeu "en cours" a son propre point pulsant local
  // (.notch__game-dot), pas d'effet sur l'enveloppe du glow.
  _refreshNotchShell: function() {
    var notch = el('header-notch');
    if (!notch) return;
    var s = this._notchState;
    notch.classList.toggle('notch--idle', s.music === 'idle' && s.game === 'idle');
    notch.classList.toggle('notch--playing', s.music === 'playing');
  },

  // ── Moitié musique de la notch — toujours visible, passe en style
  // atténué ([data-state="idle"]) tant qu'aucun titre n'est en cours, avec
  // un texte de substitution plutôt que de disparaître. [data-state=
  // "playing"] pilote à la fois la boucle de l'égaliseur et (via
  // _refreshNotchShell) la pulsation du glow commun ; le titre/sous-titre
  // font un fondu quand le morceau change (voir .is-fading).
  updateHeaderNotch: function(state) {
    var musicEl = el('notch-music');
    if (!musicEl) return;
    var hasTrack = !!(state && state.title);
    var isPlaying = hasTrack && state && state.status === 'playing';
    var musicState = !hasTrack ? 'idle' : (isPlaying ? 'playing' : 'paused');
    musicEl.setAttribute('data-state', musicState);
    this._notchState.music = musicState;

    var newTitle = (state && state.title) || '';
    var txt = musicEl.querySelector('.notch__text');
    var titleChanged = txt && this._lastNotchTitle !== undefined && newTitle !== this._lastNotchTitle;
    this._lastNotchTitle = newTitle;

    if (titleChanged) {
      // Fondu sortant instantané (transition coupée), texte remplacé pendant
      // qu'il est invisible, puis fondu entrant en retirant la classe —
      // reflow forcé entre les deux pour que le navigateur "voie" l'état
      // opacity:0 avant de rejouer la transition.
      txt.classList.add('is-fading');
      this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.notch, state || {});
      void txt.offsetWidth;
      txt.classList.remove('is-fading');
    } else {
      this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.notch, state || {});
    }

    // Sur-menu (colonne musique) — même state, même widget générique, pas
    // de logique séparée à maintenir. Étape 3 : même crossfade que la notch
    // fermée (pochette/titre/artiste ensemble via #notchmenu-music-info),
    // basé sur le même titleChanged pour rester synchronisé.
    var menuInfo = el('notchmenu-music-info');
    if (titleChanged && menuInfo) {
      menuInfo.classList.add('is-fading');
      this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.notchMenu, state || {});
      void menuInfo.offsetWidth;
      menuInfo.classList.remove('is-fading');
    } else {
      this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.notchMenu, state || {});
    }
    var menuCol = document.querySelector('.notch-menu__col--music');
    if (menuCol) menuCol.setAttribute('data-state', musicState);
    // Boîte de pochette (220x220, toujours visible) — distincte du glyphe
    // ♪ de substitution (#notchmenu-cover-placeholder, à l'intérieur) : ne
    // JAMAIS masquer cette boîte elle-même, seul son fond change (is-active),
    // sinon l'image réelle qu'elle contient disparaît avec elle.
    var menuCoverBox = el('notchmenu-cover-box');
    if (menuCoverBox) menuCoverBox.classList.toggle('is-active', hasTrack);
    var menuTitle = el('notchmenu-title');
    if (menuTitle) menuTitle.classList.toggle('is-active', hasTrack);
    var menuArtist = el('notchmenu-artist');
    if (menuArtist) menuArtist.classList.toggle('is-active', hasTrack);

    this._refreshNotchShell();
  },

  // ── Moitié jeu de la notch fermée + colonne jeu du sur-menu — PAS ENCORE
  // BRANCHÉE à une source réelle confirmée par le PC (aucun endpoint ne
  // suit "quel jeu est en cours" indépendamment de l'onglet Raccourcis :
  // voir State.steamRunning, alimenté de façon optimiste par
  // ShortcutsController.launchGame). Prête à être appelée avec
  // state = {status:'idle'|'launching'|'running', name}. Pas de jaquette
  // reprise ici (même si le jeu en a une, cf. cover_path/shortcuts.js) :
  // glyphe manette générique sur la notch, fond neutre sur le sur-menu,
  // seule la couleur/l'état changent. Temps de session/total :
  // aucune donnée réelle nulle part dans l'app pour l'instant (signalé à
  // l'utilisateur) — laissés à "—" tant que ce n'est pas ajouté côté serveur.
  updateHeaderGame: function(state) {
    var status = (state && state.status) || 'idle';
    var name = (state && state.name) || null;
    var isRunning = status === 'running';
    var isLaunching = status === 'launching';

    var gameEl = el('notch-game');
    if (gameEl) {
      gameEl.setAttribute('data-state', status);
      setText('notch-game-title', name || 'Aucun jeu');
    }
    this._notchState.game = status;
    this._refreshNotchShell();

    // Sur-menu (colonne jeu).
    setText('notchmenu-game-title', name || 'Aucun jeu lancé');
    var menuTitle = el('notchmenu-game-title');
    if (menuTitle) menuTitle.classList.toggle('is-active', isRunning || isLaunching);
    var menuCover = el('notchmenu-game-cover');
    if (menuCover) menuCover.classList.toggle('is-active', isRunning);
    var menuDot = el('notchmenu-game-dot');
    if (menuDot) menuDot.classList.toggle('is-active', isRunning);
    setText('notchmenu-game-status-txt', isRunning ? 'En cours d’exécution' : (isLaunching ? 'Lancement…' : 'Inactif'));
    var quitBtn = el('notchmenu-quit-btn');
    if (quitBtn) quitBtn.disabled = !isRunning;
  },

  // ── Tableau de Bord (Dashboard Media Update) ──────────────────────────────
  updateDashboardMedia: function(state) {
    this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.dashboard, state);
  },

  // ── Deezer Media Update ──────────────────────────────────────────────────
  updateDeezerMedia: function(state) {
    this._renderMediaWidget(this.MEDIA_WIDGET_CONFIGS.deezer, state);

    // Avertissement CDP : uniquement sur false EXPLICITE — deezer_cdp_available
    // vaut undefined tant qu'aucun cycle de vérification n'a encore tourné
    // côté serveur (voir services/windows_media.py), et true dès que le
    // raccourci "Deezer (Cockpit OS)" (--remote-debugging-port=9222) est
    // bien celui utilisé. Ne concerne que le lecteur Deezer — un autre
    // lecteur actif (Chrome, Spotify...) ne doit jamais déclencher ceci.
    var warningEl = el('dz-cdp-warning');
    if (warningEl) {
      // state.player vaut "Deezer Desktop" côté backend quand is_deezer est
      // vrai (services/windows_media.py) — PAS "deezer" en minuscule (cf. la
      // branche playerNameSelector juste au-dessus, qui teste 'deezer' et ne
      // matche donc jamais : bug préexistant sans impact visuel puisque son
      // repli affiche la même chaîne, non touché ici pour rester focalisé).
      var isDeezer = state && state.player === 'Deezer Desktop';
      warningEl.hidden = !(isDeezer && state.deezer_cdp_available === false);
    }
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

  // ── Toast notifications ──────────────────────────────────────────────────
  showToast: function(msg, type) {
    if (type === undefined) type = 'info';
    UI.showToast(msg, type); // évite la récursion — voir implémentation ci-dessous
  },
};

// Séparation pour éviter la recursion dans showToast
// duration : délai configurable avant le fondu de sortie (groupe 5 des
// animations, 3000ms par défaut) — slide-in/fade-out via transform+opacity.
UI.showToast = function(msg, type, duration) {
  if (type === undefined) type = 'info';
  if (duration === undefined) duration = 3000;
  var toast = document.getElementById('cockpit-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cockpit-toast';
    toast.style.cssText =
      'position: fixed; bottom: calc(var(--footer-h) + 16px); left: 50%; ' +
      'background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-pill); ' +
      'padding: 10px 20px; font-size: 17px; font-weight: 500; z-index: 9999; ' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.5); ' +
      'opacity: 0; transform: translate(-50%, 14px); ' +
      'transition: opacity 220ms ease, transform 220ms ease;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.color = type === 'error' ? 'var(--error)' : 'var(--text-primary)';
  // Repart de l'état caché (reflow forcé) avant de rejouer le slide-in, pour
  // qu'un second toast déclenché pendant l'affichage du premier retrouve
  // bien son fondu d'entrée plutôt qu'un simple maintien à l'état visible.
  toast.style.transition = 'none';
  toast.style.opacity = '0';
  toast.style.transform = 'translate(-50%, 14px)';
  void toast.offsetWidth;
  toast.style.transition = 'opacity 220ms ease, transform 220ms ease';
  toast.style.opacity = '1';
  toast.style.transform = 'translate(-50%, 0)';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 14px)';
  }, duration);
};
