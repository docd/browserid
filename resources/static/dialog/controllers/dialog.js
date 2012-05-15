/*jshint browser:true, jquery: true, forin: true, laxbreak:true, laxcomma:true */
/*global BrowserID: true, WinChan: true, URLParse: true */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


BrowserID.Modules.Dialog = (function() {
  "use strict";

  var bid = BrowserID,
      user = bid.User,
      errors = bid.Errors,
      dom = bid.DOM,
      win = window,
      startExternalDependencies = true,
      channel,
      sc;

  function startActions(onsuccess, onerror) {
    var actions = BrowserID.Modules.Actions.create();
    actions.start({
      onsuccess: onsuccess,
      onerror: onerror
    });
    return actions;
  }

  function startStateMachine(controller) {
    // start this directly because it should always be running.
    var machine = BrowserID.State.create();
    machine.start({
      controller: controller
    });
  }

  function startChannel() {
    var self = this,
        hash = win.location.hash;

    // first, we see if there is a local channel
    if (win.navigator.id && win.navigator.id.channel) {
      win.navigator.id.channel.registerController(self);
      return;
    }

    // next, we see if the caller intends to call native APIs
    if (hash == "#NATIVE" || hash == "#INTERNAL") {
      // don't do winchan, let it be.
      return;
    }

    try {
      channel = WinChan.onOpen(function(origin, args, cb) {
        // XXX this is called whenever the primary provisioning iframe gets
        // added.  If there are no args, then do not do self.get.
        if(args) {
          self.get(origin, args.params, function(r) {
            cb(r);
          }, function (e) {
            cb(null);
          });
        }
      });
    } catch (e) {
      self.renderError("error", {
        action: errors.relaySetup
      });
    }
  }

  function stopChannel() {
    channel && channel.detach();
  }

  function setOrigin(origin) {
    user.setOrigin(origin);
  }

  function onWindowUnload() {
    this.publish("window_unload");
  }

  function fixupURL(origin, url) {
    var u;
    if (typeof(url) !== "string")
      throw "urls must be strings: (" + url + ")";
    if (/^http(s)?:\/\//.test(url)) u = URLParse(url);
    else if (/^\//.test(url)) u = URLParse(origin + url);
    else throw "relative urls not allowed: (" + url + ")";
    // encodeURI limits our return value to [a-z0-9:/?%], excluding <script>
    return encodeURI(u.validate().normalize().toString());
  }

  function fixupAbsolutePath(origin_url, path) {
    if (/^\//.test(path))  return fixupURL(origin_url, path);

    throw "must be an absolute path: (" + path + ")";
  }

  var Dialog = bid.Modules.PageModule.extend({
    start: function(options) {
      var self=this;

      options = options || {};

      win = options.window || window;

      // startExternalDependencies is used in unit testing and can only be set
      // by the creator/starter of this module.  If startExternalDependencies
      // is set to false, the channel, state machine, and actions controller
      // are not started.  These dependencies can interfere with the ability to
      // unit test this module because they can throw exceptions and show error
      // messages.
      startExternalDependencies = true;
      if (typeof options.startExternalDependencies === "boolean") {
        startExternalDependencies = options.startExternalDependencies;
      }

      sc.start.call(self, options);

      if (startExternalDependencies) {
        startChannel.call(self);
      }

      options.ready && _.defer(options.ready);
    },

    stop: function() {
      stopChannel();
      sc.stop.call(this);
    },

    getVerifiedEmail: function(origin_url, success, error) {
      return this.get(origin_url, {}, success, error);
    },

    get: function(origin_url, paramsFromRP, success, error) {
      var self=this,
          hash = win.location.hash;

      setOrigin(origin_url);


      if (startExternalDependencies) {
        var actions = startActions.call(self, success, error);
        startStateMachine.call(self, actions);
      }

      // Security Note: paramsFromRP is the output of a JSON.parse on an
      // RP-controlled string. Most of these fields are expected to be simple
      // printable strings (hostnames, usernames, and URLs), but we cannot
      // rely upon the RP to do that. In particular we must guard against
      // these strings containing <script> tags. We will populate a new
      // object ("params") with suitably type-checked properties.
      var params = {};
      params.hostname = user.getHostname();

      // verify params
      try {
        if (paramsFromRP.requiredEmail) {
          if (!bid.verifyEmail(paramsFromRP.requiredEmail))
            throw "invalid requiredEmail: (" + paramsFromRP.requiredEmail + ")";
          params.requiredEmail = paramsFromRP.requiredEmail;
        }

        // support old parameter names...
        if (paramsFromRP.tosURL) paramsFromRP.termsOfService = paramsFromRP.tosURL;
        if (paramsFromRP.privacyURL) paramsFromRP.privacyPolicy = paramsFromRP.privacyURL;

        if (paramsFromRP.termsOfService && paramsFromRP.privacyPolicy) {
          params.tosURL = fixupURL(origin_url, paramsFromRP.termsOfService);
          params.privacyURL = fixupURL(origin_url, paramsFromRP.privacyPolicy);
        }

        if (paramsFromRP.siteLogo) {
          // Until we have our head around the dangers of data uris and images
          // that come from other domains, only allow absolute paths from the
          // origin.
          params.siteLogo = fixupAbsolutePath(origin_url, paramsFromRP.siteLogo);
        }

        if (paramsFromRP.siteName) {
          params.siteName = _.escape(paramsFromRP.siteName);
        }

        // returnTo is used for post verification redirection.  Redirect back
        // to the path specified by the RP.
        if (paramsFromRP.returnTo) {
          var returnTo = fixupAbsolutePath(origin_url, paramsFromRP.returnTo);
          user.setReturnTo(returnTo);
        }

        // If an address started out as "proxyidp", when the user is returned to
        // the dialog, the address is treated as a primary email. This is
        // a simplification because all emails are stored in localStorage as
        // either primary or secondary.
        if (hash.indexOf("#CREATE_EMAIL=") === 0) {
          var email = hash.replace(/#CREATE_EMAIL=/, "");
          if (!bid.verifyEmail(email))
            throw "invalid #CREATE_EMAIL= (" + email + ")";
          params.type = "primary";
          params.email = email;
          params.add = false;
        }
        else if (hash.indexOf("#ADD_EMAIL=") === 0) {
          var email = hash.replace(/#ADD_EMAIL=/, "");
          if (!bid.verifyEmail(email))
            throw "invalid #ADD_EMAIL= (" + email + ")";
          params.type = "primary";
          params.email = email;
          params.add = true;
        }

      } catch(e) {
        // note: renderError accepts HTML and cheerfully injects it into a
        // frame with a powerful origin. So convert 'e' first.
        self.renderError("error", {
          action: {
            title: "error in " + _.escape(origin_url),
            message: "improper usage of API: " + _.escape(e)
          }
        });

        return e;
      }
      // after this point, "params" can be relied upon to contain safe data

      // XXX Perhaps put this into the state machine.
      self.bind(win, "unload", onWindowUnload);

      self.publish("start", params);
    }

    // BEGIN TESTING API
    ,
    onWindowUnload: onWindowUnload
    // END TESTING API

  });

  sc = Dialog.sc;

  return Dialog;

}());
