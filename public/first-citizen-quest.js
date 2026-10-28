/** First-visit tour on the real app. Practice controls never invoke board/reaction APIs. */
(function (global) {
  'use strict';
  var active = null;
  var $ = function (id) { return global.document.getElementById(id); };
  function show(options) {
    hide();
    var opt = options || {}, step = 0, practiced = false, finished = false, saving = false, finishSaved = false;
    var target = null, timer = null, frame = null, closed = false, observer = null;
    var sourceScreens = ['screen-main','screen-board','screen-post-detail','screen-guide','screen-history'];
    var snapshots = sourceScreens.map(function(id){ return {el:$(id),hidden:$(id) && $(id).hidden}; });
    var focusBefore = global.document.activeElement;
    var originalPadding = global.document.body.style.paddingBottom;
    var map = $('territory-centrist-hero-bg'), mapStyle = map && map.parentElement.getAttribute('style');
    var svg = $('territory-hit-zones'), svgHidden = svg && svg.getAttribute('aria-hidden');
    var dock = $('avatar-dock'), dockWasCollapsed = dock && dock.classList.contains('is-collapsed');
    if (dock && !dockWasCollapsed && $('avatar-dock-hide')) $('avatar-dock-hide').click();
    var root = global.document.createElement('div'); root.id = 'sc-first-citizen-quest';
    root.innerHTML = '<div class="sc-quest-shade"><div></div><div></div><div></div><div></div></div><div class="sc-quest-ring"></div><aside class="sc-quest-coach" role="dialog" aria-modal="true" aria-labelledby="sc-quest-title"><div class="sc-quest-head"><span id="sc-quest-progress"></span><button type="button" id="sc-quest-skip" class="sc-btn">건너뛰기</button></div><h2 id="sc-quest-title"></h2><p id="sc-quest-copy"></p><p id="sc-quest-status" role="status"></p><div class="sc-quest-actions"><button type="button" id="sc-quest-back" class="sc-btn">이전</button><button type="button" id="sc-quest-next" class="sc-btn sc-btn--primary" hidden>다음</button></div><span id="sc-quest-live" class="sc-quest-sr" aria-live="polite"></span></aside>';
    global.document.body.appendChild(root);
    var coach = root.querySelector('aside'), shade = root.querySelector('.sc-quest-shade'), ring = root.querySelector('.sc-quest-ring');
    var back = $('sc-quest-back'), next = $('sc-quest-next'), skip = $('sc-quest-skip');
    var post = global.document.createElement('button'); post.type='button'; post.className='sc-quest-post sc-card';
    post.innerHTML='<small>첫 시민 안내 · 연습용 글</small><strong>서로 다른 의견이 만나면 무엇이 달라질까요?</strong><span>이 안내글은 실제 게시물이 아니며 기록이나 보상을 남기지 않습니다.</span>';
    var practicePage = global.document.createElement('section'); practicePage.className='sc-quest-practice-page card board';
    practicePage.innerHTML='<h1>서로 다른 의견이 만나면 무엇이 달라질까요?</h1><p class="muted">첫 시민 안내 · 연습용 글</p><p>같은 질문에도 서로 다른 답이 있습니다. 먼저 글을 읽고 다른 관점을 만나보세요.</p><p>의견의 차이보다 서로를 대하는 태도가 중요합니다.</p><h2>반응 연습</h2><div class="sc-quest-reactions" role="group" aria-label="연습용 반응"><button type="button" class="sc-btn" data-sc-quest-reaction="like" aria-pressed="false">좋아요</button><button type="button" class="sc-btn" data-sc-quest-reaction="dislike" aria-pressed="false">싫어요</button><button type="button" class="sc-btn" data-sc-quest-reaction="empathy" aria-pressed="false">공감</button></div><p class="sc-quest-practice-status" role="status">연습용입니다. 실제 반응·성향·명성에는 반영되지 않습니다.</p>';
    var detailRoot=$('post-detail-root'), detailWasHidden=detailRoot && detailRoot.hidden;
    function cleanup(restore) {
      if(closed)return; closed=true;
      if(timer)global.clearTimeout(timer); if(frame)global.cancelAnimationFrame(frame); if(observer)observer.disconnect();
      global.removeEventListener('resize',schedule); global.removeEventListener('scroll',schedule);
      global.document.removeEventListener('click',capture,true);global.document.removeEventListener('keydown',keys,true);
      post.remove();practicePage.remove();root.remove();
      if(detailRoot)detailRoot.hidden=detailWasHidden;
      global.document.body.style.paddingBottom=originalPadding;
      if(map){if(mapStyle===null)map.parentElement.removeAttribute('style');else map.parentElement.setAttribute('style',mapStyle);}
      if(svg){if(svgHidden===null)svg.removeAttribute('aria-hidden');else svg.setAttribute('aria-hidden',svgHidden);}
      if(restore){snapshots.forEach(function(s){if(s.el)s.el.hidden=s.hidden;});if(dock&&dockWasCollapsed&&$('avatar-dock-hide'))$('avatar-dock-hide').click();}
      if(active && active.root===root)active=null;
      if(focusBefore && focusBefore.isConnected && focusBefore.getClientRects().length)focusBefore.focus({preventScroll:true});
    }
    function exit(saved) { cleanup(!!opt.replay);if(typeof opt.onComplete==='function')opt.onComplete(saved); }
    function status(message){$('sc-quest-status').textContent=message;}
    function box(el,x,y,w,h){Object.assign(el.style,{left:x+'px',top:y+'px',width:Math.max(0,w)+'px',height:Math.max(0,h)+'px'});}
    function position(){
      frame=null;if(closed)return;
      if(finished||!target){coach.style.left=Math.max(12,global.innerWidth-coach.offsetWidth-16)+'px';coach.style.top='16px';return;}
      if(!target.isConnected||!target.getClientRects().length){missing();return;}
      var r=target.getBoundingClientRect(),w=global.innerWidth,h=global.innerHeight;
      var result=global.FirstCitizenQuestPlacement(r,{width:coach.offsetWidth,height:coach.offsetHeight},{width:w,height:h,top:8},step===3);
      if(step===0&&map&&(result.overlap||r.bottom>h-12)){
        var available=Math.max(160,h-coach.offsetHeight-140)+'px',mapFrame=map.parentElement;
        if(mapFrame.style.height!==available){var m=mapFrame.getBoundingClientRect();mapFrame.style.height=available;mapFrame.style.width=Math.min(w-24,parseFloat(available)*(m.width/m.height||16/9))+'px';if(global.__scSyncTerritoryHitZonesFit)global.__scSyncTerritoryHitZonesFit();schedule();return;}
      }
      if((result.overlap||r.bottom>h-12||r.top<16)&&(step===1||step===2)){
        global.document.body.style.paddingBottom=(coach.offsetHeight+64)+'px';
        var delta=r.top-32,before=global.scrollY;
        if(Math.abs(delta)>1){global.scrollBy({top:delta,behavior:'instant'});if(global.scrollY!==before){schedule();return;}}
      }
      var l=Math.max(0,r.left-7),t=Math.max(0,r.top-7),rr=Math.min(w,r.right+7),b=Math.min(h,r.bottom+7);
      box(shade.children[0],0,0,w,t);box(shade.children[1],0,b,w,h-b);box(shade.children[2],0,t,l,b-t);box(shade.children[3],rr,t,w-rr,b-t);box(ring,l,t,rr-l,b-t);
      coach.style.left=result.x+'px';coach.style.top=result.y+'px';
    }
    function schedule(){if(!closed&&frame===null)frame=global.requestAnimationFrame(position);}
    function setTarget(node){
      target=node;ring.hidden=shade.hidden=false;
      if(step===0&&svg)svg.removeAttribute('aria-hidden');
      if(step===1||step===2){global.document.body.style.paddingBottom=(coach.offsetHeight+64)+'px';node.scrollIntoView({block:'start',behavior:'instant'});global.scrollBy({top:-32,behavior:'instant'});}
      var focusable=node.matches('button,[tabindex]')?node:node.querySelector('button');
      if(focusable)focusable.focus({preventScroll:true});
      position();
    }
    function missing(){target=null;ring.hidden=shade.hidden=true;status('화면을 불러오지 못했습니다. 다시 시도하거나 안내를 건너뛸 수 있어요.');next.hidden=false;next.disabled=false;next.textContent='다시 시도';position();}
    function findMapTarget(){
      var node=global.document.querySelector('#territory-hit-zones [role="button"][aria-label^="중앙광장"]');
      if(node&&node.getClientRects().length){if(timer){global.clearTimeout(timer);timer=null;}status('밝게 표시된 곳을 직접 눌러보세요.');next.hidden=true;setTarget(node);return true;}
      return false;
    }
    function render(){
      if(closed)return;
      if(observer){observer.disconnect();observer=null;}if(timer){global.clearTimeout(timer);timer=null;}
      target=null;global.document.body.style.paddingBottom=originalPadding;
      var copy=global.FirstVisitGuideCore.STEPS[step];
      $('sc-quest-progress').textContent='첫 시민 안내 '+(step+1)+'/4';$('sc-quest-title').textContent=copy.title;
      $('sc-quest-copy').textContent=copy.body.join(' ');$('sc-quest-live').textContent=(step+1)+'단계. '+copy.title;
      back.disabled=step===0;next.hidden=step!==2;next.disabled=!practiced;next.textContent='다음: 내 시민 카드';
      status(step===2?'반응을 하나 이상 눌러보세요. 연습 기록은 저장되지 않습니다.':'밝게 표시된 곳을 직접 눌러보세요.');
      post.remove();practicePage.remove();if(detailRoot)detailRoot.hidden=detailWasHidden;
      if(step===0){
        global.__scApp.goMain();
        var mapReady=findMapTarget();
        if($('territory-hit-zones-root')){observer=new global.MutationObserver(function(){if(!target||!target.isConnected)findMapTarget();});observer.observe($('territory-hit-zones-root'),{childList:true,subtree:true});}
        if(!mapReady){ring.hidden=shade.hidden=true;status('지도를 불러오는 중입니다…');timer=global.setTimeout(function(){missing();},5000);}
      }else if(step===1){
        global.__scApp.goBoard(global.FirstVisitGuideCore.CENTRAL_TERRITORY_ID);
        var board=$('board-section');if(!board){missing();return;}
        var head=board.querySelector('.board__head');if(head)head.after(post);else board.prepend(post);setTarget(post);
      }else{
        sourceScreens.forEach(function(id){if($(id))$(id).hidden=id!=='screen-post-detail';});
        var detail=$('screen-post-detail');if(!detail){missing();return;}
        detail.appendChild(practicePage);if(detailRoot)detailRoot.hidden=true;
        if(step===2)setTarget(practicePage.querySelector('.sc-quest-reactions'));
        else {if(dock&&!dock.classList.contains('is-collapsed')&&$('avatar-dock-hide'))$('avatar-dock-hide').click();if($('avatar-dock-tab'))setTarget($('avatar-dock-tab'));else missing();}
      }
    }
    function saveAndFinish(skipped){
      if(saving||closed)return;saving=true;finished=true;target=null;ring.hidden=shade.hidden=true;
      skip.disabled=back.disabled=next.disabled=true;next.hidden=false;
      $('sc-quest-title').textContent=skipped?'안내를 마치는 중입니다…':'첫 안내를 마쳤습니다.';
      status(opt.replay?'다시 보기는 회원 완료 기록을 바꾸지 않습니다.':'완료 상태를 저장하고 있습니다…');position();
      Promise.resolve().then(function(){return opt.replay?true:opt.persistComplete();}).catch(function(){return false;}).then(function(saved){
        if(closed)return;saving=false;finishSaved=!!saved;skip.disabled=next.disabled=back.disabled=false;
        if(saved){
          if(skipped){exit(true);return;}
          $('sc-quest-title').textContent='첫 안내를 마쳤습니다.';$('sc-quest-copy').textContent='이제 자유롭게 의견을 나눠보세요.';
          status('연습 반응은 저장되지 않았습니다.');back.hidden=true;skip.textContent='닫기';next.textContent='중앙광장으로';
          skip.onclick=next.onclick=function(){exit(true);};
        }else{
          $('sc-quest-title').textContent='완료 기록을 저장하지 못했습니다.';$('sc-quest-copy').textContent='연결 상태를 확인한 뒤 다시 시도할 수 있어요.';status('안내는 닫을 수 있지만, 다음 접속 때 다시 나올 수 있습니다.');
          back.hidden=false;back.textContent='저장 다시 시도';back.onclick=function(){saveAndFinish(skipped);};
          skip.textContent='저장하지 않고 닫기';next.textContent='저장하지 않고 닫기';skip.onclick=next.onclick=function(){exit(false);};
        }
        skip.focus();position();
      });
    }
    function capture(event){
      if(closed||root.contains(event.target))return;
      if(!finished&&target&&target.contains(event.target)){
        if(step===3){
          // Let the existing profile handler open and hydrate the real citizen card.
          global.setTimeout(function(){if(!closed&&dock&&!dock.classList.contains('is-collapsed'))saveAndFinish(false);},0);
          return;
        }
        event.preventDefault();event.stopImmediatePropagation();
        if(step===0||step===1){step++;render();return;}
        var button=event.target.closest('[data-sc-quest-reaction]');if(!button)return;
        var selected=button.getAttribute('aria-pressed')!=='true';
        if(button.dataset.scQuestReaction!=='empathy')practicePage.querySelectorAll('[data-sc-quest-reaction]:not([data-sc-quest-reaction="empathy"])').forEach(function(b){b.setAttribute('aria-pressed','false');});
        button.setAttribute('aria-pressed',String(selected));practiced=true;next.disabled=false;
        practicePage.querySelector('.sc-quest-practice-status').textContent='연습 완료 ✓ 실제 반응·성향·명성에는 반영되지 않았습니다.';return;
      }
      event.preventDefault();event.stopImmediatePropagation();
    }
    function keys(event){
      if(closed)return;
      if(event.key==='Escape'){event.preventDefault();if(!saving)finished?exit(finishSaved):saveAndFinish(true);return;}
      if(event.key==='Tab'){
        var nodes=target?(target.matches('button,[tabindex]')?[target]:Array.from(target.querySelectorAll('button'))):[];
        nodes=nodes.concat(Array.from(coach.querySelectorAll('button:not([disabled])')).filter(function(n){return !n.hidden;}));
        if(!nodes.length)return;var i=nodes.indexOf(global.document.activeElement);event.preventDefault();nodes[(i+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();
      }
    }
    back.onclick=function(){if(step>0){step--;render();}};
    next.onclick=function(){if(!target){render();return;}if(step===2&&practiced){step=3;render();}};
    skip.onclick=function(){saveAndFinish(true);};
    global.document.addEventListener('click',capture,true);global.document.addEventListener('keydown',keys,true);
    global.addEventListener('resize',schedule);global.addEventListener('scroll',schedule,{passive:true});
    active={root:root,hide:function(){cleanup(true);}};
    render();
  }
  function hide(){if(active)active.hide();}
  global.ScFirstCitizenQuest={show:show,hide:hide};
})(typeof window!=='undefined'?window:this);
