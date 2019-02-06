'use strict';

var inherits = require('util').inherits;
var VPAID = require('./VPAID');
var LiePromise = require('lie');
var EVENTS = require('../enums/VPAID_EVENTS');
var isDesktop = require('../environment').isDesktop;
var VPAIDVersion = require('../VPAIDVersion');
var ButtonPic = require('./resources/ButtonPic');

function JavaScriptVPAID() {
    VPAID.apply(this, arguments); // call super()

    this.frame = null;
    this.videoSlot = null;
    this.unmuteVolume = null;
    this.unmuteButton = null;
}
inherits(JavaScriptVPAID, VPAID);

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

JavaScriptVPAID.prototype.load = function load(mediaFiles, parameters) {
    var self = this;
    var uri = mediaFiles[0].uri;
    var bitrate = mediaFiles[0].bitrate;

    return new LiePromise(function loadCreative(resolve, reject) {
        var iframe = document.createElement('iframe');
        var script = document.createElement('script');
        var video = document.createElement('video');
        var unmuteButton = document.createElement('button');

        function cleanup(reason) {
            self.container.removeChild(iframe);
            self.frame = null;
            self.api = null;

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
        var btnPic = new ButtonPic('unmute').svg;
        btnPic.style.margin = '4px';
        unmuteButton.appendChild(btnPic);

        unmuteButton.addEventListener('click', function unmute() {
            self.unmute();
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

module.exports = JavaScriptVPAID;
