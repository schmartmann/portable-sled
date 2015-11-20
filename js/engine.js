/* ===== SLED ENGINE ===== */
/* ===== STYLE GUIDE ===== */
// https://google-styleguide.googlecode.com/svn/trunk/javascriptguide.xml
// https://github.com/hapijs/contrib/blob/master/Style.md
// all function names should be verbs (ie getCurrentTime not currentTime)
/* Module pattern
function NameModule(dependency, dependency) {
  var exports = {};
  var privateVariable = 1;
  function privateMethod() {}
  exports.moduleProperty = 1;
  exports.moduleMethod = function () {};
  return exports;
}*/

/* ===== PERF NOTES ===== */
/*
animations (opacity, transforms, etc) have high perf impact on mobile - especially when doing multiple at once
use css 3d transform translate to separate layers in the GPU (ie ad is separate layer from article)
required reading for rendering perf: http://www.html5rocks.com/en/tutorials/speed/high-performance-animations/
bonus reading for rendering perf: http://blogs.adobe.com/webplatform/2014/03/18/css-animations-and-transitions-performance/
*/

// if Sled's been killed before engine is initialized, stop here
if (window.Sled) {

Sled.EngineLoader = function (Sled, Analytics, Network, Utils, settings) {

  "use strict";

  // Core variables

  var win = window;
  var doc = document;
  var plugins = Sled.plugins;
  var state = Sled.state;
  var ad = Sled.ad;
  var Gesture;
  var Scroll;
  var Swipe;
  var Video;
  var Audio;
  var Autoplay;

  console.log("Loading Sled v" + Sled.settings.engVersion);

  // Modules

  initDicts();
  this.Swipe = Swipe;
  this.Gesture = Gesture;
  this.Video = Video;
  Sled.Autoplay = Autoplay;
  Sled.Audio = Audio;
  Sled.Scroll = Scroll;

  ad.panels = 1;
  ad.state = { // current state of the ad
    timesSeen: 0,
    percentSeen: 0, // how much of the ad's been seen so far (for things like the impression50 event)
    timeStopped: 0, // total ms the ad has been not moving + visible for
    page: 1, // currently visible page
    panel: 1, // currently visible panel
    locked: false, // if ad is currently locked
  };

// note that not including vars in global sled object can be good too, because they can be minified for space savings and obfuscation
  // loader vars
  var sledLoaded = false;
  var isImgLoaded = false;

  // settings gathered from ad.html contents
  var iframeAd = false;

  // swiping
  var mask;
  var maskStyle;
  var triggers;
  var maskPosition;

  // scrolling too fast
  var overscrollWatcher;
  var overscrolling = false;
  var overscrollTimer = null;
  var overscrollStyleTimer = null;
  var OVERSCROLL_TIME_BETWEEN_TOUCH = 320; //ms
  var OVERSCROLL_GESTURE_DURATION = 250; //ms
  var OVERSCROLL_MAX_SPEED = 100; //px per 100ms
  var OVERSCROLL_ALERT = document.getElementById('sled_scroll_alert');
  var OVERSCROLL_COOLDOWN = 700; //ms to wait after last overscroll event before unlocking
  var lastScroll = 0;

  // view
  var _transform; // transform polyfill
  var frameTime;
  var scrollSpeed = 0; // px per ms
  state.adShift = 0; // tracking the ad, counting from the bottom of the screen

  // Minifcation helpers

  var NONE = 'none';
  var BLOCK = 'block';
  var ABOVE = 'above';
  var BELOW = 'below';
  var SLED_AD_WRAPPER = 'sled_ad_wrapper';

  init(); // initializes loading process

// NOTE getScrollPosition triggers relow
// once we're pretty confident in our floating prevention, we should remove this interval to boost perf
  overscrollWatcher = setInterval(function () { // Activate overscroll if page moving too fast & overscroll >= 2
    var curScroll = Utils.getScrollPosition();
    var scrollDiff = curScroll - lastScroll;
    lastScroll = curScroll;

    if (state.active && !settings.sticky && !settings.embedElement && Math.abs(scrollDiff) > 5 && !overscrolling) {
      overscrolling = true;
      var count = Analytics.floating();
      if (count >=5 ) { exit('floating'); } // prevent people from having horrible experiences
      Scroll.reset();

      clearTimeout(overscrollTimer);
      overscrollTimer = setTimeout(function () {
        overscrolling = false;
      }, 1000);
    } else {
      // once floating stops, it doesn't start again, so we can stop watching
      clearInterval(overscrollWatcher);
    }
  }, 150);


  function init() {

    initListeners();
    initPolyfills();

    templateInserted();
  }


  // these are capturing, which means they /should/, when calling preventDefault, prevent other listeners on the same event from triggering
  function initListeners() {

    win.addEventListener('touchstart', Gesture.start, true);
    win.addEventListener('touchmove', Gesture.change, true);
    win.addEventListener('touchend', Gesture.end, true);
    win.addEventListener('touchcancel', Gesture.end, true);
  }


  function initPolyfills() {

    // CSS transform polyfill

    var _elementStyle = doc.createElement('div').style;
    var _vendor = (function () {
          var vendors = ['t', 'webkitT', 'MozT', 'msT', 'OT'], transform;
          for (var i = 0, l = vendors.length; i < l; i++ ) {
            transform = vendors[i] + 'ransform';
            if (transform in _elementStyle) { return vendors[i].slice(0, -1); }
          }
          return false;
        })();
    function _prefixStyle (style) {
      if ( _vendor === false ) return false;
      if ( _vendor === '' ) return style;
      return _vendor + style.charAt(0).toUpperCase() + style.substr(1);
    }
    _transform = _prefixStyle('transform');

    // requestAnimationFrame polyfill

    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for (var x = 0, l = vendors.length; x < l && !win.requestAnimationFrame; ++x) {
      win.requestAnimationFrame = win[vendors[x]+'RequestAnimationFrame'];
      win.cancelAnimationFrame = win[vendors[x]+'CancelAnimationFrame'] || win[vendors[x]+'CancelRequestAnimationFrame'];
    }
    if (!win.requestAnimationFrame) {
      win.requestAnimationFrame = function (callback, element) {
        var currTime = new Date().getTime(),
            timeToCall = Math.max(0, 16 - (currTime - lastTime)),
            id = win.setTimeout(function () { callback(currTime + timeToCall); }, timeToCall);
        lastTime = currTime + timeToCall;
        return id;
      };
    }
    if (!win.cancelAnimationFrame) { win.cancelAnimationFrame = function (id) { clearTimeout(id); }; }
  }


  function templateInserted() {

    iframeAd = (ad.html.querySelector('iframe') !== null);

    if (ad.html.querySelector('#sled_panel_container')) {
      var panels = ad.html.getElementsByClassName('sled_panel');
      triggers = ad.html.querySelectorAll('#sled_panel_triggers li');
      maskPosition = 0; // for tracking mask position (px)
      ad.panel = 1; // goal panel to show
      ad.panels = panels.length;
      mask = ad.html.querySelector('#sled_panel_container');
      maskStyle = mask.style;
      maskStyle.width = ad.width*ad.panels + 'px';
      for (var i = 0; i < ad.panels; i++) {
        panels[i].style.width = ad.width + 'px';
      }
    }

    if (doc.getElementById('sled_autoplay')) { // autoplay ads have to wait to load first piece of video
      Autoplay.videoObj = doc.getElementById('sled_autoplay_video');
      Autoplay.progressBarObj = doc.getElementById('sled_progress_wrapper');
      Autoplay.overlayObj = doc.getElementById('sled_autoplay_overlay');

      // poster is already cached; just need to pass the img object
      Network.fetchImage(settings.extAssetURL + 'autoplay0.jpg', Autoplay.posterLoaded);
    } else {
      checkIMG();
      Sled.Autoplay = Autoplay = null; // for now, we clear this out of memory.
          // In the future, we might only include this library for ads that need it
          // or, just not init it? / only init libraries when they're needed
    }
  }


  // inspired by https://github.com/alexanderdickson/waitForImages
  function checkIMG() {

    var allObj = ad.wrapper.querySelectorAll('*');
    var allImgs = [];
    var matchUrl = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

    for (var i = allObj.length-1; i >= 0; i--) { // NOTE checking for img elements has been removed for brevity
      var elem = allObj[i];
      var value = Utils.getElementStyle(elem, 'background-image');
      var match;
      if (value) {
        do {
          match = matchUrl.exec(value);
          if (match) {
            allImgs.push({
              src: match[2],
              element: elem
            });
          }
        } while (match);
      }
    }

    for (var j = 0, imgsToLoad = allImgs.length; j < imgsToLoad; j++) {
      Network.fetchImage(allImgs[j].src, imgLoad);
    }

    imgLoad(); // fire at least once, even if there aren't any images!


    function imgLoad(err, result) {

      imgsToLoad--;
      if (imgsToLoad === -1) {
        isImgLoaded = true;
        adLoaded();
        return false;
      }
    }
  }


  function adLoaded() {

    if (isImgLoaded && (!settings.externalLoading || settings.externalLoaded)) {

      if (plugins.onLoad) {
        ad.height = ad.html.offsetHeight;
        plugins.onLoad({ad: ad.html, Analytics: Analytics, Network: Network});
      }
      ad.height = ad.html.offsetHeight; // duplicative measurement to accommodate dynamic height value changes in onLoad plugin
      state.viewTop = Utils.getScrollPosition();
      Analytics.generic('adLoaded');
      sledLoaded = true;

      if (settings.instant) {
        Scroll.possiblyOverride(BELOW);
      }
    }
  }


  function handleClick(e) {

    var t = e.target, temp = e.target, buttonData;
    while (temp.id !== SLED_AD_WRAPPER && temp.tagName !== 'BODY') {
      if (~(temp.className.indexOf('sled_button'))) { t = temp; break; }
      if (iframeAd && typeof temp.href !== 'undefined') {
        t = temp;
        buttonData = { link: temp.href };
        break;
      }
      temp = temp.parentNode;
    }
    var buttonID = t.id;
    var buttonClasses = t.className;
    buttonData = buttonData || Utils.getElementData(t);

    if (buttonData['app-ios'] && settings.ios) {
      buttonData.link = buttonData['app-ios'];
    } else if (buttonData['app-android'] && settings.android) {
      buttonData.link = buttonData['app-android'];
    } else if (buttonID === 'sled_autoplay_cta') {
      buttonData.link = settings.extCTA;
    }

    if (~buttonClasses.indexOf('disabled')) { return; }

    // First: External CTA redirects

    if (~buttonClasses.indexOf('sled_macro_button')) { // use onClick as the target (ie onClick includes pub tracker + target)
      var url = (buttonData['click-number']) ? settings.onClick[buttonData['click-number']] : settings.onClick;

      if (Autoplay) { Autoplay.pause(); }
      Analytics.cta(buttonID, url, true, function (err, result) {
        win.open(result);
      });

    // Then, buttons that redirect the browser but aren't macro buttons

    } else if (buttonData.link) {
      if (Autoplay) { Autoplay.pause(); }
      Analytics.cta(buttonID, buttonData.link || t.href, false, function (err, result) {
        win.open(result);
      });

    // Finally, buttons that don't redirect browser

    } else {
      Analytics.click(buttonID ? buttonID : 'NoButtonIDSpecified');
      if (buttonData.pixel) { Network.firePixels(buttonData.pixel); }
      if (plugins.onClick && buttonID !== SLED_AD_WRAPPER) { plugins.onClick({ad: ad.html, target: t, ID: buttonID, classes: buttonClasses, data: buttonData, Analytics: Analytics}); }

      if (~buttonClasses.indexOf('sled_video_wrapper')) {
        Video.toggle(t);
      } else if (~buttonClasses.indexOf('sled_video_play_button')) {
        Video.toggle(doc.getElementById(buttonData['video-id']));
      } else if (~buttonClasses.indexOf('sled_exit_button')) {
        exit('closeButton');
      } else if (buttonData.page) {
        updatePage(+buttonData.page);
      } else if (buttonData.panel) {
        Swipe.updatePanel(+buttonData.panel);
      } else if (buttonID === 'sled_autoplay_replay') { // restart with audio enabled
        Autoplay.sound = true;
        doc.getElementById('sled_autoplay_sound').className = 'sled_unmuted';
        Autoplay.replay();
      } else if (buttonID === 'sled_autoplay_sound' || buttonID === 'sled_autoplay') {
        if (!Autoplay.playing) {
          Autoplay.resume();
        }
        if (!Autoplay.sound) {
          Audio.play();
        } else {
          Audio.pause();
        }
        Autoplay.sound = !Autoplay.sound;
      }
    }

    function updatePage(page) {

      if (page === ad.state.page) { return; }
      Video.hide();
      doc.getElementById('sled_page_' + ad.state.page).style.display = NONE;
      doc.getElementById('sled_page_' + page).style.display = BLOCK;
      ad.state.page = page;
    }
  }


  function initDicts() {

    // Requires that ad.audioBuffer and ad.audioContext be initialized
    Audio = {
      src: null, // audio source node
      playing: false,
      play: function () {
        if (ad.audioBuffer && !Audio.playing) {
          Audio.playing = true;
          Audio.src = ad.audioContext.createBufferSource();
          Audio.src.connect(ad.audioContext.destination);
          Audio.src.buffer = ad.audioBuffer;
          Audio.src.start(0, Autoplay.currentTime()/1000);
          doc.getElementById('sled_autoplay_sound').className = 'sled_unmuted';
        }
      },
      pause: function () {
        if (Audio.src && Audio.playing) {
          Audio.playing = false;
          Audio.src.stop(0);
          doc.getElementById('sled_autoplay_sound').className = '';
        }
      },
    };


    Autoplay = {

      videoObj: null,
      videoHeight: 0,
      videoWidth: 0,
      progressBarObj: null,
      overlayObj: null,

      activated: false,
      over: false,
      playing: false,
      buffering: true,
      sound: false,
      isOnScreen: false,
      isPreview: ad.autoplayPreview || false,

      timestamp: null,
      timeStorage: 0,
      duration: (ad.autoplayLength || settings.autoplayLength || 15) * 1000,
      quartile: 0,
      quartileTimer: null,
      animationTimer: null,

      currentFrameset: 0,
      bufferedFramesets: 0,
      totalFramesets: (ad.autoplayLength || settings.autoplayLength || 15) / 5,
      loopsLeft: ad.autoplayLoops || 0,

      // user interaction events

      onScreen: function () { // can be triggered multiple times consecutively

        if (Autoplay.over || Autoplay.isOnScreen) { return; }
        Autoplay.isOnScreen = true;
        if (Autoplay.activated) {
          Autoplay.resume();
        } else { // if it hasn't been started yet, 'replay' and start loading the rest
          Autoplay.activated = true;
          Autoplay.bufferNextFrame();
          Autoplay.replay();

          if (Autoplay.quartile === 0) {
            if (!Autoplay.isPreview) { Analytics.quartile(Autoplay.quartile); }
            Autoplay.quartile++;
          }
        }
      },


      offScreen: function () { // can be triggered multiple times consecutively

        if (Autoplay.over) { return; }
        Autoplay.isOnScreen = false;
        if (Autoplay.playing) {
          Autoplay.pause();
        }
      },


      play: function () {

        var nextFrame = Autoplay.currentFrameset + 1;
        if (nextFrame > Autoplay.totalFramesets) { // if end of video
          if (Autoplay.quartile <= 4) {
            if (!Autoplay.isPreview) { Analytics.quartile(Autoplay.quartile); }
            Autoplay.quartile++;
          }
          if (Autoplay.loopsLeft > 0) {
            Autoplay.loopsLeft--;
            Autoplay.replay();
          } else {
            Audio.pause();
            Autoplay.pause();
            if (Autoplay.overlayObj) { Autoplay.overlayObj.style.display = BLOCK; }
            doc.getElementById('sled_autoplay_sound').style.display = NONE;
            Autoplay.over = true;
            if (plugins.onVideoEnd) { plugins.onVideoEnd(); }
            else if (settings.sticky) { exit('stickyEnded'); } // don't auto kill if plugin exists
          }
        } else if (Autoplay.bufferedFramesets >= nextFrame) { // if next frame ready, play it
          Autoplay.currentFrameset = nextFrame;

          if (!Autoplay.buffering) { Autoplay.timeStorage += Date.now() - Autoplay.timestamp; }
          Autoplay.resume(true);
          Autoplay.buffering = false;
          // set next frame to animate
          Autoplay.videoObj.style['background-image'] = 'url(' + settings.extAssetURL + 'autoplay' + Autoplay.currentFrameset + '.jpg)';
          Autoplay.videoObj.classList.remove('sled_autoplaying');
          Autoplay.videoObj.width = Autoplay.videoObj.offsetWidth;
          Autoplay.videoObj.classList.add('sled_autoplaying');

          Autoplay.resumeAnalytics();
        } else { // if next frame not ready, pause
          Autoplay.buffering = true;
          Autoplay.pause();
          Analytics.generic('autoplayBuffering-' + nextFrame);
        }
      },


      replay: function () {

        Autoplay.over = false;
        Autoplay.currentFrameset = 0;
        Autoplay.timeStorage = 0;
        Autoplay.timestamp = Date.now();
        Autoplay.play();
        if (Audio.playing) {
          Audio.pause();
          Audio.play();
        }

        // reset spinner + hide overlay
        Autoplay.progressBarObj.classList.remove('sled_autoplaying');
        Autoplay.progressBarObj.width = Autoplay.progressBarObj.offsetWidth;
        Autoplay.progressBarObj.classList.add('sled_autoplaying');
        if (Autoplay.overlayObj) { Autoplay.overlayObj.style.display = NONE; }
        doc.getElementById('sled_autoplay_sound').style.display = BLOCK;
      },


      // System events

      posterLoaded: function (err, img) {

        Autoplay.videoWidth = ~~(Utils.getElementStyle(doc.getElementById('sled_autoplay'), 'width').slice(0,-2));
        Autoplay.videoHeight = Math.ceil(Autoplay.videoWidth / img.width * img.height);

        Autoplay.videoObj.style.height = Autoplay.videoHeight + 'px';
        Autoplay.videoObj.style.width = Math.ceil(15000*Autoplay.videoHeight/img.height) + 'px';
        Autoplay.videoObj.style['background-image'] = 'url(' + settings.extAssetURL + 'autoplay1.jpg)';
        doc.getElementById('sled_autoplay_container').style.height = Autoplay.videoHeight + 'px';
        doc.getElementById('sled_progress_wrapper').style.width = Autoplay.videoWidth + 'px';

        Autoplay.ready();

        isImgLoaded = true;
        if (!Autoplay.buffering) {
          adLoaded();
        }
      },


      ready: function () { // set up the buffer and analaytics loops

        Autoplay.quartileTimer = setInterval(function () { // check progress / fire quartiles when appropriate
          if (Autoplay.currentTime() > Autoplay.duration * Autoplay.quartile / 4 && Autoplay.quartile < 4) {
            if (!Autoplay.isPreview) { Analytics.quartile(Autoplay.quartile); }
            Autoplay.quartile++;
          }
        }, 500);
        Autoplay.buffering = false;

        if (ad.audioBuffer) {
          var audioButton = doc.getElementById('sled_autoplay_sound');
          if (audioButton) {
            doc.getElementById('sled_autoplay_sound').style.display = 'block';
          }
        }

        if (isImgLoaded) {
          adLoaded();
        }
      },


      bufferNextFrame: function () { // recurive, keeps calling itself (in callbacks) till it's no longer needed

        Autoplay.bufferedFramesets++;
        if (Autoplay.activated && Autoplay.buffering) {
          Autoplay.play();
        }
        if (Autoplay.bufferedFramesets < Autoplay.totalFramesets) {
          Network.fetchImage(settings.extAssetURL + 'autoplay' + (Autoplay.bufferedFramesets+1) + '.jpg', Autoplay.bufferNextFrame);
        }
      },


      pause: function () { // pausing video, audio, timer

        if (Autoplay.playing) {
          Autoplay.playing = false;
          Autoplay.videoObj.classList.add('sled_paused');
          Autoplay.progressBarObj.classList.add('sled_paused');
          Audio.pause();
          Autoplay.timeStorage += Date.now() - Autoplay.timestamp;
          Autoplay.timestamp = null;
          Autoplay.stopAnimationTimer();
          Autoplay.pauseAnalytics();
        }
      },


      resume: function (force) { // resuming from a pause (without going to the next frame)

        if (force || !Autoplay.playing) {
          Autoplay.playing = true;
          Autoplay.timestamp = Date.now();
          if (Autoplay.sound) { Audio.play(); }
          Autoplay.startAnimationTimer();
          Autoplay.videoObj.classList.remove('sled_paused');
          Autoplay.progressBarObj.classList.remove('sled_paused');
          Autoplay.resumeAnalytics();
        }
      },


      pauseAnalytics: function () {

        if (state.twoSecondsPlayedTimer) {
          clearTimeout(state.twoSecondsPlayedTimer);
          state.twoSecondsPlayedTimer = null;
        }
      },


      resumeAnalytics: function () {

        if (settings.pixels.twoSecondsPlayed && !state.twoSecondsPlayedTimer) {
          state.twoSecondsPlayedTimer = setTimeout(function () {
            Network.firePixels(settings.pixels.twoSecondsPlayed);
            settings.pixels.twoSecondsPlayed = null;
          }, 2000);
        }
      },


      startAnimationTimer: function () {

        if (Autoplay.animationTimer) { clearTimeout(Autoplay.animationTimer); }
        Autoplay.animationTimer = setTimeout(Autoplay.play, Autoplay.timeUntilNextFrame());
      },


      stopAnimationTimer: function () {

        clearTimeout(Autoplay.animationTimer);
        Autoplay.animationTimer = null;
      },


      currentTime: function () { // ms played from start

        var val = Autoplay.timeStorage;
        if (!Autoplay.buffering && Autoplay.playing) {
          val += Date.now() - Autoplay.timestamp;
        }

        return val;
      },


      timeUntilNextFrame: function () {

        return Math.min(5000, 5000 - (Autoplay.currentTime() % 5000));
      }
    };


    Gesture = {

      startTouch: [0, 0, 0], // X, Y, T
      lastTouch: [0, 0, 0],
      relTouch: [0, 0, 0],
      deltaTouch: [0, 0, 0],
      touchMoved: 0, // total # of pixels moved during a touch move
      lastTouchEvent: 0, lastTouchDuration: 0,


      start: function (e) {

        Gesture.lastTouchDuration = Gesture.lastTouch[2] - Gesture.startTouch[2];
        Gesture.lastTouchEvent = Date.now() - Gesture.lastTouch[2];
        Gesture.touchMoved = 0;

        Gesture.startTouch[0] = +(e.touches[0].clientX);
        Gesture.startTouch[1] = +(e.touches[0].clientY);
        Gesture.startTouch[2] = Date.now();
        Gesture.deltaTouch[0] = +(e.touches[0].clientX - Gesture.lastTouch[0]);
        Gesture.deltaTouch[1] = +(e.touches[0].clientY - Gesture.lastTouch[1]);
        Gesture.deltaTouch[2] = Date.now() - Gesture.lastTouch[2];
        Gesture.lastTouch[0] = +(e.touches[0].clientX);
        Gesture.lastTouch[1] = +(e.touches[0].clientY);
        Gesture.lastTouch[2] = Date.now();
        Gesture.relTouch[0] = Gesture.lastTouch[0];
        Gesture.relTouch[1] = Gesture.lastTouch[1] - state.adShift;

        if (state.active && !settings.sticky && !settings.embedElement) {
          Utils.preventDefault(e);
          state.firstGesture = false; // stop on the second gesture - the first one AFTER the ad initially appears
          if (overscrolling) {
            Analytics.generic('floatPrevented');
          }
        }
      },


      change: function (e) {

        if (settings.overscroll >= 1) {
          // filter out hyper-aggressive gestures, first checking that they're moving towards the ad
          if ((Scroll.lastExit === ABOVE && +(e.touches[0].clientY - Gesture.lastTouch[1]) > 0) || (Scroll.lastExit !== ABOVE && +(e.touches[0].clientY - Gesture.lastTouch[1]) < 0)) {
            if (Gesture.lastTouchEvent < OVERSCROLL_TIME_BETWEEN_TOUCH && Gesture.lastTouchDuration < OVERSCROLL_GESTURE_DURATION) {
              // this lets us wait til there's two offenders - and don't pop up if the ad is already visible!

              if (!state.active && overscrolling) {
                if (OVERSCROLL_ALERT) { OVERSCROLL_ALERT.style.opacity = '1'; }
                clearTimeout(overscrollStyleTimer);
                overscrollStyleTimer = setTimeout(function () {
                  if (OVERSCROLL_ALERT) { OVERSCROLL_ALERT.style.opacity = '0'; }
                }, 1300);
              }
              overscrolling = true;
              clearTimeout(overscrollTimer);
              overscrollTimer = setTimeout(function () {
                overscrolling = false;
              }, OVERSCROLL_COOLDOWN);
            }
          }
        }

        if (!state.active && overscrolling) { return; }

        Gesture.deltaTouch[0] = +(e.touches[0].clientX - Gesture.lastTouch[0]);
        Gesture.deltaTouch[1] = +(e.touches[0].clientY - Gesture.lastTouch[1]);
        Gesture.deltaTouch[2] = Date.now() - Gesture.lastTouch[2];
        Gesture.lastTouch[0] = +(e.touches[0].clientX);
        Gesture.lastTouch[1] = +(e.touches[0].clientY);
        Gesture.lastTouch[2] = Date.now();
        Gesture.relTouch[0] = Gesture.lastTouch[0];
        Gesture.relTouch[1] = Gesture.lastTouch[1] - state.adShift;

        Gesture.touchMoved += Math.abs(Gesture.deltaTouch[0]) + Math.abs(Gesture.deltaTouch[1]);
        if (Gesture.touchMoved < 8) { return; } // don't try to do anything fancy till we're more confident they're moving

        if (settings.embedElement) { // embed elements have to re-caclulate this on every touch
          state.percentInView = Utils.getAdPercentInView();
          if (!state.active && state.percentInView > 0) {
            Scroll.override();
          }
        }

        if (!state.scrolling && !state.swiping && !state.gestureOverride) {
          // automatically scroll if ad barely on screen, if touch not over ad, touch moving in a vertical direction, or swiping not enabled
          // note the 1.5 factor to make it easier to scroll than swipe
          if (state.percentInView < 50 ||
              (!settings.embedElement && (Gesture.relTouch[1] < 0 || Gesture.relTouch[1] > ad.height)) ||
              Math.abs(1.5*Gesture.deltaTouch[1]) > Math.abs(Gesture.deltaTouch[0]) ||
              ad.panels === 1) {
            Scroll.start();
            state.scrolling = true;
          } else {
            state.swiping = true;
          }
        }

        if (state.swiping) {
          Swipe.change();
        } else if (state.scrolling) {
          Scroll.change();
        }
        if (state.active && !settings.sticky && !settings.embedElement) {
          Utils.preventDefault(e);
        }
      },


      end: function (e) {

        var deltaX = Math.abs(Gesture.lastTouch[0]-Gesture.startTouch[0]);
        var deltaY = Math.abs(Gesture.lastTouch[1]-Gesture.startTouch[1]);
        var deltaT = Math.abs(Gesture.lastTouch[2]-Gesture.startTouch[2]);

        if (state.scrolling) {
          Scroll.end(); // outside of active state check b/c used by onBeforeImpression
        }
        if (state.active) {
          if ((!state.gestureOverride && !state.scrolling && !state.swiping && !settings.embedElement) ||
              (deltaX < 7 && deltaY < 7 && deltaT < 100)) {
            handleClick(e);
          }
          if (state.swiping) {
            Swipe.end();
          }
          Analytics.interaction(); // let analytics know there was an interaction
          if (!settings.sticky && !settings.embedElement) { Utils.preventDefault(e); }
        }
        state.scrolling = false;
        state.swiping = false;
        state.gestureOverride = false;
      }
    };


    Scroll = {

      frame: null, // the animation frame
      initFrame: null, // what frame we were on when we last initialized
      insertionPoint: null, // px from page top to view bottom when ad was first inserted
      lastExit: BELOW, // where last insertion came from (ABOVE or BELOW)


      start: function () {

        scrollSpeed = 0;
        state.scrolling = true;

        if (!settings.early) {
          Scroll.possiblyOverride();
        } else if (Scroll.initFrame === Scroll.frame)  { // edge case where win.requestAnimationFrame dies prematurely while override is on
          win.cancelAnimationFrame(Scroll.frame);
          Scroll.frame = win.requestAnimationFrame(Scroll.update);
          Scroll.initFrame = Scroll.frame;
        }
      },


      change: function () {

        if (settings.embedElement) { return; }

        scrollSpeed = (Gesture.deltaTouch[1]/Gesture.deltaTouch[2])*0.9 + scrollSpeed*0.1; // moving average
        if (state.firstGesture) { // boost the first gesture - but still cap it. Speed up slow gestures, but don't let them fling it.
          scrollSpeed *= settings.ENTRY_MULTIPLIER;
          scrollSpeed = Math.min(Math.max(scrollSpeed, -settings.ENTRY_MAX_SPEED), settings.ENTRY_MAX_SPEED); // cap it at max entry speed
        }
        else {
          scrollSpeed = Math.min(Math.max(scrollSpeed, -settings.SCROLL_SPEED_MAX), settings.SCROLL_SPEED_MAX); // cap it
        }

        if (sledLoaded && plugins.onBeforeImpressionGesture && Utils.getScrollPosition() + state.viewHeight > settings.minPosition) {
          plugins.onBeforeImpressionGesture();
          plugins.onBeforeImpressionGesture = null;
        }
      },


      end: function () {

        if (settings.early) {
          Scroll.possiblyOverride();
        }

        if (Autoplay && Audio && Autoplay.playing && settings.autoplayAutosound) {
          Audio.play();
          settings.autoplayAutosound = false;
        }

        if (sledLoaded && !settings.embedElement && plugins.onBeforeImpression && Utils.getScrollPosition() + state.viewHeight > settings.minPosition) {
          plugins.onBeforeImpression();
          plugins.onBeforeImpression = null;
        }
      },


      // direction (optional) manually overrides direction selection
      possiblyOverride: function (direction) {

        if (settings.embedElement) { return; } // embed checks on gesture change, we don't need it here

        if (state.active && !settings.sticky && !settings.embedElement && state.lastFrame === state.frames) {
          if (state.hasClicked) {
            Analytics.generic('bug-ClickFreeze');
            exit('bug-ClickFreeze');
          } else if (state.frozenGestures >= 2) {
            exit('bug-FrameFreeze');
          } else {
            Analytics.generic('bug-FrameFreeze');
          }
          state.frozenGestures++;
        }

        state.lastFrame = state.frames;
        if (sledLoaded && !state.active && (settings.instant || state.gestures > 1)) {
          state.viewTop = Utils.getScrollPosition();
          state.viewHeight = Utils.getViewHeight();
          state.viewBottom = state.viewTop + state.viewHeight;

          if (direction) {
            Scroll.override(direction);
          // if view is below start line and scrolling down, let's go!
          } else if (!Scroll.insertionPoint || Scroll.lastExit === BELOW) {
            if (state.viewBottom > (Scroll.insertionPoint || settings.minPosition) && Gesture.deltaTouch[1] < 0) {
              Scroll.override(BELOW);
            }

          } else { // last inserted below, which means next time comes from top
            if (state.viewBottom < Scroll.insertionPoint && state.viewBottom > settings.minPosition && Gesture.deltaTouch[1] > 0) {
              Scroll.override(ABOVE);
            }
          }
        }
      },


      override: function (direction) {

        if (win.innerHeight < win.innerWidth) { return; } // don't show ad in landscape mode
        if (!sledLoaded) { // don't show if not loaded
          Analytics.notReady();
          return;
        }

        // insert ad / start animation frame
        ad.state.timesSeen++;
        ad.state.percentSeen = 0;
        state.active = true;
        state.viewTop = Utils.getScrollPosition();
        state.viewHeight = Utils.getViewHeight();
        state.viewBottom = state.viewTop + state.viewHeight;
        Scroll.lastExit = direction;
        if (Scroll.lastExit === ABOVE) {
          state.adShift = -ad.height + settings.offsetTop;
        } else {
          state.adShift = state.viewHeight + settings.offsetTop;
        }

        ad.wrapper.classList.add('sled_visible');
        if (!settings.embedElement) {
          doc.body.style['touch-action'] = NONE;
        }

        if (!Scroll.frame) {
          frameTime = Date.now();
          Scroll.frame = win.requestAnimationFrame(Scroll.update);
          console.log('initiating frames');
          setTimeout(function () { // detect the case where the frame doesn't fire
            if (state.frames > 0) {
              state.lastFrame = state.frames;
            } else {
              console.log('Failed to initiate frames, trying again');
              Scroll.frame = win.requestAnimationFrame(Scroll.update);
              setTimeout(function () { // detect the case where the frame doesn't fire
                if (Scroll.frame === null || (settings.ios7 && state.frames === 0)) {
                  console.log('Still failed, killing');
                  Scroll.reset();
                } else {
                  state.lastFrame = state.frames;
                }
              }, 60);
            }
          }, 60);
        }
      },


      reset: function () {

        Scroll.release();
        Scroll.frame = null;
      },


      update: function () {

        var time = Date.now();
        var deltaT = Math.min(settings.FRAME_DELTA_T_MAX, time - frameTime) || 1;

        frameTime = time;
        state.frames++;
        state.frameT += deltaT;

        // Code that run every frame

        if (state.percentInView >= 50) {
          state.viewable50 += deltaT;
          state.viewable50Continuous += deltaT;

          if (state.viewable50Continuous >= 1000 && Analytics.impressionMRC) {
            Analytics.impressionMRC();
          }
          if (state.percentInView >= 100) {
            state.viewable100 += deltaT;
          }
        } else {
          state.viewable50Continuous = 0;
        }

        // Code that runs when we aren't moving

        if (state.focused && !scrollSpeed && !settings.instant && !settings.embedElement) { // if not moving & still in focus, increment ad.state.timeStopped
          ad.state.timeStopped += deltaT;

        // Code that runs when we ARE moving

        } else if ((settings.instant || scrollSpeed || settings.embedElement) && !state.locked && state.focused) {
          state.percentInView = Utils.getAdPercentInView(); // only need to update if we've moved
          var delta = Math.round(Math.min(Math.max(scrollSpeed * deltaT, -12), 12)) * (settings.SPEED_ALPHA-state.percentInView)/settings.SPEED_BETA;
                  // ^^ that final multiple determines speed at the edges of screen vs center
          // embed's is updated in Utils.getAdPercentInView
          if (!settings.embedElement) {
            state.adShift += delta;
          }
          var midpoint = state.adShift + ad.height / 2;

          if (!state.locked && settings.sticky) {
            showStickyUnit();
          }

          if (plugins.onScroll) { plugins.onScroll({ad: ad.html, adShift: state.adShift}); }
          if (delta && plugins.scrollPoints) {
            var t = plugins.scrollPoints,
                dir = ((delta<0) ? 1 : -1); // delta is upside down
            if (midpoint < state.viewHeight / 2) { dir *= -1; }
            for (var i = 0, l = t.length; i < l; i++) {
              var p = t[i], nextDir = p.nextDir || ((p.entry) ? 1 : -1);
              if (p.entry) {
                if (nextDir === dir && nextDir*state.percentInView > nextDir*p.entry) {
                  p.nextDir = -dir;
                  if (dir === 1) { p.function (); }
                }
              } else if (p.exit) {
                if (nextDir === dir && nextDir*state.percentInView > nextDir*p.exit) {
                  p.nextDir = -dir;
                  if (dir === -1) { p.function (); }
                }
              } else if (p.center) {
                if (Math.abs(midpoint - state.viewHeight/2) < 10) {
                  p.function ();
                }
              } else if (p.percent) {
                if (Math.abs(midpoint - (state.viewHeight * p.percent)) < 10) {
                  p.function ();
                }
              }
            }
          }

          // if they're zooming along from a speedy first gesture, don't let the ad fly off screen
          if (state.firstGesture && Math.abs(state.viewHeight/2 - ad.height/2 - state.adShift) < 10 && !settings.sticky) {
            scrollSpeed = 0;
          }
          scrollSpeed *= settings.FRICTION - 0.004*(deltaT-30); // decelerate when the user lets go, adjusting friction for time each frame
              // close approximation of *= Math.pow(settings.FRICTION, deltaT/30)
          if (Math.abs(scrollSpeed) < settings.SCROLL_SPEED_MIN) { scrollSpeed = 0; } // if it's going really slow, stop rather than creep

          if (state.percentInView > 0) {
            Analytics.onScreen();

            if (state.percentInView > ad.state.percentSeen) {
              if (state.percentInView >= 50 && ad.state.percentSeen < 50) {
                // entered 50% in view for first time - fire analytics event / load the rest of the videos / start autoplay
                if (Analytics.impression50) { Analytics.impression50(); }
              }
              if (state.percentInView === 100) {
                if (Analytics.impression100) { Analytics.impression100(); }
              }
              ad.state.percentSeen = state.percentInView;
            }
            if (Autoplay) {
              if (state.percentInView >= settings.autoplayViewPercent) {
                Autoplay.onScreen(); // if it's in the transition area
              } else if (state.percentInView < settings.autoplayViewPercent) {
                Autoplay.offScreen(); // if it's leaving view
              }
            }
          }

          if (settings.embedElement) {
            if (state.percentInView < 0) {
              Scroll.release('embed');
            }
          } else {
            // NOTE: If we change how ad shift is handled, we need to change how pixelSeconds is recorded
            ad.style[_transform] = 'translate(0,' + state.adShift + 'px) translateZ(0)';
            /* Backgroung page scroll disabled
            if (!settings.ios8) {
              setTimeout(function () { // scroll the page
                settings.scrollElement.scrollTop -= delta*settings.ARTICLE_SCROLL_SPEED;
              }, 0);
            }*/

            if ((state.adShift < -ad.height + settings.offsetTop || state.adShift > state.viewHeight + settings.offsetTop)) {
              if (state.adShift <= 0) { Scroll.lastExit = ABOVE; }
              else { Scroll.lastExit = BELOW; }

              if (settings.multiview || ad.state.timesSeen === 0 || (settings.bottomPersistence && state.adShift > state.viewHeight + settings.offsetTop)) {
                Scroll.release(Scroll.lastExit); // releasing the ad but not destroying Sled
              } else {
                exit(Scroll.lastExit); // permanently destroying Sled
              }
            }
          }
        }

        Scroll.frame = (state.active) ? win.requestAnimationFrame(Scroll.update) : null;
      },


      release: function (dir) {

        state.active = false;
        Analytics.offScreen(dir);
        ad.wrapper.classList.remove('sled_visible');
        if (!settings.embedElement) {
          doc.body.style['touch-action'] = '';
          Scroll.insertionPoint = Math.max(state.viewBottom, settings.minPosition + 250); // give it some range to appear in when scrolling back up!
        }
        if (Autoplay) {
          Autoplay.sound = false;
          Autoplay.pause();
        }
      }
    };


    Swipe = {

      change: function () {

        maskStyle.transition = NONE;
        if (maskPosition > ad.width*(ad.panels-1) || maskPosition < 0) {
          maskPosition = ad.width*(ad.panel-1) + (Gesture.startTouch[0]-Gesture.lastTouch[0])/4; // resist if user swipes out of bounds
        } else {
          maskPosition = ad.width*(ad.panel-1) + (Gesture.startTouch[0]-Gesture.lastTouch[0]);
        }
        maskStyle[_transform] = 'translate(' + Math.round(-maskPosition) + 'px, 0) translateZ(0)';
        Swipe.onChange();
      },


      end: function () {

        var newTarget = ad.panel;
        if (Math.abs(maskPosition - ad.width*(ad.panel-1)) > settings.SWIPE_THRESHOLD * ad.width) {
          if (maskPosition > ad.width*(ad.panel-1) && ad.panel !== ad.panels) {
            newTarget++;
          } else if (maskPosition < ad.width*(ad.panel-1) && ad.panel !== 1) {
            newTarget -=1;
          }
        }
        Swipe.updatePanel(newTarget);
        setTimeout(function () {
          state.swiping = false;
        }, 300);
      },


      updatePanel: function (newTarget) {

        if (newTarget !== ad.panel) {
          ad.panel = newTarget;
          Analytics.swipe(ad.panel);
          if (plugins.onSwipeChange) { plugins.onSwipeChange({panel: newTarget}); }
        } else {
          Analytics.generic('swipeIncomplete');
        }

        Video.hide();
        maskPosition = ad.width*(ad.panel-1);
        maskStyle.transition = 'all 0.3s';
        maskStyle[_transform] = 'translate(' + Math.round(-maskPosition) + 'px, 0) translateZ(0)';
        if (triggers.length > 0) {
          for (var i = 0, l = triggers.length; i < l; i++) {
            triggers[i].classList.remove('selected');
          }
          triggers[ad.panel-1].classList.add('selected');
        }
        mask.className = 'sled_active_panel-' + ad.panel;
        Swipe.onChange();
      },


      onChange: function () {

        if (plugins.onSwipe) { plugins.onSwipe({ad: ad.html, page: ad.state.page, position: maskPosition}); }
      }
    };


    Video = {
      active: null,
      activeWrapper: null,
      activeOverlay: null, // active video element, if any


      toggle: function (wrapper) {

        if (!wrapper.querySelector('.sled_video')) {
          Video.insert(wrapper);
        }
        var id = wrapper.id;

        // toggling the currently playing video - pause it

        if (Video.activeWrapper === wrapper) {
          Video.hide();

        // this is a new video - stop the current video, start this one

        } else {
          Analytics.videoStart(id);
          Video.hide();
          Video.activeWrapper = wrapper;
          Video.active = Video.activeWrapper.querySelector('.sled_video');
          Video.activeOverlay = Video.activeWrapper.querySelector('.sled_video_overlay');
          Video.active.style.display = BLOCK;
          Video.activeOverlay.classList.add('sled_invisible');
          Video.active.play();
        }
      },


      hide: function () { // hide + stop old video

        if (Video.active) {
          Analytics.videoEnd(Video.activeWrapper.id);
          if (doc.exitFullscreen) {
            doc.exitFullscreen();
          } else if (doc.mozExitFullScreen) {
            doc.mozExitFullScreen();
          } else if (doc.webkitExitFullScreen) {
            doc.webkitExitFullScreen();
          }
          Video.active.pause();
          Video.activeOverlay.classList.remove('sled_invisible');
          Video.active.style.display = NONE;
          if (plugins.onVideoClose) { plugins.onVideoClose({ad:ad, videoWrapperID: Video.activeWrapper.id}); }
          Video.active = Video.activeWrapper = Video.activeOverlay = null;
        }
      },


      close: function () { // called when fullscreen video closed

        Analytics.click(Video.activeWrapper.id); // simulate click to close video
        Video.hide();
      },


      finish: function () {

        Video.hide();
      },


      insert: function (el) { // given a div.sled_video_wrapper, inserts video element

        var src = el.getAttribute('data-video-src');
        var video = doc.createElement('video');
        var source = doc.createElement('source');
        video.className = 'sled_video';
        video.style.display = NONE;
        source.src = ad.assetURL + src;
        source.type = 'video/mp4';
        video.appendChild(source);

        el.appendChild(video); // NOTE: controls currently not included, but could set video.controls = 'controls' if desired
        video.addEventListener('webkitendfullscreen', Video.close, false);
        video.addEventListener('mozfullscreenchange', Video.close, false);
        video.addEventListener('endfullscreen', Video.close, false);
        video.addEventListener('ended', Video.finish, false);
      }
    };
  }


  function showStickyUnit() {

    ad.html.classList.add('sled_locked');
    doc.body.style['touch-action'] = '';
    state.adShift = -(ad.height-1); // don't want a gap on the bottom
    state.percentInView = 100;
    state.locked = true;
    Autoplay.onScreen();
    if (plugins.onLock) { plugins.onLock({ad: ad.html, position: state.viewHeight + settings.offsetTop - ad.height}); }
  }


  var exit = this.exit = function (reason) { // only way to completely kill the engine (does not kill Sledbeat)

    Analytics.dismiss(reason);
    Scroll.release();
    ad.wrapper.classList.add('sled_invisible');
    win.removeEventListener('touchstart', Gesture.start, true);
    win.removeEventListener('touchmove', Gesture.change, true);
    win.removeEventListener('touchend', Gesture.end, true);
    win.removeEventListener('touchcancel', Gesture.end, true);
    if (plugins.onExit) { plugins.onExit({Analytics: Analytics}); }

    console.log(YAHOO.tool.Profiler.getFullReport(function (report) { return report.calls>0; }));
    console.log('Scroll.update avg performance: ' + (YAHOO.tool.Profiler.getFullReport()['Scroll.update'].avg) + 'ms');
    console.log('Scroll.update worst performance: ' + (YAHOO.tool.Profiler.getFullReport()['Scroll.update'].max) + 'ms');

    setTimeout(function () {
      ad.wrapper.remove();
    }, 300);
  };
};
}
