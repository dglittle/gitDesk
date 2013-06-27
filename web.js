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

var cons = require('consolidate')
var swig  = require('swig')
var _ = require('gl519')
var accounting = require('accounting')

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

	app.use(function(req, res, next) {
	    var data = []
	    req.setEncoding('utf8')
	    req.on('data', function (chunk) {
	    	data.push(chunk)
	    })
	    req.on('end', function () {
	    	req.rawBody = data.join('')
	    })
        next()
	})

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
	    	db.collection("tokens").update({
	    		_id : "github:" + profile.username
	    	}, { $set : { accessToken : accessToken, refreshToken : refreshToken }
	    	}, { upsert : true}, function () {
            	done(null, { id : profile.username, accessToken : accessToken, refreshToken : refreshToken })
            })
	    }
	))

	passport.use(new OdeskStrategy({
	        consumerKey: process.env.ODESK_API_KEY,
	        consumerSecret: process.env.ODESK_API_SECRET,
	        callbackURL: process.env.HOST + "/auth/odesk/callback"
	    },
	
	    function(token, tokenSecret, profile, done) {
	    	db.collection("tokens").update({
	    		_id : "odesk:" + profile.id
	    	}, { $set : { accessToken : token, tokenSecret : tokenSecret }
	    	}, { upsert : true}, function () {
            	done(null, { id : profile.id, accessToken : token, tokenSecret : tokenSecret })
            })
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

// ------- ------- ------- ------- AUTH AND REDIRECT APP ROUTES ------- ------- ------- -------

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

// ------- ------- ------- ------- "GET" APP ROUTES ------- ------- ------- -------

	// Dashboard: View Open Bounties and Active Jobs
	app.get('/issues', requirelogin, function (req, res) {
		_.run(function(){
			var jobs = getoDeskJobs(req)
			var contracts = getoDeskContracts(req)
			var repos = getLinkedRepos(req.session.github.id)
			res.render('issues.html', {
				jobs: jobs,
				contracts: contracts,
				repos : repos
			})
		})
	})

	function getLinkedRepos(githubuserid) {
		return _.p(db.collection("linkedrepos").find( { "githubuserid" : githubuserid } ).toArray(_.p()))
	}

	// Add Bounty Form
	app.get('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			repos = getRepos(req)
			t = getTeams(req)
			teams = t.sort(sort_by('company__name', false, function(a){return a.toUpperCase()}))
			res.render('addbounty.html', {

			})
		})
	})

	// Manage Repos
    app.get('/repos', requirelogin, function (req, res) {
		_.run(function(){
			var repos = getRepos(req)
			var teams = getTeams(req)
			_.each(repos, function(ghr) {
				if (ghr.is_linked) {
					_.each(teams, function(team) {
						if (ghr.team == team.team__reference) { ghr.team_name = team.company__name + ' > ' + team.team__name }
					})
				}
			})
			var githubuserid = req.session.github.id
			res.render('repos.html', {
				repos : repos,
				githubuserid : githubuserid,
				teams : teams
			})
		})
	})

	// Admin History: view all bounties posted on gitDesk
    app.get('/admin/history', requirelogin, function (req, res) {
		_.run(function(){
			_.print('the filter posted ' + req.query.oDeskUserID)
			if (req.query.oDeskUserID) {
				var history = getGitDeskJobs(req.query.oDeskUserID) } else {
				var history = getGitDeskJobs()
			}
			res.render('history.html', {
				history: history
			})
		})
	})

	// Add Bounty — Confirmation
    app.get('/confirm', requirelogin, function (req, res) {
		_.run(function(){
			res.render('confirmbounty.html', {
				title: "Issue Title" , // req.body.title,
				description: "This is the description of the issue", // description,
				team: "" , // req.body.team,
				joburl: "http://www.google.com" // job.public_url
			})
		})
	})

	// Add Issue Form
    app.get('/addissue', requirelogin, function (req, res) {
		_.run(function(){
			repos = getRepos(req) 
			teams = getTeams(req)
			res.render('addissue.html', {
			})
		})
	})

