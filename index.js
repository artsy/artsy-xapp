var Emitter = require('events').EventEmitter,
  request = require('superagent');

var MAX_NODE_TIMEOUT = 2147483647;
var MIN_NODE_TIMEOUT = 1;
var timeoutHandles = []

module.exports = new Emitter();

module.exports.init = function (options, callback) {

  // Do a solid and just callback for test env
  if (process.env.NODE_ENV == 'test') return callback();

  // Make sure there aren't any lingering timeouts.
  clearTimeouts();

  // Setup defaults
  if (typeof options == 'function') {
    callback = options;
    var options = {};
  }
  if (!options.url) options.url = process.env.ARTSY_URL;
  if (!options.id) options.id = process.env.ARTSY_ID;
  if (!options.secret) options.secret = process.env.ARTSY_SECRET;

  // Fetch the xapp token, cache, and refresh
  fetchAndCacheToken(options, callback);
}

function clearTimeouts() {
  for (var timeoutHandle of timeoutHandles) {
    clearTimeout(timeoutHandle);
  }
  timeoutHandles = [];
}

var fetchAndCacheToken = function (options, callback) {
  // Get the token
  request
    .get(options.url + '/api/v1/xapp_token')
    .query({ client_id: options.id, client_secret: options.secret })
    .end(function(err, res) {
      if (err) {
        module.exports.emit('error', err);
        if (callback) callback(err);
        return
      }

      // Set and callback w/ token (useful for client middleware).
      module.exports.token = res.body.xapp_token;
      if (callback) callback(null, module.exports.token);

      // Recurse this function to refresh the token it before it expires
      var expiresAt = new Date(res.body.expires_in).getTime();
      var timeout = (expiresAt - 1000) - Date.now()
      var timeoutHandle = setTimeout(function () {
        var index = timeoutHandles.indexOf(timeoutHandle);
        timeoutHandles.splice(index, 1);
        fetchAndCacheToken(options, callback);
      },
        ((timeout > MAX_NODE_TIMEOUT) ? MAX_NODE_TIMEOUT :
         (timeout < MIN_NODE_TIMEOUT) ? MIN_NODE_TIMEOUT : timeout)
      )
      timeoutHandles.push(timeoutHandle);
    });
}
