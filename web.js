
function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:5000")
defaultEnv("NODE_ENV", "production")
defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/nodesk")
defaultEnv("SESSION_SECRET", "blahblah")
defaultEnv("ODESK_API_KEY", "3f448b92c4aaf8918c0106bd164a1656")
defaultEnv("ODESK_API_SECRET", "e6a71b4f05467054")
defaultEnv("GITHUB_CLIENT_ID", "c8216b1247ddcf0b1eff")
defaultEnv("GITHUB_CLIENT_SECRET", "e6a71b4f05467054")

///

function logError(err, notes) {
    console.log('error: ' + (err.stack || err))
    console.log('notes: ' + notes)
}

process.on('uncaughtException', function (err) {
    try {
        logError(err)
    } catch (e) {}
})

var swig  = require('swig');

swig.init({
  allowErrors: false,
  autoescape: true,
  cache: true,
  encoding: 'utf8',
  filters: {},
  root: ".",
  tags: {},
  extensions: {},
  tzOffset: 0
});

var _ = require('gl519')
_.run(function () {

    var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['users'])

    db.createCollection('logs', {capped : true, size : 10000}, function () {})
    logError = function (err, notes) {
        console.log('error: ' + (err.stack || err))
        console.log('notes: ' + _.json(notes))
        db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
    }

    var express = require('express')
    var app = express()

    app.use(express.cookieParser())
    app.use(function (req, res, next) {
        _.run(function () {
            req.body = _.consume(req)
            next()
        })
    })

    var MongoStore = require('connect-mongo')(express)
    app.use(express.session({
        secret : process.env.SESSION_SECRET,
        cookie : { maxAge : 24 * 60 * 60 * 1000 },
        store : new MongoStore({
            url : process.env.MONGOHQ_URL,
            auto_reconnect : true,
            clear_interval : 3600
        })
    }))

    require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET, process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET)

/*
    app.all('*', function (req, res, next) {
        if (!req.user) {
            res.redirect('/login')
        } else {
            next()
        }
    })
*/

// ------- ------- ------- ------- APP ROUTES GO HERE ------- ------- ------- -------

// Add Issue
    app.get('/addissue', function (req, res) {

		var tmpl = swig.compileFile('templates/addissue.html');
		res.send(tmpl.render({
			odeskuserid: 'someodesker',
			githubuserid: 'somegithubuser',
//			myCars: ['Saab','Volvo','BMW']
		}))
	})

// View Issues
    app.get('/issues', function (req, res) {

		var tmpl = swig.compileFile('templates/base.html');
		res.send(tmpl.render({
		}))
	})


// ------- ------- ------- ------- BELOW HERE IS BACK-END ------- ------- ------- -------

    app.use(express.static(__dirname + '/static'));

    app.listen(process.env.PORT, function() {
        console.log("go to " + process.env.HOST)
    })

})
