var Emitter = require("events").EventEmitter;
var MAX_NODE_TIMEOUT = 2147483647;
var MIN_NODE_TIMEOUT = 1;
// Backoff for retrying after a failed fetch: 30s, doubling up to 10 minutes.
var DEFAULT_RETRY_DELAY = 30 * 1000;
var DEFAULT_MAX_RETRY_DELAY = 10 * 60 * 1000;
var timeoutHandles = [];

// Incremented on every init() so responses to requests started by an
// earlier init() can be recognised and dropped.
var generationCount = 0;

module.exports = new Emitter();

module.exports.init = function (options, callback) {
  // Do a solid and just callback for test env
  if (process.env.NODE_ENV == "test") return callback();

  // Make sure there aren't any lingering timeouts, and invalidate any
  // request still in flight from a previous init() so it can't schedule a
  // second refresh loop when it resolves.
  clearTimeouts();
  generationCount++;

  // Setup defaults
  if (typeof options == "function") {
    callback = options;
    var options = {};
  }
  if (!options.url) options.url = process.env.ARTSY_URL;
  if (!options.id) options.id = process.env.ARTSY_ID;
  if (!options.secret) options.secret = process.env.ARTSY_SECRET;
  if (!options.retryDelay) options.retryDelay = DEFAULT_RETRY_DELAY;
  if (!options.maxRetryDelay) options.maxRetryDelay = DEFAULT_MAX_RETRY_DELAY;

  // Fetch the xapp token, cache, and refresh
  fetchAndCacheToken(options, callback, generationCount, 0);
};

function clearTimeouts() {
  for (var timeoutHandle of timeoutHandles) {
    clearTimeout(timeoutHandle);
  }
  timeoutHandles = [];
}

// Schedule the next fetch for this generation. Delays are clamped to what
// setTimeout supports.
function scheduleFetch(delay, options, callback, gen, failures) {
  var timeoutHandle = setTimeout(
    function () {
      var index = timeoutHandles.indexOf(timeoutHandle);
      if (index !== -1) timeoutHandles.splice(index, 1);
      fetchAndCacheToken(options, callback, gen, failures);
    },
    delay > MAX_NODE_TIMEOUT
      ? MAX_NODE_TIMEOUT
      : delay < MIN_NODE_TIMEOUT
      ? MIN_NODE_TIMEOUT
      : delay
  );
  timeoutHandles.push(timeoutHandle);
}

// `failures` is the number of consecutive failed fetches so far; it drives the
// retry backoff and resets to 0 after a successful fetch.
var fetchAndCacheToken = function (options, callback, gen, failures) {
  var isStale = function () {
    return gen !== generationCount;
  };

  // Get the token
  fetch(
    options.url +
      `/api/v1/xapp_token?client_id=${options.id}&client_secret=${options.secret}`
  )
    .then((data) => {
      // Release the connection for responses whose body we won't read.
      var discardBody = function () {
        if (data.body) data.body.cancel().catch(function () {});
      };
      if (isStale()) return discardBody();
      // fetch() resolves on HTTP errors (e.g. 401 for bad/rotated
      // credentials), so treat non-2xx responses as failures explicitly.
      if (!data.ok) {
        discardBody();
        var err = new Error(
          "Failed to fetch xapp token: " + data.status + " " + data.statusText
        );
        err.status = data.status;
        throw err;
      }
      return data.json();
    })
    .then((res) => {
      if (isStale()) return;
      // Validate the payload before scheduling a refresh. A missing or
      // unparseable expires_in yields a NaN timeout, which setTimeout treats
      // as ~1ms and would hammer the API in a tight loop.
      var expiresAt = new Date(res && res.expires_in).getTime();
      if (!res || !res.xapp_token || !Number.isFinite(expiresAt)) {
        throw new Error("Invalid xapp token response from " + options.url);
      }

      // Set and callback w/ token (useful for client middleware).
      module.exports.token = res.xapp_token;
      if (callback) callback(null, module.exports.token);

      // Refresh the token shortly before it expires.
      scheduleFetch(expiresAt - 1000 - Date.now(), options, callback, gen, 0);
    })
    .catch((err) => {
      if (isStale()) return;

      // Retry with capped exponential backoff so a transient failure (5xx,
      // network error) doesn't leave the app with an expired token until
      // restart, while bad credentials can't turn into a request storm.
      // Scheduled before emitting, since emitting "error" with no listener
      // throws.
      var delay = Math.min(
        options.retryDelay * Math.pow(2, failures),
        options.maxRetryDelay
      );
      scheduleFetch(delay, options, callback, gen, failures + 1);

      module.exports.emit("error", err);
      if (callback) callback(err);
    });
};
