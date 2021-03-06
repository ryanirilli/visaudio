var express = require('express')
var path = require('path')
var bodyParser = require('body-parser')
var compress = require('compression')
var kue = require('kue')
var facebook = require('./../slideshow/facebook')
var jobs = kue.createQueue({
  redis: {
    host: '159.203.212.134',
    options: {
      socket_keepalive: true,
      retry_strategy: function (options) {
        return 300
      }
    }
  }
})

var serverSettings = {
  port: process.env.PORT || 3000
};

var app = express();
app.use(compress());
app.use(express.static(path.resolve('dist')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

/***************************
 * Routes
 * **************************/

app.post('/api/publish-slideshow', function (req, res) {
  var urls = req.body.urls;
  var songPath = req.body.songPath;
  var token = req.body.token;
  facebook.upgradeToken({token: token}).then(function (token) {
    return facebook.getUser({token: token}).then(function (user) {
      console.log(new Date(), 'PROCESSING_USER', user)
      var job = jobs.create('slideshows', {
        token: token,
        songPath: songPath,
        urls: urls
      }).attempts(3)

      job.on('complete', function () {
        console.log(new Date(), 'Job', job.id, 'with token', job.data.token, 'is done');
      }).on('failed attempt', function (errorMessage, doneAttempts) {
        console.log(new Date(), 'Job', job.id, 'with token', job.data.token, 'has failed', 'error', errorMessage, 'attempts', doneAttempts)
      }).on('failed', function (errorMessage) {
        console.log(new Date(), 'Job', job.id, 'with token', job.data.token, 'has failed', 'error', errorMessage);
      })

      job.save(function (err) {
        if (err) {
          console.log(new Date(), 'ERROR_SAVING', err, 'Job', job.id, 'with token', job.data.token)
        }
      })

    })

  }).fail(function (err) {
    console.log(new Date(), "ERROR_UPGRADE_TOKEN", token, err)
  })

  res.status(200).send(JSON.stringify({data: 'all good in the hood'}));
});

app.get('*', function (req, res) {
  res.sendFile(path.resolve('dist/index.html'));
});

app.listen(serverSettings.port, function () {
  console.log('Server listening on port ' + serverSettings.port);
});
