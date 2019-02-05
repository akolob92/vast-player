'use strict';

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var LiePromise = require('lie');
var canPlay = require('../environment').canPlay;
var sortBy = require('sort-by');
var VPAID_EVENTS = require('../enums/VPAID_EVENTS');
var HTML_MEDIA_EVENTS = require('../enums/HTML_MEDIA_EVENTS');
var HTMLVideoTracker = require('../HTMLVideoTracker');
var EventProxy = require('../EventProxy');
var ButtonPic = require('./resources/ButtonPic');

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

function method(implementation, promiseify) {
    function getError() {
        return new Error('The <video> has not been loaded.');
    }

    return function callImplementation(/*...args*/) {
        if (!this.video) {
            if (promiseify) { return LiePromise.reject(getError()); } else { throw getError(); }
        }

        return implementation.apply(this, arguments);
    };
}

function pickMediaFile(mediaFiles, dimensions) {
    var width = dimensions.width;
    var items = mediaFiles.map(function(mediaFile) {
        return {
            mediaFile: mediaFile,
            playability: canPlay(mediaFile.type)
        };
    }).filter(function(config) {
        return config.playability > 0;
    }).sort(sortBy('-playability', '-mediaFile.bitrate'));
    var distances = items.map(function(item) {
        return Math.abs(width - item.mediaFile.width);
    });
    var item = items[distances.indexOf(Math.min.apply(Math, distances))];

    return (!item || item.playability < 1) ? null : item.mediaFile;
}

function HTMLVideo(container) {
    this.container = container;
    this.video = null;
    this.unmuteButton = null;

    this.__private__ = {
        hasPlayed: false
    };
}
inherits(HTMLVideo, EventEmitter);
Object.defineProperties(HTMLVideo.prototype, {
    adRemainingTime: { get: method(function getAdRemainingTime() {
        return this.video.duration - this.video.currentTime;
    }) },
    adDuration: { get: method(function getAdDuration() { return this.video.duration; }) },
    adVolume: {
        get: method(function getAdVolume() { return this.video.volume; }),
        set: method(function setAdVolume(volume) { this.video.volume = volume; })
    }
});

HTMLVideo.prototype.load = function load(mediaFiles) {
    var self = this;

    return new LiePromise(function loadCreative(resolve, reject) {
        var video = document.createElement('video');
        var unmuteButton = document.createElement('button');
        var mediaFile = pickMediaFile(mediaFiles, self.container.getBoundingClientRect());

        if (!mediaFile) {
            return reject(new Error('There are no playable <MediaFile>s.'));
        }

        video.setAttribute('webkit-playsinline', 'true');
        video.src = mediaFile.uri;
        video.preload = 'auto';

        video.style.display = 'block';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';

        unmuteButton.style.visibility = 'hidden';
        unmuteButton.style.position = 'absolute';
        unmuteButton.style.backgroundColor = '#FFF';
        unmuteButton.style.border = '0';
        unmuteButton.style.borderRadius = '4px';
        unmuteButton.style.padding = '0px';
        unmuteButton.style.width = '22px';
        unmuteButton.style.height = '22px';
        unmuteButton.style.bottom = '2px';
        unmuteButton.style.left = '2px';
        var btnPic = new ButtonPic('unmute').svg;
        btnPic.style.margin = '4px';
        unmuteButton.appendChild(btnPic);

        unmuteButton.addEventListener('click', function unmute() {
            self.unmute();
        });

        once(video, HTML_MEDIA_EVENTS.LOADEDMETADATA, function onloadedmetadata() {
            var tracker = new HTMLVideoTracker(video);
            var proxy = new EventProxy(VPAID_EVENTS);

            proxy.from(tracker).to(self);

            self.video = video;
            self.unmuteButton = unmuteButton;
            resolve(self);

            self.emit(VPAID_EVENTS.AdLoaded);

            on(video, HTML_MEDIA_EVENTS.DURATIONCHANGE, function ondurationchange() {
                self.emit(VPAID_EVENTS.AdDurationChange);
            });
            on(video, HTML_MEDIA_EVENTS.VOLUMECHANGE, function onvolumechange() {
                self.emit(VPAID_EVENTS.AdVolumeChange);
            });
        });

        once(video, HTML_MEDIA_EVENTS.ERROR, function onerror() {
            var error = video.error;

            self.emit(VPAID_EVENTS.AdError, error.message);
            reject(error);
        });

        once(video, HTML_MEDIA_EVENTS.PLAYING, function onplaying() {
            self.__private__.hasPlayed = true;
            self.emit(VPAID_EVENTS.AdImpression);
        });

        once(video, HTML_MEDIA_EVENTS.ENDED, function onended() {
            self.stopAd();
        });

        on(video, 'click', function onclick() {
            self.emit(VPAID_EVENTS.AdClickThru, null, null, true);
        });

        self.container.appendChild(video);
    });
};

var switchMute = function(self, mode) {
    self.video.muted = mode;
    if (mode) {
        self.container.appendChild(self.unmuteButton);
    } else {
        self.container.removeChild(self.unmuteButton);
    }
    self.emit(VPAID_EVENTS.AdVolumeChange);
    return LiePromise.resolve(this);
};

HTMLVideo.prototype.mute = method(function mute() {
    return switchMute(this, true);
}, true);

HTMLVideo.prototype.unmute = method(function unmute() {
    return switchMute(this, false);
}, true);

HTMLVideo.prototype.startAd = method(function startAd() {
    var self = this;
    var video = this.video;

    if (this.__private__.hasPlayed) {
        return LiePromise.reject(new Error('The ad has already been started.'));
    }

    var promise = video.play();
    if (promise !== undefined) {
        promise.then(function () {
            self.emit(VPAID_EVENTS.AdStarted);
        }).catch(function () {
            self.emit(VPAID_EVENTS.AdPaused);
        });
    } else {
        promise = LiePromise.reject(new Error('HTML video not supported.'));
    }
    return promise;
}, true);

HTMLVideo.prototype.stopAd = method(function stopAd() {
    this.container.removeChild(this.video);
    this.emit(VPAID_EVENTS.AdStopped);

    return LiePromise.resolve(this);
}, true);

HTMLVideo.prototype.pauseAd = method(function pauseAd() {
    var self = this;
    var video = this.video;

    if (this.video.paused) {
        return LiePromise.resolve(this);
    }

    return new LiePromise(function callPause(resolve) {
        once(video, HTML_MEDIA_EVENTS.PAUSE, function onpause() {
            resolve(self);
            self.emit(VPAID_EVENTS.AdPaused);
        });

        return video.pause();
    });
}, true);

HTMLVideo.prototype.resumeAd = method(function resumeAd() {
    var self = this;
    var video = this.video;

    if (!this.__private__.hasPlayed) {
        return LiePromise.reject(new Error('The ad has not been started yet.'));
    }

    if (!this.video.paused) {
        return LiePromise.resolve(this);
    }

    return new LiePromise(function callPlay(resolve) {
        once(video, HTML_MEDIA_EVENTS.PLAY, function onplay() {
            resolve(self);
            self.emit(VPAID_EVENTS.AdPlaying);
        });

        return video.play();
    });
}, true);

module.exports = HTMLVideo;
