# bugle

A Hapi plugin for Google Drive Login with:

* refresh token storage policy
* hooked to create `.drive` on requests where available
* drive API extensions from npm: decorated-google-drive

## Usage

### Installation

    npm i bugle -S

You also need grant and probably yar.

    npm i grant -S
    npm i yar -S

### Configuration

#### ./path/to/hapi/config/bugle.json

If you want to store encrypted refresh tokens for each user in their own Drive appDataFolder, where they can't change them and no one else will likely see
them, add the "refreshTokenStash" setting below. Otherwise that can be omitted. 

    {
      "drive": {
          "refreshTokenStash": {
	      "location": "appDataFolder",
	      "file": "r",
	      "key": "makeUpSomthingBetterThanThisForYourIronEncryptionKey"
	   }
       },
       "myRedirect": "/a/me", // where to send users who have logged in with Google Drive -- defaults to /a/me
       "useMeLevel": 2, // level from 0-4 to determine what to return from /a/me -- 0 is 404 (default), 1 is name+pic, 2 includes drive profile, 3 headers, 4 server info 
       "loginHTMLFile": "/path/to/your/login.html", // optional HTML file to show at URL /a/login -- default provided
       "retryHTMLFile": "/path/to/your/retry.html"  // also optional
    }


#### ./path/to/hapi/config/grant.json

**Note:  bugle reads the grant config via `server.registrations.grant` **

Configure grant like this for an app that wants to:

* read/write its own files from the user's Google Drive
* read/write the secret appDataFolder on the user's Google Drive 


    {
       "server": {
           "protocol": "https",   // you do use https, dont you?
	   "host": "example.com",
	   "callback": "/a/googledrive",
	   "transport": "session",
	   "state": true
        },
	"google": {
	    "key": "your-api-console-drive-client-id-goes-here",
	    "secret": "your-api-console-drive-secret-goes-here"
            "scope": [
	        "https://www.googleapis.com/auth/drive.file",	
	        "https://www.googleapis.com/auth/drive.appdata"
	    ],
	    "callback": "/a/googledrive",
	    "custom_params": {
		"access_type": "offline"
	    }
        }
    }


Note:  Adding `"prompt": "consent"` to `custom_params` forces the Google app consent dialog every login, yielding new refresh tokens each time.
In documentation, though, it is suggested to reuse the old refresh tokens until they expire (6 mo?) by storing them somewhere safe.


#### ./path/to/hapi/config/yar.json

`isSameSite:false` turns off some cookie same site protection that was problematic with yar + chrome browser - use at own risk or omit 

    {
       "cookieOptions": {
            "password": "changeThisPasswordToSomethingHardToGuessBecauseItEncryptsTheCookiesWithTheDriveTokens",
	    "isSecure": true,  // use true if you are using https
            "isSameSite": false  
	}
    }

### Example Hapi Server

#### ./path/to/hapi/index.js

**Note: this requires some set up in Google API Console and the configuration files before it will work**

```js

// Minimal Example: Hapi server using yar-grant-bugle

// jshint esversion:6, strict:global, node:true

"use strict";

const Hapi = require('hapi');
const yar = require('yar');
const Grant = require('grant-hapi');
const grant = new Grant();
const server = new Hapi.Server();
const Boom = require('boom');
const bugle = require('bugle');

server.connection({port:8888});

server.register([
    // REQUIRED: (any session store - see ./examples/hapi-session)
    {
	register: yar,
	options: require('./config/yar.json')
    },
    // REQUIRED: grant, configured for Google Drive login
    {
	register: grant,
	options: require('./config/grant.json')
    },
    // REQUIRED: bugle, grabs google config from grant, and own config from bugle.json
    {
	register: bugle,
	options: require('./config/bugle.json') 
    }
], function(err){
    if (err) throw new Error(err);

    server.start((err)=>{
	if (err) throw new Error(err);
	console.log("Server started at:", server.info.uri);
    });
});

```

## Features

* provides several routes under `/a` to deal with `/a/login`, `/a/logout`, `/a/googledriveretry` retries, `/a/me` Google Drive User's profile
* inherits route `/connect/google` as alternate login point from `grant` 
* `request` decorated with `.drive` from [decorated-google-drive](https://github.com/DrPaulBrewer/decorated-google-drive) at `onPreAuth`
 * `req.drive` and `req.drive.x` are built from and on top of `npm:googleapis`
 * `req.drive` without the `.x` is a vanilla `npm:googleapis.drive` client
 * `req.drive.x` extensions know about
   * the appDataFolder via `req.drive.x.appDataFolder.method`
   * paths `req.drive.x.findPath('/some/nested/path/in/users/drive')`
   * how to make paths like `mkdir -p` does
   * creating upload URLs for later uploads, and doing resumable upload now for bigger files
   * more (see decorated-google-drive)
* `request.drive` will use `googleapis` to try to auto-update its Google Drive OAuth2 access_token from the OAuth2 refresh_token 
* token/cookie management
   * updated Google Drive tokens are pushed out into the session cookie automatically at `onPostHandler`
   * new Google Drive OAuth2 refresh tokens can be stashed in the user's Drive appDataFolder in an encrypted file for safe keeping
   * subsequent `access_token` only logins will retrieve the stashed refresh_token as part of drive initialization

## Copyright

Copyright 2017 Paul Brewer, Economic and Financial Technology Consulting LLC <drpaulbrewer@eaftc.com>

## License: MIT

## No relation to Google, Inc.

This software is 3rd party software.

It is not a product of Google, Inc.

Google Drive[tm] is a trademark of Google, Inc.
    
npm: googleapis is a Google-provided nodejs client for Google APIs such as Google Drive, linked to/referenced from our code. License: Apache 2.0
A copy is not included herein, but running `npm install` may install one.


