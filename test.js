var artsyXapp = require('./'),
    express = require('express');

var app = express();
var requested = 0;
var lastReq;
var timeOffset = 0;
app.get('/api/v1/xapp_token', function(req, res, next) {
  requested++
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
    var refreshes = 1;
    artsyXapp.init({
      url: 'http://localhost:7000',
      id: 'foo',
      secret: 'bar'
    }, function() {
      artsyXapp.token.should.equal('foo-token' + refreshes++);
      setTimeout(function() {
        artsyXapp.token.should.not.equal('foo-token1');
        artsyXapp.token.should.containEql('foo-token2');
        done();
      }, 275);
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

  xit('emits an error if after failed to get an access token', function() {
  });
});
