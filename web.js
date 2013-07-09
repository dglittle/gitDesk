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
var toType = function(obj) {
  return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
}

_.run(function () {

	var skill_dict = _.makeSet(_.unJson(_.read('./skills.json')))
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
			_.print(contracts)
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

	function updateIssue(issue, body) {
		_.print('updating issue body')

		// update the GitHub issue
		var g = _.p(db.collection("tokens").findOne( { "_id" : "github:" + issue.user.login }, _.p()))
		u = issue.url + '?access_token=' + g.accessToken
		var s = _.wget('PATCH', u, _.json({
			body : 	body
		}))		
	}

	function closeIssue(issue, close) {
		_.print('in closeIssue now')

		// get GitHub token
		var g = _.p(db.collection("tokens").findOne( { "_id" : "github:" + issue.user.login }, _.p()))
		var u = issue.url + '?access_token=' + g.accessToken		

		// get oDesk job URL
		var joburl = _.p(getOByUserID(issue.odeskuserid).get('hr/v2/jobs/' + issue.jobref + '.json', _.p())).job.public_url
		_.print(joburl)

		// construct message to prepend to the GitHub issue
		var prepend = issue.body.match(/\*{3}[\n\r]*.+[\n\r]*\*{3}/)
		var newprepend = 	 	"***" + '\n' +
								"This issue was [done on oDesk](" + joburl + ")! Learn how to [link your repo to oDesk](http://warm-everglades-8745.herokuapp.com/about) and get your issues resolved fast." + '\n'
								+ "***"
		issue.body = issue.body.replace(prepend, newprepend)

		// update the issue
		var update = {}
		update.body = issue.body
		if (close) { update.state = 'closed' }

		var s = _.wget('PATCH', u, _.json(update))
	}

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

	// Learn More
    app.get('/about', function (req, res) {
		_.run(function(){
			res.render('about.html', {})
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

	function addbounty(issue, team, title, budget, description, visibility, odeskuserid, githubuserid, skills) {
		var o = getOByUserID(odeskuserid)
		_.print(arguments)
	    function getDateFromNow(fromNow) {
	        var d = new Date(_.time() + fromNow)
	        function zeroPrefix(x) { x = "" + x; return x.length < 2 ? '0' + x : x }
	        return zeroPrefix(d.getMonth() + 1) + "-" + zeroPrefix(d.getDate()) + "-" + d.getFullYear()
	    }

		var body = description
		description.length > 300 ? description = description.substring(0,300) + '...' : description = description
		_.print(description)

		description =		"Resolve the following GitHub issue:" + '\n\n'
							+ issue.html_url + '\n\n'
							+ "To apply, please answer the following questions:" + '\n'
							+ "1) What is your GitHub ID?" + '\n'
							+ "2) How long do you think it will take you to resolve this issue?" + '\n\n\n'
							+ "********************************************" + '\n'
							+ "The GitHub issue body begins as follows:" + '\n\n'
							+ description

		var post = 			{
								buyer_team__reference : team,
								category : 'Web Development',
								subcategory : 'Web Programming',
								title : title,
								description : description,
								budget : budget,
								visibility : visibility,
								job_type : 'fixed-price',
								end_date : getDateFromNow(1000 * 60 * 60 * 24 * 7),
								skills : skills
							}
		if (true) {

			_.print('about to post the odesk job')
			var job = _.p(o.post('hr/v2/jobs', post, _.p())).job
			_.print('the returned odesk job:')
			_.print(job.reference)

			// update the gitDesk issue
			var issueBody = "***" + '\n' +
						"I'm offering [$" + (1*budget).toFixed(2) + " on oDesk]("+ job.public_url +") for someone to do this task. Learn how to [get your issues resolved on oDesk](http://warm-everglades-8745.herokuapp.com/about).\n"
						+ "***" + '\n\n'
						+ body

			updateIssue(issue, issueBody)

			var post = {
				odesk: {
					uid: odeskuserid,
					job_url: job.public_url,
					recno: job.reference
				},
				github: {
					uid: githubuserid,
					issue_url: issue.html_url
				}
			}

			logBounty(post)
			return post
		}
	}

	// Add Bounty to Existing Issue	
    app.post('/addbounty', requirelogin, function (req, res) {
		_.run(function(){
			var u = req.body.api_url + '?access_token=' + req.session.github.accessToken
			var issue = _.unJson(_.wget(u))

			var team = req.body.team
			var title = req.body.title
			var budget = req.body.price
			var skills = validateSkills(req.body.skills)
			var description = req.body.description

			var visibility = 'private'
			if (req.body.visibility) { visibility = 'public' }

			var post = addbounty(issue, team, title, budget, description, visibility, req.session.odesk.id, req.session.github.id, skills)
			_.print('here is what the add bounty API returns:')
			_.print(post)

			res.render('confirmbounty.html', {
				title: title,
				description: description,
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
			var pay_option = req.body.radiogroup
			var amount = 0
			if(pay_option == 'closeandpaycustom') { amount = req.body.amount }
			if(pay_option == 'closeandpay') { amount = req.body.bounty }
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

			// End the Contract
			var url = 'https://www.odesk.com/api/hr/v2/contracts/' + req.body.contract + '.json?' +
				'reason=API_REAS_JOB_COMPLETED_SUCCESSFULLY&would_hire_again=yes'
			_.print('close job url = ' + url)
			var reason = 'API_REAS_JOB_COMPLETED_SUCCESSFULLY'
			var hireagain = 'yes'
			_.print(req.body.contract)
			_.p(o.delete('hr/v2/contracts/' + req.body.contract, {
				reason : reason,
				would_hire_again : hireagain
			}, _.p()))

			// Close the GitHub Issue if the user wants us to
			var issue = getIssueByURL(req, req.body.issue_url)
			issue.jobref = req.body.jobref
			issue.odeskuserid = req.session.odesk.id
			var close
			(req.body.closeissue == 'on') ? close = true : close = false
			try { closeIssue(issue, close) } catch(e) { _.print('closing the issue failed') }

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

			var skill = 'javascript, php'
			var skills = skill.split(/\s*,\s*/i)			
			var ok = _.all(skills, function(skill) { return skill_dict[skill] })

			_.print(ok)

			res.render('apitest.html', {
			})
		})
	})

	function validateSkills(skills) {
		var skill_array = skills.split(/\s*,\s*/i)
		skill_array = _.filter(skill_array, function(skill) { return skill_dict[skill] })
		skills = skill_array.join(';')
		_.print('skills: ' + skills)
		return skills
	}

// ------- ------- ------- ------- API FUNCTIONS ------- ------- ------- -------

	function getIssueByURL(req, url) {
		_.print('in getIssueByURL now')
		var m = url.match(/github.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/)

		// make sure it's at least a github URL
		if (!m) { res.send(false) }

		var uid = m[1]
		var repo = m[2]
		var issuenum = m[3]
		var url = 'https://api.github.com/repos/'+uid+'/'+repo+'/issues/'+issuenum + '?access_token=' + req.session.github.accessToken
		var issue = _.unJson(_.wget(url))
		issue.repo = repo
		return issue
	}

	app.get('/api/getissuebyurl', function(req, res) {
		_.run(function() {
			res.json(getIssueByURL(req, req.query.url))
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

			var markdown = {
				visibility : 'public',
				bounty : '',
				skills: ''
			}

			// if it's an open, add a job; if it's a close, close the job(?)
			var action = req.body.action
			if (action == 'opened') {
				try {

					var issueBody = req.body.issue.body	
					var linkedrepo = _.p(db.collection("linkedrepos").findOne({
						"githubuserid" : req.body.issue.user.login,
						"repo" : req.body.repository.name
					}, _.p()))

					// look for bounty in the markdown
					try {
						var bounty = issueBody.match(/(odesk bounty:\s*\$?)(\d+(\.\d+)?)/i)
						markdown.bounty = bounty[2]
						_.print('bounty regex match = ' + bounty[0])
						_.print('bounty = ' + markdown.bounty)
					} catch (e) {}

					// look for visibility in the markdown
					try { 
						var visibility = issueBody.match(/(odesk\s*visibility\s*:\s*)(private|public)/i)
						markdown.visibility = visibility[2]
						_.print('visibility regex match = ' + visibility[0])
						_.print('visibility = ' + markdown.visibility)
					} catch (e) {}

					// look for skills in the markdown
					try {
						var skill_array = issueBody.match(/(odesk\s*skills?\s*:\s*)(.*)/i)
						markdown.skills = validateSkills(skill_array[2])
						_.print('skills regex match = ' + skill_array[0])
						_.print('skills = ' + markdown.skills)
					} catch (e) {}

					_.print('about to add bounty')

					// INSERT CODE TO REMOVE MARKDOWN ONCE THE ISSUE IS CREATED
					if (bounty) { issueBody = issueBody.replace(bounty[0],'') }
					if (visibility) { issueBody = issueBody.replace(visibility[0],'') }
					if (skill_array) { issueBody = issueBody.replace(skill_array[0],'') }
					_.print('the new body with markdown removed is: ')
					_.print(issueBody)

					addbounty(req.body.issue, linkedrepo.team, req.body.issue.title, markdown.bounty, issueBody, markdown.visibility, linkedrepo.odeskuserid, linkedrepo.githubuserid, markdown.skills)

				} catch (e) { _.print(e); _.print('error: ' + (e.stack || e)) }

			} else if (action == 'closed') {
				// possibly close the job
				_.print("this issue was closed. doing nothing for now.")
			}

			// we're still adding hackhooks for now, even with no markdown
			_.p(db.collection('hackhooks').insert({
				body : req.body.issue,
				parsed : markdown
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
			var u = t.permissions.permission
			var utype = toType(u)

			if (utype == 'string') {
				if (u == 'manage_employment') {
					teams.push(t)
				}
			} else if (utype == 'array') {
				_.each(u, function(u) { if (u == 'manage_employment') { teams.push(t) } })
			} else {}
		})
		return teams
	}

    function getoDeskJobs(req) {

		// get the companies this user is in
		var teams = getTeams(req)

		// CHANGE IT SO THAT IT HANDLES USERS WITH PERMISSIONS IN SUB TEAMS BUT NOT THE PARENT TEAM
		var j = []
		var jobs = []

		// get all jobs the user has access to and put them in an array
		_.each(teams, function(team) {
			try {
//				_.print('team = ' + team.company__name + ' > ' + team.team__name)
				_.each(team.permissions.permission, function(p) {
//					_.print('permissions = ' + p)
				})
				j = j.concat(_.p(getO(req).get('hr/v2/jobs?buyer_team__reference=' + team.team__reference + '&status=open&page=0;100', _.p())).jobs.job)
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
					issue_url : 'https://api.' + m[0],
					odesk_url : 'http://www.odesk.com/e/' + c.buyer_company__reference + '/contracts/' + c.reference,
					recno : c.reference,
					company : c.buyer_company__reference,
					team : c.buyer_team__reference,
					amount : c.fixed_pay_amount_agreed,
					amount_formatted : accounting.formatMoney(c.fixed_charge_amount_agreed),
					jobref : c.job__reference
				}
				contracts.push(contract)
			}
		})

		return contracts
	} 

// ------- ------- ------- ------- BELOW HERE IS BACK-END ------- ------- ------- -------

    app.use(express.static(__dirname + '/static'));

	var port = process.env.PORT || 5000
    app.listen(port, function() {
        console.log("go to " + process.env.HOST)
    })

})