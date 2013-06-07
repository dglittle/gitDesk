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
// change the odesk IDs so they're different?

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
        console.log('error: ' + (err.stack || _.json(err)))
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
    app.use(express.bodyParser())

    app.use(function (req, res, next) {
    	res.json = function (x) {
    		if (typeof(x) != 'string')
    			x = _.json(x) || ''
			res.setHeader('Content-Type', 'application/json; charset=utf-8')
			res.setHeader('Content-Length', Buffer.byteLength(x))
			res.end(x)
    	}
    	next()
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
	        scope : ['public_repo'],
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
    		githubuserid : req.session.github && req.session.github.id,
    		team : req.session.team
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
    app.all('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/auth' }), function(req, res) {
            req.session.github = req.user
            res.redirect('/auth')
        })

    app.get('/auth/odesk', passport.authenticate('odesk'))
    app.get('/auth/odesk/callback', passport.authenticate('odesk', { failureRedirect: '/auth' }), function (req, res) {
            req.session.odesk = req.user
            res.redirect('/auth')
        })

// ------- ------- ------- ------- APP ROUTES GO HERE ------- ------- ------- -------

	// home page redirects to /issues
	app.get('/', function (req, res) {
		res.redirect('/issues')
	})

	// Splash page and auth for clients
	app.get('/auth', function (req, res) {

		if (res.locals.user.odeskuserid && res.locals.user.githubuserid) {
			res.redirect('/issues')
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
	    if (!req.user || !req.user.githubuserid || !req.user.odeskuserid) {
	        res.redirect('/auth')
		} else {
	        next()
	    }
	}

	// Add Issue
    app.get('/addissue', requirelogin, function (req, res) {
		_.run(function(){
			repos = _.unJson(_.wget('https://api.github.com/users/'+req.user.githubuserid+'/repos?access_token=' + req.session.github.accessToken))
			teams = getTeams(req)

			res.render('addissue.html', {

			})
		})
	})

	// Add Bounty to Existing Issue (GET form)
    app.get('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			repos = _.unJson(_.wget('https://api.github.com/users/'+req.user.githubuserid+'/repos?access_token=' + req.session.github.accessToken))
			t = getTeams(req)
			teams = t.sort(sort_by('company_name', false, function(a){return a.toUpperCase()}))
			res.render('addbounty.html', {

			})
		})
	})

	// Add Bounty to Existing Issue (actually POST the bounty)
    app.post('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			var o = getO(req)

		    function getDateFromNow(fromNow) {
		        var d = new Date(_.time() + fromNow)
		        function zeroPrefix(x) { x = "" + x; return x.length < 2 ? '0' + x : x }
		        return zeroPrefix(d.getMonth() + 1) + "-" + zeroPrefix(d.getDate()) + "-" + d.getFullYear()
		    }

			if (req.body.description.length > 200) {
				var more = "... "
				} else var more = ""

			var description =	"Resolve the following GitHub issue:" + '\n\n'
								+ req.body.githubissueurl + '\n\n'
								+ "To apply, please answer the following questions:" + '\n'
								+ "1) What is your GitHub ID?" + '\n'
								+ "2) How long do you think it will take you to resolve this issue?" + '\n\n\n'
								+ "********************************************" + '\n'
								+ "The GitHub issue body begins as follows:" + '\n\n'
								+ req.body.description.substring(0,200) + more
			

			var jobRef = _.p(o.post('hr/v2/jobs', {
				buyer_team__reference : req.body.team,
				category : 'Web Development',
				subcategory : 'Web Programming',
				title : req.body.title,
				description : description,
				budget : req.body.price,
				visibility : 'private',
				job_type : 'fixed-price',
				end_date : getDateFromNow(1000 * 60 * 60 * 24 * 7)
			}, _.p())).job.reference

			var job = _.p(o.get('hr/v2/jobs/' + jobRef, _.p())).job

			console.log(req.body)

			var u = 'https://api.github.com/repos/' + req.session.github.id + '/' + req.body.repo_var + '/issues/' + req.body.issuenum + '?access_token=' + req.session.github.accessToken

			var issue = _.unJson(_.wget(u))

			var s = _.wget('PATCH', u, _.json({
                body : 	"********************************************" + '\n' +
						"I'm offering $" + (1*req.body.price).toFixed(2) + " on oDesk for someone to do this task: "
						+ job.public_url + '\n'
						+ "********************************************" + '\n\n'
						+ issue.body
			}))
			console.log("s =" +s)
			console.log("u =" +u)
			console.log("accessToken ="+req.session.github.accessToken)

			res.render('confirmbounty.html', {
				title: req.body.title,
				description: description,
				team: req.body.team,
				joburl: job.public_url
			})
		})
	})

	// View List of Open Issues
    app.get('/issues', requirelogin, function (req, res) {
		_.run(function(){

			res.render('issues.html', {
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
				]
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

	var sort_by = function(field, reverse, primer){
	   var key = function (x) {return primer ? primer(x[field]) : x[field]};

	   return function (a,b) {
		  var A = key(a), B = key(b);
		  return ( (A < B) ? -1 : ((A > B) ? 1 : 0) ) * [-1,1][+!!reverse];                  
	   }
	}

	function parseGitHubURL(req) {
		var url = req.url
	}

    function getO(req) {
		var odesk = require('node-odesk-utils')
		var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
		o.OAuth.accessToken = req.session.odesk.accessToken
		o.OAuth.accessTokenSecret = req.session.odesk.tokenSecret
		return o
    }

	function getTeams(req) {
		return _.p(getO(req).get('hr/v2/teams', _.p())).teams
	}

	// get issues for a particular repo
	app.get('/api/getissuesbyrepo', function(req, res) {
		_.run(function() {
			var issues = _.wget('https://api.github.com/repos/'+req.user.githubuserid+'/'+req.query.repo+'/issues' + '?access_token=' + req.session.github.accessToken)
			res.json(issues)
		})
	})

	app.get('/api/getissuebyurl', function(req, res) {
		_.run(function() {
			
//			https://github.com/mdlevinson/Experimentation/issues/5     (may or may not have 'www.')
			var m = req.query.url.match(/github.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)

			// make sure it's at least a github URL
			if (!m) { res.send(false) }

			var uid = m[1]
			var repo = m[2]
			var issuenum = m[3]
			var url = 'https://api.github.com/repos/'+uid+'/'+repo+'/issues/'+issuenum + '?access_token=' + req.session.github.accessToken
			var issue = _.unJson(_.wget(url))
			issue.repo = repo
			res.json(issue)
		})
	})

	app.all('/api/getteams', function (req, res) {
		_.run(function () {
			_.print(getTeams(req))
			res.json(getTeams(req))
		})
	})

	app.all('/api/setteam', function (req, res) {
		_.run(function () {
			req.session.team = _.unJson(req.query.team || req.body.team)
			res.json(true)
		})
	})

	// create a job issue pair
	app.all('/api/createpair', function (req, res) {
		_.run(function () {
			var repo = req.query.repo || req.body.repo
			var title = req.query.title || req.body.title
			var desc = req.query.description || req.body.description
			var skills = req.query.skills || req.body.skills
			var price = 1*(req.query.price || req.body.price)

			// todo: need to create odesk job

			var u = 'https://api.github.com/repos/' + req.session.github.id + '/' + repo + '/issues?access_token=' + req.session.github.accessToken
			var hi = _.wget('POST', u, _.json({
				title : title,
				body : desc
			}))

			res.json(true)
		})
	})

// ------- ------- ------- ------- BELOW HERE IS BACK-END ------- ------- ------- -------

    app.use(express.static(__dirname + '/static'));

	var port = process.env.PORT || 5000
    app.listen(port, function() {
        console.log("go to " + process.env.HOST)
    })

})
