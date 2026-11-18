# artsy-xapp
Tiny lib to fetch, store, and refresh an xapp token from Artsy's API.

## Example

````javascript
var artsyXapp = require('artsy-xapp');
artsyXapp.init({
  url: 'https://api.artsy.net', // defaults to process.env.ARTSY_URL
  id: '31f31ffds', // defaults to process.env.ARTSY_ID
  secret: '32rf1fds', // defaults to process.env.ARTSY_SECRET
  retryDelay: 30000, // optional, first retry delay in ms after a failed fetch
  maxRetryDelay: 600000 // optional, cap for the retry delay in ms
}, function() {
  app.locals.xappToken = artsyXapp.token
});
artsyXapp.on('error', process.exit);
````

## How it works

ArtsyXapp will fetch an xapp token on `init`, store the token in `artsyXapp.token` and refresh the token in the background shortly before it expires.

If a fetch fails (an HTTP error such as a 401 or 5xx, a network error, or an invalid response), it emits an `error` event, calls the `init` callback with the error, and retries with exponential backoff: 30 seconds, doubling up to a 10-minute cap. The backoff resets after the next successful fetch. `artsyXapp.token` keeps its last value until a fetch succeeds, so it may be expired while retries are failing. If your app depends deeply on Artsy's API, you may want to crash the server on `error` instead.

Note that the `init` callback runs again after every refresh and every failed fetch, not just once.

## License

MIT