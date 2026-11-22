'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./share-invite-store');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const KR_IMAGE = '/assets/territory-evolution/territory-evolution-central-kr-1-primitive.png';
const US_IMAGE = '/assets/territory-evolution/territory-evolution-central-en-1-primitive.png';

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function imageFor(region) {
  const rel = region === 'US' ? US_IMAGE : KR_IMAGE;
  const file = path.join(__dirname, '..', 'public', rel);
  return fs.existsSync(file) ? rel : '';
}

function sendHtml(res, html) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

async function send(req, res, query) {
  const region = req.path.indexOf('/us/') === 0 ? 'US' : 'KR';
  const lang = region === 'US' ? 'en' : 'ko';
  const locale = region === 'US' ? 'en_US' : 'ko_KR';
  const site = 'SentenceArena';
  let title = region === 'US' ? 'SentenceArena' : '센텐스아레나';
  let description = region === 'US'
    ? 'Sentences build territories. Debate moves the world.'
    : '문장이 영토를 만들고 토론이 세계를 움직입니다.';
  const origin = req.protocol + '://' + req.get('host');
  const url = origin + req.path;
  if (typeof query === 'function' && req.params.postId) {
    try {
      const preview = await store.publicPreview(query, region, req.params.postId);
      if (preview.available) {
        title = preview.title || title;
        description = preview.description || description;
      } else {
        title = region === 'US' ? 'This post is not public' : '공개되지 않은 글입니다';
        description = region === 'US'
          ? 'The post is unavailable. Open the public board.'
          : '글을 볼 수 없습니다. 공개 게시판으로 이동합니다.';
      }
    } catch (_) {
      title = region === 'US' ? 'This post is not public' : '공개되지 않은 글입니다';
      description = region === 'US' ? 'The post is unavailable.' : '글을 볼 수 없습니다.';
    }
  }
  if (req.params.code && !req.params.postId) {
    title = region === 'US' ? 'You are invited to SentenceArena' : '센텐스아레나에 초대합니다';
    description = region === 'US'
      ? 'See the United States public boards, then join or look around.'
      : '한국 공개 게시판을 보고 가입하거나 둘러볼 수 있습니다.';
  }
  const imagePath = imageFor(region);
  const image = imagePath ? origin + imagePath : '';
  const meta = [
    '<meta name="description" content="' + esc(description) + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:site_name" content="' + esc(site) + '">',
    '<meta property="og:locale" content="' + locale + '">',
    '<meta property="og:type" content="article">',
    image ? '<meta property="og:image" content="' + esc(image) + '">' : '',
  ].filter(Boolean).join('');
  let html = fs.readFileSync(INDEX, 'utf8');
  html = html.replace('<html lang="ko"', '<html lang="' + lang + '"');
  html = html.replace('</head>', meta + '</head>');
  sendHtml(res, html);
}

module.exports = { send: send };
