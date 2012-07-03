#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('./lib/test_env.js');

const assert = require('assert'),
vows = require('vows'),
start_stop = require('./lib/start-stop.js'),
wsapi = require('./lib/wsapi.js'),
email = require('../lib/email.js');

var suite = vows.describe('forgotten-email');

start_stop.addStartupBatches(suite);

// every time a new token is sent out, let's update the global
// var 'token'
var token = undefined;

// create a new account via the api with (first address)
suite.addBatch({
  "staging an account": {
    topic: wsapi.post('/wsapi/stage_user', {
      email: 'first@fakeemail.com',
      pass: 'firstfakepass',
      site:'http://localhost:123'
    }),
    "works": function(err, r) {
      assert.strictEqual(r.code, 200);
    }
  }
});

// wait for the token
suite.addBatch({
  "a token": {
    topic: function() {
      start_stop.waitForToken(this.callback);
    },
    "is obtained": function (t) {
      assert.strictEqual(typeof t, 'string');
      token = t;
    }
  }
});

suite.addBatch({
  "create first account": {
    topic: function() {
      wsapi.post('/wsapi/complete_user_creation', { token: token }).call(this);
    },
    "account created": function(err, r) {
      assert.equal(r.code, 200);
      assert.strictEqual(true, JSON.parse(r.body).success);
      token = undefined;
    }
  }
});

suite.addBatch({
  "email created": {
    topic: wsapi.get('/wsapi/user_creation_status', { email: 'first@fakeemail.com' } ),
    "should exist": function(err, r) {
      assert.strictEqual(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).status, "complete");
    }
  }
});

// add a new email address to the account (second address)
suite.addBatch({
  "add a new email address to our account": {
    topic: wsapi.post('/wsapi/stage_email', {
      email: 'second@fakeemail.com',
      site:'https://fakesite.foobar.bizbaz.uk'
    }),
    "works": function(err, r) {
      assert.strictEqual(r.code, 200);
    }
  }
});

// wait for the token
suite.addBatch({
  "a token": {
    topic: function() {
      start_stop.waitForToken(this.callback);
    },
    "is obtained": function (t) {
      assert.strictEqual(typeof t, 'string');
      token = t;
    }
  }
});

// confirm second email email address to the account
suite.addBatch({
  "create second account": {
    topic: function() {
      wsapi.post('/wsapi/complete_email_addition', { token: token }).call(this);
    },
    "account created": function(err, r) {
      assert.equal(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).success, true);
      token = undefined;
    }
  }
});

// verify now both email addresses are known
suite.addBatch({
  "first email exists": {
    topic: wsapi.get('/wsapi/have_email', { email: 'first@fakeemail.com' }),
    "should exist": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).email_known, true);
    }
  },
  "second email exists": {
    topic: wsapi.get('/wsapi/have_email', { email: 'second@fakeemail.com' }),
    "should exist": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).email_known, true);
    }
  },
  "a random email doesn't exist": {
    topic: wsapi.get('/wsapi/have_email', { email: 'third@fakeemail.com' }),
    "shouldn't exist": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).email_known, false);
    }
  }
});

suite.addBatch({
  "reset status": {
    topic: wsapi.get('/wsapi/password_reset_status', { email: 'first@fakeemail.com' } ),
    "returns 'complete' before calling reset": function(err, r) {
      assert.strictEqual(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).status, "complete");
    }
  }
});

// Run the "forgot_email" flow with first address. 
suite.addBatch({
  "reset password on first account": {
    topic: wsapi.post('/wsapi/stage_reset', {
      email: 'first@fakeemail.com',
      pass: 'secondfakepass',
      site:'https://otherfakesite.com'
    }),
    "works": function(err, r) {
      assert.strictEqual(r.code, 200);
    }
  }
});

// wait for the token
suite.addBatch({
  "a token": {
    topic: function() {
      start_stop.waitForToken(this.callback);
    },
    "is obtained": function (t) {
      assert.strictEqual(typeof t, 'string');
      token = t;
    }
  }
});

// verify that the old email address + password combinations are still
// valid (this is so *until* someone clicks through)
suite.addBatch({
  "first email works": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'first@fakeemail.com',
      pass: 'firstfakepass',
      ephemeral: false
    }),
    "should work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, true);
    }
  },
  "second email works": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'second@fakeemail.com',
      pass: 'firstfakepass',
      ephemeral: false
    }),
    "should work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, true);
    }
  },
  "reset status": {
    topic: wsapi.get('/wsapi/password_reset_status', { email: 'first@fakeemail.com' } ),
    "returns 'pending' after calling reset": function(err, r) {
      assert.strictEqual(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).status, "pending");
    }
  }
});

suite.addBatch({
  "given a token, getting an email": {
    topic: function() {
      wsapi.get('/wsapi/email_for_token', { token: token }).call(this);
    },
    "account created": function(err, r) {
      assert.equal(r.code, 200);
      var body = JSON.parse(r.body);
      console.log(body);
      assert.strictEqual(body.success, true);
    }
  }
});

// now let's complete the re-registration of first email address
suite.addBatch({
  "complete password reset": {
    topic: function() {
      wsapi.post('/wsapi/complete_reset', { token: token }).call(this);
    },
    "account created": function(err, r) {
      assert.equal(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).success, true);
    }
  }
});

suite.addBatch({
  "reset status": {
    topic: wsapi.get('/wsapi/password_reset_status', { email: 'first@fakeemail.com' } ),
    "returns 'complete' after completing reset": function(err, r) {
      assert.strictEqual(r.code, 200);
      assert.strictEqual(JSON.parse(r.body).status, "complete");
    }
  }
});

// now we should be able to sign in using any email address
suite.addBatch({
  "first email, first pass bad": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'first@fakeemail.com',
      pass: 'firstfakepass',
      ephemeral: false
    }),
    "shouldn't work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, false);
    }
  },
  "first email, second pass good": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'first@fakeemail.com',
      pass: 'secondfakepass',
      ephemeral: false
    }),
    "should work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, true);
    }
  },
  "second email, first pass bad": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'second@fakeemail.com',
      pass: 'firstfakepass',
      ephemeral: false
    }),
    "should work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, false);
    }
  },
  "second email, second pass bad": {
    topic: wsapi.post('/wsapi/authenticate_user', {
      email: 'second@fakeemail.com',
      pass: 'secondfakepass',
      ephemeral: false
    }),
    "shouldn' work": function(err, r) {
      assert.strictEqual(JSON.parse(r.body).success, true);
    }
  },
});

// test list emails
suite.addBatch({
  "list emails API": {
    topic: wsapi.get('/wsapi/list_emails', {}),
    "succeeds with HTTP 200" : function(err, r) {
      assert.strictEqual(r.code, 200);
    },
    "returns an object with proper bits set": function(err, r) {
      r = JSON.parse(r.body);
      assert.strictEqual(r['second@fakeemail.com'].verified, false);
      assert.strictEqual(r['first@fakeemail.com'].verified, true);
    }
  }
});


// XXX: test that verification of unverified emails fails

// XXX: test that we can verify the remaining email ok


start_stop.addShutdownBatches(suite);

// run or export the suite.
if (process.argv[1] === __filename) suite.run();
else suite.export(module);