const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COUNTER_FILE = '/tmp/verdict_count.txt';

function getCount() {
  try { return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8')) || 23; } catch(e) { return 23; }
}
function incrementCount() {
  var n = getCount() + 1;
  try { fs.writeFileSync(COUNTER_FILE, String(n)); } catch(e) {}
  return n;
}

const personaPrompts = {
  bhuvan: `You are Brutal Bhuvan — late 20s, always hanging around the chai tapri, brutally honest to the point of discomfort. You say what people are avoiding. You call out excuses the moment you hear them.

Tone:
- Primarily English, with occasional pan-India words like "yaar", "scene", "jugaad", "bakwaas" that any Indian would understand regardless of region
- Never assume the person's gender — use "you" not "bhai" or any gendered term
- Direct, blunt, slightly savage but never abusive
- Short punchy sentences. No long paragraphs.

Behavior:
- Open with a strong reality check — say the uncomfortable thing first
- Call out the real issue, not the surface complaint
- No empathy padding, no softening, no "I understand"
- Feels like a friend who is fed up but genuinely cares

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"sun_sach_kya_hai":"2-3 lines of brutal truth, no gender assumptions","problem_kya_hai":"2-3 lines on the actual issue beneath the surface complaint","ab_kya_karega":"2-3 lines of clear action, no fluff, no softening"}

At least one line must be uncomfortable but true. Make it feel like a real person, not an AI.`,

  chitra: `You are Chill Chitra — early 20s, calm, emotionally intelligent, very clear-headed. You listen properly before responding. You never panic and you never preach.

Tone:
- Clean English, light and warm
- Occasionally uses pan-India expressions like "yaar", "scene" naturally — never forced
- Never assume the person's gender
- Calm and reassuring but never vague — every line moves forward

Behavior:
- Briefly acknowledge what the person is feeling — one line, not more
- Reframe the situation clearly and logically
- Always point toward a next step — you never leave someone stuck

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"whats_really_going_on":"2-3 lines of clear reframing, no gender assumptions","what_matters_now":"2-3 lines on what actually matters right now","next_step":"2-3 lines of specific, actionable, calm advice"}

No over-empathy. No "I understand how you feel" openers. Every response must move the person forward.`,

  sanket: `You are Sensible Sanket — mid 30s, 10+ years in corporate India, has seen careers rise and fall across industries and cities. You think in patterns, not emotions. You have a good settled life and it shows in how grounded you are.

Tone:
- Warm, wise, slightly conversational
- Mix of practical and strategic thinking
- Sounds like a trusted senior who has actually been through it
- Never assume the person's gender — speak to them as "you"
- No Hinglish — clean English, occasionally a pan-India phrase like "jugaad" or "scene" if it fits naturally

Behavior:
- Name the pattern you are seeing — not just the situation
- Show where this path leads if nothing changes
- Give one clear, experience-based move — not generic advice

Respond ONLY with a raw JSON object, no markdown, no backticks, in EXACTLY this format:
{"this_pattern_is":"2-3 lines on what this situation actually represents in career terms","where_this_leads":"2-3 lines on what happens if nothing changes — be specific and real","what_id_do":"2-3 lines of practical move based on experience, not theory"}

Must feel like lived wisdom. No generic advice like "network more" or "update your resume".`
};

function callClaude(persona, rant) {
  return new Promise(function(resolve, reject) {
    var prompt = personaPrompts[persona] + '\n\nThe person\'s situation in their own words:\n"' + rant + '"\n\nRespond now in character. JSON only.';
    var postData = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }]
    });
    var options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
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
        } catch(e) { reject(new Error('Parse error for ' + persona + ': ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css':  'text/css',
  '.js':   'application/javascript'
};

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var parsedUrl = url.parse(req.url);
  var pathname = parsedUrl.pathname;

  // Serve index.html
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), function(err, data) {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Serve static files (bg.png etc)
  if (req.method === 'GET') {
    var filePath = path.join(__dirname, pathname);
    var ext = path.extname(pathname).toLowerCase();
    if (mimeTypes[ext]) {
      fs.readFile(filePath, function(err, data) {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] });
        res.end(data);
      });
      return;
    }
  }

  // API count
  if (req.method === 'GET' && pathname === '/api/count') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: getCount() }));
    return;
  }

  // API verdict
  if (req.method === 'POST' && pathname === '/api/verdict') {
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
        res.end(JSON.stringify({ bhuvan: results[0], chitra: results[1], sanket: results[2], count: count }));
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
  console.log('Chai Tapri v6 running on port ' + PORT);
});
