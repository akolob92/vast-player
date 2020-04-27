'use strict';

var EVENTS = require('./enums/VPAID_EVENTS');

function identity(value) {
  return value;
}

function fire(pixels, mapper) {
  (pixels || []).forEach(function(src) {
    new Image().src = mapper(src);
  });
}

function PixelReporter(pixels, mapper) {
  this.pixels = pixels.reduce(function(pixels, item) {
    if (item) {
      (pixels[item.event] || (pixels[item.event] = [])).push(item.uri);
    }

    return pixels;
  }, {});

  this.__private__ = {
    mapper: mapper || identity
  };
}

PixelReporter.prototype.track = function track(vpaid) {
  var pixels = this.pixels;
  var customMapper = this.__private__.mapper;
  var lastVolume = vpaid.adVolume;

  function fireType(type, mapper, predicate) {
    function pixelMapper(url) {
      return customMapper((mapper || identity)(url));
    }

    return function firePixels() {
      if (type === 'start' && typeof window.__bdOnVpaidAdStart === 'function') {
        try {
          window.__bdOnVpaidAdStart();
        } catch (err) {
          console.log('__bdOnVpaidAdStart error', err);
        }
      }

      if (typeof window.__bdOnVpaidEvent === 'function') {
        try {
          console.log('__bdOnVpaidEvent call');
          window.__bdOnVpaidEvent(type);

          if (type === 'AdStart' && typeof window.__bdOnVpaidAdStart === 'function') {
            window.__bdOnVpaidAdStart();
          }

        } catch (err) {
          console.log('__bdOnVpaidEvent error', err);
        }
      }

      if (!predicate || predicate()) {
        fire(pixels[type], pixelMapper);
      }
    };
  }

  ['on', 'once'].forEach(function (method) {
    if (typeof vpaid[method] !== 'function') {
      return;
    }

    try {
      vpaid[method](EVENTS.AdSkipped, fireType('skip'));
      vpaid[method](EVENTS.AdStarted, fireType('creativeView'));
      vpaid[method](EVENTS.AdStarted, fireType('progress'));
      vpaid[method](EVENTS.AdVolumeChange, fireType('unmute', null, function() {
        return lastVolume === 0 && vpaid.adVolume > 0;
      }));
      vpaid[method](EVENTS.AdVolumeChange, fireType('mute', null, function() {
        return lastVolume > 0 && vpaid.adVolume === 0;
      }));
      vpaid[method](EVENTS.AdImpression, fireType('impression'));
      vpaid[method](EVENTS.AdVideoStart, fireType('start'));
      vpaid[method](EVENTS.AdVideoFirstQuartile, fireType('firstQuartile'));
      vpaid[method](EVENTS.AdVideoMidpoint, fireType('midpoint'));
      vpaid[method](EVENTS.AdVideoThirdQuartile, fireType('thirdQuartile'));
      vpaid[method](EVENTS.AdVideoComplete, fireType('complete'));
      vpaid[method](EVENTS.AdClickThru, fireType('clickThrough'));
      vpaid[method](EVENTS.AdUserAcceptInvitation, fireType('acceptInvitationLinear'));
      vpaid[method](EVENTS.AdUserMinimize, fireType('collapse'));
      vpaid[method](EVENTS.AdUserClose, fireType('closeLinear'));
      vpaid[method](EVENTS.AdPaused, fireType('pause'));
      vpaid[method](EVENTS.AdPlaying, fireType('resume'));
      vpaid[method](EVENTS.AdError, fireType('error', function(pixel) {
        return pixel.replace(/\[ERRORCODE\]/g, 901);
      }));

      vpaid.on(EVENTS.AdVolumeChange, function updateLastVolume() {
        lastVolume = vpaid.adVolume;
      });
    } catch (err) {
      console.log('REPORTER_ERR', err);
    }
  });
};

module.exports = PixelReporter;
