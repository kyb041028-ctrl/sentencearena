#!/usr/bin/env node
'use strict';
/**
 * Local verification server for alien moderation V1 (port 3019).
 * Does not replace the user's :3000 process. Memory only — no production DB writes.
 */

const path = require('path');
const express = require('express');
const { createBoardRouter } = require('../server/board-routes');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const alienRoutes = require('../server/alien-moderation-routes');
const alienService = require('../server/alien-moderation-service');
const alienMem = require('../server/alien-moderation-memory-repository');
const evoRoutes = require('../server/territory-evolution-routes');
const evoService = require('../server/territory-evolution-service');
const popAdapter = require('../server/territory-population-adapter');
const popMem = require('../server/territory-population-memory-repository');
const popSupa = require('../server/territory-population-supabase-repository');

const PORT = 3019;
const TARGET = '00000000-0000-4000-8000-000000000001';
const REPORTER_A = '00000000-0000-4000-8000-000000000011';
const REPORTER_B = '00000000-0000-4000-8000-000000000012';
const REPORTER_C = '00000000-0000-4000-8000-000000000013';
const REPORTER_OTHER = '00000000-0000-4000-8000-000000000014';

function createFakeProfilesClient(members) {
  return {
    from: function () {
      const state = { eq: {}, neq: {} };
      const q = {
        select: function () { return q; },
        eq: function (col, val) { state.eq[col] = val; return q; },
        neq: function (col, val) { state.neq[col] = val; return q; },
        then: function (resolve, reject) {
          let rows = members.slice();
          Object.keys(state.eq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] === state.eq[col]; });
          });
          Object.keys(state.neq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] !== state.neq[col]; });
          });
          return Promise.resolve({ count: rows.length, error: null, data: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

async function main() {
  alienMem._reset();
  alienService.setRepository(alienMem);
  alienService.setV1Enabled(true);
  alienMem._seedState(TARGET, {
    earthTerritory: 'PIONEER',
    citizenshipStatus: 'CITIZEN',
  });

  const boardRepo = createBoardMemoryRepository();
  alienService.setBoardReportReader(boardRepo);
  const territories = {};
  territories[TARGET] = 'PIONEER';
  territories[REPORTER_A] = 'CENTRAL';
  territories[REPORTER_B] = 'CENTRAL';
  territories[REPORTER_C] = 'CENTRAL';
  territories[REPORTER_OTHER] = 'CENTRAL';
  const userContext = createMockUserContextAdapter({ defaultTerritory: 'CENTRAL', territories: territories });
  const onReportCreated = function (row) {
    return alienService.onReportCreated(row);
  };

  const members = [];
  function add(territory, citizenship, n) {
    for (let i = 0; i < n; i++) members.push({ territory: territory, citizenship_status: citizenship });
  }
  add('PIONEER', 'CITIZEN', 4);
  add('CENTRAL', 'CITIZEN', 6);
  add('GUARDIAN', 'CITIZEN', 2);
  add('CENTRAL', 'KANTAPBIYA_RESIDENT', 1);
  popSupa.setAdminClient(createFakeProfilesClient(members));
  popSupa.invalidateEarthCountCache();
  popAdapter.setRepository(popSupa);
  popAdapter.setDataMode('API_OPERATIONAL');
  evoService.setDataMode('API_OPERATIONAL');

  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter({
    useMemory: true,
    operational: true,
    repository: boardRepo,
    userContext: userContext,
    onReportCreated: onReportCreated,
    resolveActorFromRequest: async function (req) {
      const h = String(req.headers.authorization || '');
      const m = h.match(/^Bearer\s+user:(.+)$/i);
      if (m) return { userId: m[1].trim() };
      if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
      return null;
    },
  }));
  app.use('/api', alienRoutes);
  app.use(
    '/api/admin/moderation',
    alienRoutes.mountAdminRoutes({
      adminBypass: true,
      getBoardService: function () {
        return createBoardService({
          repository: boardRepo,
          userContext: userContext,
          operational: true,
          onReportCreated: onReportCreated,
        });
      },
    }),
  );
  app.use('/api', evoRoutes);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const board = createBoardService({
    repository: boardRepo,
    userContext: userContext,
    operational: true,
    onReportCreated: onReportCreated,
  });
  const post = await board.createPost({ userId: TARGET }, {
    title: '검증용 게시글 제목입니다',
    content: '브라우저 신고 검증을 위한 본문입니다. 충분히 긴 내용.',
    isAnonymous: false,
  });
  const otherPost = await board.createPost({ userId: TARGET }, {
    title: '기타신고 검증용 게시글 제목',
    content: '운영자 즉시 외계행 검증을 위한 본문입니다.',
    isAnonymous: false,
  });

  app.get('/verify/alien-report.html', function (_req, res) {
    res.type('html').send(
      '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Alien report verify</title></head><body>' +
        '<h1>신고 UI</h1>' +
        '<form id="report-form">' +
        '<label><input type="radio" name="reason" value="abuse" checked> 욕설 / 인신공격</label>' +
        '<label><input type="radio" name="reason" value="spam"> 도배 / 광고</label>' +
        '<label><input type="radio" name="reason" value="other"> 기타</label>' +
        '<textarea id="detail" maxlength="300"></textarea>' +
        '<button id="submit-report" type="submit">신고</button>' +
        '</form>' +
        '<button id="submit-other" type="button">기타신고</button>' +
        '<ul id="sc-notification-list"></ul>' +
        '<p id="sc-alien-status-banner" hidden data-citizenship="CITIZEN"></p>' +
        '<pre id="evo-hud"></pre>' +
        '<script>window.__VERIFY_POST=' + JSON.stringify(post.post.id) +
        ';window.__VERIFY_OTHER_POST=' + JSON.stringify(otherPost.post.id) +
        ';window.__VERIFY_TARGET=' + JSON.stringify(TARGET) +
        ';window.__VERIFY_REPORTER=' + JSON.stringify(REPORTER_A) +
        ';</script>' +
        '<script src="/verify/alien-report-client.js"></script>' +
        '</body></html>'
    );
  });

  app.get('/verify/alien-report-client.js', function (_req, res) {
    res.type('js').send(clientJs());
  });

  app.get('/verify/admin.html', function (_req, res) {
    res.type('html').send(
      '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>admin verify</title></head><body>' +
        '<script>location.replace("/admin/moderation/");</script></body></html>'
    );
  });

  app.listen(PORT, '127.0.0.1', function () {
    console.log(JSON.stringify({
      ok: true,
      port: PORT,
      reportUrl: 'http://127.0.0.1:' + PORT + '/verify/alien-report.html',
      adminUrl: 'http://127.0.0.1:' + PORT + '/admin/moderation/',
      postId: post.post.id,
      otherPostId: otherPost.post.id,
      target: TARGET,
      reporter: REPORTER_A,
      reporterOther: REPORTER_OTHER,
    }));
  });
}

function clientJs() {
  return [
    '(function(){',
    'var postId=window.__VERIFY_POST;',
    'var otherPost=window.__VERIFY_OTHER_POST;',
    'var reporter=window.__VERIFY_REPORTER;',
    'var target=window.__VERIFY_TARGET;',
    'function headers(uid){return {"Content-Type":"application/json","Authorization":"Bearer user:"+uid,"x-user-id":uid};}',
    'function addNoti(n){var ul=document.getElementById("sc-notification-list");var li=document.createElement("li");li.setAttribute("data-type",n.type);li.textContent=(n.title||"")+" "+(n.message||"");ul.appendChild(li);}',
    'function refreshTarget(){',
    'fetch("/api/alien/moderation/inbox",{headers:headers(target)}).then(function(r){return r.json()}).then(function(d){',
    'document.getElementById("sc-notification-list").textContent="";',
    '(d.notifications||[]).forEach(addNoti);',
    '});',
    'fetch("/api/alien/moderation/status",{headers:headers(target)}).then(function(r){return r.json()}).then(function(d){',
    'var b=document.getElementById("sc-alien-status-banner");',
    'if(d.state){var alien=d.state.citizenshipStatus==="KANTAPBIYA_RESIDENT";b.hidden=!alien;b.setAttribute("data-citizenship",d.state.citizenshipStatus||"CITIZEN");b.textContent=alien?("외계행성 소속 "+(d.state.returnPolicy||"")):"";}',
    '});',
    'fetch("/api/territories/evolution").then(function(r){return r.json()}).then(function(d){',
    'document.getElementById("evo-hud").textContent=JSON.stringify(d.directCounts||d.data&&d.data.directCounts||d,null,2);',
    '});',
    '}',
    'document.getElementById("report-form").addEventListener("submit",function(ev){',
    'ev.preventDefault();',
    'var reason=document.querySelector("input[name=reason]:checked").value;',
    'fetch("/api/board/reports",{method:"POST",headers:headers(reporter),body:JSON.stringify({targetType:"POST",targetId:postId,reasonCode:reason,reasonDetail:document.getElementById("detail").value||null})})',
    '.then(function(r){return r.json()}).then(function(){refreshTarget();});',
    '});',
    'document.getElementById("submit-other").addEventListener("click",function(){',
    'fetch("/api/board/reports",{method:"POST",headers:headers("' + REPORTER_OTHER + '"),body:JSON.stringify({targetType:"POST",targetId:otherPost,reasonCode:"other",reasonDetail:"운영 확인"})})',
    '.then(function(r){return r.json()}).then(function(){refreshTarget();});',
    '});',
    'refreshTarget();',
    '})();',
  ].join('\n');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
