(()=>{'use strict';if(new URLSearchParams(location.search).has('capture'))document.body.classList.add('capture');if(new URLSearchParams(location.search).has('card'))document.body.classList.add('cardCapture');
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)},lerp=(a,b,p)=>a+(b-a)*p;
const FORMAT=window.ACHIEVEMENT_FORMAT;const PHASES=FORMAT.phases;
const assets={front:['Master/sena_front.png',337,263,926,1273],right:['Master/sena_right.png',383,228,834,1344],surprised:['Actions/sena_surprised.png',364,328,872,1143],wave:['Actions/sena_wave.png',326,357,947,1086],celebrate:['Actions/sena_celebrate.png',323,326,954,1147]};
let t=0,active=false,ready=false,failed=false,last=0,raf=0,lang=document.documentElement.lang==='en'?'en':'ko';
function poseLayout(){}
function resize(){$('#stage').style.transform=`scale(${$('#viewport').clientWidth/1200})`;poseLayout();}
function text(){document.documentElement.lang=lang;$$('[data-t]').forEach(el=>el.textContent=TEXT[lang][el.dataset.t]);$('#pause').textContent=TEXT[lang][active?'pause':'resume'];$('#loadStatus').textContent=TEXT[lang][failed?'error':'ready'];$('#lang').value=lang;$$('img').filter(im=>im.src.includes('badge_construction')).forEach(im=>im.alt=TEXT[lang].badgeAlt);$('#viewport').setAttribute('aria-label',TEXT[lang].sceneLabel);$('#seek').setAttribute('aria-label',TEXT[lang].timeLabel);renderLabels();}
function render(){const walkEnd=PHASES[0].end,reactionStart=PHASES[1].start,cardStart=PHASES[2].start;
const enter=clamp(t/walkEnd),walk=t<walkEnd,notice=smooth((t-2.03)/.16),surprise=smooth((t-2.22)/.14),card=smooth((t-cardStart)/.9),fly=smooth((t-5)/.48),walkLift=walk?Math.abs(Math.sin(t*13))*2:0;
$('.floor-shadow').style.transform=`translateY(${walkLift}px) scaleX(${1.02-walkLift*.008})`;
$$('.step-foot').forEach((f,i)=>{const step=Math.sin(t*13+i*Math.PI);f.style.transform=walk?`translate(${step*3}px,${walkLift-Math.max(0,step)*8}px) rotate(${step*7}deg)`:'none'});
$('#sena .right-arm').style.transform=walk?`rotate(${Math.sin(t*13+Math.PI)*6}deg)`:'rotate(0deg)';
$('#scrim').style.opacity=.86*smooth((t-3)/.6)*(1-smooth((t-5)/.6));$('.arrival').style.opacity=smooth((t-5.35)/.08)*(1-smooth((t-5.6)/.15));$('.arrival').style.transform=`scale(${1+.12*smooth((t-5.35)/.35)})`;
const recoil=7*smooth((t-2.03)/.14)*(1-smooth((t-2.34)/.2));
$('#sena').style.transform=`translate(${lerp(-290,365,enter)-recoil}px,${walk?-walkLift:0}px) rotate(${walk?Math.sin(t*13)*.65:-4*notice*(1-surprise)}deg)`;
$('#sena [data-pose=right]').style.opacity=1-surprise;$('#sena [data-pose=surprised]').style.opacity=surprise;
$('#sign').style.transform='rotate(-.5deg)';$('#sign .sign-aura').style.opacity=.5*smooth((t-2.05)/.12)*(1-smooth((t-2.6)/.3));
$('#plaza').style.opacity=1-card;$('#plaza').style.transform='none';
$('#flight').style.opacity=t<3?0:clamp((t-3)/.18)*(1-smooth((t-5.38)/.12));$('#flight').style.transform=`translate(${lerp(400,296,fly)}px,${65+Math.sin(fly*Math.PI)*-80}px) scale(${lerp(lerp(.85,1,card),.17,fly)})`;$('#flight .pose').style.transform=`translateY(${-Math.sin(Math.max(0,t-3)*6)*2}px) rotate(${Math.sin(Math.max(0,t-3)*4)*1.5}deg)`;
$$('.stars b').forEach((el,i)=>{const age=t-(4.02+i*.38),p=smooth(age/.28),land=smooth((age-.28)/.10),bounce=Math.sin(clamp((age-.28)/.23)*Math.PI)*.2;
 el.style.opacity=smooth(age/.055);el.style.transform=`translateY(${lerp(-85,0,p)}px) scale(${lerp(3,1,p)+bounce}) rotate(${lerp(i?28:-28,0,p)}deg)`;el.style.filter=`brightness(${1+1.3*(1-land)}) drop-shadow(0 0 ${12+14*(1-land)}px #ffc85a)`;
 const burst=$('#star-burst-'+i),bp=clamp((age-.24)/.35);burst.style.opacity=smooth((age-.24)/.06)*(1-smooth((age-.32)/.18));burst.style.transform=`scale(${.4+bp*1.1})`;
 });
 $('#stars-earned').style.opacity=smooth((t-4.62)/.12)*(1-smooth((t-5.03)/.1));$('#stars-earned').style.transform=`translateY(${lerp(12,0,smooth((t-4.62)/.12))}px)`;
 $('#flight h2').style.opacity=smooth((t-3.82)/.18);$('#flight .card-text p').style.opacity=smooth((t-3.87)/.13);
 $('#target').style.opacity=lerp(.3,1,smooth((t-5.3)/.2));$('#target img').style.opacity=smooth((t-5.27)/.18);$('#target img').style.transform=`scale(${lerp(.7,1,smooth((t-5.27)/.18))})`;
 const dock=smooth((t-5.35)/.42),pulse=Math.sin(clamp((t-5.75)/.25)*Math.PI)*.22;
 $('#profile-spark').style.opacity=smooth((t-5.35)/.07)*(1-smooth((t-5.74)/.08));$('#profile-spark').style.transform=`translate(${lerp(496,116,dock)-64}px,${lerp(325,357,dock)-64-Math.sin(dock*Math.PI)*100}px) scale(${lerp(.85,.5,dock)})`;
 $('#featured .slots img').style.opacity=smooth((t-5.73)/.06);$('#featured .slots img').style.transform=`scale(${1+pulse})`;
 $('#featured').style.setProperty('--earned',smooth((t-5.45)/.3));$('#profile-earned').style.opacity=smooth((t-5.48)/.13);$('#profile-earned').style.transform=`translateY(${lerp(12,0,smooth((t-5.48)/.13))}px)`;
 $('#profile-note').style.opacity=smooth((t-5.7)/.15);$('#profile-ring').style.opacity=smooth((t-5.7)/.08)*(.55+.25*(1-smooth((t-5.8)/.2)));$('#profile-ring').style.transform=`scale(${lerp(.5,1.1,smooth((t-5.7)/.3))})`;
 $('#clock').value=t.toFixed(2)+' / 6.00s';$('#seek').value=t;$('#stage').dataset.time=t.toFixed(3);$('#stage').dataset.state=failed?'error':active?'playing':t>=FORMAT.duration?'complete':'paused';renderLabels();if(document.activeElement!==$('#reviewTime'))$('#reviewTime').value=t.toFixed(2);}