// ------- ------- ------- ------- "POST" APP ROUTES ------- ------- ------- -------

	function addbounty(issue, team, title, budget, visibility, odeskuserid, githubuserid) {
		var o = getOByUserID(odeskuserid)

	    function getDateFromNow(fromNow) {
	        var d = new Date(_.time() + fromNow)
	        function zeroPrefix(x) { x = "" + x; return x.length < 2 ? '0' + x : x }
	        return zeroPrefix(d.getMonth() + 1) + "-" + zeroPrefix(d.getDate()) + "-" + d.getFullYear()
	    }

		if (issue.body.length > 200) {
			var more = "... "
			} else var more = ""

		var description =	"Resolve the following GitHub issue:" + '\n\n'
							+ issue.html_url + '\n\n'
							+ "To apply, please answer the following questions:" + '\n'
							+ "1) What is your GitHub ID?" + '\n'
							+ "2) How long do you think it will take you to resolve this issue?" + '\n\n\n'
							+ "********************************************" + '\n'
							+ "The GitHub issue body begins as follows:" + '\n\n'
							+ issue.body.substring(0,200) + more

		var jobRef = _.p(o.post('hr/v2/jobs', {
			buyer_team__reference : team,
			category : 'Web Development',
			subcategory : 'Web Programming',
			title : title,
			description : description,
			budget : budget,
			visibility : visibility,
			job_type : 'fixed-price',
			end_date : getDateFromNow(1000 * 60 * 60 * 24 * 7)
		}, _.p())).job.reference

		var job = _.p(o.get('hr/v2/jobs/' + jobRef, _.p())).job

		var g = _.p(db.collection("tokens").findOne( { "_id" : "github:" + githubuserid }, _.p()))
		
		u = issue.url + '?access_token=' + g.accessToken

		issue.body = issue.body.replace()

		var s = _.wget('PATCH', u, _.json({
            body : 	"********************************************" + '\n' +
					"I'm offering $" + (1*budget).toFixed(2) + " on oDesk for someone to do this task: "
					+ job.public_url + '\n'
					+ "********************************************" + '\n\n'
					+ issue.body
		}))

		var post = {
			odesk: {
				uid: odeskuserid,
				job_url: job.public_url,
				recno: jobRef
			},
			github: {
				uid: githubuserid,
				issue_url: issue.html_url
			}
		}

		logBounty(post)
		return post
	}

	// Add Bounty to Existing Issue	
    app.post('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			var u = req.body.api_url + '?access_token=' + req.session.github.accessToken
			var issue = _.unJson(_.wget(u))

			var team = req.body.team
			var title = req.body.title
			var budget = req.body.price

			var visibility
			if (req.body.visibility) { visibility = 'public' }
			else { visibility = 'private' }
			var post = addbounty(issue, team, title, budget, visibility, req.session.odesk.id, req.session.github.id)

			res.render('confirmbounty.html', {
				title: title,
				description: req.body.description,
				team: team,
				joburl: post.odesk.job_url,
				budget: budget
			})
		})
	})

	// Close an Issue and Optionally Pay
    app.post('/closeissue', requirelogin, function (req, res) {
		_.run(function(){

			var o = getO(req)
			var option = req.body.radiogroup
			var amount = 0
			if(option == 'closeandpaycustom') { amount = req.body.amount }
			if(option == 'closeandpay') { amount = req.body.bounty }
			var comment = 'Payment for resolving a GitHub issue via gitDesk'

			// try to pay
			if(amount > 0) {
				_.print('going to try to pay $' + amount + ' now')

				var paymentRef = _.p(o.post('hr/v2/teams/' + req.body.team + '/adjustments', {
					engagement__reference : req.body.contract,
					charge_amount : amount,
					comments : comment
				}, _.p())).adjustment.reference

				_.print(paymentRef)
			} // end if

			// close the job

			// endContract(req.body.contract, req.session.odesk.id)

			var url = 'https://www.odesk.com/api/hr/v2/contracts/' + req.body.contract + '.json?' +
				'reason=API_REAS_JOB_COMPLETED_SUCCESSFULLY&would_hire_again=yes'
			_.print('close job url = ' + url)
			var reason = 'API_REAS_JOB_COMPLETED_SUCCESSFULLY'
			var hireagain = 'yes'
			_.print(o)
			_.print(req.body.contract)

			_.p(o.delete('hr/v2/contracts/' + req.body.contract, {
				reason : reason,
				would_hire_again : hireagain
			}, _.p()))

			// update the github issue ???

			res.redirect('/issues')
		})
	})

