'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const special = require('../server/special-achievement-service');
const persist = require('../server/achievement-persist-service');
const evalCore = require('../shared/achievement-evaluation-core');
const defs = require('../shared/achievement-definitions-core');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const source = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

(async () => {
  let checks=0;
  function ok(value) { assert.ok(value); checks++; }
  function browser(region) {
    const context = { location:{pathname:region==='US'?'/us':'/kr'} };
    context.window=context;
    vm.runInNewContext(source('public/achievement-definitions.js'),context);
    return context;
  }
  const kr=browser('KR'),us=browser('US');
  ok(defs.listAchievementKeys().length===12 && new Set(defs.listAchievementKeys()).size===12);
  const originalNames = ['글쓰기 버튼이 눌렸다','한마디 거들겠습니다','내 말 맞지?','시민증 발급 완료','또 왔네, 또 왔어','할 말이 좀 많습니다','댓글에서 뵙겠습니다','나만 그렇게 생각한 거 아니었어','양쪽에서 살아남은 발언','그때 내가 거기 있었지','공사 중인데 오셨군요!'];
  ok(JSON.stringify(kr.ACHIEVEMENT_DEFINITIONS.slice(0,11).map(d=>d.name))===JSON.stringify(originalNames));
  for(const def of kr.ACHIEVEMENT_DEFINITIONS) {
    const kd=kr.getAchievementDefinition(def.id),ud=us.getAchievementDefinition(def.id);
    ok(kd.id===ud.id && ud.name && ud.description && !/[가-힣]/.test(ud.name+ud.description));
    ok(kd.conditionType===ud.conditionType && kd.persistenceType===ud.persistenceType && kd.rarity===ud.rarity);
  }
  ok(kr.getAchievementDefinition('bug-busters').name==='센스코');
  ok(us.getAchievementDefinition('bug-busters').name==='Bug Busters');
  ok(us.getAchievementDefinition('beta-citizen').name==='You Caught Us Building!');
  ok(kr.getAchievementDefinition('beta-citizen').implementationStatus==='CONFIRMED');
  for(const key of ['beta-citizen','bug-busters']) {
    ok(!evalCore.evaluateAchievementCondition(defs.getAchievementDefinition(key),{achievementStats:{validPostCount:1000}}).eligible);
    ok(!Object.values(evalCore.TRIGGER_MAP).flat().includes(key));
  }
  ok(!evalCore.TRIGGER_MAP.POST_CREATED.includes('witness-of-an-era'));
  // Existing deferred grant paths remain unconnected; changing copy never enables them.
  for(const type of ['POST_CREATED','COMMENT_CREATED','EMPATHY_RECEIVED','ACTIVITY_RECORDED']) {
    const out=evalCore.evaluateAchievementsForDomainEvent({eventType:type,userId:uid(1)}, {achievementStats:{validPostCount:10,validCommentOnOthersPostCount:20,validEmpathyReceivedCount:1,distinctPostsWithValidComments:20},ownedAchievements:[]});
    ok(!out.grants.some(g=>['steady-footsteps','empathy-from-many','dialogue-across-territories','witness-of-an-era'].includes(g.achievementKey)));
  }
  const {requestRegion}=require('../server/achievement-request-region');
  const req = (ref,cookie='') => ({headers:{cookie}, get:k=>k==='referer'?ref:k==='host'?'arena.test':''});
  ok(requestRegion(req('https://arena.test/us'))==='US');
  ok(requestRegion(req('https://arena.test/kr'))==='KR');
  ok(requestRegion(req('https://evil.test/us'))==='KR');
  ok(requestRegion(req('', 'sa_ar_x=1; sa_ar=US'))==='US');

  // Real JWT-role guard + HTTP owner acceptance boundary; no actual external services.
  let inquiry={id:uid(100),kind:'BUG',author_user_id:uid(20),activity_region:'KR'};
  let accepted=[];
  const previousAccept=special.acceptVerifiedBug;
  special.acceptVerifiedBug=async input=>{ accepted.push(input);return {status:'GRANTED'}; };
  const app=express();app.use(express.json());
  app.use('/api/admin/inquiries',require('../server/admin-inquiries-routes').mountAdminInquiriesRoutes({
    adminAuth:{supabaseUrl:'https://example.test',supabaseAnonKey:'test-only',getUserFromAccessToken:async token=>({id:uid(900),app_metadata:{role:token==='owner'?'OWNER':token==='admin'?'ADMIN':'USER'},user_metadata:{role:'OWNER'}})},
    query:async()=>({rows:[inquiry]}),
  }));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/admin/inquiries/'+uid(100)+'/accept-verified-bug';
  async function post(token,body) {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const body={verified:true,bugKey:'verified-test-bug',evidence:'Confirmed reproduction with a server trace.',userId:uid(666),region:'US',role:'OWNER'};
  try {
    ok((await post('',body)).status===401);
    ok((await post('member',body)).status===403);
    ok((await post('admin',body)).status===403);
    ok(accepted.length===0);
    ok((await post('owner',{})).status===400);
    inquiry.kind='GENERAL';ok((await post('owner',body)).status===400);inquiry.kind='BUG';
    inquiry.activity_region=null;ok((await post('owner',body)).status===409);inquiry.activity_region='KR';
    ok((await post('owner',body)).status===200);
    ok(accepted.length===1 && accepted[0].userId===uid(20) && accepted[0].region==='KR' && accepted[0].ownerId===uid(900));
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r));special.acceptVerifiedBug=previousAccept; }

  // Execute actual validated board writes and assert hook timing/source binding.
  const betaCalls=[];
  const previousBeta=special.grantBetaParticipationSafe;
  special.grantBetaParticipationSafe=async (...args)=>{betaCalls.push(args);return {status:'GRANTED',achievement_key:'beta-citizen',acquired_at:new Date().toISOString(),acquisition_sequence:1};};
  const evaluator=require('../server/achievement-evaluator-service');
  const oldPost=evaluator.evaluateAfterPostCreated,oldComment=evaluator.evaluateAfterCommentCreated;
  evaluator.evaluateAfterPostCreated=async()=>({granted:[]});evaluator.evaluateAfterCommentCreated=async()=>({granted:[]});
  const progression=require('../server/user-progression-service');
  const oldPostXp=progression.applyPostCreatedXp,oldCommentXp=progression.applyBoardCommentCreatedXp;
  progression.applyPostCreatedXp=async()=>({level:1});progression.applyBoardCommentCreatedXp=async()=>({level:1});
  try {
    const repository=require('../server/board-memory-repository').createBoardMemoryRepository();
    const userContext=require('../server/board-user-context-adapter').createMockUserContextAdapter({territories:{[uid(1)]:'CENTRAL',[uid(2)]:'PIONEER'}});
    const service=require('../server/board-service').createBoardService({repository,userContext,operational:true});
    await assert.rejects(service.createPost({userId:uid(1)},{title:'',content:''}));checks++;
    ok(betaCalls.length===0);
    const post=await service.createPost({userId:uid(1)},{title:'A meaningful post',content:'A valid contribution for the beta.'});
    ok(betaCalls.length===1 && betaCalls[0][1]==='KR' && betaCalls[0][2]==='POST' && betaCalls[0][3]===post.post.id);
    ok(post.newlyGrantedAchievements.some(r=>r.achievementId==='beta-citizen'));
    const comment=await service.createComment({userId:uid(2)},post.post.id,{content:'A meaningful response.'});
    ok(betaCalls.length===2 && betaCalls[1][2]==='BOARD_COMMENT');
    ok(comment.newlyGrantedAchievements.some(r=>r.achievementId==='beta-citizen'));
    const fixture=require('./daily-issue-api-test-fixtures');
    const {requestApp}=require('./daily-issue-api-http-helper');
    const daily=fixture.createTestApp({legalGate:{assertCompleteForUser:async()=>{},assertUsCompleteForUser:async()=>{}},applyIssueCommentXp:false});
    const item=fixture.makeReady('special_beta_comment',{status:'PUBLISHED',activityRegion:'KR',publishedAt:fixture.AS_OF,publishExpiresAt:'2099-01-01T00:00:00Z'});
    daily.repo.insertReviewItems([item],[],{});
    const before=betaCalls.length;
    const empty=await requestApp(daily.app,'POST','/api/daily-issues/'+item.id+'/comments',{headers:fixture.memberHeaders('alice'),body:{body:'  '}});
    assert.ok(empty.status>=400 && empty.status<500 && betaCalls.length===before,JSON.stringify(empty.body));checks++;
    const issueComment=await requestApp(daily.app,'POST','/api/daily-issues/'+item.id+'/comments',{headers:fixture.memberHeaders('alice'),body:{body:'A real Daily Issue contribution.'}});
    assert.equal(issueComment.status,201,JSON.stringify(issueComment.body));checks++;
    ok(betaCalls.length===before+1 && betaCalls[before][2]==='ISSUE_COMMENT');
    ok(issueComment.body.data.newlyGrantedAchievements[0].record.achievementId==='beta-citizen');
  } finally {
    special.grantBetaParticipationSafe=previousBeta;evaluator.evaluateAfterPostCreated=oldPost;evaluator.evaluateAfterCommentCreated=oldComment;
    progression.applyPostCreatedXp=oldPostXp;progression.applyBoardCommentCreatedXp=oldCommentXp;persist.closeAdminClientForTests();
  }
  console.log('PASS special achievements:',checks,'checks (locale, owner auth, real board writes)');
})().catch(e=>{console.error(e);process.exitCode=1;});
