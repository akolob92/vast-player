'use strict';

var inherits = require('util').inherits;
var VPAID = require('./VPAID');
var LiePromise = require('lie');
var EVENTS = require('../enums/VPAID_EVENTS');
var isDesktop = require('../environment').isDesktop;
var VPAIDVersion = require('../VPAIDVersion');
var ButtonPic = require('./resources/ButtonPic');
var EventEmitter = require('events').EventEmitter;
var HTML_MEDIA_EVENTS = require('../enums/HTML_MEDIA_EVENTS');
var HTMLVideoTracker = require('../HTMLVideoTracker');
var EventProxy = require('../EventProxy');


function JavaScriptVPAID() {
    VPAID.apply(this, arguments); // call super()

    this.frame = null;
    this.videoSlot = null;
    this.unmuteVolume = null;
    this.unmuteButton = null;

    this.__private__ = {
        hasPlayed: false
    };
}
inherits(JavaScriptVPAID, VPAID);
inherits(JavaScriptVPAID, EventEmitter);

JavaScriptVPAID.prototype.mute = function() {
    var self = this;
    var unmuteButton = self.unmuteButton;
    if (unmuteButton) {
        unmuteButton.style.visibility = 'visible';
    }
    if (self.adVolume > 0) {
        self.unmuteVolume = self.adVolume;
    }
    if (self.videoSlot) {
        self.videoSlot.muted = true;
    }
};

JavaScriptVPAID.prototype.unmute = function() {
    var self = this;
    var unmuteButton = self.unmuteButton;
    if (unmuteButton) {
        unmuteButton.style.visibility = 'hidden';
    }
    if (self.unmuteVolume) {
        self.adVolume = self.unmuteVolume;
    }
    if (self.videoSlot) {
        self.videoSlot.muted = false;
    }

};

function on(video, event, handler) {
    return video.addEventListener(event, handler, false);
}

function off(video, event, handler) {
    return video.removeEventListener(event, handler, false);
}

function once(video, event, handler) {
    return on(video, event, function onevent() {
        off(video, event, onevent);
        return handler.apply(this, arguments);
    });
}

JavaScriptVPAID.prototype.load = function load(mediaFiles, parameters, options) {
    var self = this;
    var uri = mediaFiles[0].uri;
    var bitrate = mediaFiles[0].bitrate;
    options = options || {};

    return new LiePromise(function loadCreative(resolve, reject) {
        var iframe = document.createElement('iframe');
        var script = document.createElement('script');
        var video = document.createElement('video');
        var unmuteButton = document.createElement('button');

        function cleanup(reason) {
            self.container.removeChild(iframe);
            self.frame = null;
            self.api = null;

            if (typeof options.cleanCallback === 'function') {
                options.cleanCallback();
            }

            if (reason) {
                reject(reason);
            }
        }

        iframe.src = 'about:blank';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.display = 'block';
        iframe.style.opacity = '0';
        iframe.style.border = 'none';

        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.setAttribute('muted', 'true');

        video.style.display = 'block';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';

        unmuteButton.style.visibility = 'hidden';
        unmuteButton.style.position = 'absolute';
        unmuteButton.style.backgroundColor = '#FFF';
        unmuteButton.style.border = '0';
        unmuteButton.style.padding = '0px';
        unmuteButton.style.width = '22px';
        unmuteButton.style.height = '22px';
        unmuteButton.style.bottom = '2px';
        unmuteButton.style.left = '2px';
        var btnPic = new ButtonPic('mute').svg;
        btnPic.style.margin = '4px';
        unmuteButton.appendChild(btnPic);

        unmuteButton.addEventListener('click', function unmute() {
            self.unmute();
        });


        once(video, HTML_MEDIA_EVENTS.LOADEDMETADATA, function onloadedmetadata() {
            var tracker = new HTMLVideoTracker(video);
            var proxy = new EventProxy(EVENTS);

            proxy.from(tracker).to(self);

            self.videoSlot = video;
            self.video = video;
            self.unmuteButton = unmuteButton;
            resolve(self);

            self.emit(EVENTS.AdLoaded);

            on(video, HTML_MEDIA_EVENTS.DURATIONCHANGE, function ondurationchange() {
                self.emit(EVENTS.AdDurationChange);
            });
            on(video, HTML_MEDIA_EVENTS.VOLUMECHANGE, function onvolumechange() {
                self.emit(EVENTS.AdVolumeChange);
            });
        });

        once(video, HTML_MEDIA_EVENTS.ERROR, function onerror() {
            var error = video.error;

            self.emit(EVENTS.AdError, error.message);
            reject(error);
        });

        once(video, HTML_MEDIA_EVENTS.PLAYING, function onplaying() {
            self.__private__.hasPlayed = true;
            self.emit(EVENTS.AdImpression);
        });

        once(video, HTML_MEDIA_EVENTS.ENDED, function onended() {
            self.stopAd();
        });

        self.container.appendChild(iframe);
        // Opening the iframe document for writing causes it to inherit its parent's location
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.close();

        iframe.contentWindow.document.body.style.margin = '0';
        self.frame = iframe;

        script.src = uri;
        script.onload = function onload() {
            var vpaid = iframe.contentWindow.getVPAIDAd();
            var position = iframe.getBoundingClientRect();
            var slot = iframe.contentWindow.document.body;
            var version = self.vpaidVersion = new VPAIDVersion(vpaid.handshakeVersion('2.0'));

            function resizeAd() {
                var position = iframe.getBoundingClientRect();

                self.resizeAd(position.width, position.height, 'normal');
            }

            if (version.major > 2) {
                return reject(new Error('VPAID version ' + version + ' is not supported.'));
            }

            iframe.contentWindow.addEventListener('resize', resizeAd, false);

            EVENTS.forEach(function subscribe(event) {
                return vpaid.subscribe(function handle(/*...args*/) {
                    var args = new Array(arguments.length);
                    var length = arguments.length;
                    while (length--) { args[length] = arguments[length]; }

                    return self.emit.apply(self, [event].concat(args));
                }, event);
            });

            self.once(EVENTS.AdLoaded, function onAdLoaded() {
                iframe.style.opacity = '1';
                self.api = vpaid;
                resolve(self);
            });

            self.once(EVENTS.AdError, function onAdError(reason) {
                cleanup(new Error(reason));
            });

            self.once(EVENTS.AdStopped, cleanup);
            self.videoSlot = video;
            self.unmuteButton = unmuteButton;

            vpaid.initAd(
              position.width,
              position.height,
              'normal',
              bitrate,
              { AdParameters: parameters },
              { slot: slot, videoSlot: video, videoSlotCanAutoPlay: isDesktop }
            );
        };
        script.onerror = function onerror() {
            cleanup(new Error('Failed to load MediaFile [' + uri + '].'));
        };

        iframe.contentWindow.document.body.appendChild(video);
        iframe.contentWindow.document.body.appendChild(unmuteButton);
        iframe.contentWindow.document.head.appendChild(script);
    });
};

