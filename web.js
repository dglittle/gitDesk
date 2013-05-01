
var template  = require('swig');
var _ = require('gl519')
_.run(function () {

	var express = require('express')
	var app = express()

    app.use(express.static(__dirname + '/static'));

    app.get('/', function (req, res) {


        // var tmpl = template.compileFile('/path/to/template.html');
        // tmpl.render({
        //     pagename: 'awesome people',
        //     authors: ['Paul', 'Jim', 'Jane']
        // });        
        // res.send('hi')
    })

	app.listen(3000, function() {
		console.log("go to localhost:3000")
	})
})
