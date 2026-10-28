// FIX: restore the existing deployed panel stylesheet, preserving every runtime module.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),name='ClientRequestsPanel-DSREBZ1c.css';
const before=fs.readFileSync(root+'/public-index.html','utf8');
assert.ok(!before.includes('href="/assets/'+name+'"'),'stylesheet already linked; review newer release');
const after=before.replace('</head>','<!-- FIX: external WB panel requires its original stylesheet at the FBO entry point. -->\n<link rel="stylesheet" href="/assets/'+name+'">\n</head>');
assert.notEqual(after,before);fs.mkdirSync(root+'/web/payload',{recursive:true});
fs.writeFileSync(root+'/web/payload/index.html',after);
