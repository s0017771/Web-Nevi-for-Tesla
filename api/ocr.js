// Vercel serverless function: business-card OCR via Claude.
// The API key is read from the ANTHROPIC_API_KEY environment variable —
// set it in Vercel → Settings → Environment Variables. Never hardcode it here.
//
// POST /api/ocr  body: { "image": "<base64>", "media_type": "image/jpeg" }
// returns: { ok: true, card: { name, company, ... } }  or  { ok: false, error }

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name:       { type: 'string', description: '이름 (명함의 원래 언어 그대로)' },
    name_en:    { type: 'string', description: '영문 이름 (있으면)' },
    title:      { type: 'string', description: '직함/직책' },
    company:    { type: 'string', description: '회사명' },
    department: { type: 'string', description: '부서' },
    phone:      { type: 'string', description: '대표/유선 전화' },
    mobile:     { type: 'string', description: '휴대전화' },
    fax:        { type: 'string', description: '팩스' },
    email:      { type: 'string', description: '이메일' },
    website:    { type: 'string', description: '웹사이트/URL' },
    address:    { type: 'string', description: '주소' },
    raw_text:   { type: 'string', description: '명함에 보이는 전체 텍스트 원문' },
  },
  required: ['name', 'name_en', 'title', 'company', 'department', 'phone',
             'mobile', 'fax', 'email', 'website', 'address', 'raw_text'],
};

const PROMPT =
  '이 이미지는 명함입니다. 명함에 적힌 정보를 정확히 읽어(OCR) 각 항목에 채워 넣으세요. ' +
  '이름은 명함에 적힌 원래 언어 그대로 쓰고, 별도의 영문 표기가 있으면 name_en에 넣으세요. ' +
  '해당 항목이 명함에 없으면 빈 문자열("")로 두세요. 전화·팩스·휴대전화는 구분해서 넣고, ' +
  '보이는 모든 텍스트는 raw_text에 원문 그대로 넣으세요. 추측하지 말고 보이는 것만 적으세요.';

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return req.body;
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST만 지원합니다.' });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({
      ok: false, error: 'no_api_key',
      message: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. Vercel → Settings → Environment Variables에서 추가한 뒤 재배포하세요.',
    });
    return;
  }

  const body = await readBody(req);
  let image = body.image || '';
  let mediaType = body.media_type || 'image/jpeg';
  // Accept a full data URL too, e.g. "data:image/png;base64,AAAA..."
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(image);
  if (m) { mediaType = m[1]; image = m[2]; }
  if (!image) {
    res.status(400).json({ ok: false, error: '이미지가 없습니다.' });
    return;
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema: CARD_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      res.status(502).json({ ok: false, error: 'claude_error', status: apiRes.status, message: detail.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();
    if (data.stop_reason === 'refusal') {
      res.status(200).json({ ok: false, error: 'refusal', message: '이미지를 처리할 수 없습니다.' });
      return;
    }
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      res.status(502).json({ ok: false, error: 'no_content' });
      return;
    }
    let card;
    try { card = JSON.parse(textBlock.text); }
    catch { res.status(502).json({ ok: false, error: 'parse_failed', message: textBlock.text.slice(0, 500) }); return; }

    res.status(200).json({ ok: true, card, usage: data.usage || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: String(e && e.message || e) });
  }
}
