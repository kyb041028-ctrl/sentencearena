'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const facade=fs.readFileSync(require('path').join(__dirname,'../public/first-visit-guide-ui.js'),'utf8');
let options,requests=[],replays=0;
const window={document:{readyState:'loading',addEventListener(){}},FirstVisitGuideCore:{CENTRAL_TERRITORY_ID:'COMMON'},ScFirstCitizenQuest:{show(o){options=o;replays++;},hide(){}},ScAuth:{authFetch:async(url,opt)=>{requests.push({url,opt});return window.response;}},__scApp:{goBoard(){}},__scAuthUserId:'fixture-user'};
vm.runInNewContext(facade,{window});
(async()=>{
  window.ScFirstVisitGuideUI.show(()=>{});
  assert.equal(typeof options.persistComplete,'function');
  for(const [response,want] of [[{ok:true,json:async()=>({ok:true,persisted:true})},true],[{ok:false,json:async()=>({ok:false})},false],[{ok:true,json:async()=>({ok:true,persisted:false})},false],[{ok:true,json:async()=>{throw Error('bad json')}},false]]){
    window.response=response;assert.equal(await options.persistComplete(),want);
  }
  assert(requests.every(r=>r.url==='/api/me/first-visit/complete'&&r.opt.method==='POST'));
  const before=requests.length;window.ScFirstVisitGuideUI.replay();assert(options.replay);assert.equal(options.persistComplete,undefined);assert.equal(requests.length,before);
  window.__scAuthUserId=null;const count=replays;window.ScFirstVisitGuideUI.replay();assert.equal(replays,count);
  const src=fs.readFileSync(require('path').join(__dirname,'../public/first-citizen-quest.js'),'utf8');
  assert(!/authFetch|\.fetch\(|\/api\/board|apply.*Xp|grant.*Fame/.test(src));
  assert(src.includes('event.stopImmediatePropagation()'));
  assert(src.includes('data-sc-quest-reaction'));
  console.log('PASS connected tour: completion HTTP/error handling, isolated practice, replay without writes, guest guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
