# artsy-xapp
Tiny lib to fetch, store, and refresh an xapp token from Artsy's API.

## Example

````javascript
var artsyXapp = require('artsy-xapp');
artsyXapp.init({
  url: 'https://api.artsy.net', // defaults to process.env.ARTSY_URL
  id: '31f31ffds', // defaults to process.env.ARTSY_ID
  secret: '32rf1fds' // defaults to process.env.ARTSY_SECRET
}, function() {
  app.locals.xappToken = artsyXapp.token
});
artsyXapp.on('error', process.exit);
````

## How it works

ArtsyXapp will fetch an xapp token on `init`, store the token in `artsyXapp.token` and refresh the token in the background. If everything goes to hell (e.g. the token is expiring and Artsy's API is down) it will emit an error and null the token—you probably want to crash the server at this point if your app depends deeply on Artsy's API.

## License

MIT