function renderLabels(){const phase=FORMAT.phaseAt(t);$('#phase').textContent=TEXT[lang].phases[PHASES.indexOf(phase)];}
let listSent=false;
function notify(state){try{if(window.parent&&window.parent!==window)window.parent.postMessage({source:'sena-beta-citizen',achievementId:'beta-citizen',devOnly:true,productionGrant:false,state:state},location.origin);}catch(err){}}
function frame(now){if(!active)return;t=Math.min(FORMAT.duration,t+(now-last)/1000);last=now;render();if(!listSent&&t>=5){listSent=true;notify('list');}if(t<FORMAT.duration)raf=requestAnimationFrame(frame);else{active=false;text();render();notify('complete');}}
function play(){if(!ready||failed)return;cancelAnimationFrame(raf);if(t>=FORMAT.duration)t=0;if(t<5)listSent=false;active=true;last=performance.now();text();raf=requestAnimationFrame(frame);}
function pause(){active=false;cancelAnimationFrame(raf);text();render();}
$('#reviewTime').oninput=e=>{pause();t=Math.max(0,Math.min(6,+e.target.value));render();};$('#replay').onclick=()=>{t=0;play();};$('#pause').onclick=()=>active?pause():play();$('#seek').oninput=e=>{const value=+e.target.value;pause();t=value;render();};$$('[data-at]').forEach(el=>el.onclick=()=>{pause();t=+el.dataset.at;render();});$('#lang').onchange=e=>{lang=e.target.value;text();};
$$('.pose').forEach(el=>{el.classList.add('segmented'); const pose=el.dataset.pose; const im=new Image();im.alt='Sena '+pose;im.src='assets/'+(pose==='wave'?'wave-body':pose==='right'?'right-body':pose)+'.png';el.append(im);if(pose==='right'){im.className='right-torso';const under=new Image();under.className='right-arm-underlap';under.alt='';under.src='assets/right.png';el.append(under);const arm=new Image();arm.className='right-arm';arm.alt='';arm.src='assets/right.png';el.append(arm);for(let i=0;i<2;i++){const foot=new Image();foot.className='step-foot foot'+i;foot.alt='';foot.src='assets/right-foot'+i+'.png';el.append(foot);}}if(pose==='wave'){const arm=new Image();arm.className='arm';arm.alt='';arm.src='assets/wave-arm.png';el.append(arm);}});
$('#replay').disabled=$('#pause').disabled=true;
const hold=new URLSearchParams(location.search).has('hold');
let startWhenReady=false;
window.addEventListener('message',function(event){if(event.origin!==location.origin)return;if(!(event.data&&event.data.source==='sena-beta-parent'&&event.data.action==='play'))return;if(ready)play();else startWhenReady=true;});
Promise.all($$('img').map(im=>im.decode())).then(()=>{ready=true;$('#replay').disabled=$('#pause').disabled=false;resize();text();render();if(startWhenReady||(!hold&&!document.body.classList.contains('capture')&&!matchMedia('(prefers-reduced-motion: reduce)').matches))play();}).catch(()=>{failed=true;pause();$('#plaza').hidden=true;$('#flight').hidden=true;text();});
new ResizeObserver(resize).observe($('#viewport'));document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)pause();});resize();text();render();
})();

