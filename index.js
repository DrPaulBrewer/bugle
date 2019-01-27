// Copyright 2019- Paul Brewer, Economic and Financial Technology Consulting LLC <drpaulbrewer@eaftc.com>
// License: MIT

const fs = require('fs');
const driveX = require('decorated-google-drive');
const googleapis = require('googleapis').google;
const request = require('request');
const opener = require('open-from-google-drive');
const Iron = require('iron');
const Boom = require('boom');
const str = require('string-to-stream');

function bugle(server, options, next) {

  const googleCred = server.registrations.grant.options.google; // requires Object { key, secret } -- other props ignored

  if (options.openUrl) {
    if (!options.hostname)
      throw new Error("bugle: missing options.hostname");
    const openCred = {
      key: googleCred.key,
      secret: googleCred.secret,
      redirect: 'https://' + options.hostname + options.openUrl
    };
    const openSelectedDriveFile = opener(googleapis, openCred).open;
    server.method('openSelectedDriveFile', openSelectedDriveFile);
  }

  const cached = {};

  function cacheContent(what, path) {
    fs.readFile(path, (err, content) => {
      cached[what] = content;
    });
  }

  cacheContent('login', options.loginHTMLFile || __dirname + '/html/loginWithGoogleDrive.html');
  cacheContent('retry', options.retryHTMLFile || __dirname + '/html/retryWithGoogleDrive.html');

  function getCachedPage(what) {
    return function (req, reply) {
      reply(cached[what]).type('text/html');
    };
  }

  if ((!googleCred) || (typeof (googleCred.key) !== 'string') || (typeof (googleCred.secret) !== 'string'))
    next(new Error("bugle: expected to find google credentials in grant module configuration"));

  async function handleopen(req, reply) {
    const params = req.query;
    const fields = options.openfields || '*';
    const maxSize = options.openmaxsize || 100 * 1024;
    try {
      const {
        user,
        drive,
        file,
        contents
      } = await server.methods.openSelectedDriveFile({
        params,
        fields,
        maxSize
      });
      if (typeof (server.methods.onopen) === 'function') {
        await server.methods.onopen({
          req,
          reply,
          user,
          drive,
          file,
          contents
        });
      } else {
        const out = JSON.stringify([user, file, contents], null, 2);
        reply(out).type('text');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.dir(e);
    }
  }

  function getTokensFromCookie(req) {
    let tokens;
    const cookieManager = req.session || req.yar;
    if (cookieManager) {
      const grantCookie = cookieManager.get('grant');
      const bugleCookie = cookieManager.get('bugle');
      //  a grant cookie with a refresh token gets top priority because it is fresh from the Google OAuth2 endpoint
      //  a bugle cookie with a refresh token is an older refresh token and is also ok
      //  if neither cookie contains a refresh token, look for an access token in the grant cookie
      //  if that fails, nothing
      if (grantCookie &&
        grantCookie.response &&
        grantCookie.response.refresh_token
      ) {
        tokens = grantCookie.response;
      } else if (bugleCookie && bugleCookie.refresh_token) {
        tokens = bugleCookie;
      } else if (grantCookie &&
        grantCookie.response &&
        grantCookie.response.access_token) {
        tokens = grantCookie.response;
      }
      if (tokens && tokens._raw) delete tokens._raw;
      if (tokens && tokens.raw) delete tokens.raw;
      return tokens;
    }
  }


  function spinupGoogleDrive(req, reply) {
    const tokens = getTokensFromCookie(req);
    if (tokens && (tokens.access_token)) {
      req.drive = driveX(googleapis, request, googleCred, tokens, options.hexidSalt);
    }
    reply.continue();
  }


  function retryDriveLogin() {
    return this.redirect('/a/googledriveretry'); // jshint ignore:line
  }

  server.decorate('reply', 'retryDriveLogin', retryDriveLogin);

  function hapiDriveConductor(req, reply) {
    const tokens = getTokensFromCookie(req);
    const drive = req.drive;
    if (!drive) {
      // not logged in
      return reply.redirect('/a/googledriveretry');
    }
    let pRefresh;
    if (options && options.drive && options.drive.refreshTokenStash &&
      (options.drive.refreshTokenStash.location === 'appDataFolder')) {
      const refreshFile = options.drive.refreshTokenStash.file;
      const refreshIronKey = options.drive.refreshTokenStash.key;
      if (tokens.refresh_token) {
        pRefresh = (
          Iron.seal(tokens.refresh_token, refreshIronKey, Iron.defaults)
            .then((sealed) => (drive.x.appDataFolder.upload2({
              folderPath: '',
              name: refreshFile,
              stream: str(sealed),
              mimeType: 'text/plain',
              clobber: true
            })))
        );
      } else {
        pRefresh = (
          drive.x.appDataFolder.download(refreshFile)
            .then((sealed) => (Iron.unseal(sealed, refreshIronKey, Iron.defaults)))
            .then((refresh_token) => {
              tokens.refresh_token = refresh_token;
            })
        );
      }
    } else {
      pRefresh = Promise.resolve(); // do-nothing placeholder
    }
    (pRefresh
      .then(
        () => {
          const cookieManager = (req.session || req.yar);
          cookieManager.clear('grant');
          cookieManager.set('bugle', tokens);
          reply.redirect(options.myRedirect || '/a/me');
        },
        () => {
          reply.redirect('/a/googledriveretry');
        })
    );
  }

  function driveUserProfile(req, reply) {
    const drive = req.drive;
    if (drive)
      drive.x.aboutMe().then(reply).catch(() => {
        reply(Boom.badData("no response from Google Drive"));
      });
    else reply.redirect('/a/googledriveretry').takeover();
  }

  function driveUpdateTokens(req, reply) {
    try {
      const tokens = req.drive._options.auth.credentials;
      if (tokens.access_token && tokens.refresh_token) {
        const old_access_token = (req.session || req.yar).get('bugle').access_token;
        if (old_access_token !== tokens.access_token) {
          (req.session || req.yar).set('bugle', tokens);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("driveUpdateTokens: " + e.toString());
    }
    // ignore errors here resetting cookie - worst case is the access_token never updates and googleapis uses the refresh_token every time to get an access_token
    reply.continue();
  }

  function logout(req, reply) {
    const cookieManager = (req.session || req.yar);
    cookieManager.reset();
    reply('Goodbye').type('text/plain');
  }

  server.ext([{
    type: 'onPreAuth',
    method: spinupGoogleDrive
  },
  {
    type: 'onPostHandler',
    method: driveUpdateTokens
  }
  ]);

  if (options.openUrl){
    server.route({
      method: 'GET',
      path: options.openUrl,
      handler: handleopen
    });
  }

  server.route([{
    method: 'GET',
    path: googleCred.callback,
    handler: hapiDriveConductor
  },
  {
    method: 'GET',
    path: '/a/login',
    handler: getCachedPage('login')
  },
  {
    method: 'GET',
    path: '/a/logout',
    handler: logout
  },
  {
    method: 'GET',
    path: '/a/googledriveretry',
    handler: getCachedPage('retry')
  },
  {
    method: 'GET',
    path: '/a/googledrivereset',
    handler: getCachedPage('retry')
  },
  {
    method: 'GET',
    path: '/a/me',
    config: {
      pre: [{
        method: driveUserProfile,
        assign: 'me',
        failAction: 'error'
      }],
      handler: function (req, reply) {
        let page = '';
        const level = options.useMeLevel || 0;
        if (level > 0) {
          if (level > 0) page += '<h2>Welcome, ' + req.pre.me.user.displayName + '</h2>';
          if (level > 0) page += '<img src="' + req.pre.me.user.photoLink + '" />';
          if (level > 1) page += '<p>From Drive</p><pre>' + JSON.stringify(req.pre.me, null, 4) + '</pre>';
          if (level > 2) page += '<p>From req.headers</p><pre>' + JSON.stringify(req.headers, null, 4) + '</pre>';
          if (level > 3) page += '<p>From req.info</p><pre>' + JSON.stringify(req.info, null, 4) + '</pre>';
          page += '<p><a href="/a/logout">Logout</a></p>';
          reply(page);
        } else {
          reply(Boom.notFound());
        }
      }
    }
  }
  ]);

  next(); // call next to complete plugin registration

}

bugle.attributes = {
  pkg: require('./package.json'),
  dependencies: 'grant'
};

module.exports = {
  register: bugle
};