var switchMute = function(self, mode) {
    self.videoSlot.muted = mode;
    if (mode) {
        self.container.appendChild(self.unmuteButton);
    } else {
        self.container.removeChild(self.unmuteButton);
    }
    self.emit(EVENTS.AdVolumeChange);
    return LiePromise.resolve(this);
};

function method(implementation, promiseify) {
    function getError() {
        return new Error('The <video> has not been loaded.');
    }

    return function callImplementation(/*...args*/) {
        if (!this.videoSlot) {
            if (promiseify) { return LiePromise.reject(getError()); } else { throw getError(); }
        }

        return implementation.apply(this, arguments);
    };
}


JavaScriptVPAID.prototype.mute = method(function mute() {
    return switchMute(this, true);
}, true);

JavaScriptVPAID.prototype.unmute = method(function unmute() {
    return switchMute(this, false);
}, true);

JavaScriptVPAID.prototype.startAd = method(function startAd() {

    var self = this;
    var video = this.videoSlot;

    if (this.__private__.hasPlayed) {
        return LiePromise.reject(new Error('The ad has already been started.'));
    }

    var promise = video.play();

    if (promise !== undefined) {
        promise.then(function () {
            self.emit(EVENTS.AdStarted);
        }).catch(function () {
            self.emit(EVENTS.AdPaused);
        });
    } else {
        promise = LiePromise.reject(new Error('HTML video not supported.'));
    }
    return promise;

}, true);

JavaScriptVPAID.prototype.stopAd = method(function stopAd() {
    this.container.removeChild(this.videoSlot);
    this.emit(EVENTS.AdStopped);

    return LiePromise.resolve(this);
}, true);

JavaScriptVPAID.prototype.pauseAd = method(function pauseAd() {
    var self = this;
    var video = this.videoSlot;

    if (this.videoSlot.paused) {
        return LiePromise.resolve(this);
    }

    return new LiePromise(function callPause(resolve) {
        once(video, HTML_MEDIA_EVENTS.PAUSE, function onpause() {
            resolve(self);
            self.emit(EVENTS.AdPaused);
        });

        return video.pause();
    });
}, true);

JavaScriptVPAID.prototype.resumeAd = method(function resumeAd() {
    var self = this;
    var video = this.videoSlot;

    if (!this.__private__.hasPlayed) {
        return LiePromise.reject(new Error('The ad has not been started yet.'));
    }

    if (!this.videoSlot.paused) {
        return LiePromise.resolve(this);
    }

    return new LiePromise(function callPlay(resolve) {
        once(video, HTML_MEDIA_EVENTS.PLAY, function onplay() {
            resolve(self);
            self.emit(EVENTS.AdPlaying);
        });

        return video.play();
    });
}, true);


module.exports = JavaScriptVPAID;
