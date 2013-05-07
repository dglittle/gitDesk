function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:5000")
defaultEnv("NODE_ENV", "production")
defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/nodesk")
defaultEnv("SESSION_SECRET", "blahblah")
defaultEnv("ODESK_API_KEY", "26739894934be7c046d268680146a8d0")
defaultEnv("ODESK_API_SECRET", "b694a28f79d55f7b")
defaultEnv("GITHUB_CLIENT_ID", "c8216b1247ddcf0b1eff")
defaultEnv("GITHUB_CLIENT_SECRET", "7543eff6fc9436e1daaa99e533edafdc5d39720f")

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

var cons = require('consolidate');
var swig  = require('swig');

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

	app.engine('.html', cons.swig);
	app.set('view engine', 'html');

	swig.init({
	  allowErrors: false,
	  root: "./templates"
	});

	app.set('views', './templates');

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

    // login stuff
	var passport = require('passport')
    GitHubStrategy = require('passport-github').Strategy
    OdeskStrategy = require('passport-odesk').Strategy

	passport.use(new GitHubStrategy({
	        clientID: process.env.GITHUB_CLIENT_ID,
	        clientSecret: process.env.GITHUB_CLIENT_SECRET,
	        callbackURL: process.env.HOST + "/auth/github/callback",
	        customHeaders: { "User-Agent": "gitDesk/1.0" }
	    },
	    function(accessToken, refreshToken, profile, done) {
            return done(null, {
            	id : profile.username,
            	accessToken : accessToken,
            	refreshToken : refreshToken
            });
	    }
	))

	passport.use(new OdeskStrategy({
	        consumerKey: process.env.ODESK_API_KEY,
	        consumerSecret: process.env.ODESK_API_SECRET,
	        callbackURL: process.env.HOST + "/auth/odesk/callback"
	    },
	    function(token, tokenSecret, profile, done) {
            return done(null, {
            	id : profile.id,
            	accessToken : token,
            	tokenSecret : tokenSecret
            });
	    }
	))

	passport.serializeUser(function (user, done) {
	    done(null, "none");
	})

	passport.deserializeUser(function (obj, done) {
	    done(null, {});
	})    

    app.use(passport.initialize());
    app.use(passport.session());

    app.use(function (req, res, next) {
    	req.user = {
    		odeskuserid : req.session.odesk && req.session.odesk.id,
    		githubuserid : req.session.github && req.session.github.id
    	}
    	res.locals.user = req.user
        next()
    })

    app.get('/logout', function (req, res){
        req.session.odesk = null
        req.session.github = null
		req.session.destroy()
        req.logout()
        res.redirect('/auth')
    })

    app.get('/auth/github', passport.authenticate('github'))
    app.get('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/auth' }), function(req, res) {
            req.session.github = req.user
            res.redirect('/auth')
        })

    app.get('/auth/odesk', passport.authenticate('odesk'))
    app.get('/auth/odesk/callback', passport.authenticate('odesk', { failureRedirect: '/' }), function (req, res) {
            req.session.odesk = req.user
            res.redirect('/auth')
        })

// ------- ------- ------- ------- APP ROUTES GO HERE ------- ------- ------- -------

	// Splash page and auth for clients
	app.get('/auth', function (req, res) {

		if (res.locals.user.odeskuserid && res.locals.user.githubuserid) {
			res.redirect('/addissue')
			return
		}

		res.render ('auth.html', {
		})
	})

	// Splash page and auth for contractors
    app.get('/auth_contractor', function (req, res) {
		res.render('auth_contractor.html')
	})


	// Require Login for all pages besides 'auth'
	function requirelogin(req, res, next) {
	    if (!req.user) {
	        res.redirect('/auth')
	    } else {
	        next()
	    }
	}

	// Add Issue
    app.get('/addissue', requirelogin, function (req, res) {
		_.run(function(){
			repos = _.unJson(_.wget('https://api.github.com/users/'+req.user.githubuserid+'/repos'))

			res.render('addissue.html', {

			})
		})
	})

	// Add Bounty to Existing Issue
    app.get('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			repos = _.unJson(_.wget('https://api.github.com/users/'+req.user.githubuserid+'/repos'))

			res.render('addbounty.html', {

			})
		})
	})

	// View Issue
    app.get('/issue/101', requirelogin, function (req, res) {
		res.render('issue.html', {
			gitDesk_issues: [
			    {
			        "id"		: 101,
					"title"		: "make unicode chess pieces white",
			        "pull_reqs"	: 2
			    }, 
			    {
			        "id"		: 102,
			        "title"		: "this is our second open issue",
			        "pull_reqs"	: 0
			    }
			],
			issue: {
			        "id"		: 101,
					"title"		: "make unicode chess pieces white",
					"status"	: "Open",
					"posted_on" : "11 hours ago",
					"bounty"	: "$13.00",
					"gh_url"	: "http://www.github.com/dglittle/advanced-chess/issues/5",
					"odesk_url"	: "https://www.odesk.com/jobs/make-unicode-chess-pieces-look-white_~~e8233e3fddb85354",
			        "pull_reqs"	: 2,
					"description" : "github issue description"  // Greg: I assume you'll pass me a string
																// that will render here, nicely formatted
			}
		})
	})

// ------- ------- ------- ------- FRONT_END HELPER FUNCTIONS GO HERE ------- ------- ------- -------

	// get issues for a particular repo
	app.get('/api/getissuesbyrepo', function(req, res) {
		_.run(function() {
			var issues = _.wget('https://api.github.com/repos/'+req.user.githubuserid+'/'+req.query.repo+'/issues')
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(issues))
			res.end(issues)
		})
	})

	// find issue by title
	function findByTitle (source, title){
		return $(source.find(":title="+title))
	}

	// find issue by title
	function getIssue(issues, key, val) {
	    var issue = [];
	    for (var i in issues) {
			if (i == key && issue[key] == val) {
	            issue.push(issues);
	        }
	    }
	    return issue[0];
	}

	// get issue data
	app.get('/api/getissuebytitle', function(req, res) {
		_.run(function() {
			var issues = _.wget('https://api.github.com/repos/'+req.user.githubuserid+'/'+req.query.repo+'/issues');
			alert('blah: '+JSON.stringify(issues));
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(issues));
			var issue = getIssue(issues, "title", req.query.title);
			res.end(issue)
		})
	})


// ------- ------- ------- ------- BELOW HERE IS BACK-END ------- ------- ------- -------

    app.use(express.static(__dirname + '/static'));

    app.listen(process.env.PORT, function() {
        console.log("go to " + process.env.HOST)
    })

})
