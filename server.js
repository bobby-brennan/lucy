var REQUEST = require('request');

var LUCY_HOST = process.env.LUCY_HOST || 'http://lucyreg.bbrennan.info';
var LUCY_PORT = 3000;
var LUCY_URL = LUCY_HOST + ':' + LUCY_PORT;
var LUCY_VERSION = '0.1.0';

var ERROR_PREFIX = 'Error'

var handleResponse = function(callback, ignoreBody) {
  return function(err, res, body) {
    if (err) { 
      console.log('Error connecting to Lucy\'s servers:' + JSON.stringify(err) + '::' + JSON.stringify(res));
      if (callback){callback(err)}
      throw err;
    }
    var serverErr = body.indexOf(ERROR_PREFIX) === 0;
    if (!ignoreBody || serverErr) {
      console.log(body);
      if (serverErr) {
        if (callback) {callback(body);}
        throw new Error("Server error:" + body);
      }
    }
    if (callback) {
      callback(null, body);
    }
  }
}

var buildBody = function(email, password, payload) {
  return {
    email: email,
    password: password,
    lucy_version: LUCY_VERSION,
    payload: payload,
  };
}

exports.publish = function(email, password, pkgDef, tarball) {
  REQUEST({
       method: 'POST',
       preambleCRLF: true,
       postambleCRLF: true,
       uri: LUCY_URL + '/publish',
       multipart: [{
             'content-type': 'application/json',
             body: JSON.stringify(buildBody(email, password, pkgDef)),
       }, {
             'content-type': 'application/octet-stream',
             body: tarball,
       }]
  }, handleResponse());
}

exports.addUser = function(loginInfo) {
  REQUEST({
    url: LUCY_URL + '/signup',
    json: true,
    body: buildBody(loginInfo.email, loginInfo.password, {}),
    method: 'POST',
  }, handleResponse())
}

exports.define = function(email, password, defn) {
  REQUEST({
        url: LUCY_URL + '/define',
        json: true,
        body: buildBody(email, password, defn),
        method: 'POST',
 }, handleResponse());
}

exports.getPackage = function(email, password, packageName, writeStream, onDone) {
  REQUEST({
    url: LUCY_URL + '/getPackage',
    json: true,
    body: buildBody(email, password, packageName), 
    method: 'POST',
  }, handleResponse(onDone, true)).pipe(writeStream);
}
