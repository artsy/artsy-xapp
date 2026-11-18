var artsyXapp = require('./'),
    express = require('express');

var app = express();
// Reused keep-alive sockets can delay fetch() requests by hundreds of ms on
// some Node versions, which makes refresh timing unpredictable. Use a fresh
// connection per request.
app.use(function(req, res, next) {
  res.set('Connection', 'close');
  next();
});
var requested = 0;
var lastReq;
var timeOffset = 0;
var responseStatus = 200;
var responseBody = null;
var offsetsById = null; // optional expiry offsets keyed by client_id
var requestsById = {};
var statusSequence = null; // optional status per request number, then responseStatus
var requestTimes = [];
app.get('/api/v1/xapp_token', function(req, res, next) {
  requested++
  requestTimes.push(Date.now());
  var id = req.query.client_id;
  requestsById[id] = (requestsById[id] || 0) + 1;
  lastReq = req;
  var status = (statusSequence && statusSequence[requested - 1]) || responseStatus;
  if (status !== 200) {
    return res.status(status).send({ error: 'Error ' + status });
  }
  if (responseBody) return res.send(responseBody);
  res.send({
    "xapp_token": "foo-token" + requested,
    "expires_in": new Date(
      Date.now() + ((offsetsById && offsetsById[id]) || timeOffset)
    ).toISOString(),
  });
  lastReq = req;
});


describe('artsyXapp', function() {

  var server, token, xappRes;

  before(function(done) {
    server = app.listen(7000, done);
  });

  beforeEach(function () {
    requested = 0;
    timeOffset = 2000;
    responseStatus = 200;
    responseBody = null;
    offsetsById = null;
    requestsById = {};
    statusSequence = null;
    requestTimes = [];
    artsyXapp.removeAllListeners('error');
  })

  it('gets an access token on init', function(done) {
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar'
    }, function() {
      artsyXapp.token.should.equal('foo-token1');
      done();
    });
  });

  it('refreshes the access token before it expires', function(done) {
    timeOffset = 1250
    var calls = 0;
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar'
    }, function(err, token) {
      // The callback fires on init and again on every refresh (scheduled
      // ~250ms out: 1250ms expiry - 1000ms buffer).
      calls++;
      if (calls === 1) {
        token.should.equal('foo-token1');
      } else if (calls === 2) {
        token.should.equal('foo-token2');
        artsyXapp.token.should.equal('foo-token2');
        done();
      }
    });
  });

  it('drops an in-flight request from a previous init', function(done) {
    // The stale init's token expires soon, so if its response were honoured
    // it would start its own refresh loop ~100ms in. The live init refreshes
    // ~500ms in. Requests are counted per client_id so traffic from other
    // tests can't affect the counts.
    offsetsById = { stale: 1100, live: 1500 };
    var url = 'http://localhost:7000';
    var staleCalls = 0;
    var liveCalls = 0;

    artsyXapp.init({ url: url, id: 'stale', secret: 'bar' }, function() {
      staleCalls++;
    });
    artsyXapp.init({ url: url, id: 'live', secret: 'bar' }, function(err, token) {
      liveCalls++;
      if (liveCalls === 2) {
        // By now the stale loop would have refreshed several times.
        requestsById.stale.should.equal(1);
        requestsById.live.should.equal(2);
        staleCalls.should.equal(0);
        artsyXapp.token.should.equal(token);
        done();
      }
    });
  });

  it('sends client id and secret', function(done) {
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar'
    }, function() {
      lastReq.query.client_id.should.equal('foo');
      lastReq.query.client_secret.should.equal('bar');
      done();
    });
  });

  it('emits an error and backs off instead of retrying immediately on a 401', function(done) {
    responseStatus = 401;
    var errors = 0;
    artsyXapp.on('error', function(err) {
      errors++;
      err.status.should.equal(401);
    });
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'bad',
      secret: 'creds'
    }, function(err) {
      err.should.be.an.instanceOf(Error);
      setTimeout(function() {
        requested.should.equal(1);
        errors.should.equal(1);
        done();
      }, 200);
    });
  });

  it('emits an error and backs off instead of retrying immediately on an invalid payload', function(done) {
    responseBody = { xapp_token: 'foo-token', expires_in: 'not-a-date' };
    var errors = 0;
    artsyXapp.on('error', function() { errors++; });
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar'
    }, function(err) {
      err.should.be.an.instanceOf(Error);
      setTimeout(function() {
        requested.should.equal(1);
        errors.should.equal(1);
        done();
      }, 200);
    });
  });

  it('retries after a transient 5xx and recovers', function(done) {
    statusSequence = [503, 200];
    var errors = 0;
    artsyXapp.on('error', function(err) {
      errors++;
      err.status.should.equal(503);
    });
    var calls = 0;
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar',
      retryDelay: 50
    }, function(err, token) {
      calls++;
      if (calls === 1) {
        err.should.be.an.instanceOf(Error);
      } else {
        (err === null).should.be.true;
        token.should.equal('foo-token2');
        artsyXapp.token.should.equal('foo-token2');
        errors.should.equal(1);
        requested.should.equal(2);
        done();
      }
    });
  });

  it('retries after a network error', function(done) {
    var errors = 0;
    artsyXapp.on('error', function() {
      errors++;
      if (errors === 2) done();
    });
    artsyXapp.init({
      url: 'http://127.0.0.1:1', // nothing listens here
      id: 'foo',
      secret: 'bar',
      retryDelay: 20
    });
  });

  it('doubles the retry delay up to the cap', function(done) {
    this.timeout(5000);
    responseStatus = 503;
    artsyXapp.on('error', function() {
      if (requestTimes.length < 6) return;
      var gaps = [];
      for (var i = 1; i < requestTimes.length; i++) {
        gaps.push(requestTimes[i] - requestTimes[i - 1]);
      }
      // Expected: 40, 80, 160, 200 (capped), 200 (capped).
      [40, 80, 160, 200, 200].forEach(function(expected, i) {
        gaps[i].should.be.within(expected - 5, expected + 60);
      });
      done();
    });
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar',
      retryDelay: 40,
      maxRetryDelay: 200
    });
  });

  it('resets the backoff after a successful fetch', function(done) {
    // fail -> retry (100ms) -> success (refresh ~100ms later) -> fail ->
    // retry should wait 100ms again, not 200ms.
    statusSequence = [503, 200, 503, 200];
    timeOffset = 1100;
    var calls = 0;
    artsyXapp.on('error', function() {});
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar',
      retryDelay: 100
    }, function(err) {
      calls++;
      if (calls === 4) {
        (err === null).should.be.true;
        requested.should.equal(4);
        (requestTimes[3] - requestTimes[2]).should.be.within(95, 160);
        done();
      }
    });
  });
});
