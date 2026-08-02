import { FactionFlagEffect } from "./faction-flag-effect.js";

export class BalancedFactionFlagsEffect {
  render() {
    const root=document.createElement("div"); root.className="balanced-effect";
    root.setAttribute("aria-label","박빙 상태: 개척, 중앙, 수호 깃발");
    [
      ["pioneer","balanced-blue",0,0],
      ["central","balanced-green",70,120],
      ["guardian","balanced-red",140,220],
    ].forEach(([faction,className,arrivalDelay,waveDelay])=>{
      const flag=new FactionFlagEffect({faction,compact:true,arrivalDelay,waveDelay}).render();
      flag.classList.add(className); root.append(flag);
    });
    return root;
  }
}

