/**
 * Cockpit OS — Navigation par vues (sheets Deezer, breadcrumb) et tri des pistes.
 * Dépend de app-core.js.
 */

'use strict';

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