function endContract(contract, odeskuserid) {
	var o = getOByUserID(odeskuserid)
	_.p(o.delete('hr/v2/contracts/' + contract, {
		reason : 'API_REAS_JOB_COMPLETED_SUCCESSFULLY',
		would_hire_again : 'yes'
	}, _.p()))
}

function endJob(jobref, odeskuserid) {
	var o = getOByUserID(odeskuserid)

	_.p(o.delete('hr/v2/jobs/' + jobref, {
		reason_code : '41'
	}, _.p()))
}


// ------- ------- ------- ------- HELPER FUNCTIONS ------- ------- ------- -------

	// Require Login for all pages besides 'auth'
	function requirelogin(req, res, next) {
	    if (!req.user || !req.user.githubuserid || !req.user.odeskuserid) {
	        res.redirect('/auth')
		} else { next() }
	}

	function githubGetAll(u) {
		var items = []
		while (u) {
			items = items.concat(_.unJson(_.wget(u)))
			u = null
			try {
				u = _.wget.res.headers.link.match(/<([^>]*)>; rel="next"/)[1]
			} catch (e) {}
		}
		return items
	}

	function getRepos (req) {
		var githubuserid = req.user.githubuserid
		var repos = githubGetAll('https://api.github.com/users/'+githubuserid+
				'/repos?access_token=' + req.session.github.accessToken)
		var linked_repos =  getLinkedRepos(githubuserid)
		_.each(repos, function(ghr) {
			_.each(linked_repos, function(lr) {
				if (ghr.name == lr.repo) { 
					ghr.is_linked = true,
					ghr.team = lr.team }
			})
		})
		return repos
	}

	// Page to Test APIs
    app.get('/apitest', requirelogin, function (req, res) {
		_.run(function(){
			
			// look for markdown
			var issueBody = 'Here is the issue name.\noDesk bounty: $10.44\nAnd some more'
			bounty = issueBody.match(/(odesk bounty:\s*$?)(\d+\.\d+)/i)[2]

			res.render('apitest.html', {
			})
		})
	})



