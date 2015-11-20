// Handles loading the ad, then passes off to engine.js

"use strict"; // jshint ignore:line

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  new InitSled();
} else {
  document.addEventListener('DOMContentLoaded', function (e) {
    new InitSled();
  });
}

// new InitSled() creates a "this" for modules to latch to
function InitSled() { // jshint ignore:line

  var settings = {
    ads: [
      {
        id: 'ad',
        format: 'ad',
      },
    ],
    analyticsURL: 'http://b.sledmobile.com',
    isATest: true,
  };
  var win = window.top;
  var doc = win.document;
  var timer = Date.now();

  if (win.Sled) { // don't run if our code's already running, but track that another tag was called
    win.Sled.state.tagCount++;
    win.Sled.Analytics.generic('tagCount-' + win.Sled.state.tagCount);
    return;
  }

  if (settings.server === 'localhost') {
    settings.sledURL = 'http://' + window.location.host;
  }

  var Sled;
  win.Sled = Sled = {
    adJSLoaded: null, // will be populated by Loader.js
    adJSFailed: null, // will be populated by Loader.js
    ad: null,
    Analytics: null,
    engine: null,
    external: {
      loaded: function () {
        Sled.settings.externalLoaded = true;
        Sled.engine.adJSLoaded();
      }
    },
    Network: null,
    plugins: { },
    state: {
      tagCount: 1, // how many times our tag has been run this session / page, starting at 1
      loadSpeed: null,
      initSpeed: null,
      frames: 0, // for moving average of frame speed - # of frames run
      frameT: 0, // for moving average of frame speed - total time between frames
      viewable50: 0, // ms that ad has been >=50% viewable
      viewable50Continuous: 0, // ms that ad has been continuously >=50% viewable
      viewable100: 0, // ms that ad has been >=100% viewable
      moatViewableFunction: function () { return null; },
      moatMaxT: 0, // moat viewable returns 0 after impressionEnd, so we rachet it
      lastFrame: 0, // keeping track of the last frame we saw, to check if they've stopped incrementing

      scrollPosition: 0,
      scrollPositionT: Date.now(), // only calculate a max of every 100ms, forces a reflow

      percentInView: 0, // percent of ad currently in view
      viewHeight: win.screen.availHeight,
      viewWidth: win.screen.availWidth,
      viewTop: 0,
      viewBottom: 0,

      focused: true, // if window is in focus
      hasClicked: false, // if the user has clicked a CTA at least once
      gestures: 0, // count of gestures made
      frozenGestures: 0, // how many times the user has tried to gesture with no result
      active: false, // if the engine is actively overriding gestures
      firstGesture: true,
      swiping: false, // if mid-swipe gesture
      scrolling: false, // if mid-scroll gesture

      host: encodeURIComponent(win.location.hostname.slice(0,255)),
      referrer: encodeURIComponent(doc.referrer.slice(0,255)),
      page: encodeURIComponent(win.location.href.slice(0,255)),
      title: encodeURIComponent(document.title.slice(0,255)),
      language: (win.navigator.userLanguage || win.navigator.language).toLowerCase(),

      timesAdSeen: 0,
      timesSledSeen: 0
    },
    settings: null,
    Utils: null
  };

  try {

    // Process the settings / filling in defaults
    // General Sled utilities

    (function (exports) {

      var xmlParser = null;

      if (typeof DOMParser != 'undefined') {
        xmlParser = new DOMParser();
      } else {
        console.log("No DOM Parser available"); // Gulp doesn't have access to DOMParser
      }


      // Custom Sled Error object
      // options.alert: fire Analytics error. Defaults to true
      // For reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
      exports.SledError = function (name, message, options) {
        options = options || {};
        this.name = name || 'SledError';
        this.message = message || 'Sled Error';
        this.stack = (new Error()).stack;
        // dir not log so that it's not surrounded by "if Sled.settings.isATest" in gulp. May be called before Sled.settings is defined
        console.dir(this);
        if (Sled && Sled.Analytics && options.alert !== false) {
          Sled.Analytics.error(this);
        }
      };
      exports.SledError.prototype = Object.create(Error.prototype);
      exports.SledError.prototype.constructor = exports.SledError;

      // takes in a list of tasks with signature (cb) - (that must call cb when done)
      // fires done when all are complete
      // aborts with err if any fail -> resturns (err, result)
      exports.async = function (tasks, done) {

        var task = [].concat(tasks.shift());
        var remaining = [];
        var failed = false;

        for (var i = 0, l = task.length; i < l; i++) { // can't use remaining here, because that gets changed by cb's
          worker(i, task[i]);
        }

        function worker(i, func) {
          remaining.push(i);
          func(function(err, result) {
            cb(i, err, result);
          });
        }

        function cb(i, err, result) {

          var index = remaining.indexOf(i);

          if (index === -1) { return; } // this function already returned....skip

          remaining.splice(index, 1);

          if (failed) {
            // do nothing - one of the workers already failed
          } else if (err) {
            failed = true;
            done(err);
          } else if (remaining.length > 0) {
            // do nothing, parallel tasks still running
          } else if (tasks.length > 0) { // start next batch
            exports.async(tasks, done);
          } else {
            done();
          }
        }
      };


      // like async, but takes a list of inputs and a function to run on them
      // keeps waterfalling through the list until one succeeds all
      exports.waterfall = function (waterfall, func, timeout, cb) {

        if (waterfall.length === 1) { timeout = 60000; } // no point in timing out if there's nothing to waterfall to

        waterfallHelper(waterfall, func, timeout, cb);
      };


      function waterfallHelper (waterfall, func, timeout, cb) {

        if (waterfall.length === 0) {
          return cb({
            name: 'endOfWaterfall',
            message: 'endOfWaterfall'
          });
        }

        var alreadyCb = false;
        var timer = setTimeout(function() {
          errored(new Error('timeout'));
        }, timeout);

        // run the supplied fuction
        func(waterfall[0], function(err, result) {

          if (alreadyCb) { return; }

          if (err) { errored(err); return; }

          alreadyCb = true;
          clearTimeout(timer);
          cb(null, result);
        });


        function errored(error) {

          if (alreadyCb) { return; }

          alreadyCb = true;
          clearTimeout(timer);

          exports.waterfall(waterfall.slice(1), func, timeout, function(err, result) {

            if (err) {
              err.message = error.message + '->' + err.message;
              return cb(err);
            }

            cb(null, result);
          });
        }
      }


      exports.parseXml = function (text, cb) {

        try {
          cb(null, xmlParser.parseFromString(text,'text/xml'));
        } catch (err) {
          err.name = 'XmlParserError';
          cb(err);
        }
      };


      exports.replaceMacros = function (str, name, cb) {

        try {
          // capture any macros inside of {}'s, []'s, %5b%5d's
          // with optional '?' in front
          var result;
          if (Array.isArray(str)) {
            result = [];
            for (var i = 0, l = str.length; i < l; i++) {
              result[i] = str[i].replace(/\$?(\[|\{|(?:%5b))(.*?)(\]|\}|(?:%5d))/g, replaceMacroHelper);
            }
          } else {
            result = str.replace(/\$?(\[|\{|(?:%5b))(.*?)(\]|\}|(?:%5d))/g, replaceMacroHelper);
          }
          return cb(null, result);
        } catch (err) {
          err.name = 'ReplaceMacroError';
          err.message = name + ': ' + err.message;
          return cb(err);
        }
      };


      function replaceMacroHelper (whole, capture, match) {

        match = match.toLowerCase();
        switch (match) {
          case 'random':
              return exports.random;

          case 'timestamp':
              return exports.timestamp;

          case 'player_width':
          case 'player_height':
              return Sled.state.viewWidth;

          case 'media_id':
          case 'media_title':
              return Sled.state.title;

          case 'description_url':
              return Sled.state.page;

          case 'media_url':
          case 'source_page_url':
          case 'hard_code_url':
              return Sled.state.host;

          case 'referrer_url':
              return Sled.state.referrer;

          case 'publisher':
              return (Sled.settings.metadata) ? Sled.settings.metadata.publisher : '';

          default:
            if (Sled.settings.debug) {
              new exports.SledError('UnknownMacro', whole);
            }
            return whole;
        }
      }


      exports.timestamp = Date.now(); // static value generated on script load


      exports.random = ~~(Math.random() * 1e8); // static value generated on script load


      exports.getScrollPosition = function () {

        var state = Sled.state;
        // calculate at most once every 100ms - high performance cost
        if (Date.now() - state.scrollPositionT >= 100) {
          var el = settings.scrollElement || doc.documentElement;
          state.scrollPosition = ~~el.scrollTop;
          state.scrollPositionT = Date.now();
        }
        return state.scrollPosition;
      };


      exports.getElementData = function (el) {

        var data = {};
        [].forEach.call(el.attributes, function (attr) {
          if (/^data-/.test(attr.name)) {
            data[attr.name.substr(5)] = attr.value;
          }
        });
        return data;
      };


      // requires styleProp to be in hyphenated format (ie background-color)
      exports.getElementStyle = function (el, styleProp) {

        var value, defaultView = (el.ownerDocument || doc).defaultView;
        if (defaultView && defaultView.getComputedStyle) {
          return defaultView.getComputedStyle(el, null).getPropertyValue(styleProp);
        }
      };


      // rough equivalent to jquery's .closest
      exports.getClosest = function (elem, selector) {

        var firstChar = selector.charAt(0);
        for ( ; elem && elem !== document; elem = elem.parentNode ) {
          // If selector is a class
          if ( firstChar === '.' && elem.classList.contains( selector.substr(1) ) ) { return elem; }
          // If selector is an ID
          if ( firstChar === '#' && elem.id === selector.substr(1) ) { return elem; }
          // If selector is a data attribute
          if ( firstChar === '[' && elem.hasAttribute( selector.substr(1, selector.length - 2) ) ) { return elem; }
          // If selector is a tag
          if ( elem.tagName.toLowerCase() === selector ) { return elem; }
        }
        return false;
      };


      exports.getViewHeight = function () {

        var height = Math.max(win.screen.availHeight, win.innerHeight, 0);
        return height - settings.offsetTop - settings.offsetBottom;
      };


      exports.getAdPercentInView = function () {

        var viewPercent = 0;
        var adShift = Sled.state.adShift;
        var adHeight = Sled.ad.height;

        if (settings.embedElement) {
          state.viewTop = exports.getScrollPosition();
          Sled.state.adShift = Sled.ad.wrapper.getBoundingClientRect().top;
          adShift = Sled.state.adShift;
        }
        if (adShift) {
          if (adShift + adHeight < state.viewHeight + settings.offsetTop && adShift > settings.offsetTop) {
            viewPercent = 1; // ad fully in view
          } else if (adShift + adHeight > state.viewHeight + settings.offsetTop) {
            viewPercent = (state.viewHeight + settings.offsetTop - adShift) / adHeight; // ad near bottom
          } else {
            viewPercent = 1 + (adShift - settings.offsetTop)/adHeight; // ad near top
          }
        }
        return ~~(viewPercent * 100);
      };


      exports.preventDefault = function (e) {

        e = e || win.event;
        if (e.preventDefault) e.preventDefault();
        e.returnValue = false;
      };


      exports.cookieRead = function (name) {

        var nameEQ = name + '=', ca = doc.cookie.split(';');
        for (var i = 0, l = ca.length; i < l; i++) {
          var c = ca[i].trim();
          if (c.indexOf(nameEQ) === 0) {
            var val = c.substring(nameEQ.length,c.length);
            return isNaN(val) ? val : +val;
          }
        }
        return null;
      };


      exports.cookieWrite = function (name, value) {

        var date = new Date();
        date.setTime((+date) + (365*86400000)); // expires in 365 days

        var temp = location.host.split('.').reverse(),
            domain = ' domain=.' + temp[1] + '.' + temp[0] + ';'; // adds . in front of domain for access across all subdomains
        if (location.host.indexOf(':8000') !== -1) { domain = ''; }

        doc.cookie = name + '=' + value + '; expires=' + date.toGMTString() + ';' + domain + 'path=/;';
      };


      exports.windowBlur = function () {

        if (!Sled.state.focused) { return; }
        Sled.state.focused = false;
        if (!Sled.engine || !Sled.state.active) {
          if (Sled.state.frames === 0) {
            Analytics.left('leftBeforeAd');
          } else {
            Analytics.left('leftAfterAd');
          }
        } else { // ad is active - it's a defocus
          Analytics.left('left');
          if (Sled.Autoplay) { Sled.Autoplay.offScreen(); }
        }
      };


      exports.windowFocus = function () {

        if (Sled.state.focused) { return; }
        Sled.state.focused = true;
        if (!Sled.engine || !Sled.state.active) {
          if (Sled.state.frames === 0) {
            Analytics.returned('returnedBeforeAd');
          } else {
            Analytics.returned('returnedAfterAd');
          }
        } else { // ad is active - it's back on screen
          Analytics.returned('returned');
          if (Sled.Autoplay) { Sled.Autoplay.onScreen(); }
        }
      };

    })(typeof exports === 'undefined'? this.Utils = {} : exports);


    var Utils = Sled.Utils = this.Utils;
    // Handles formatting settings and defining defaults

    (function SettingsParser (exports) {


      // This module structure (init, allows some handy things:
        // The module cannot be run unless it's first initialized with its dependencies
        // The code is quite compact and very minifiable since it doesn't require long static references (ie exports.module.prototype.parseURL)
      exports.init = function (Utils, errorFunction) {

        // given a URL, parses it into a settings dictionary
        // if generating, don't complain about non-resolved macros
        exports.parseURL = function (url, generating) {

          var params = url.split('?');
          var settings = {};

          if (params.length <= 1 || params[1].length <= 1) {
            errorFunction(new Utils.SledError('SettingsParserError', 'noSettingsInURL'));
          } else if (params.length >2) {
            errorFunction(new Utils.SledError('SettingsParserError', 'invalidSettingsEncoding'));
          } else {
            settings = exports.parseSettings(JSON.parse('{"' + params[1].replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g,'":"') + '"}'), generating);
          }
          return settings;
        };


        exports.parseSettings = function (settings, generating) {

          var errs = [];
          for (var setting in settings) {
            var old = settings[setting];
            try {
              var decoded = decodeURIComponent(old);
              if (!generating) { // running decodes breaks on macros. When we're generating, we want to preserve macros
                while (decoded !== old) {
                  old = decoded;
                  decoded = decodeURIComponent(decoded);
                }
              }
              settings[setting] = exports.formatSetting(setting, decoded, generating);
            } catch(e) {
              if (!generating && typeof settings[setting] !== 'object') {
                errs.push(new Utils.SledError('SettingsParserError', setting + ':' + settings[setting]));
                settings[setting] = null;
              }
            }
          }
          // call errors once the settings are done parsing
          for (var i = 0, l = errs.length; i < l; i++) { errorFunction(errs[i], settings); }
          return settings;
        };


        // unified formatting patterns for all setting values
        exports.formatSetting = function (key, value, generating) {

          // don't numerize these, they'll overflow JS precision
          if (key === 'user' || key === 'session' || key === 'tagID') {
            return value;
          }

          if (value === 'true' || value === true) {
            return true;
          } else if (value === 'false' || value === false) {
            return false;
          } else if (!isNaN(value)) {
            return +value;
          } else if (value.constructor === Array || (value.slice(0, 1) === '[' && value.slice(-1) === ']')) { // array
            return eval(value); // jshint ignore:line
          } else if (typeof value !== 'object' && value.indexOf(',') !== -1) { // array - convert string back into array
            var array = value.replace(/"/g, '').replace(/'/g, '').split(',');
            for (var i = 0, l = array.length; i < l; i++) {
              var item = array[i];
              if (item === 'true') { item = true; }
              else if (item === 'false') { item = false; }
              else if (!isNaN(item)) { item = +item; }
            }
            return array;
          }
          return value;
        };


        exports.applyDefaults = function (s) {

          s.SWIPE_THRESHOLD = s.SWIPE_THRESHOLD || 0.15; // % of panel user has to swipe to trigger change
          s.SPEED_ALPHA = s.SPEED_ALPHA || 190; // scroll speed speed = (alpha - percentInView) / beta
          s.SPEED_BETA = s.SPEED_BETA || 90;
          s.SCROLL_SPEED_MAX = s.SCROLL_SPEED_MAX || 0.8; // max speed they can scroll through the ad
          s.SCROLL_SPEED_MIN = 0.1; // if ad scroll speed is below this, set it to 0
          s.FRAME_DELTA_T_MAX = 60; // max ms between frames for calculating animation diffs
          s.FRICTION = s.FRICTION || 0.886; // speed = speed * (1 - friction) per 30ms (~1 frame)
          s.ENTRY_MULTIPLIER = s.ENTRY_MULTIPLIER || 1.6; // multiplier on first gesture's scroll speed
          s.ENTRY_MAX_SPEED = s.ENTRY_MAX_SPEED || s.SCROLL_SPEED_MAX;

          s.scrollElement = (s.scrollElement && doc.querySelector(s.scrollElement)) || doc.body;
          s.embedElement = (s.embedElement && doc.querySelector(s.embedElement)) || false;
          s.minPosition = (s.embedElement) ? 0 : (s.minPosition || 1000);
          s.multiview = s.multiview || false;
          s.bottomPersistence = s.bottomPersistence || false;
          s.offsetBottom = s.offsetBottom || 0;
          s.offsetTop = s.offsetTop || 0;
          s.overscroll = (s.embedElement) ? 0 : (s.overscroll || 1);
          s.autoplayViewPercent = s.autoplayViewPercent || 50;

          return s;
        };

        return exports;
      };
    })(typeof exports === 'undefined' ? this.SettingsParser = {} : exports);


    var errors = [];
    var SettingsParser = this.SettingsParser.init(Utils, function (err) { errors.push(err); });

    var state = Sled.state;
    var settings; // redefining settings here prevents the minifier from breaking it

    Sled.settings = settings = SettingsParser.applyDefaults(SettingsParser.parseSettings(settings));
    if (settings.tagID === 0) { console.log('Sled running off default tag'); }
    settings.sledbeat = settings.sledbeat || settings.isATest || (Math.random() < 0.01); // only enable sledbeat for 1% of imps to keep data impact minimal
    settings.pixels = settings.pixels || {};

    // Initialize modules
    // Handles low-level networking requests and callbacks

    (function (exports) {

      exports.init = function (Utils) {

        // hit a single GET url (has CORS issues)
        exports.fetchData = function (url, cb) {

          xmlRequest('GET', url, null, cb);
        };


        // hit a single POST url with data (has CORS issues)
        exports.post = function (url, data, cb) {

          xmlRequest('POST', url, data, cb);
        };


        function xmlRequest (type, url, data, cb) {

          var xmlhttp = new XMLHttpRequest();
          xmlhttp.open(type, url, true);
          xmlhttp.onreadystatechange = function () {
            if (xmlhttp.readyState === 4 ) {
              if (xmlhttp.status === 200) {
                if (cb) { cb(null, xmlhttp.responseText); }
              } else {
                var notFromSled = (url.substring(9,23) !== 'sledmobile.com'); // don't fire analytics errors on analytics errors
                var err = new Utils.SledError('NetworkError', xmlhttp.status + ':' + url, { alert: notFromSled });
                if (cb) { cb(err); }
              }
            }
          };
          xmlhttp.send(data);
        }


        // hit a single GET url (immune to CORS issues)
        exports.fetchImage = function (url, cb) {

          var img = new Image();
          if (cb) { img.addEventListener('load', function () { cb(null, img); }, false); }

          img.addEventListener('error', function () {

            var err = new Utils.SledError('NetworkError', 'failedImg:' + url);
            if (cb) { cb(err); }
          }, false);
          img.src = url;
        };


        // fire a URL and don't bother listening for a response; used by internal analytics
        // Note: Does NOT replace macros before firing. If desired, use firePixels instead
        // Reason: performance. firePixel is used by all Sled Analytics calls, which do not need macro checking
        exports.firePixel = function (url) {

          var img = new Image();
          img.src = url;
        };


        // fire an artibrary # of pixels, don't bother listening for a response; used by external pixels
        exports.firePixels = function (urls) {

          urls = [].concat(urls);
          for (var i = 0, l = urls.length; i < l; i++) {
            Utils.replaceMacros(urls[i], urls[i], fire);
          }
          function fire (err, result) {

            if (err) {
              return;
            }

            console.log(result);
            if (settings.fireExternalPixels) {
              exports.firePixel(result);
            }
          }
        };

        return exports;
      };
    })(typeof exports === 'undefined'? this.Network = {} : exports);


    // Handles tracking analytics information and firing Sled and external pixels

    (function (exports) {

      exports.init = function (Network, Sled, Utils, settings, state) {

        var win = window.top;
        var timer = Date.now(); // general timer for analytics
        var pageTimer = (window.performance && window.performance.timing) ? window.performance.timing.domInteractive : settings.t || Date.now();
              // timestamp of when the page started being usable - ideally using domInteractive, falling back to when the tag was called
              // timing definition here: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceTiming
        var timeStore = 0; // for saving previous time value when ad leaves then re-enters screen
        var pageTimeStore = 0;
        var isOnScreen = false; // if the ad is currently on-screen (to trigger events on status change)
        var seen = false; // tracks if the user has seen the ad for the first time
        var firedNotReady = false;
        var sequence = 1; // sequence # for all analytics events - starts at 1 b/c pageLoaded already fired
        var floatCounter = 0; // how many floats have happened this session
        var swipeCounter = 0; // number of swipes so far this session
        var videoCounter = 0; // number of videos played so far this session
        var currentVideo = ''; // keeping track of the video element ID that's currently playing
        var videoElement = null; // currently playing video element
        var lastQuartile = -1; // the last quartile event that was fired, to help prevent duplicated events

        // heartbeat / intervals

        var HEARTBEAT_TIMER = settings.beatSpeed || 1000; // time between heartbeats
        var viewHeartbeat = null; // timers
        var videoHeartbeat = null;
        var recentlyInteracted; // for keeping track of if the ad is considered 'active'
        var interactionTimeout = setTimeout(interactionTimeoutEvent, INTERACTION_TIMEOUT);
        var INTERACTION_TIMEOUT = 5 * HEARTBEAT_TIMER;


        function init () { // called at the end of init()
          exports.interaction(); // get the timers started - loading the page counts as an interaction
        }


        exports.generic = function (action, optional) {

          setTimeout(function() {
            // console log must be on a single line for gulp to wrap
            console.log('Analytics - ' + action, (optional && optional.description ? optional.description : ''), '@t=' + getTime() + ' @t50%=' + state.viewable50 + ' @moatT=' + state.moatViewableFunction() + ' @pgT=' + (Date.now() - pageTimer + pageTimeStore));
            Network.firePixel(settings.analyticsURL + '/track/' + action + generateParameters(optional));
          }, 0); // asynchronously fire analytics pixels
        };


        function generateParameters(optional) {

          var i, keys, queryString = '?';
          state.moatMaxT = Math.max(state.moatMaxT, state.moatViewableFunction());
          var params = {
              time: getTime(),
              time50: state.viewable50,
              time100: state.viewable100,
              timeMoat: state.moatMaxT,
              timeOnPage: (Date.now() - pageTimer + pageTimeStore),
              sequence: (sequence++),
              session: settings.session,
              user: settings.user,
              u_gif: settings.pseudoUser || null, // pseudocookie user id
              tagID: settings.tagID,
              campaign: settings.campaign,
              publisher: state.host,
              page: state.page,
              referrer: state.referrer,
              title: state.title,
              screenWidth: state.viewWidth,
              screenHeight: state.viewHeight,
              isPortrait: (state.viewWidth < state.viewHeight),
              language: state.language,
              loadSpeed: state.loadSpeed || '',
              initSpeed: state.initSpeed || '',
              scrollPosition: Utils.getScrollPosition(),
              engVer: settings.engVersion,
              tagCount: state.tagCount,
              gestures: state.gestures,
              placement: settings.placement,
              externalID: settings.extID
          };
          if (settings.experimentID != null && settings.experimentGroup != null) {
            params.experimentID = settings.experimentID;
            params.experimentGroup = settings.experimentGroup;
          }
          if (Sled.ad) {
            params.ad = Sled.ad.id;
            params.adVer = Sled.ad.version;
            params.timesAdSeen = state.timesAdSeen || 0;
            params.timesSledSeen = state.timesSledSeen || 0;
            if (Sled.ad.state) {
              params.percentSeen = Sled.ad.state.percentSeen;
            }
          }
          if (state.active) { // things that are unknown till the engine is running
            params.viewPct = state.percentInView;
            params.frameSpeed = ~~(state.frameT / state.frames);
            params.timeStopped = Sled.ad.state.timeStopped;
          }
          if (settings.isATest) { params.testing = true; } // only include if true

          // supplied optional params can overwrite earlier values
          if (optional) {
            for (i = 0, keys = Object.keys(optional); i < keys.length; i++) {
              params[keys[i]] = encodeURIComponent(optional[keys[i]]);
            }
          }

          for (i = 0, keys = Object.keys(params); i < keys.length; i++) {
            if (typeof params[keys[i]] !== 'undefined') { // don't bother passing undefined parameters
              queryString += keys[i] + '=' + params[keys[i]] + '&';
            }
          }
          return queryString.slice(0, -1);
        }


        exports.interaction = function () {
          if (!recentlyInteracted) {
            recentlyInteracted = true;
            startViewHeartbeat();
          }
          clearTimeout(interactionTimeout);
          interactionTimeout = setTimeout(interactionTimeoutEvent, INTERACTION_TIMEOUT);
        };


        function interactionTimeoutEvent() {
          recentlyInteracted = false;
        }


        exports.notReady = function () {
          if (firedNotReady) { return; }
          firedNotReady = true;
          exports.generic('notReady');
        };


        exports.error = function (err, optional) {

          optional = optional || {};
          optional.description = err.message;
          return exports.generic('ERR:' + encodeURIComponent(err.name), optional);
        };


        exports.onScreen = function () {

          if (!isOnScreen && state.active) {
            isOnScreen = true;

            if (!seen) { // this is the first impression - update cookie, fire external pixels, etc
              seen = true;
              exports.generic('impression');
              Utils.cookieWrite('sledImp' + Sled.ad.id, state.timesAdSeen+1);
              Utils.cookieWrite('sledImpTotal', state.timesSledSeen+1);

              if (Sled.plugins.onImpression) { Sled.plugins.onImpression({ad: Sled.ad.html, Analytics: Analytics}); }
              if (Sled.external.onImpression) { Sled.external.onImpression(); }
              if (settings.pixels.onImpression) { Network.firePixels(settings.pixels.onImpression); }
              if (settings.onImpression) { Network.firePixels(settings.onImpression); }
              if (settings.onPanelView && settings.onPanelView[0]) {
                Network.firePixels(settings.onPanelView[0]);
                if (!settings.alwaysFireOnSwipe) { settings.onPanelView[0] = 0; }
              }
            }
            timer = Date.now(); // reset view timer post-impression for backwards compatibility (ie that impression 'time' = time on page pre-impression)
            exports.generic('viewStart');
          }
        };


        exports.left = function(action) {
          interactionTimeoutEvent();
          exports.offScreen('defocused');
          exports.generic(action);
        };

        exports.returned = function(action) { // reset timers since they were away

          timer = Date.now();
          pageTimer = Date.now();
          exports.interaction();
          exports.onScreen();
          exports.generic(action);
        };


        exports.floating = function () {
          exports.generic('floating-' + (++floatCounter));
          return floatCounter;
        };


        exports.impression50 = function () {

          exports.generic('impression50');
          if (settings.onImpression50) { Network.firePixels(settings.onImpression50); }
          if (settings.pixels.onImpression50) { Network.firePixels(settings.pixels.onImpression50); }
          if (Sled.plugins.onImpression50) { Sled.plugins.onImpression50(); }

          exports.impression50 = null;
        };


        exports.impression100 = function () {

          exports.generic('impression100');
          if (Sled.plugins.onFullView) { Sled.plugins.onFullView({ad: Sled.ad.html, Analytics: Analytics}); }

          exports.impression100 = null;
        };


        exports.impressionMRC = function () {

          exports.generic('impressionMRC');
          if (Sled.plugins.onImpressionMRC) { Sled.plugins.onImpressionMRC(); }
          if (settings.onImpressionMRC) { Network.firePixels(settings.onImpressionMRC); }
          exports.impressionMRC = null;
        };


        exports.offScreen = function (reason) {

          if (isOnScreen) {
            isOnScreen = false;
            exports.generic('viewHeartbeat'); // final viewHeartbeat that's fired before resuming the one-per-five
            exports.generic('viewEnd', { description: reason });
            stop();
            timeStore += Math.min((Date.now() - timer), HEARTBEAT_TIMER);
            timer = Date.now();
          }
        };


        exports.viewProgress = function () {

          if (!recentlyInteracted) {
            stopViewHeartbeat();
          }

          var ptDiff = Math.min((Date.now() - pageTimer), HEARTBEAT_TIMER);
          pageTimeStore += ptDiff;
          pageTimer = Date.now();

          if (state.active && isOnScreen) {
            // rachet time in fixed increments, so that if they come back to the app after a day...
            timeStore += Math.min((Date.now() - timer), HEARTBEAT_TIMER);
            timer = Date.now();
            exports.generic('viewHeartbeat');
          } else if (settings.sledbeat && ~~(pageTimeStore/1000) % 5 === 0) {
            exports.generic('viewHeartbeat');
          }
        };


        exports.swipe = function (num) {

          swipeCounter += 1;
          if (settings.onSwipe && (swipeCounter === 1 || settings.alwaysFireOnSwipe)) {
            Network.firePixels(settings.onSwipe);
          }
          if (settings.onPanelView && settings.onPanelView[num-1]) {
            Network.firePixels(settings.onPanelView[num-1]);
            if (!settings.alwaysFireOnSwipe) {
              settings.onPanelView[num-1] = 0;
            }
          }
          exports.interaction();
          exports.generic('swipe-' + num, {
            counter: swipeCounter
          });
        };


        exports.click = function (id) {

          exports.interaction();
          exports.generic('tap-' + id, {
            clickX: ~~(Sled.engine.Gesture.relTouch[0]/Sled.ad.width*100),
            clickY: ~~(Sled.engine.Gesture.relTouch[1]/Sled.ad.height*100),
          });
        };


        // click that redirects the user's page via click trackers (pub -> sled -> target)
        // macroButton change order to sled -> pub -> target because (pub -> target) is combined
        exports.cta = function (id, target, macroButton, cb) {

          state.hasClicked = true;

          Utils.replaceMacros(target, 'cta', function (err, result) {

            if (err) { return cb(err); }

            if (settings.pixels && settings.pixels.onClick) {

              Utils.replaceMacros(settings.pixels.onClick, 'cta-pixel', function (err, pixel) {

                if (err) { exports.error(err); return; }

                Network.firePixels(pixel);
              });
            }

            var params = {
              clickX: ~~(Sled.engine.Gesture.relTouch[0] / Sled.ad.width * 100),
              clickY: ~~(Sled.engine.Gesture.relTouch[1] / Sled.ad.height * 100),
              target: result,
              cb: Math.floor(Math.random()*10e12)
            };

            target = settings.analyticsURL + '/redirect/click-' + id + generateParameters(params);
            if (settings.onClick && !macroButton) { // if onClick w/o macro, prepend onClick
              target = settings.onClick + encodeURIComponent(target);
            }

            cb(null, target);
          });
        };


        exports.video = function (action) {

          var videoTime = videoElement.currentTime;
          var percent = (!isNaN(videoElement.duration)) ? ~~(100*videoTime/videoElement.duration) : 0;
          exports.quartile(Math.floor(percent/25));
          exports.generic(action, {
            videoTime: Math.round(videoTime*1000), // in ms
            videoPct: percent,
            counter: videoCounter,
          });
        };


        exports.videoStart = function (id) {

          if (currentVideo !== id) {
            currentVideo = id;
            videoCounter += 1;
            videoElement = doc.getElementById(currentVideo).getElementsByClassName('sled_video')[0];
            exports.video('videoStart-' + currentVideo);
          }
          var analy = exports;
          setTimeout(function () { // fire the first one really quickly to increase analytics resolution
            analy.videoProgress();
          }, 1000);
          videoHeartbeat = setInterval(function () {
            analy.videoProgress();
          }, HEARTBEAT_TIMER);
        };


        exports.videoProgress = function () {

          exports.video('videoHeartbeat-' + currentVideo);
        };


        exports.videoEnd = function () {

          clearTimeout(videoHeartbeat);
          videoHeartbeat = null;
          exports.videoProgress();
          exports.video('videoEnd-' + currentVideo);
        };


        exports.quartile = function (quartile) {

          if (quartile === lastQuartile) { return; } // prevents duplicate quartile event echoes

          if (Sled.plugins.onVideoQuartile) { Sled.plugins.onVideoQuartile({ quartile: quartile }); }

          lastQuartile = quartile;
          exports.generic('videoQuartile-' + quartile);
          if (quartile === 0 && settings.pixels.start) {
            Network.firePixels(settings.pixels.start);
          } else if (quartile === 1 && settings.pixels.firstQuartile) {
            Network.firePixels(settings.pixels.firstQuartile);
          } else if (quartile === 2 && settings.pixels.midpoint) {
            Network.firePixels(settings.pixels.midpoint);
          } else if (quartile === 3 && settings.pixels.thirdQuartile) {
            Network.firePixels(settings.pixels.thirdQuartile);
          } else if (quartile === 4 && settings.pixels.complete) {
            Network.firePixels(settings.pixels.complete);
          }
        };


        exports.dismiss = function (reason) {

          if (isOnScreen) {
            exports.generic('impressionEnd', {
              viewPct: Sled.ad.state.percentSeen,
              description: reason
            });
            exports.offScreen(reason);
          }
        };


        exports.fatal = function (err) {

          exports.generic('fatal', { description: err.message });
          if (settings.pixels && settings.pixels.onInitializationFailure) { Network.firePixels(settings.pixels.onInitializationFailure); }
        };


        // for testing ONLY. Stops ALL timers, including sledbeat
        exports.destroy = function() {

          clearTimeout(interactionTimeoutEvent);
          stop();
          stopViewHeartbeat();
        };


        function stop() {

          if (videoHeartbeat) {
            exports.videoEnd();
          }
        }


        function getTime() {

          return (state.active) ? (Date.now() - timer + timeStore) : timeStore;
        }


        function startViewHeartbeat() {

          if (viewHeartbeat) { return; }

          timer = Date.now();
          pageTimer = Date.now();
          viewHeartbeat = setInterval(function () {
            exports.viewProgress();
          }, HEARTBEAT_TIMER);
        }


        function stopViewHeartbeat() {

          clearInterval(viewHeartbeat);
          viewHeartbeat = null;
        }


        init();

        return exports;
      };
    })(typeof exports === 'undefined'? this.Analytics = {} : exports);


    // Handles parsing VAST tags

    // VAST spec: http://www.iab.net/media/file/VASTv3.0.pdf
    // Sample / reference VAST XML files in /test

    (function (exports) {

      exports.init = function (Analytics, Network, Utils) {

        // input an XML file, return the first valid ad we find
        // optional args: nested (if the VAST being processed was nested inside another VAST)
        exports.process = function (xml, settings, ad, callback, args) {

          try {

            var temp = xml.getElementsByTagName('Ad');
            if (temp.length === 0) {
              throw new Utils.SledError('VastParserError', 'vastBlank' + ((args && args.nested) ? 'Nested' : ''));
            }

            var waterfall = [];
            for (var i = 0, l = temp.length; i < l; i++) { // coerce into array
              waterfall.push(temp[i]);
            }

            Utils.waterfall(waterfall, function (vast, callback) {
              load(vast, settings, ad, callback);
            }, 3000, callback);
          } catch (err) {
            failed(err, settings, callback);
          }
        };


        function load (vast, settings, ad, callback) {

          try {

            var wrapper = vast.getElementsByTagName('VASTAdTagURI')[0];

            if (wrapper) {
              if (!vast.getElementsByTagName('TrackingEvents')[0] ||
                  !vast.getElementsByTagName('Impression')[0]) {
                throw new Utils.SledError('VastParserError','vastWrapperMissingTracking');
              }
            } else {
              if (!vast.getElementsByTagName('TrackingEvents')[0] ||
                  !vast.getElementsByTagName('ClickThrough')[0] ||
                  !vast.getElementsByTagName('Impression')[0]) {
                if (vast.getElementsByTagName('InLine').length === 0) {
                  throw new Utils.SledError('VastParserError', 'vastBlank');
                } else {
                  throw new Utils.SledError('VastParserError', 'vastInlineMissingTracking');
                }
              }
            }

            // Primary tracking

            var i, l, key, val;
            var tracking = vast.getElementsByTagName('TrackingEvents')[0].childNodes;
            var clickTracking = vast.getElementsByTagName('ClickTracking');
            var impression = vast.getElementsByTagName('Impression');
            settings.pixels = settings.pixels || {};

            if (!wrapper) {
              settings.extCTA = nodeValue(vast.getElementsByTagName('ClickThrough')[0]);
              var creativeID = vast.getElementsByTagName('Creative')[0].id || nodeAttribute(vast.getElementsByTagName('Creative')[0], 'AdID') || undefined;
              var adID = vast.id || undefined;

              // demand-source specific ID parsing
              switch (ad.id) {
                case 18: case 19: case 20: case 21:
                  creativeID = nodeAttribute(vast.getElementsByTagName('Creative')[0], 'AdID') || undefined;
                  adID = adID.toString().split('.')[0];
                break;
              }

              settings.extID = adID + '-' + creativeID;

              if (!adID && !creativeID) {
                throw new Utils.SledError('VastParserError', 'vastNoID');
              }

              // Loops through potential mediafiles to find a suitable mp4

              var mediafiles = vast.getElementsByTagName('MediaFile');
              for (i = 0, l = mediafiles.length; i < l; i++) {
                val = nodeValue(mediafiles[i]);
                if (!val) { continue; }

                if (nodeAttribute(mediafiles[i], 'type').indexOf('mp4') !== -1 || val.indexOf('.mp4') !== -1) {
                  settings.extSRC = val;
                  break;
                }
              }
              if (!settings.extSRC) {
                throw new Utils.SledError('VastParserError', 'vastNoMp4Media');
              }

              var duration = nodeValue(vast.getElementsByTagName('Duration')[0]);
              if (duration) {
                duration = duration.split(':');
                settings.autoplayLength = (+duration[0]*60*60) + (+duration[1]*60) + (+duration[2]);
              }
            }

            for (i = 0, l = tracking.length; i < l; i++) {
              var node = tracking[i];
              if (node.nodeName === 'Tracking') {
                key = (node.attributes[0]) ? node.attributes[0].nodeValue : null;
                val = nodeValue(node);
                if (!key || !val) { continue; }

                if (key === 'creativeView') {
                  key = 'onImpression';
                }
                settings.pixels[key] = [].concat(settings.pixels[key] || []).concat(val);
              }
            }
            if (clickTracking) {
              for (i = 0, l = clickTracking.length; i < l; i++) {
                val = nodeValue(clickTracking[i]);
                if (val) { // only if not empty
                  settings.pixels.onClick = [].concat(settings.pixels.onClick || []).concat(val);
                }
              }
            }

            // Optional tracking

            var error = nodeValue(vast.getElementsByTagName('Error')[0]);
            if (error) {
              settings.pixels.onInitializationFailure = [].concat(settings.pixels.onInitializationFailure || []).concat(error);
            }

            var customTracking = vast.getElementsByTagName('CustomTracking')[0];
            if (customTracking) {
              customTracking = customTracking.childNodes;
              for (i = 0, l = customTracking.length; i < l; i++) {
                if (customTracking[i].nodeName === 'Tracking') {
                  key = customTracking[i].attributes[0].nodeValue;
                  val = nodeValue(customTracking[i]);
                  if (!key || !val) { continue; }

                  if (key === 'viewable_impression') {
                    key = 'twoSecondsPlayed';
                  } else {
                    continue;
                  }
                  var invalidCharactersToBeRemoved = /[\u8629]/g; // right arrow seen in occassional VAST tags
                  val = val.replace(invalidCharactersToBeRemoved, '').trim();
                  settings.pixels[key] = [].concat(settings.pixels[key] || []).concat(val);
                }
              }
            }

            settings.pixels.onImpression50 = [].concat(settings.pixels.onImpression50 || []);
            for (i = 0, l = impression.length; i < l; i++) {
              val = nodeValue(impression[i]);
              if (!val) { continue; }

              if (settings.vastFastImp) {
                Network.firePixel(val);
              } else {
                settings.pixels.onImpression50.push(val);
              }
            }

            // If wrapper, load wrapper tag; otherwise, report done

            if (wrapper) {
              console.log('Processing wrapper');
              var newUrl = wrapper.childNodes[0].wholeText.replace(/[\u8629]/g, '').trim();
              Utils.replaceMacros(newUrl, 'vastUrl', function (err, result) {

                if (err) { throw err; }

                Network.fetchData(result, function (err, text) {

                  if (err) { throw err; }

                  Utils.parseXml(text, function (err, result) {

                    if (err) { throw err; }

                    exports.process(result, settings, ad, callback, { nested: true });
                  });
                });
              });
            } else {
              Analytics.generic('vastLoaded');
              callback(null, settings);
            }
          } catch (err) {
            failed(err, settings, callback);
          }
        }


        function nodeAttribute (node, attribute) {

          if (!node || !node.attributes[attribute]) {
            return null;
          }

          return node.attributes[attribute].nodeValue;
        }


        function nodeValue (node) {

          if (!node || !node.firstChild) {
            return null;
          }

          return node.firstChild.nodeValue;
        }


        function failed (err, settings, callback) {

          settings.pixels = {};
          err.name = 'VastParserError';
          callback(err);
        }

        return exports;
      };
    })(typeof exports === 'undefined'? this.Vast = {} : exports);


    // This library is in charge of selecting which ad to show, and loading it

    // Waterfall object = Sled.settings.ads, defined in adserver/tag

    (function (exports) {

      var WATERFALL_TIMEOUT = 12000; // ms before waterfall auto advances to next ad

      // This module is currently non-stateless - we have to track all of this across a bunch of async calls
      var win = window.top;
      var doc = win.document;
      var settings;
      var autoplayLoading = false;

      exports.init = function (Network, Utils, Vast) {

        // takes in a waterfall, returns the ad object when it's loaded into DOM
        // will continue to waterfall until ad loaded successfully, or end of waterfall
        // this is just the public initializer - the real work is done in nextWaterfall
        exports.waterfall = function (waterfall, inSettings, callback) {

          settings = inSettings;
          Utils.waterfall(waterfall, load, WATERFALL_TIMEOUT, callback);
        };


        exports.abVersion = function (versions) {

          if (typeof versions === 'object') {
            var rand = Math.random();
            var check = 0;
            for (var v in versions) {
              if (versions.hasOwnProperty(v)) {
                check += versions[v];
                if (rand <= check) {
                  return v;
                }
              }
            }
            return 1;
          }
          return versions;
        };


        // takes in an ad object, returns an ad object when it has been loaded into the DOM
        function load (ad, callback) {

          // Setup

          if (Sled.ad && Sled.ad.wrapper) { Sled.ad.wrapper.remove(); console.log('Removed old wrapper'); }
          if (Sled.plugins && Sled.plugins.unload) { Sled.plugins.unload(); }
          Sled.plugins = {}; // clear plugins before each ad
          settings.extAssetURL = null;
          Sled.ad = ad;

          // Initialize the ad

          ad.version = exports.abVersion(ad.version);
          buildAssetUrls();
          autoplayLoading = false;

          // Load the ad

          Utils.async([
            loadVast,
            loadAdJs,
            buildAssetUrls,
            [ loadCss, loadHtml, loadAutoplay ], // calling loadAutoplay twice to load asap - sometimes we don't know if there's autoplay until we've inserted the HTML
            insertAd,
            loadAutoplay,
            initializeAd
          ], function (err, result) {

            if (err) {
              err.name = 'WaterfallError';
              return callback(err);
            }

            Sled.adJSLoaded = null;
            Sled.adJSFailed = null;

            callback(null, Sled.ad);
          });
        }


        function loadAdJs (callback) {

          Sled.adJSLoaded = function () {
            callback(null, Sled.ad);
            Sled.adJSFailed = function() { }; // prevent multiple callbacks if onload gets fired multiple times`
            Sled.adJSLoaded = function() { };
          };
          Sled.adJSFailed = function () {
            callback(new Utils.SledError('LoadError', 'adJsReportsFailure'));
            Sled.adJSFailed = function() { };
            Sled.adJSLoaded = function() { };
          };

          var js = doc.createElement('script');
          js.type = 'text/javascript';
          js.id = 'sledJS';
          js.onload = function() { adJsOnload(); };
          js.onerror = function onAdJsError() { callback(new Utils.SledError('LoadError', 'failedToLoadJs')); };
          js.src = 'ad/ad.js' + ((settings.isATest) ? ('?cb=' + ~~(Math.random()*1e8)) : '');
          doc.head.appendChild(js);

          function adJsOnload (err) { // this breaks from the normal callback pattern due to backwards compatibility
            if (Sled.plugins.load) {
              Sled.plugins.load({ Network: Network, Analytics: Sled.Analytics, adSettings: Sled.ad });
            } else {
              console.log('Ad.JS lacks .load plugin, assuming valid');
              Sled.adJSLoaded();
            }
          }
        }


        function loadVast (callback) {

          if (Sled.ad.format === 'vast') {

            if (!(Sled.ad.extData || Sled.ad.vast)) { return callback(new Utils.SledError('LoadError', 'vastNotDefined')); }

            Utils.replaceMacros(Sled.ad.extData || Sled.ad.vast, 'vastUrl', function (err, result) {

              if (err) { return callback(err); }

              Sled.Analytics.generic('vastRequested');

              Network.fetchData(result, function (err, text) {

                if (err) { return callback(err); }

                Utils.parseXml(text, function (err, result) {

                  if (err) { return callback(err); }

                  // if we're debugging & it's not a blank VAST, send to video server for analysis
                  if (settings.debug && result.getElementsByTagName('Ad').length > 0) {
                    Network.post(settings.videoServer + '/xml/' + settings.campaign + '/' + Sled.ad.id, text);
                  }

                  Vast.process(result, settings, Sled.ad, callback);
                });
              });
            });
          } else {
            callback(); // if it's not a VAST ad, just skip this
          }
        }


        function loadCss (callback) {

          var css = doc.createElement('link');
          css.rel = 'stylesheet';
          css.id = 'sledCSS';
          css.onload = cssLoaded;
          css.onerror = function onCssError() {
            callback(new Utils.SledError('LoadError', 'failedToLoadCss'));
          };
          css.href = Sled.ad.assetURL + 'ad.css' + ((settings.isATest) ? ('?callback=' + ~~(Math.random()*1e8)) : '');
          doc.head.appendChild(css);

          if (settings.androidStock) { // stock android doesn't fire css loaded event accurately; fire 'loaded' with a little delay
            setTimeout(cssLoaded, 200);
          }

          function cssLoaded () {
            callback();
          }
        }


        function loadHtml (callback) {

          Sled.ad.wrapper = doc.getElementById('sled_ad_wrapper');

          if (Sled.ad.wrapper) { // if ad.js already inserted the ad
            callback();
          } else {
            // insert ad HTML and make any adjustments that don't require us to know the ad size yet
            Network.fetchData(Sled.ad.assetURL + 'ad.html' + ((settings.isATest) ? ('?callback=' + ~~(Math.random()*1e8)) : ''), function (err, result) {

              if (err) { return callback(new Utils.SledError('LoadError', 'failedToLoadHtml')); }

              Sled.ad.html = result;
              callback();
            });
          }
        }


        function loadAutoplay (callback) {

          if (!autoplayLoading && (Sled.ad.format === 'vast' || doc.getElementById('sled_autoplay'))) {
            autoplayLoading = true;

            Utils.async([ // We have to wait for both poster and first frames to load
              [ function (callback) {
                  Network.fetchImage(settings.extAssetURL + 'autoplay0.jpg', callback, function () { callback(new Utils.SledError('LoadError', 'failedToLoadPoster')); });
                }, function (callback) {
                  Network.fetchImage(settings.extAssetURL + 'autoplay1.jpg', callback, function () { callback(new Utils.SledError('LoadError', 'failedToLoadFrame1')); });
                } ],
              startLoadingAudio
            ], framesLoaded);
          } else {
            callback();
          }


          function framesLoaded (err, result) {

            if (err) {
              if (Sled.ad.format === 'vast') { // fire transcode request if it's VAST
                Network.firePixel(settings.videoServer + '/transcode?' +
                    'id=' + settings.extID +
                    '&server=' + settings.server +
                    '&url=' + encodeURIComponent(settings.extSRC));
                Sled.Analytics.generic('transcodeRequest-' + settings.extID);
              }
              return callback(new Utils.SledError('LoadError', 'vastTranscoding'));
            }
            callback();
          }


          function startLoadingAudio (callback) { // start buffering the audio - but don't wait on it

            callback();

            if (Sled.ad && !Sled.ad.autoplayPreview) { // check for Sled.ad in case we abort mid load
              // web audio polyfill
              var ContextClass = (win.AudioContext || win.webkitAudioContext || win.mozAudioContext || win.oAudioContext || win.msAudioContext);
              Sled.ad.audioContext = (ContextClass) ? (new ContextClass()) : null;

              if (Sled.ad.audioContext) { // only init audio if Web Audio API is available

                var req = new XMLHttpRequest();
                req.open('GET', settings.extAssetURL + 'autoplay.mp3', true);
                req.responseType = 'arraybuffer';
                req.onload = function () {

                  if (Sled.ad == null || Sled.ad.audioContext == null) {
                    console.log('Failed to find Sled ad or audio context, sound disabled');
                    return;
                  }

                  Sled.ad.audioContext.decodeAudioData(req.response, function (data) {

                    Sled.ad.audioBuffer = data;
                    var audioButton = doc.getElementById('sled_autoplay_sound');
                    if (audioButton) {
                      audioButton.style.display = 'block';
                    }
                  }, console.log);
                };
                req.send();
              }
            }
          }
        }


        function insertAd (callback) {

          var ad = Sled.ad;

          if (Sled.plugins.onBeforeLoad) { Sled.plugins.onBeforeLoad({ad: ad, Network: Network, Analytics: Analytics}); }

          if (ad.wrapper) {
            callback();
          } else {

            // Pre insertion: Double Verify Wrapper

            var fragment = doc.createDocumentFragment();
            ad.wrapper = doc.createElement('div');
            ad.wrapper.id = 'sled_ad_wrapper';
            ad.wrapper.innerHTML = ad.html;
            fragment.appendChild(ad.wrapper);

            // Pre-insertion: Double Verify

            var dvid = Sled.Utils.random + ad.id;
            if (settings.doubleVerify) {
              var adHtml = fragment.getElementById('sled_ad').innerHTML;
              var dvSledWrap = "<span class='sled_doubleVerify_wrapper' id='" + dvid + "' adunit='1'>" + adHtml + "</span>";
              fragment.getElementById('sled_ad').innerHTML = dvSledWrap;

              var dvjs = doc.createElement('script');
              dvjs.id = 'sled_doubleVerify_tag';
              // https://cdn.doubleverify.com/dvtp_src.js?ctx=2397394&cmp=8986369&sid=1688159&plc=121513734&num=&adid=&advid=2397395&adsrv=1&region=30&btreg=&btadsrv=&crt=&crtname=&chnl=&unit=&pid=&uid=&tagtype=&dvtagver=6.1.src
              dvjs.src = 'https://cdn.doubleverify.com/dvtp_src.js?ctx=2397394&cmp=8986369&sid=1688159&plc=121513734&num=&adid=&advid=2397395&adsrv=1&region=30&btreg=' +
                  dvid +
                  '&btadsrv=&crt=&crtname=&chnl=&unit=&pid=&uid=&tagtype=&dvtagver=6.1.src';
              fragment.appendChild(dvjs);
            }

            // Pre-insertion: MOAT

            if (settings.moat) {

              if (!settings.metadata || !settings.metadata.advertiser) {
                Analytics.error({
                  name: 'MetadataError',
                  message:'moatMissingMetadata'
                });
              } else {
                window.SledMoatListener = function (e) {
                  console.log("MOAT event triggered, timing function received");
                  state.moatViewableFunction = e.getInViewTime;
                };
                var moatjs = doc.createElement('script'), moatsrc = '';
                moatjs.id = 'sled_moat_tag';

                // http://js.moatads.com/sledmobile193334213423/moatad.js#moatClientLevel1=_ADVERTISER_&moatClientLevel2=_CAMPAIGN_&moatClientLevel3=_LINEITEM_&moatClientLevel4=_CREATIVE_&moatClientSlicer1=_SITE_&moatClientSlicer2=_PLACEMENT_
                moatsrc = 'http://js.moatads.com/sledmobile193334213423/moatad.js' +
                    '#moatClientLevel1=' + encodeURIComponent(settings.metadata.advertiser) + // _ADVERTISER_
                    '&moatClientLevel2=' + encodeURIComponent(settings.campaign) + //_CAMPAIGN_
                    '&moatClientLevel3=' + encodeURIComponent(ad.version) + // _CREATIVE_
                    '&moatClientLevel4=' + encodeURIComponent(settings.tagID) + // _TAGID_
                    '&moatClientSlicer1=' + encodeURIComponent(state.host); // _SITE_
                if (settings.placement) { moatsrc += '&moatClientSlicer2=' + encodeURIComponent(settings.placement); } //_PLACEMENT_
                moatjs.src = moatsrc;
                doc.head.appendChild(moatjs);
              }
            }

            // Insertion

            if (settings.embedElement) {
              ad.wrapper.classList.add('sled_no_scroll');
              settings.embedElement.appendChild(fragment);
              settings.minPosition = settings.embedElement.offsetTop - 200; // get started a bit early
            } else {
              doc.body.appendChild(fragment);
            }

            callback();
          }
        }


        function initializeAd (callback) {

          if (!Sled.ad.html) {
            return callback(new Utils.SledError('LoadError', 'failedToInsertAd'));
          }

          Sled.ad.html = doc.getElementById('sled_ad');
          Sled.ad.style = Sled.ad.html.style;
          Sled.ad.width = Sled.ad.html.clientWidth;
          // Sled.ad.height has to wait for images to load

          callback();
        }


        function buildAssetUrls (callback) {

          var url = settings.sledURL + '/';
          switch (Sled.ad.format) { // extra code for special formats
            case 'vast':
              url += 'vast';
              if (settings.server === 'localhost') {
                settings.videoServer = 'http://localhost:8001';
                settings.extAssetURL = settings.sledURL;
              } else if (settings.server === 'qa') {
                settings.videoServer = 'http://betavideo.sledmobile.com';
                settings.extAssetURL = 'http://qa.sledmobile.com';
              } else {
                settings.videoServer = 'http://video.a47b.com';
                settings.extAssetURL = 'http://a47b.com';
              }
              settings.extAssetURL += '/vast/' + settings.extID + '/' + settings.qualityLevel + '/';
            break;
            default:
              url += settings.assetURL || Sled.ad.id;
            break;
          }
          settings.extAssetURL = settings.extAssetURL || (settings.sledURL + '/' + (settings.assetURL || Sled.ad.id) + '/' + settings.qualityLevel + '/' + Sled.ad.version + '/');
          url += '/' + settings.qualityLevel + '/' + Sled.ad.version + '/';
          Sled.ad.assetURL = url;

          Sled.ad.assetURL = 'ad/';

          if (callback) { callback(null, url); }
        }

        return exports;
      };
    })(typeof exports === 'undefined'? this.Loader = {} : exports);


    var Network = Sled.Network = this.Network.init(Utils);
    var Analytics = Sled.Analytics = this.Analytics.init(Network, Sled, Utils, settings, state);
    var Vast = this.Vast.init(Analytics, Network, Utils);
    var Loader = this.Loader.init(Network, Utils, Vast);
    console.log("Loading Sled v" + Sled.settings.engVersion);

    // Analytics report

    state.initSpeed = (Date.now() - settings.t);
    console.log('Sled.js loaded in: ' + state.initSpeed + 'ms');
    Analytics.generic('pageLoaded'); // let Analytics know the tag has loaded
    // fire any errors that occured before Analytics was defined
    for (var i = 0, l = errors.length; i < l; i++) {
      Analytics.error(errors[i]);
    }

    if (!Utils.cookieRead('sledUserID')) { // user is passed from server - make sure stored on client for future reference
      Utils.cookieWrite('sledUserID', settings.user);
    }

    // pseudocookie user tracking

    var adserver = 'http://tags.a47b.com';
    if (settings.server === 'qa') {
      adserver = 'http://beta.tags.sledmobile.com';
    }
    else if (settings.server === 'localhost') {
      adserver = 'http://localhost:8888';
    }
    Network.fetchData(adserver + '/u.gif', function(err, result) {
      result = JSON.parse(result);
      settings.pseudoUser = result.u;
    });

    // 3rd party cookie user tracking

    var iframe = document.createElement("IFRAME");
    iframe.src = "http://a47b.com/u3.html?user=" + settings.user + '&isATest=' + settings.isATest + '&analyticsURL=' + encodeURIComponent(settings.analyticsURL);
    iframe.style.width = "0px";
    iframe.style.height = "0px";
    doc.body.appendChild(iframe);

    // Check useragents & kill if we shouldn't be serving

    settings.android = (/android/i.test(navigator.userAgent));
    var rxaosp = navigator.userAgent.match(/Android.*AppleWebKit\/([\d.]+)/); // http://stackoverflow.com/questions/14403766/how-to-detect-the-stock-android-browser
    var chromeVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    settings.androidStock = settings.android && ((rxaosp && rxaosp[1]<537) || (chromeVersion && +chromeVersion[1].slice(0,4) < 34));
    settings.ios = (/iphone|ipad|ipod/i.test(navigator.userAgent));
    // settings.iosChrome = (/(crios)/i.test(navigator.userAgent));
    settings.ios7 = (/(iPad|iPhone|iPod touch);.*CPU.*OS 7_\d/i.test(navigator.userAgent));
    settings.mobile = settings.android || settings.ios; // unsupported systems: webOS|BlackBerry|IEMobile|Opera Mini
    if (!settings.allDevices) {
      if (!settings.mobile) {
        throw new Utils.SledError('EnforcerError', 'browser'); // unknown browse that's not android or iOS
      }
      if (settings.androidStock) {
        throw new Utils.SledError('EnforcerError', 'browserAndroidStock'); // don't load on Android stock browser, though we can't always catch it
      }
      if (!settings.isATest && win.innerWidth > 767) {
        throw new Utils.SledError('EnforcerError', 'screenTooBig'); // Tablet - currently unsupported
      }
      if (!settings.isATest && win.innerHeight < win.innerWidth) {
        throw new Utils.SledError('EnforcerError', 'isLandscape'); // Landscape orientation - currently unsupported
      }
    }

    // Check if globally rate limited

    if (settings.rateLimit) {
      var timestamp = Utils.cookieRead('sledViewTimestamp');
      settings.timesSledSeenSinceLimited = Utils.cookieRead('sledImpTotal');
      if (!timestamp) {
        timestamp = Date.now();
        Utils.cookieWrite('sledViewTimestamp', timestamp);
      } else if (Date.now() - timestamp > (1000*60*60*24)) { // if it's been over a day, reset counter
        settings.timesSledSeenSinceLimited = 0;
        Utils.cookieWrite('sledImpTotal', settings.timesSledSeenSinceLimited);
        Utils.cookieWrite('sledViewTimestamp', Date.now());
      }
      if (settings.timesSledSeenSinceLimited >= settings.rateLimit) { // over rate limit - don't show
        throw new Utils.SledError('EnforcerError', 'rateLimited');
      }
    }

    // fire publisher pixel once we've ruled out situations we won't serve

    if (settings.onPageLoad) { Network.firePixels(settings.onPageLoad); }

    // Let's get loading!

    if (state.loadSpeed < 500) {
      settings.qualityLevel = 'high';
    } else if (state.loadSpeed < 800) {
      settings.qualityLevel = 'med';
    } else {
      settings.qualityLevel = 'low';
    }

    Utils.async([
      [loadEngine, loadWaterfall]
    ], function (err, result) {
      if (err) {
        err.name = 'LoadError';
        return die(err);
      }
      initEngine();
    });

    // Monitor the page & gestures

    win.addEventListener('blur', Utils.windowBlur);
    win.addEventListener('focus', Utils.windowFocus);
    win.addEventListener('touchstart', function() {
      state.focused = true; // any time there's a gesture registered, we know the tab is in focus
      state.gestures++;
      Analytics.interaction(); // let analytics know there was an interaction
    });

    // Hide element we're executed from, if needed

    if (settings.hideElement && doc.querySelector(settings.hideElement)) {
      doc.querySelector(settings.hideElement).style.display = 'none';
    }
  } catch (err) {
    die(err);
  }


  function die (err) {
    Analytics.fatal(err);
    win.removeEventListener('blur', Utils.windowBlur);
    win.removeEventListener('focus', Utils.windowFocus);
    delete window.Sled;
  }


  /* ===== THAR BE LOADING HERE ===== */

  function loadWaterfall(cb) {

    Loader.waterfall(settings.ads, settings, function (err, result) {

      if (err) { return cb(err); }

      Sled.ad = result;
      state.timesAdSeen = +Utils.cookieRead('sledImp'+Sled.ad.id) || 0;
      state.timesSledSeen = +Utils.cookieRead('sledImpTotal') || 0;

      // Clean up memory for garbage collection
      Loader = settings.ad = settings.ads = null;

      cb();
    });
  }


  function loadEngine(cb) {

    var js = doc.createElement('script');
    js.src = 'js/engine.js';
    js.id = 'sledScriptTag';
    js.onload = engineLoaded;
    js.onreadystatechange = function () {
      if (this.readyState === 'loaded' || this.readyState === 'complete') {
        engineLoaded();
      }
    };
    js.onerror = function () {
      cb(new Utils.SledError('LoadError', 'failedToLoadEngine'));
    };
    doc.head.appendChild(js);


    function engineLoaded() {

      state.loadSpeed = Date.now() - timer;
      cb();
    }
  }


  function initEngine() {

    Sled.engine = new Sled.EngineLoader(Sled, Analytics, Network, Utils, settings);
    Sled.EngineLoader = null;
  }
}
