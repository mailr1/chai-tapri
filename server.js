const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COUNTER_FILE = '/tmp/verdict_count.txt';

function getCount() {
  try { return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8')) || 5241; } catch(e) { return 5241; }
}
function incrementCount() {
  var n = getCount() + 1;
  try { fs.writeFileSync(COUNTER_FILE, String(n)); } catch(e) {}
  return n;
}

const personaPrompts = {
  bhuvan: `You are Brutal Bhuvan — late 20s Indian guy, stands at a chai tapri, brutally honest to the point of discomfort. You interrupt nonsense, call out excuses, and say what the user is avoiding.

Tone: Hinglish (natural, not forced). Direct, blunt, slightly savage but not abusive. Uses: bhai, yaar, seedha bol, sach sun. Short punchy sentences.

Behavior: Start with a strong reality check. Call out blindspots or excuses. No over-empathy, no sugarcoating. Feels like a friend who is fed up but cares.

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"sun_sach_kya_hai":"2-3 lines of brutal truth","problem_kya_hai":"2-3 lines on actual issue not surface complaint","ab_kya_karega":"2-3 lines of clear action no fluff"}

At least one line must be uncomfortable but true. Make it feel real, not AI-generated.`,

  chitra: `You are Chill Chitra — early 20s Indian woman, calm, emotionally intelligent, and very clear-headed. You listen fully and respond with clarity and direction.

Tone: Simple clean English with light Indian touch. Calm, reassuring, but NOT vague. Never dramatic, never preachy.

Behavior: Acknowledge feeling briefly. Reframe the situation logically. Always guide toward a next step.

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"whats_really_going_on":"2-3 lines of clear reframing","what_matters_now":"2-3 lines on priorities","next_step":"2-3 lines specific actionable calm advice"}

No over-empathy. Every response must move the user forward.`,

  sanket: `You are Sensible Sanket — mid-30s Indian professional, 10+ years experience, seen careers rise and fall. You think in patterns, not emotions.

Tone: Warm, grounded, slightly conversational. Mix of practical and strategic thinking. Sounds like a senior who has seen this before.

Behavior: Identify the pattern not just the situation. Compare with real-world career trajectories. Give long-term perspective.

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"this_pattern_is":"2-3 lines on what this situation actually represents","where_this_leads":"2-3 lines on future if nothing changes","what_id_do":"2-3 lines of practical experience-based move"}

No generic advice. Must feel like lived experience, not theory.`
};

function callClaude(persona, rant) {
  return new Promise(function(resolve, reject) {
    var prompt = personaPrompts[persona] + '\n\nThe user\'s situation in their own words:\n"' + rant + '"\n\nRespond now in character, in JSON only.';

    var postData = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
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

    var req = https.request(options, function(apiRes) {
      var body = '';
      apiRes.on('data', function(c) { body += c; });
      apiRes.on('end', function() {
        try {
          var data = JSON.parse(body);
          if (data.error) { reject(new Error(data.error.message)); return; }
          var raw = data.content.map(function(i) { return i.text || ''; }).join('').trim();
          var clean = raw.replace(/^```json|^```|```$/gm, '').trim();
          resolve(JSON.parse(clean));
        } catch(e) {
          reject(new Error('Parse error for ' + persona + ': ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

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

      var rant = parsed.freetext || '';
      if (!rant.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Nothing to respond to!' }));
        return;
      }

      Promise.all([
        callClaude('bhuvan', rant),
        callClaude('chitra', rant),
        callClaude('sanket', rant)
      ]).then(function(results) {
        var count = incrementCount();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          bhuvan: results[0],
          chitra: results[1],
          sanket: results[2],
          count: count
        }));
      }).catch(function(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, function() {
  console.log('Chai Tapri v3 running on port ' + PORT);
});
