const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COUNTER_FILE = path.join('/tmp', 'verdict_count.txt');

function getCount() {
  try {
    return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8')) || 4812;
  } catch(e) {
    return 4812;
  }
}

function incrementCount() {
  var n = getCount() + 1;
  try { fs.writeFileSync(COUNTER_FILE, String(n)); } catch(e) {}
  return n;
}

const personaPrompts = {
  bhuvan: 'You are Brutal Bhuvan - a late-20s wheatish Indian man, disheveled hair, business casual. Brutally honest, no-nonsense, speaks Hinglish. Never sugarcoats. Use words like bhai, yaar, chhod do yaar, seedha baat karo naturally. Short punchy sentences. Max 2-3 sentences per section.',
  chitra: 'You are Chill Chitra - early-20s Indian woman, level-headed, calm, formal English. Always shows a path FORWARD. Reassuring but practical. Never dwells on the problem. Max 2-3 sentences per section.',
  sanket: 'You are Sensible Senior Sanket - mid-30s Indian man, 10 years in the organisation. Wise, warm, grounded mentor. Mix of formal and conversational English. Max 2-3 sentences per section.'
};

const scenarioContext = {
  quit: 'The person is asking whether they should quit their current job.',
  confused: 'The person is confused about their career direction overall.',
  underpaid: 'The person wants to know if they are being underpaid in their current role.',
  ownbiz: 'The person is considering leaving their job to start their own business or venture.'
};

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var parsedUrl = url.parse(req.url);

  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), function(err, data) {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/count') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: getCount() }));
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/verdict') {
    if (!ANTHROPIC_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
      return;
    }

    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      var persona = parsed.persona;
      var scenario = parsed.scenario || 'quit';
      var q1 = (parsed.q1 || []).join(', ');
      var q2 = (parsed.q2 || []).join(', ');
      var q3 = (parsed.q3 || []).join(', ');
      var freetext = parsed.freetext;

      var context = scenarioContext[scenario] || scenarioContext.quit;
      var userContext = 'Scenario: ' + context + '\nTime in job: ' + q1 + '\nFrustrations: ' + q2 + '\nSwitching/action status: ' + q3 + '\nIn their own words: ' + freetext;
      var prompt = personaPrompts[persona] + '\n\nHere is the situation of the person you are advising:\n' + userContext + '\n\nGive your verdict in your character voice. Respond ONLY with a raw JSON object, no markdown, no backticks:\n{"verdict":"one punchy verdict sentence","reason":"2-3 sentences of your reasoning in character","next_step":"1-2 sentences of a concrete action they can take this week"}';

      var postData = JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      });

      var options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      var apiReq = https.request(options, function(apiRes) {
        var responseBody = '';
        apiRes.on('data', function(chunk) { responseBody += chunk; });
        apiRes.on('end', function() {
          try {
            var data = JSON.parse(responseBody);
            if (data.error) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: data.error.message }));
              return;
            }
            var raw = data.content.map(function(i) { return i.text || ''; }).join('').trim();
            var clean = raw.replace(/^```json|^```|```$/gm, '').trim();
            var result = JSON.parse(clean);
            result.count = incrementCount();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch(e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Parse error: ' + e.message }));
          }
        });
      });

      apiReq.on('error', function(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });

      apiReq.write(postData);
      apiReq.end();
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, function() {
  console.log('Chai Tapri v2 running on port ' + PORT);
});
