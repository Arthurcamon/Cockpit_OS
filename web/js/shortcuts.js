/* ═══════════════════════════════════════════════════════════════════════════
   COCKPIT OS — SHORTCUTS TAB CONTROLLER (ShortcutsController)
   Grille en 4 zones (Apps rapides / Macros / Steam / Système) — refonte
   2026-09-03, voir Design_code/refonte-ui-2026.md pour la référence visuelle.
   ═══════════════════════════════════════════════════════════════════════════ */
window.ShortcutsController = (function() {
  var isTabActive = false;
  var currentActionModal = null;

  var APPS_PAGE_SIZE = 8;   // grille 4x2
  var STEAM_PAGE_SIZE = 3;  // 3 vignettes par page, cf. mockup

  var appsList = [];
  var appsPage = 0;
  var appsRunning = {};
  var appsStatusTimer = null;

  var steamList = [];
  var steamPage = 0;

  // Jeu Steam actuellement mis en évidence "en cours d'exécution" (groupe 4
  // des animations) — mémoire optimiste côté front uniquement, au même
  // titre que activeSceneId ci-dessous : aucune détection de processus
  // Steam n'existe côté backend (launch_steam_game ne fait que déclencher
  // le protocole steam://, pas de endpoint de statut comme pour les apps).
  var runningSteamAppId = null;

  // Macro actuellement mise en évidence (groupe 2 des animations) — mémoire
  // optimiste côté front uniquement : aucune notion de "scène active" n'est
  // remontée par le backend (run_scene est une exécution ponctuelle, pas un
  // toggle, cf. core/shortcuts.py). Activer une autre macro fait
  // automatiquement retomber celle-ci en fondu à l'état neutre.
  var activeSceneId = null;

  // Toutes les routes /shortcuts/* exigent le token d'authentification
  // (voir window.AUTH_TOKEN, injecté par le serveur — cf. core/shortcuts.py).
  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers['Authorization'] = 'Bearer ' + (window.AUTH_TOKEN || '');
    return fetch(url, opts);
  }

  // Icons SVG string helpers
  var ICONS = {
    app: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    scene: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };

  // Icônes par app, retrouvées via le champ icon_class renvoyé par
  // /shortcuts/apps ("icon-discord", "icon-browser"...) — un pictogramme
  // distinct par app plutôt que la même icône générique répétée partout.
  // icon-discord/icon-browser/icon-music/icon-gamepad/icon-spark reprennent
  // les vrais logos de marque fournis dans assets/Icon/*.svg (couleurs
  // propres à chaque marque, pas teintées par --rc-text-primary comme les
  // glyphes neutres ci-dessous). icon-discord n'est utilisée par aucune app
  // de shortcuts_config.json pour l'instant (pas de Discord configuré) —
  // prête si une entrée est ajoutée plus tard.
  var APP_ICONS = {
    'icon-discord': '<svg width="17" height="17" viewBox="0 0 256 199" xmlns="http://www.w3.org/2000/svg"><path fill="#5865F2" d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.66 131.66 0 0 0 5.355 4.237 136.07 136.07 0 0 1-21.886 10.653c4.006 8.02 8.638 15.67 13.873 22.848 21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/></svg>',
    'icon-browser': '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden" viewBox="0 0 268.152 273.883"><defs><linearGradient id="a"><stop offset="0" stop-color="#0fbc5c"/><stop offset="1" stop-color="#0cba65"/></linearGradient><linearGradient id="g"><stop offset=".231" stop-color="#0fbc5f"/><stop offset=".312" stop-color="#0fbc5f"/><stop offset=".366" stop-color="#0fbc5e"/><stop offset=".458" stop-color="#0fbc5d"/><stop offset=".54" stop-color="#12bc58"/><stop offset=".699" stop-color="#28bf3c"/><stop offset=".771" stop-color="#38c02b"/><stop offset=".861" stop-color="#52c218"/><stop offset=".915" stop-color="#67c30f"/><stop offset="1" stop-color="#86c504"/></linearGradient><linearGradient id="h"><stop offset=".142" stop-color="#1abd4d"/><stop offset=".248" stop-color="#6ec30d"/><stop offset=".312" stop-color="#8ac502"/><stop offset=".366" stop-color="#a2c600"/><stop offset=".446" stop-color="#c8c903"/><stop offset=".54" stop-color="#ebcb03"/><stop offset=".616" stop-color="#f7cd07"/><stop offset=".699" stop-color="#fdcd04"/><stop offset=".771" stop-color="#fdce05"/><stop offset=".861" stop-color="#ffce0a"/></linearGradient><linearGradient id="f"><stop offset=".316" stop-color="#ff4c3c"/><stop offset=".604" stop-color="#ff692c"/><stop offset=".727" stop-color="#ff7825"/><stop offset=".885" stop-color="#ff8d1b"/><stop offset="1" stop-color="#ff9f13"/></linearGradient><linearGradient id="b"><stop offset=".231" stop-color="#ff4541"/><stop offset=".312" stop-color="#ff4540"/><stop offset=".458" stop-color="#ff4640"/><stop offset=".54" stop-color="#ff473f"/><stop offset=".699" stop-color="#ff5138"/><stop offset=".771" stop-color="#ff5b33"/><stop offset=".861" stop-color="#ff6c29"/><stop offset="1" stop-color="#ff8c18"/></linearGradient><linearGradient id="d"><stop offset=".408" stop-color="#fb4e5a"/><stop offset="1" stop-color="#ff4540"/></linearGradient><linearGradient id="c"><stop offset=".132" stop-color="#0cba65"/><stop offset=".21" stop-color="#0bb86d"/><stop offset=".297" stop-color="#09b479"/><stop offset=".396" stop-color="#08ad93"/><stop offset=".477" stop-color="#0aa6a9"/><stop offset=".568" stop-color="#0d9cc6"/><stop offset=".667" stop-color="#1893dd"/><stop offset=".769" stop-color="#258bf1"/><stop offset=".859" stop-color="#3086ff"/></linearGradient><linearGradient id="e"><stop offset=".366" stop-color="#ff4e3a"/><stop offset=".458" stop-color="#ff8a1b"/><stop offset=".54" stop-color="#ffa312"/><stop offset=".616" stop-color="#ffb60c"/><stop offset=".771" stop-color="#ffcd0a"/><stop offset=".861" stop-color="#fecf0a"/><stop offset=".915" stop-color="#fecf08"/><stop offset="1" stop-color="#fdcd01"/></linearGradient><linearGradient xlink:href="#a" id="s" x1="219.7" x2="254.467" y1="329.535" y2="329.535" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#b" id="m" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#c" id="n" cx="45.259" cy="279.274" r="71.46" fx="45.259" fy="279.274" gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#d" id="l" cx="304.017" cy="118.009" r="47.854" fx="304.017" fy="118.009" gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#e" id="o" cx="181.001" cy="177.201" r="71.46" fx="181.001" fy="177.201" gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#f" id="p" cx="207.673" cy="108.097" r="41.102" fx="207.673" fy="108.097" gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#g" id="r" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#h" id="j" cx="154.87" cy="145.969" r="71.46" fx="154.87" fy="145.969" gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)" gradientUnits="userSpaceOnUse"/><filter id="q" width="1.097" height="1.116" x="-.048" y="-.058" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.701"/></filter><filter id="k" width="1.033" height="1.02" x="-.017" y="-.01" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".242"/></filter><clipPath id="i" clipPathUnits="userSpaceOnUse"><path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z"/></clipPath></defs><g clip-path="url(#i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)"><path fill="url(#j)" d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z" filter="url(#k)"/><path fill="url(#l)" d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z" filter="url(#k)"/><path fill="url(#m)" d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z" filter="url(#k)"/><path fill="url(#n)" d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z" filter="url(#k)"/><path fill="#3086ff" d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z" filter="url(#k)"/><path fill="url(#o)" d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z" filter="url(#k)"/><path fill="url(#p)" d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z" filter="url(#q)"/><path fill="url(#r)" d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z" filter="url(#k)"/><path fill="url(#s)" d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z" filter="url(#k)" opacity=".5"/></g></svg>',
    'icon-folder': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2c.5 0 .9.2 1.2.6l1 1.2c.3.4.7.6 1.2.6H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.4H5A1.5 1.5 0 0 1 3.5 18Z"/></svg>',
    'icon-music': '<svg width="17" height="17" viewBox="0 0 24 24" fill="#A238FF" xmlns="http://www.w3.org/2000/svg"><path d="M.693 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807C.312 4.41 0 5.666 0 7.217s.312 2.808.693 2.808ZM21.038 1.56c-.364 0-.684.805-.91 2.096C19.765 1.446 19.184 0 18.526 0c-.78 0-1.464 2.036-1.784 5-.312-2.158-.788-3.536-1.325-3.536-.745 0-1.386 2.704-1.62 6.472-.442-1.932-1.083-3.145-1.793-3.145s-1.35 1.213-1.793 3.145c-.242-3.76-.874-6.463-1.628-6.463-.537 0-1.013 1.378-1.325 3.535C6.938 2.036 6.262 0 5.474 0c-.658 0-1.247 1.447-1.602 3.665-.217-1.291-.546-2.105-.91-2.105-.675 0-1.221 2.807-1.221 6.272 0 3.466.546 6.273 1.221 6.273.277 0 .537-.476.736-1.273.32 2.928.996 4.938 1.776 4.938.606 0 1.143-1.204 1.507-3.11.251 3.622.875 6.195 1.602 6.195.46 0 .875-1.023 1.187-2.677C10.142 21.6 11 24 12.004 24c1.005 0 1.863-2.4 2.235-5.822.312 1.654.727 2.677 1.186 2.677.728 0 1.352-2.573 1.603-6.195.364 1.906.9 3.11 1.507 3.11.78 0 1.455-2.01 1.775-4.938.208.797.46 1.273.737 1.273.675 0 1.22-2.807 1.22-6.273-.008-3.457-.553-6.272-1.23-6.272ZM23.307 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807-.381 0-.693 1.256-.693 2.807s.312 2.808.693 2.808Z"/></svg>',
    'icon-gauge': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/></svg>',
    'icon-headset': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="4" height="7" rx="1.5"/><rect x="17.5" y="13" width="4" height="7" rx="1.5"/></svg>',
    'icon-gamepad': '<svg width="17" height="17" viewBox="0 0 65 65" fill="#fff" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#steamSym" x=".5" y=".5"/><defs><linearGradient id="steamGrad" x2="50%" x1="50%" y2="100%" y1="0%"><stop stop-color="#111d2e" offset="0%"/><stop stop-color="#051839" offset="21.2%"/><stop stop-color="#0a1b48" offset="40.7%"/><stop stop-color="#132e62" offset="58.1%"/><stop stop-color="#144b7e" offset="73.8%"/><stop stop-color="#136497" offset="87.3%"/><stop stop-color="#1387b8" offset="100%"/></linearGradient></defs><symbol id="steamSym"><g><path d="M1.305 41.202C5.259 54.386 17.488 64 31.959 64c17.673 0 32-14.327 32-32s-14.327-32-32-32C15.001 0 1.124 13.193.028 29.874c2.074 3.477 2.879 5.628 1.275 11.328z" fill="url(#steamGrad)"/><path d="M30.31 23.985l.003.158-7.83 11.375c-1.268-.058-2.54.165-3.748.662a8.14 8.14 0 0 0-1.498.8L.042 29.893s-.398 6.546 1.26 11.424l12.156 5.016c.6 2.728 2.48 5.12 5.242 6.27a8.88 8.88 0 0 0 11.603-4.782 8.89 8.89 0 0 0 .684-3.656L42.18 36.16l.275.005c6.705 0 12.155-5.466 12.155-12.18s-5.44-12.16-12.155-12.174c-6.702 0-12.155 5.46-12.155 12.174zm-1.88 23.05c-1.454 3.5-5.466 5.147-8.953 3.694a6.84 6.84 0 0 1-3.524-3.362l3.957 1.64a5.04 5.04 0 0 0 6.591-2.719 5.05 5.05 0 0 0-2.715-6.601l-4.1-1.695c1.578-.6 3.372-.62 5.05.077 1.7.703 3 2.027 3.696 3.72s.692 3.56-.01 5.246M42.466 32.1a8.12 8.12 0 0 1-8.098-8.113 8.12 8.12 0 0 1 8.098-8.111 8.12 8.12 0 0 1 8.1 8.111 8.12 8.12 0 0 1-8.1 8.113m-6.068-8.126a6.09 6.09 0 0 1 6.08-6.095c3.355 0 6.084 2.73 6.084 6.095a6.09 6.09 0 0 1-6.084 6.093 6.09 6.09 0 0 1-6.081-6.093z"/></g></symbol></svg>',
    'icon-settings': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    'icon-cube': '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12v9M12 12l8-4.5M12 12L4 7.5"/></svg>',
    'icon-spark': '<svg width="17" height="17" viewBox="0 0 24 24" fill="#D97757" xmlns="http://www.w3.org/2000/svg"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>'
  };
  function appIcon(app) {
    return (app.icon_class && APP_ICONS[app.icon_class]) || ICONS.app;
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

  // Petite flèche pour les boutons "aller à" (fenêtres) / "lancer" (macros).
  ICONS.go = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  // Palette déterministe (hash simple d'une clé texte) — dégradés sourds en
  // guise de cover art de substitution pour les vignettes Steam (une seule
  // collection utilise une couleur d'identité par élément dans cet onglet ;
  // Apps rapides et Macros n'en ont volontairement plus, voir journal de
  // refonte v5).
  var PALETTE = [
    ['#3a3ea8', '#1c1f52'],
    ['#a542e0', '#4c1780'],
    ['#e08a2f', '#5c2c0a'],
    ['#2f7ee0', '#0a2a5c'],
    ['#d94f7a', '#5c0a2c'],
    ['#2fae7e', '#0a3d2a']
  ];
  function hashStr(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function paletteFor(key) {
    return PALETTE[hashStr(key) % PALETTE.length];
  }

  // Troncature "propre" des titres de jeux trop longs pour une vignette
  // (~130-190px) : coupe au dernier espace avant la limite plutôt qu'en
  // plein milieu d'un mot ("Assassin's Creed…" plutôt que "Assassin's Cre…").
  // Le CSS (text-overflow:ellipsis) reste en filet de sécurité pour les cas
  // limites (un seul mot très long, police plus grande sur un autre écran).
  function truncateName(name, maxLen) {
    name = String(name || '');
    if (name.length <= maxLen) return name;
    var cut = name.slice(0, maxLen);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.4) cut = cut.slice(0, lastSpace);
    return cut.replace(/[\s.,;:\-–—]+$/, '') + '…';
  }

  // durationMs : délai avant le fondu de sortie (groupe 5 des animations),
  // configurable par appelant — 2500ms par défaut. Le slide-in/fade-out
  // lui-même vient de .toast/.toast.is-visible (design-tokens.css).
  function toast(message, isError, durationMs) {
    var toastEl = document.getElementById('shortcuts-toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.style.color = isError ? 'var(--danger)' : 'var(--accent-strong)';
    toastEl.classList.add('is-visible');
    clearTimeout(toastEl._hideTimer);
    toastEl._hideTimer = setTimeout(function() {
      toastEl.classList.remove('is-visible');
    }, durationMs || 2500);
  }

  // --- MODALES GÉNÉRIQUES (.modal-overlay / .modal-card, design-tokens.css) ---
  function openModalEl(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.add('is-open');
  }
  function closeModalEl(id) {
    var modal = document.getElementById(id);
    if (modal) modal.classList.remove('is-open');
  }

  // --- PAGINATION PARTAGÉE (Apps rapides / Steam) ---
  // Rend une rangée de points cliquables dans #pagerId ; masquée si une
  // seule page. La transition de balayage entre pages (swipe/easing) est
  // ajoutée en étape 3 (groupe 4 des animations) — ici, changement direct.
  function renderPager(pagerId, pageCount, currentPage, onSelect) {
    var pagerEl = document.getElementById(pagerId);
    if (!pagerEl) return;

    if (pageCount <= 1) {
      pagerEl.classList.add('is-hidden');
      pagerEl.innerHTML = '';
      return;
    }

    pagerEl.classList.remove('is-hidden');
    var html = '';
    for (var i = 0; i < pageCount; i++) {
      html += '<button class="rc-pager__dot' + (i === currentPage ? ' is-active' : '') + '" data-page="' + i + '" aria-label="Page ' + (i + 1) + '"></button>';
    }
    pagerEl.innerHTML = html;

    var dots = pagerEl.querySelectorAll('.rc-pager__dot');
    for (var j = 0; j < dots.length; j++) {
      dots[j].addEventListener('click', (function(pageIndex) {
        return function() { onSelect(pageIndex); };
      })(j));
    }
  }

  // --- 1. APPS RAPIDES ---
  function fetchApps() {
    var container = document.getElementById('shortcuts-dock-apps');
    if (!container) return;

    authFetch('/shortcuts/apps')
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
    appsList = apps || [];
    appsPage = 0;
    renderAppsPage();
  }

  function renderAppsPage() {
    var container = document.getElementById('shortcuts-dock-apps');
    if (!container) return;

    var total = appsList.length;

    if (total === 0) {
      container.innerHTML = '<div class="rc-status-msg">Aucune application configurée</div>';
      renderPager('shortcuts-apps-pager', 0, 0, function() {});
      return;
    }

    var pageCount = Math.max(1, Math.ceil(total / APPS_PAGE_SIZE));
    appsPage = Math.max(0, Math.min(appsPage, pageCount - 1));
    var start = appsPage * APPS_PAGE_SIZE;
    var pageApps = appsList.slice(start, start + APPS_PAGE_SIZE);

    var html = '';
    for (var i = 0; i < pageApps.length; i++) {
      var app = pageApps[i];
      var safeName = (app.name || app.id).replace(/'/g, "\\'");
      html += '<button class="rc-app-tile" id="shortcuts-app-' + app.id + '" onclick="ShortcutsController.launchApp(\'' + app.id + '\', \'' + safeName + '\')">' +
                '<span class="rc-app-tile__running-dot"></span>' +
                '<span class="rc-app-tile__icon">' + appIcon(app) + '</span>' +
                '<span class="rc-app-tile__name">' + (app.name || app.id) + '</span>' +
              '</button>';
    }
    container.innerHTML = html;

    renderPager('shortcuts-apps-pager', pageCount, appsPage, function(page) {
      appsPage = page;
      renderAppsPage();
    });

    applyRunningStatus();
  }

  function launchApp(appId, appName) {
    var btn = document.getElementById('shortcuts-app-' + appId);
    if (btn && btn.classList.contains('is-loading')) return;

    if (btn) btn.classList.add('is-pressed', 'is-loading');

    authFetch('/shortcuts/launch/' + encodeURIComponent(appId), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('Erreur lancement');
        return res.json();
      })
      .then(function(data) {
        toast((data && data.message) || ('Lancement de ' + appName + '...'), false);
        setTimeout(function() {
          if (btn) btn.classList.remove('is-pressed', 'is-loading');
        }, 1200);
        pollAppsStatus();
      })
      .catch(function(err) {
        toast('Échec du lancement : ' + appName, true);
        if (btn) btn.classList.remove('is-pressed', 'is-loading');
      });
  }

  // --- Statut "app déjà lancée" (badge sur la tuile) ---
  function applyRunningStatus() {
    var start = appsPage * APPS_PAGE_SIZE;
    var pageApps = appsList.slice(start, start + APPS_PAGE_SIZE);
    for (var i = 0; i < pageApps.length; i++) {
      var app = pageApps[i];
      var tile = document.getElementById('shortcuts-app-' + app.id);
      if (tile) tile.classList.toggle('is-running', !!appsRunning[app.id]);
    }
  }

  function pollAppsStatus() {
    authFetch('/shortcuts/apps/status')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        appsRunning = data || {};
        applyRunningStatus();
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching apps status:', err);
      });
  }

  // --- 2. JEUX STEAM ---
  function fetchSteamGames() {
    var container = document.getElementById('shortcuts-steam-grid');
    if (!container) return;

    authFetch('/shortcuts/steam-games')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(games) {
        renderSteamGames(games);
      })
      .catch(function(err) {
        console.warn('[Shortcuts] Error fetching steam games:', err);
        container.innerHTML = '<div class="rc-status-msg"><span>Erreur de chargement des jeux</span>' +
          '<button style="margin-top:4px;padding:6px 14px;border-radius:999px;border:none;background:rgba(255,255,255,0.10);color:var(--text);font-size:15px;font-weight:600;cursor:pointer;" onclick="ShortcutsController.fetchSteamGames()">Réessayer</button></div>';
      });
  }

  function renderSteamGames(games) {
    steamList = games || [];
    steamPage = 0;
    renderSteamPage();
  }

  // direction : 'next'/'prev', pilote le sens de la transition d'entrée
  // (voir .rc-steam-grid.is-sliding-*, shortcuts.css) ; omis au premier
  // rendu d'une liste (pas de transition à jouer depuis rien).
  function renderSteamPage(direction) {
    var container = document.getElementById('shortcuts-steam-grid');
    if (!container) return;

    var total = steamList.length;

    if (total === 0) {
      container.innerHTML = '<div class="rc-status-msg">Aucun jeu détecté</div>';
      renderPager('shortcuts-steam-pager', 0, 0, function() {});
      return;
    }

    var pageCount = Math.max(1, Math.ceil(total / STEAM_PAGE_SIZE));
    steamPage = Math.max(0, Math.min(steamPage, pageCount - 1));
    var start = steamPage * STEAM_PAGE_SIZE;
    var pageGames = steamList.slice(start, start + STEAM_PAGE_SIZE);

    var html = '';
    for (var i = 0; i < pageGames.length; i++) {
      var game = pageGames[i];
      var safeName = (game.name || '').replace(/'/g, "\\'");
      var c = paletteFor(game.app_id);
      html += '<div class="rc-game-card" id="steam-game-' + game.app_id + '" style="background:linear-gradient(155deg, ' + c[0] + ', ' + c[1] + ')" onclick="ShortcutsController.launchSteamGame(\'' + game.app_id + '\', \'' + safeName + '\')">' +
                '<span class="name">' + truncateName(game.name, 18) + '</span>' +
              '</div>';
    }
    container.innerHTML = html;
    applySteamRunningMarker();

    if (direction) {
      container.classList.add('is-sliding-' + direction);
      void container.offsetWidth;
      container.classList.remove('is-sliding-next', 'is-sliding-prev');
    }

    renderPager('shortcuts-steam-pager', pageCount, steamPage, function(page) {
      var dir = page > steamPage ? 'next' : 'prev';
      steamPage = page;
      renderSteamPage(dir);
    });
  }

  function applySteamRunningMarker() {
    var cards = document.querySelectorAll('.rc-game-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('is-running', cards[i].id === 'steam-game-' + runningSteamAppId);
    }
  }

  // --- Swipe/balayage tactile entre pages Steam (groupe 4 des animations) ---
  // Jusqu'ici le seul déclencheur de changement de page était le pager
  // (points de 44x32px) — sur tablette l'utilisateur s'attend aussi à
  // pouvoir balayer directement les vignettes. Pointer Events : un seul
  // chemin de code pour souris/tactile (cible = Chrome sur Galaxy Tab A8,
  // pas besoin de fallback touchstart/mousedown séparés).
  var steamSwipeInited = false;
  var steamSwipe = { active: false, moved: false, startX: 0, startY: 0, pointerId: null };
  var steamSwipeConsumeNextClick = false;
  var STEAM_SWIPE_THRESHOLD = 40; // px de déplacement horizontal avant de compter comme un swipe

  function steamPageCount() {
    return Math.max(1, Math.ceil(steamList.length / STEAM_PAGE_SIZE));
  }

  function initSteamSwipe() {
    if (steamSwipeInited) return;
    var grid = document.getElementById('shortcuts-steam-grid');
    if (!grid) return;
    steamSwipeInited = true;

    grid.addEventListener('pointerdown', function(e) {
      if (steamSwipe.active || !e.isPrimary) return;
      steamSwipe.active = true;
      steamSwipe.moved = false;
      steamSwipe.startX = e.clientX;
      steamSwipe.startY = e.clientY;
      steamSwipe.pointerId = e.pointerId;
    });

    grid.addEventListener('pointermove', function(e) {
      if (!steamSwipe.active || e.pointerId !== steamSwipe.pointerId) return;
      var dx = e.clientX - steamSwipe.startX;
      var dy = e.clientY - steamSwipe.startY;
      if (!steamSwipe.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      steamSwipe.moved = true;
      // Résistance légère en bout de piste (première/dernière page) : suit
      // toujours le doigt, mais moins loin, pour signaler qu'il n'y a rien
      // au-delà plutôt que de bloquer net.
      var atStart = steamPage === 0 && dx > 0;
      var atEnd = steamPage === steamPageCount() - 1 && dx < 0;
      var followed = (atStart || atEnd) ? dx * 0.35 : dx;
      grid.classList.add('is-dragging');
      grid.style.transform = 'translateX(' + followed + 'px)';
    });

    function endSwipe(e) {
      if (!steamSwipe.active || (e && e.pointerId !== steamSwipe.pointerId)) return;
      var dx = e ? (e.clientX - steamSwipe.startX) : 0;
      var wasMoved = steamSwipe.moved;
      steamSwipe.active = false;
      steamSwipe.moved = false;
      grid.classList.remove('is-dragging');
      grid.style.transform = '';

      if (!wasMoved) return;

      // Consomme le clic qui suit immédiatement le relâchement (évite de
      // lancer le jeu sous le doigt à la fin d'un swipe) — intercepté par
      // le listener 'click' en phase de capture ci-dessous.
      steamSwipeConsumeNextClick = true;

      var pageCount = steamPageCount();
      if (dx <= -STEAM_SWIPE_THRESHOLD && steamPage < pageCount - 1) {
        steamPage += 1;
        renderSteamPage('next');
      } else if (dx >= STEAM_SWIPE_THRESHOLD && steamPage > 0) {
        steamPage -= 1;
        renderSteamPage('prev');
      }
      // Sinon (sous le seuil, ou déjà en bout de piste) : le retrait du
      // transform inline ci-dessus suffit, la transition normale de
      // .rc-steam-grid (280ms) fait revenir la page en place ("snap-back").
    }

    grid.addEventListener('pointerup', endSwipe);
    grid.addEventListener('pointercancel', endSwipe);

    grid.addEventListener('click', function(e) {
      if (steamSwipeConsumeNextClick) {
        steamSwipeConsumeNextClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  function launchSteamGame(appId, gameName) {
    var el = document.getElementById('steam-game-' + appId);
    if (el && el.classList.contains('is-loading')) return;

    if (el) el.classList.add('is-pressed', 'is-loading');

    // Écho vers l'état partagé (State.steamRunning) — la notch fermée et le
    // sur-menu du header suivent la même mémoire optimiste que cette tuile,
    // voir UI.updateHeaderGame (app-ui-core.js).
    if (window.UI && UI.updateHeaderGame) UI.updateHeaderGame({ status: 'launching', name: gameName });

    authFetch('/shortcuts/steam/launch/' + encodeURIComponent(appId), { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('Erreur Steam');
        return res.json();
      })
      .then(function(data) {
        toast('Démarrage de ' + gameName + '...', false);
        setTimeout(function() {
          if (el) el.classList.remove('is-pressed', 'is-loading');
          runningSteamAppId = appId;
          applySteamRunningMarker();
          window.State && (State.steamRunning = { appId: appId, name: gameName });
          if (window.UI && UI.updateHeaderGame) UI.updateHeaderGame({ status: 'running', name: gameName });
        }, 1500);
      })
      .catch(function(err) {
        toast('Échec du démarrage de ' + gameName, true);
        if (el) el.classList.remove('is-pressed', 'is-loading');
        var prev = window.State && State.steamRunning;
        if (window.UI && UI.updateHeaderGame) {
          UI.updateHeaderGame(prev ? { status: 'running', name: prev.name } : { status: 'idle' });
        }
      });
  }

  // --- 3. ACTIONS SYSTÈME & MODALES ---
  function handleSystemAction(action) {
    authFetch('/shortcuts/system/' + encodeURIComponent(action), { method: 'POST' })
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

  // Modale de confirmation générique — utilisée par les actions système de
  // cet onglet ET par tout autre appelant (ex. "Fermer le jeu" du sur-menu
  // de la notch, app-ui-core.js/notch-menu.js) : même composant, même geste
  // d'ouverture, pour ne jamais diverger entre les deux. evt : l'événement
  // de tap sur le bouton déclencheur — sert à faire s'ouvrir la modale en
  // scale-up depuis cette position plutôt qu'un slide-up générique centré
  // (voir .modal-card--from-origin, shortcuts.css). subtitle est optionnel :
  // omis, le texte par défaut du HTML reste affiché.
  function confirmGenericAction(evt, title, subtitle, onConfirm) {
    var titleEl = document.getElementById('shortcuts-modal-title');
    var subtitleEl = document.getElementById('shortcuts-modal-subtitle');
    var confirmBtn = document.getElementById('shortcuts-modal-confirm-btn');
    var modalEl = document.getElementById('shortcuts-confirm-modal');
    var modalCard = modalEl ? modalEl.querySelector('.modal-card') : null;

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl && subtitle) subtitleEl.textContent = subtitle;

    if (modalCard) {
      modalCard.classList.add('modal-card--from-origin');
      var btn = evt && evt.currentTarget;
      if (btn) {
        // Rects mesurés en coordonnées viewport pour les deux éléments :
        // le ratio (donc le %) reste correct quelle que soit l'échelle
        // appliquée à #app-shell (applyAppScale, app-core.js), pas besoin
        // d'en tenir compte explicitement ici.
        var btnRect = btn.getBoundingClientRect();
        var cardRect = modalCard.getBoundingClientRect();
        var originX = ((btnRect.left + btnRect.width / 2 - cardRect.left) / cardRect.width) * 100;
        var originY = ((btnRect.top + btnRect.height / 2 - cardRect.top) / cardRect.height) * 100;
        modalCard.style.transformOrigin = originX + '% ' + originY + '%';
      } else {
        modalCard.style.transformOrigin = '';
      }
    }

    openModalEl('shortcuts-confirm-modal');

    if (confirmBtn) {
      confirmBtn.onclick = function() {
        closeModal();
        onConfirm();
      };
    }
  }

  function confirmSystemAction(evt, action, title) {
    currentActionModal = action;
    confirmGenericAction(evt, 'Confirmer ' + title + ' ?', null, function() {
      handleSystemAction(action);
    });
  }

  function closeModal() {
    closeModalEl('shortcuts-confirm-modal');
    currentActionModal = null;
  }

  // --- 4. SCÈNES & MACROS ---
  function fetchScenes() {
    var container = document.getElementById('shortcuts-scenes-list');
    if (!container) return;

    authFetch('/shortcuts/scenes')
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
    var container = document.getElementById('shortcuts-scenes-list');
    if (!container) return;

    if (!scenes || scenes.length === 0) {
      container.innerHTML = '<div class="rc-status-msg">Aucune macro disponible</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      var safeName = (sc.name || '').replace(/'/g, "\\'");
      html += '<button class="rc-macro-tile" id="scene-btn-' + sc.id + '" onclick="ShortcutsController.runScene(\'' + sc.id + '\', \'' + safeName + '\')">' +
                '<span class="rc-macro-tile__icon">' + sceneIcon(sc) + '</span>' +
                '<span class="rc-macro-tile__name">' + sc.name + '</span>' +
              '</button>';
    }
    container.innerHTML = html;
    applyActiveScene();
  }

  function applyActiveScene() {
    var tiles = document.querySelectorAll('.rc-macro-tile');
    for (var i = 0; i < tiles.length; i++) {
      var isActive = tiles[i].id === 'scene-btn-' + activeSceneId;
      tiles[i].classList.toggle('is-active', isActive);
    }
  }

  function runScene(sceneId, sceneName) {
    var tile = document.getElementById('scene-btn-' + sceneId);

    if (tile && tile.classList.contains('is-loading')) return;

    if (tile) tile.classList.add('is-loading');

    toast('Lancement de ' + sceneName + '...', false);

    authFetch('/shortcuts/scenes/' + encodeURIComponent(sceneId) + '/run', { method: 'POST' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        toast('Scène ' + sceneName + ' activée !', false);
        activeSceneId = sceneId;
        applyActiveScene();
      })
      .catch(function(err) {
        toast('Erreur exécution ' + sceneName, true);
      })
      .finally(function() {
        if (tile) tile.classList.remove('is-loading');
      });
  }

  // --- LIFECYCLE DE L'ONGLET ---
  function onActivate() {
    isTabActive = true;

    fetchApps();
    fetchSteamGames();
    fetchScenes();
    initSteamSwipe();

    clearInterval(appsStatusTimer);
    appsStatusTimer = setInterval(pollAppsStatus, 6000);
  }

  function onDeactivate() {
    isTabActive = false;
    closeModal();
    clearInterval(appsStatusTimer);
    appsStatusTimer = null;
  }

  return {
    onActivate: onActivate,
    onDeactivate: onDeactivate,
    fetchApps: fetchApps,
    launchApp: launchApp,
    fetchSteamGames: fetchSteamGames,
    launchSteamGame: launchSteamGame,
    handleSystemAction: handleSystemAction,
    confirmSystemAction: confirmSystemAction,
    confirmGenericAction: confirmGenericAction,
    closeModal: closeModal,
    fetchScenes: fetchScenes,
    runScene: runScene
  };
})();
