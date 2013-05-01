
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

	var express = require('express')
	var app = express()

    app.use(express.static(__dirname + '/static'));

// Add Issue
    app.get('/addissue', function (req, res) {

		var tmpl = swig.compileFile('templates/addissue.html');
		res.send(tmpl.render({
			odeskuserid: 'someodeskuser',
			githubuserid: 'somegithubuser'
		}))
	})

	app.listen(3000, function() {
		console.log("go to localhost:3000")
	})
})
