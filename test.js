var artsyXapp = require('./'),
    express = require('express');

var app = express();
var requested = 0;
var lastReq;
var timeOffset = 0;
var responseStatus = 200;
var responseBody = null;
app.get('/api/v1/xapp_token', function(req, res, next) {
  requested++
  lastReq = req;
  if (responseStatus !== 200) {
    return res.status(responseStatus).send({ error: 'Unauthorized' });
  }
  if (responseBody) return res.send(responseBody);
  res.send({
    "xapp_token": "foo-token" + requested,
    "expires_in": new Date(Date.now() + timeOffset).toISOString(),
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

  it('emits an error and does not retry in a loop on a 401', function(done) {
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

  it('emits an error and does not retry in a loop on an invalid payload', function(done) {
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
});
