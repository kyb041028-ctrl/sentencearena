import { FactionFlagEffect } from "./faction-flag-effect.js";
import { BalancedFactionFlagsEffect } from "./balanced-faction-flags-effect.js";

const states=[
  ["pioneer","개척 우세","PIONEER","#3f8cff"],
  ["central","중앙 우세","CENTRAL","#43c777"],
  ["guardian","수호 우세","GUARDIAN","#ed5353"],
];

function mount(){
  const grid=document.querySelector("#preview-grid"); grid.replaceChildren();
  states.forEach(([faction,title,eyebrow,color])=>{
    const card=document.createElement("article"); card.className="preview-card"; card.style.setProperty("--accent",color);
    card.innerHTML=`<div class="card-heading"><div><span class="status-dot"></span><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><span class="state-pill">LEADING</span></div><div class="flag-stage"><div class="ground-glow"></div></div><p class="card-note">깃대 고정 · 천 10분할 2.5D loop</p>`;
    card.querySelector(".flag-stage").append(new FactionFlagEffect({faction}).render()); grid.append(card);
  });
  const balanced=document.createElement("article"); balanced.className="preview-card balanced-card";
  balanced.innerHTML=`<div class="card-heading"><div><span class="status-dot"></span><span class="eyebrow">BALANCED</span><h2>박빙</h2></div><span class="state-pill">3 FACTIONS</span></div><div class="flag-stage"><div class="ground-glow"></div></div><p class="card-note">동일 크기 · 70ms 순차 착지 · 독립 loop</p>`;
  balanced.querySelector(".flag-stage").append(new BalancedFactionFlagsEffect().render()); grid.append(balanced);
}

document.querySelector("#replay").addEventListener("click",mount);
mount();