// ------- ------- ------- ------- API FUNCTIONS ------- ------- ------- -------

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
			res.json(getTeams(req))
		})
	})

	app.all('/api/setteam', function (req, res) {
		_.run(function () {
			req.session.team = _.unJson(req.query.team || req.body.team)
			res.json(true)
		})
	})

	app.get('/api/canceljob', function (req, res) {    // add close job
		_.run(function () {
			endJob(req.query.jobref, req.query.odeskuserid)
			res.redirect('/issues')
		})
	})
	
	app.all('/api/getodeskjobs', function (req, res) {
		_.run(function () {
			var a = getoDeskJobs(req)
			res.json(a)
		})
	})

	// get issues for a particular repo
	app.get('/api/getissuesbyrepo', function(req, res) {
		_.run(function() {
			var issues = _.wget('https://api.github.com/repos/'+req.user.githubuserid+'/'+req.query.repo+'/issues' + '?access_token=' + req.session.github.accessToken)
			res.json(issues)
		})
	})

	app.all('/api/issue-hook', function (req, res) {
		_.run(function () {

			// make sure the request is from github
			hmac = require('crypto').createHmac('sha1', process.env.GITHUB_CLIENT_SECRET).update(req.rawBody).digest("hex")
			if (hmac != req.headers['x-hub-signature'].split(/=/)[1]) {
				throw new Error("request doesn't seem to be from github")
			}

			// make sure the issue is added by the repo owner (since anyone can create an issue)
			if (req.body.issue.user.login != req.body.repository.owner.login) {
				throw new Error('issue not created by repository owner')
			}

			// look for markdown
			var issueBody = req.body.issue.body
			var bounty = issueBody.match(/(odesk bounty:\s*\$?)(\d+(\.\d+)?)/i)[2]
			_.print('bounty = ' + bounty)
			if (bounty) {

				var linkedrepo = _.p(db.collection("linkedrepos").findOne({
					"githubuserid" : req.body.issue.user.login,
					"repo" : req.body.repository.name }, _.p()))

				var visibility = 'private'   // look for this next
				var v = issueBody.match(/(odesk\s*visibility\s*:\s*)(\w+)/i)[2]
				_.print('visibility = ' + v)
				if (v == 'private' || v == 'public') { visibility = v }

				addbounty(req.body.issue, linkedrepo.team, req.body.issue.title, bounty, visibility, linkedrepo.odeskuserid, linkedrepo.githubuserid)
			}

			// we're still adding hackhooks for now, even with no markdown
			_.p(db.collection('hackhooks').insert({
				body : req.body,
				headers : req.headers
			}, _.p()))

			res.send("ok")
		})
	})

	app.all('/api/linkrepo', function (req, res) {
		_.run(function () {

			var u = 'https://api.github.com/repos/' + req.session.github.id + '/' + req.query.repo + '/hooks?access_token=' + req.session.github.accessToken

			var s = _.wget(u, _.json({
				"name": "web",
				"active": true,
				"events": [
					"issues",
					"watch"
				],
				"config": {
					"url": process.env.HOST + "/api/issue-hook",
					"content_type": "json",
					"secret": process.env.GITHUB_CLIENT_SECRET
				}
			}))

			var repository = {
				githubuserid : req.query.githubuserid,
				odeskuserid : req.session.odesk.id,
				repo : req.query.repo,
				team : req.query.team,
				html_url : 'https://github.com/' + req.query.githubuserid + '/' + req.query.repo
			}
			
			_.p(db.collection("linkedrepos").insert(repository, _.p()))

			res.redirect('/repos')
		})
	})

	app.all('/api/unlinkrepo', function (req, res) {
		_.run(function () {

			var githubuserid = req.user.githubuserid

			var hooks = githubGetAll('https://api.github.com/repos/' + githubuserid + '/' + req.query.repo + '/hooks?access_token=' + req.session.github.accessToken)

			var funcs = []
			_.each(hooks, function (hook) {
				if (hook.config && hook.config.url.indexOf(process.env.HOST) == 0) {
					funcs.push(function () {
						_.wget('DELETE', 'https://api.github.com/repos/' + githubuserid + '/' + req.query.repo + '/hooks/' + hook.id + '?access_token=' + req.session.github.accessToken)
					})
				}
			})
			_.parallel(funcs)

			_.p(db.collection("linkedrepos").remove({"repo" : req.query.repo}, _.p()))

			res.redirect('/repos')
		})
	})

	// ------- ------- ------- ------- HELPER FUNCTIONS GO HERE ------- ------- ------- -------

	// record the posting of a bounty
	function logBounty(post) {
		_.p(db.collection("posts").insert(post, _.p()))
	}
	
	function getGitDeskJobs() {
		if (arguments[0]) {
			var uid = arguments[0]
			return _.p(db.collection("posts").find( { "odesk.uid" : uid } ).toArray(_.p()))
		} else {
			return _.p(db.collection("posts").find().toArray(_.p()))
		}
	}

	var sort_by = function(field, reverse, primer){
	   var key = function (x) {return primer ? primer(x[field]) : x[field]};

	   return function (a,b) {
		  var A = key(a), B = key(b);
		  return ( (A < B) ? -1 : ((A > B) ? 1 : 0) ) * [-1,1][+!!reverse];                  
	   }
	}

	function getOFromToken(token) {
		var odesk = require('node-odesk-utils')
		var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
		o.OAuth.accessToken = token.accessToken
		o.OAuth.accessTokenSecret = token.tokenSecret
		return o
	}

	function getO(req) {
		return getOFromToken(req.session.odesk)
	}

	function getOByUserID(odeskuserid) {
		return getOFromToken(_.p(db.collection("tokens").findOne( { "_id" : "odesk:" + odeskuserid }, _.p())))
	}

	function getTeams(req) {
		var t = _.p(getO(req).get('hr/v2/userroles', _.p())).userroles.userrole
		var teams = []
		_.each(t, function(t) {
			var hm = false
			var u = t.permissions.permission
			_.each(u, function(u) { if (u == 'manage_employment') { u = true } })
			if (u) { teams.push(t) }
		})
		return teams
	}

	function getCompanies(req) {
		var teams = _.p(getO(req).get('hr/v2/teams', _.p())).teams
		var companies = []

		_.each(teams, function(team) {
			if (team.company__reference == team.reference) {
				companies.push(team)
			}
		})
		return companies
	}
	
	function getCompanyByTeam(teams, team) {
		var company

		_.each(teams, function(t) {
			if (t.reference == team) { company = t.company__reference }
		})
		return company
	}


	function getCompaniesAndTeams(req) {
		var teams = _.p(getO(req).get('hr/v2/teams', _.p())).teams
		var companies = []

		_.each(teams, function(team) {
			if (team.company__reference == team.reference) {
				companies.push({
					company: team.reference,
					company_name: team.company_name
				})
			}
		})

		_.each(companies, function(company) {
			company.teams = []
			_.each(teams, function(team) {
				if (team.company__reference == company.company) {
					company.teams.push({
						team: team.reference,
						team_name: team.name
					})
				}				
			})
		})

		return companies
	}


    function getoDeskJobs(req) {
	
		// get the companies this user is in
		var companies = getCompanies(req)
		
		// CHANGE IT SO THAT IT HANDLES USERS WITH PERMISSIONS IN SUB TEAMS BUT NOT THE PARENT TEAM
		var j = []
		var jobs = []

		// get all jobs the user has access to and put them in an array
		_.each(companies, function(company) {
			try {
				j = j.concat(_.p(getO(req).get('hr/v2/jobs?buyer_team__reference=' + company.company__reference + '&status=open&page=0;100', _.p())).jobs.job)
			} catch (e) { _.print('oDesk API failed to get jobs') }
		})

		_.each(j,function(j){

			// only add github issues to the object
			if(j) {
				var m = j.description.match(/github.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)

				if (m && j.status == 'open') {
					var job = {}

					job.company = j.buyer_company__reference

					// company name, prettified
					var c_name = j.buyer_company__name
					var t_name = j.buyer_team__name
					if (t_name != c_name) { c_name = c_name + ' > ' + t_name }
					job.company_name = c_name

					job.opening = j.reference
					job.title = j.title
					job.description = j.description
					job.odesk_url = j.public_url
					job.github_url = 'http://' + m[0]
					job.status = j.status
					job.candidates = j.num_candidates
					job.candidates_new = j.num_new_candidates
					job.budget = accounting.formatMoney(j.budget)
					job.ats_url = 'https://www.odesk.com/jobs/' + job.opening + '/applications?applicants'
					jobs.push(job)
				}
			}
		})
		return jobs
	}

    function getoDeskContracts(req) {
		var teams = getTeams(req)
		var contracts = []
		var c = []

		// get all jobs the user has access to and put them in an array
		try { c = _.p(getO(req).get('hr/v2/engagements?status=active&page=0;200&field_set=extended&sort=created_time;D', _.p())).engagements.engagement } catch (e) { 
			_.print('oDesk API failed to get contracts')
		} // would sorting by time descending speed up the next loop?

		// get all the logged gitDesk jobs the user has access to and put them in an array
		var gdj = getGitDeskJobs(req.session.odesk.id)
		// instead of doing this, do the regex thing

		_.each(c, function(c) {
			var m = c.job__description.match(/github.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)
			if (m) {
				var contract = {
					title : c.engagement_title,
					contractor : c.provider__name,
					github_url : m[0],
					odesk_url : 'http://www.odesk.com/e/' + c.buyer_company__reference + '/contracts/' + c.reference,
					recno : c.reference,
					company : c.buyer_company__reference,
					team : c.buyer_team__reference,
					amount : c.fixed_pay_amount_agreed,
					amount_formatted : accounting.formatMoney(c.fixed_pay_amount_agreed)
				}
				contracts.push(contract)
			}
		})

//		_.print('contracts = ')
//		_.print(contracts)
		return contracts
	} 

// ------- ------- ------- ------- BELOW HERE IS BACK-END ------- ------- ------- -------

    app.use(express.static(__dirname + '/static'));

	var port = process.env.PORT || 5000
    app.listen(port, function() {
        console.log("go to " + process.env.HOST)
    })

})