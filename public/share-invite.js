(function (global) {
  'use strict';

  var RETURN_KEY = 'sa_share_return';
  var INTENT_KEY = 'sa_share_intent';

  function safePath(value) {
    var text = String(value || '');
    if (text.indexOf('\\') >= 0 || text.indexOf('://') >= 0 || text.indexOf('//') >= 0) return '';
    var cut = text.indexOf('?');
    var path = cut >= 0 ? text.slice(0, cut) : text;
    var query = cut >= 0 ? text.slice(cut) : '';
    var post = /^\/(kr|us)\/posts\/[0-9a-f-]{36}$/i.test(path);
    var invite = /^\/(kr|us)\/invite\/[A-Za-z0-9_-]{8,32}$/.test(path);
    if (!post && !invite) return '';
    if (query && !/^\?s=[A-Za-z0-9_-]{8,32}$/.test(query)) query = '';
    return path + query;
  }

  function remember(path, intent) {
    var safe = safePath(path);
    if (!safe) return;
    try {
      sessionStorage.setItem(RETURN_KEY, safe);
      if (intent === 'comment' || intent === 'react' || intent === 'follow') {
        sessionStorage.setItem(INTENT_KEY, intent);
      }
    } catch (_) {}
  }

  global.saConsumeShareReturn = function () {
    var saved = '';
    try { saved = sessionStorage.getItem(RETURN_KEY) || ''; } catch (_) {}
    var safe = safePath(saved);
    if (!safe) return '';
    try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {}
    if (global.location.pathname === safe.split('?')[0]) return '';
    return safe;
  };

  function token() {
    try { return sessionStorage.getItem('sa_local_beta_token') || ''; } catch (_) { return ''; } }
  function setToken(value, userId) {
    try {
      sessionStorage.setItem('sa_local_beta_token', value);
      if (userId) sessionStorage.setItem('sa_local_beta_user', userId);
    } catch (_) {}
  }
  function rememberCountry(region) {
    var country = region === 'US' ? 'US' : 'KR';
    document.cookie = 'sa_ar=' + country + '; Path=/; SameSite=Lax';
    document.cookie = 'sa_ar_x=1; Path=/; SameSite=Lax';
  }
  function existingFollow(targetId) {
    var id = String(targetId || '').trim();
    if (!id || !global.FollowSystem || typeof global.FollowSystem.toggleFollow !== 'function') return false;
    var saved = '';
    try { saved = sessionStorage.getItem('sa_local_beta_user') || ''; } catch (_) {}
    if (saved && (!global.__scPlayer || !global.__scPlayer.userId)) global.__scPlayer = { userId: saved };
    var result = global.FollowSystem.toggleFollow(id);
    return !!(result && result.ok && result.following);
  }
  function intent() {
    try { return sessionStorage.getItem(INTENT_KEY) || ''; } catch (_) { return ''; } }

  function page() {
    var path = global.location.pathname || '';
    var post = path.match(/^\/(kr|us)\/posts\/([0-9a-f-]{36})$/i);
    var invite = path.match(/^\/(kr|us)\/invite\/([A-Za-z0-9_-]{8,32})$/);
    var code = '';
    try { code = new URLSearchParams(global.location.search).get('s') || ''; } catch (_) {}
    if (post) return { kind: 'post', region: post[1].toUpperCase(), id: post[2], code: code };
    if (invite) return { kind: 'invite', region: invite[1].toUpperCase(), code: invite[2] };
    return null;
  }

  function boardPath(region) {
    return region === 'US' ? '/us' : '/kr';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function toast(message) {
    if (typeof global.showScShareToast === 'function') global.showScShareToast(message);
  }

  function authHeader() {
    var value = token();
    return value ? { Authorization: 'Bearer ' + value, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async function copyOrShare(url, title) {
    if (navigator.share) {
      try {
        await navigator.share({ title: title || 'SentenceArena', url: url });
        toast('공유했습니다.');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          toast('공유를 취소했습니다.');
          return;
        }
      }
    }
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch (_) { ok = false; }
    toast(ok ? '링크가 복사되었습니다.' : '링크 복사에 실패했습니다.');
  }

  function currentRegion() {
    return (global.location.pathname || '').indexOf('/us') === 0 ? 'US' : 'KR';
  }

  function openShareSheet(opts) {
    var region = opts && opts.region === 'US' ? 'US' : 'KR';
    var us = region === 'US';
    var url = opts && opts.url ? String(opts.url) : '';
    var code = opts && opts.code ? String(opts.code) : '';
    var old = document.getElementById('sa-share-sheet');
    if (old) old.remove();
    var sheet = el('div', 'sa-share-sheet');
    sheet.id = 'sa-share-sheet';
    var card = el('div', 'sa-share-sheet__card sc-card');
    card.appendChild(el('h2', '', us ? 'Share' : '공유하기'));
    function button(label, fn) {
      var b = el('button', 'sc-btn', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      card.appendChild(b);
    }
    if (us) {
      button('X', function () {
        global.open('https://twitter.com/intent/tweet?url=' + encodeURIComponent(url), '_blank', 'noopener');
      });
      button('WhatsApp', function () {
        global.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank', 'noopener');
      });
      button('Messenger', function () { copyOrShare(url, 'SentenceArena'); });
    } else {
      button('카카오톡', function () { copyOrShare(url, 'SentenceArena'); });
    }
    button(us ? 'Copy link' : '링크 복사', function () { copyOrShare(url, 'SentenceArena'); });
    if (code) {
      var shown = el('p', 'sa-share-code', (us ? 'Referral code: ' : '추천인 코드: ') + code);
      shown.id = 'sa-share-code';
      card.appendChild(shown);
      button(us ? 'Copy referral code' : '추천인 코드 복사', function () { copyOrShare(code, 'SentenceArena'); });
    }
    button(us ? 'Close' : '닫기', function () { sheet.remove(); });
    sheet.addEventListener('click', function (ev) {
      if (ev.target === sheet) sheet.remove();
    });
    sheet.appendChild(card);
    document.body.appendChild(sheet);
  }

  function issueInvite() {
    var region = currentRegion();
    if (!token()) {
      toast(region === 'US' ? 'Log in to create an invite link.' : '로그인 후 초대 링크를 만들 수 있습니다.');
      return;
    }
    fetch('/api/invite-links', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeader(),
      body: JSON.stringify({ region: region }),
    }).then(function (res) { return res.json(); }).then(function (body) {
      if (!body || !body.url) {
        toast(region === 'US' ? 'The invite link could not be created.' : '초대 링크를 만들지 못했습니다.');
        return;
      }
      var code = '';
      var path = String(body.path || body.url);
      var parts = path.split('/').filter(Boolean);
      code = parts.length ? parts[parts.length - 1] : '';
      openShareSheet({ url: body.url, code: code, region: body.region || region });
    }).catch(function () {
      toast(region === 'US' ? 'The invite link could not be created.' : '초대 링크를 만들지 못했습니다.');
    });
  }

  function mountMenu() {
    var bug = document.getElementById('app-tab-bug');
    var btn = document.getElementById('sa-invite-menu');
    if (!bug) return;
    if (!btn) {
      btn = el('a', '', currentRegion() === 'US' ? 'Invite Friends' : '친구초대');
      btn.id = 'sa-invite-menu';
      btn.href = '#';
      btn.setAttribute('data-sa-i18n', 'tab-invite');
    }
    if (btn.getAttribute('data-invite-bound') !== '1') {
      btn.setAttribute('data-invite-bound', '1');
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        issueInvite();
      });
    }
    if (btn.previousElementSibling !== bug) bug.insertAdjacentElement('afterend', btn);
    var label = currentRegion() === 'US' ? 'Invite Friends' : '친구초대';
    if (btn.textContent !== label) btn.textContent = label;
  }

  function loginBox(host, here, intentName) {
    var box = el('div', 'sa-public-read__auth');
    var note = el('p', 'sa-public-read__note', here.region === 'US'
      ? 'Log in or join to continue. You will come back to this page.'
      : '로그인하거나 가입하면 이 화면으로 돌아옵니다.');
    box.appendChild(note);
    var email = el('input');
    email.type = 'email';
    email.placeholder = 'email';
    email.setAttribute('autocomplete', 'username');
    var password = el('input');
    password.type = 'password';
    password.placeholder = 'password';
    var name = el('input');
    name.placeholder = here.region === 'US' ? 'Public nickname' : '공개 닉네임';
    var age = el('input');
    age.type = 'checkbox';
    var ageLabel = el('label', '', here.region === 'US' ? ' I am 18 or older' : ' 만 14세 이상입니다');
    ageLabel.prepend(age);
    box.appendChild(email);
    box.appendChild(password);
    box.appendChild(name);
    box.appendChild(ageLabel);
    var referral = null;
    if (here.kind === 'invite') {
      referral = el('input');
      referral.id = 'sa-referral-code';
      referral.placeholder = here.region === 'US' ? 'Referral code (optional)' : '추천인 코드 (선택)';
      referral.value = here.code || '';
      box.appendChild(referral);
    }
    function afterAuth() {
      try { sessionStorage.setItem(INTENT_KEY, intentName || intent()); } catch (_) {}
      global.location.reload();
    }
    var login = el('button', 'sc-btn sc-btn--primary', here.region === 'US' ? 'Log in' : '로그인');
    login.type = 'button';
    login.addEventListener('click', function () {
      remember(global.location.pathname + global.location.search, intentName);
      fetch('/api/local-session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, password: password.value }),
      }).then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
        .then(function (result) {
          if (!result.body || !result.body.token) {
            note.textContent = here.region === 'US' ? 'Login failed.' : '로그인에 실패했습니다.';
            return;
          }
          setToken(result.body.token, result.body.userId);
          afterAuth();
        });
    });
    var signup = el('button', 'sc-btn', here.region === 'US' ? 'Join' : '가입');
    signup.type = 'button';
    signup.addEventListener('click', function () {
      remember(global.location.pathname + global.location.search, intentName);
      var typed = referral ? String(referral.value || '').trim() : '';
      var payload = {
        email: email.value,
        password: password.value,
        displayName: name.value,
        region: here.region,
      };
      if (here.kind === 'invite' && typed) {
        payload.referralCode = typed;
        payload.pathKind = 'invite';
        payload.code = typed;
      } else if (here.kind !== 'invite' && here.code) {
        payload.pathKind = 'share';
        payload.code = here.code;
      }
      if (here.region === 'US') payload.confirmAge18 = age.checked === true;
      else payload.confirmAge14 = age.checked === true;
      fetch('/api/local-session/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
        .then(function (result) {
          if (result.status === 409) {
            note.textContent = here.region === 'US'
              ? 'This email already has an account. Log in instead.'
              : '이미 가입한 이메일입니다. 로그인해 주세요.';
            return;
          }
          if (result.body && (result.body.error === 'REFERRAL_CODE_INVALID' || result.body.error === 'SELF_REFERRAL')) {
            note.textContent = result.body.error === 'SELF_REFERRAL'
              ? (here.region === 'US'
                ? 'You cannot use your own code. You can join without it.'
                : '자기 추천인 코드는 쓸 수 없습니다. 코드 없이 가입할 수 있습니다.')
              : (here.region === 'US'
                ? 'That code could not be confirmed. You can join without it.'
                : '추천인 코드를 확인하지 못했습니다. 코드 없이 가입할 수 있습니다.');
            if (referral) referral.value = '';
            return;
          }
          if (!result.body || !result.body.token) {
            note.textContent = (result.body && result.body.error) || (here.region === 'US' ? 'Sign up failed.' : '가입에 실패했습니다.');
            return;
          }
          setToken(result.body.token, result.body.userId);
          afterAuth();
        });
    });
    var browse = el('a', 'sc-btn', here.region === 'US' ? 'Look around' : '둘러보기');
    browse.href = boardPath(here.region);
    box.appendChild(login);
    box.appendChild(signup);
    box.appendChild(browse);
    var oauth = el('button', 'sc-btn', here.region === 'US' ? 'Existing social login' : '기존 소셜 로그인');
    oauth.type = 'button';
    oauth.addEventListener('click', function () {
      remember(global.location.pathname + global.location.search, intentName);
      if (global.ScAuth && typeof global.ScAuth.login === 'function') global.ScAuth.login('google');
      else note.textContent = here.region === 'US' ? 'Social login is not available here.' : '이 화면에서는 소셜 로그인을 시작할 수 없습니다.';
    });
    box.appendChild(oauth);
    host.appendChild(box);
    return box;
  }

  function unavailable(host, here, message, region) {
    host.appendChild(el('h1', '', message));
    var link = el('a', 'sc-btn', region === 'US' ? 'Open the US board' : '한국 공개 게시판으로');
    link.href = boardPath(region || here.region);
    host.appendChild(link);
  }

  async function renderPost(host, here) {
    var res = await fetch('/api/public/posts/' + encodeURIComponent(here.id) + '?region=' + here.region + (here.code ? '&s=' + encodeURIComponent(here.code) : ''));
    var body = await res.json();
    if (!body || body.ok !== true) {
      var target = body && body.region ? body.region : here.region;
      var message = body && body.error === 'COUNTRY_MISMATCH'
        ? (target === 'US' ? 'This post belongs to the United States.' : '이 글은 한국 게시판의 글입니다.')
        : (here.region === 'US' ? 'This post is not available.' : '이 글을 볼 수 없습니다.');
      unavailable(host, here, message, target);
      return;
    }
    var post = body.post;
    host.appendChild(el('p', '', post.region + ' · ' + (post.territory || '') + ' · board ' + (post.boardStage || 1)));
    host.appendChild(el('h1', '', post.title || ''));
    host.appendChild(el('p', '', post.authorName || ''));
    host.appendChild(el('p', '', post.content || ''));
    host.appendChild(el('p', '', (here.region === 'US' ? 'Reactions ' : '반응 ') + (post.reactions.positive || 0)));
    (post.comments || []).forEach(function (comment) {
      host.appendChild(el('p', '', (comment.authorName || '') + ': ' + (comment.content || '')));
    });
    var actions = el('div', 'sa-public-read__actions');
    function shareAction(mode) {
      return function () {
      if (!token()) {
        if (here.code) {
          if (mode === 'copy') copyOrShare(global.location.href, post.title);
          else openShareSheet({ url: global.location.href, region: here.region });
          return;
        }
        toast(here.region === 'US' ? 'Log in to create a share link.' : '로그인 후 이 글의 공유 링크를 만들 수 있습니다.');
        return;
      }
      fetch('/api/share-links', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeader(),
        body: JSON.stringify({ postId: post.id }),
      }).then(function (res) { return res.json(); }).then(function (body) {
        if (!body || !body.url) {
          toast(body && body.error === 'POST_UNAVAILABLE'
            ? (here.region === 'US' ? 'Only a public post can be shared.' : '공개 중인 글만 공유할 수 있습니다.')
            : (here.region === 'US' ? 'The share link could not be created.' : '공유 링크를 만들지 못했습니다.'));
          return;
        }
        if (mode === 'copy') copyOrShare(body.url, post.title);
        else openShareSheet({ url: body.url, region: here.region });
      }).catch(function () {
        toast(here.region === 'US' ? 'The share link could not be created.' : '공유 링크를 만들지 못했습니다.');
      });
      };
    }
    var share = el('button', 'sc-btn', here.region === 'US' ? 'Share' : '공유하기');
    share.type = 'button';
    share.addEventListener('click', shareAction('sheet'));
    var copy = el('button', 'sc-btn', here.region === 'US' ? 'Copy link' : '링크복사');
    copy.type = 'button';
    copy.addEventListener('click', shareAction('copy'));
    actions.appendChild(share);
    actions.appendChild(copy);
    var react = el('button', 'sc-btn', here.region === 'US' ? 'React' : '반응');
    react.type = 'button';
    var commentBtn = el('button', 'sc-btn', here.region === 'US' ? 'Comment' : '댓글');
    commentBtn.type = 'button';
    var follow = el('button', 'sc-btn', here.region === 'US' ? 'Follow author' : '작성자 팔로우');
    follow.type = 'button';
    actions.appendChild(react);
    actions.appendChild(commentBtn);
    if (post.authorId) actions.appendChild(follow);
    host.appendChild(actions);
    var composer = el('textarea');
    composer.hidden = true;
    host.appendChild(composer);
    async function blocked() {
      if (here.region !== 'US' || !token()) return false;
      var check = await fetch('/api/public/participation?region=US', { headers: authHeader() });
      var data = await check.json();
      if (data && data.write === false) {
        var youth = data.reason === 'US_PARTICIPATION_READ_ONLY';
        unavailable(host, here, youth
          ? (here.region === 'US'
            ? 'Korean accounts aged 14 to 17 can only read the United States area.'
            : '한국 만 14~17세 계정은 미국 영역을 읽기만 할 수 있습니다.')
          : (here.region === 'US'
            ? 'United States participation needs a confirmed 18+ qualification.'
            : '미국 참여는 확인된 만 18세 자격이 있어야 합니다.'), 'US');
        return true;
      }
      return false;
    }
    async function ensure(intentName) {
      if (!token()) {
        remember(global.location.pathname + global.location.search, intentName);
        loginBox(host, here, intentName);
        return false;
      }
      if (await blocked()) return false;
      return true;
    }
    commentBtn.addEventListener('click', async function () {
      if (!(await ensure('comment'))) return;
      composer.hidden = false;
      composer.focus();
    });
    var send = el('button', 'sc-btn sc-btn--primary', here.region === 'US' ? 'Post comment' : '댓글 등록');
    send.type = 'button';
    send.hidden = true;
    send.addEventListener('click', async function () {
      if (!(await ensure('comment'))) return;
      var result = await fetch('/api/board/posts/' + encodeURIComponent(post.id) + '/comments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeader(),
        body: JSON.stringify({ content: composer.value, territory: post.territory }),
      });
      var data = await result.json();
      if (!result.ok) {
        host.appendChild(el('p', '', data && data.error === 'US_PARTICIPATION_READ_ONLY'
          ? '한국 만 14~17세 계정은 미국 영역을 읽기만 할 수 있습니다.'
          : (data && data.error === 'US_AGE_UNVERIFIED'
            ? (here.region === 'US'
              ? 'United States participation needs a confirmed 18+ qualification.'
              : '미국 참여는 확인된 만 18세 자격이 있어야 합니다.')
            : ((data && data.error) || '댓글을 남기지 못했습니다.'))));
        return;
      }
      try { sessionStorage.removeItem(INTENT_KEY); } catch (_) {}
      global.location.reload();
    });
    host.appendChild(send);
    react.addEventListener('click', async function () {
      if (!(await ensure('react'))) return;
      var result = await fetch('/api/board/posts/' + encodeURIComponent(post.id) + '/empathy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeader(),
      });
      var data = await result.json();
      host.appendChild(el('p', '', result.ok ? (here.region === 'US' ? 'Reaction saved.' : '반응을 남겼습니다.') : ((data && data.error) || '반응을 남기지 못했습니다.')));
      if (result.ok) { try { sessionStorage.removeItem(INTENT_KEY); } catch (_) {} }
    });
    follow.addEventListener('click', async function () {
      if (!(await ensure('follow'))) return;
      rememberCountry(here.region);
      var result = await fetch('/api/users/' + encodeURIComponent(post.authorId) + '/follow/toggle', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeader(),
        body: '{}',
      });
      var data = await result.json();
      if (result.ok) existingFollow(post.authorId);
      host.appendChild(el('p', '', result.ok
        ? (here.region === 'US' ? 'Follow updated. It is not automatic.' : '팔로우를 반영했습니다. 자동으로 연결하지 않습니다.')
        : ((data && data.error) || (here.region === 'US' ? 'Follow was not changed.' : '팔로우를 바꾸지 못했습니다.'))));
    });
    if (token() && intent() === 'comment') {
      composer.hidden = false;
      send.hidden = false;
      composer.focus();
    } else if (token()) {
      send.hidden = false;
    }
  }

  async function renderInvite(host, here) {
    var res = await fetch('/api/public/invites/' + encodeURIComponent(here.code) + '?region=' + here.region);
    var body = await res.json();
    if (!body || body.ok !== true) {
      var target = body && body.region ? body.region : here.region;
      unavailable(host, here, body && body.error === 'COUNTRY_MISMATCH'
        ? (target === 'US' ? 'This invite is for the United States.' : '이 초대는 한국 초대입니다.')
        : (here.region === 'US' ? 'This invite code is not valid.' : '초대 코드를 찾을 수 없습니다.'), target);
      return;
    }
    host.appendChild(el('h1', '', here.region === 'US' ? 'You are invited to SentenceArena' : '센텐스아레나에 초대합니다'));
    host.appendChild(el('p', '', (body.nickname || '') + (here.region === 'US' ? ' invited you.' : ' 님이 초대했습니다.')));
    host.appendChild(el('p', '', here.region === 'US'
      ? 'Sentences build territories. You can read the United States public boards.'
      : '문장이 영토를 만듭니다. 한국 공개 게시판을 둘러볼 수 있습니다.'));
    if (token()) {
      host.appendChild(el('p', '', here.region === 'US'
        ? 'You already have an account. Joining again is not a new signup.'
        : '이미 가입한 계정입니다. 다시 가입해도 신규 회원이 되지 않습니다.'));
      var follow = el('button', 'sc-btn', here.region === 'US' ? 'Follow inviter' : '초대자 팔로우');
      follow.type = 'button';
      follow.addEventListener('click', async function () {
        var targetRes = await fetch('/api/invites/' + encodeURIComponent(here.code) + '/follow-target?region=' + here.region, { headers: authHeader() });
        var targetBody = await targetRes.json();
        if (!targetBody || !targetBody.target) return;
        rememberCountry(here.region);
        var result = await fetch('/api/users/' + encodeURIComponent(targetBody.target.userId) + '/follow/toggle', {
          method: 'POST', credentials: 'same-origin', headers: authHeader(), body: '{}',
        });
        var data = await result.json();
        if (result.ok) existingFollow(targetBody.target.userId);
        host.appendChild(el('p', '', result.ok
          ? (here.region === 'US' ? 'Follow updated. It is not automatic.' : '팔로우를 반영했습니다. 자동으로 연결하지 않습니다.')
          : ((data && data.error) || (here.region === 'US' ? 'Follow was not changed.' : '팔로우를 바꾸지 못했습니다.'))));
      });
      host.appendChild(follow);
      var back = el('a', 'sc-btn', here.region === 'US' ? 'Open the US board' : '한국 공개 게시판');
      back.href = boardPath(here.region);
      host.appendChild(back);
      return;
    }
    loginBox(host, here, 'follow');
  }

  global.saSharePost = function (shareTarget, mode) {
    var region = currentRegion();
    var postId = shareTarget && shareTarget.postId ? String(shareTarget.postId) : '';
    if (!postId || !token()) {
      toast(region === 'US' ? 'Log in to share this post.' : '로그인 후 이 글의 공유 링크를 만들 수 있습니다.');
      return;
    }
    fetch('/api/share-links', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeader(),
      body: JSON.stringify({ postId: postId }),
    }).then(function (res) { return res.json(); }).then(function (body) {
      if (!body || !body.url) {
        toast(body && body.error === 'POST_UNAVAILABLE'
          ? (region === 'US' ? 'Only a public post can be shared.' : '공개 중인 글만 공유할 수 있습니다.')
          : (region === 'US' ? 'The share link could not be created.' : '공유 링크를 만들지 못했습니다.'));
        return;
      }
      if (mode === 'copy') copyOrShare(body.url, 'SentenceArena');
      else openShareSheet({ url: body.url, region: region });
    }).catch(function () {
      toast(region === 'US' ? 'The share link could not be created.' : '공유 링크를 만들지 못했습니다.');
    });
  };

  function boot() {
    mountMenu();
    var here = page();
    if (!here) return;
    var login = document.getElementById('view-login');
    if (login) login.hidden = true;
    var localLogin = document.getElementById('local-beta-login');
    if (localLogin) {
      localLogin.hidden = true;
      localLogin.style.display = 'none';
    }
    var app = document.getElementById('view-app');
    if (app) app.hidden = true;
    var sheet = document.getElementById('sa-public-read');
    if (!sheet) {
      sheet = el('div', 'sa-public-read');
      sheet.id = 'sa-public-read';
      document.body.appendChild(sheet);
    }
    var card = el('div', 'sa-public-read__card sc-card');
    sheet.appendChild(card);
    var run = here.kind === 'invite' ? renderInvite(card, here) : renderPost(card, here);
    run.catch(function () {
      unavailable(card, here, here.region === 'US' ? 'The page could not be opened.' : '화면을 열지 못했습니다.', here.region);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.setInterval(function () {
    mountMenu();
    if (!page()) return;
    var login = document.getElementById('view-login');
    if (login) login.hidden = true;
    var localLogin = document.getElementById('local-beta-login');
    if (localLogin) {
      localLogin.hidden = true;
      localLogin.style.display = 'none';
    }
  }, 500);
})(typeof window !== 'undefined' ? window : globalThis);
