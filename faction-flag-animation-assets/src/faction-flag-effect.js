import { factionFlagAssets, flagGeometry } from "./faction-flag-assets.js";

const layer = (faction, name) => `${factionFlagAssets[faction].root}/${name}.png`;

export class FactionFlagEffect {
  constructor({ faction, arrivalDelay = 0, waveDelay = 0, compact = false } = {}) {
    if (!factionFlagAssets[faction]) throw new Error(`Unknown faction: ${faction}`);
    this.faction = faction;
    this.arrivalDelay = arrivalDelay;
    this.waveDelay = waveDelay;
    this.compact = compact;
  }

  render() {
    const root = document.createElement("div");
    root.className = `flag-effect${this.compact ? " is-compact" : ""}`;
    root.setAttribute("aria-label", `${factionFlagAssets[this.faction].label} 전황 깃발`);
    root.style.setProperty("--arrival-delay", `${this.arrivalDelay}ms`);
    root.style.setProperty("--wave-delay", `${this.waveDelay}ms`);
    root.innerHTML = `
      <div class="flag-arrival">
        <img class="flag-layer impact-remain" src="${layer(this.faction,"impact-remain")}" alt="">
        <span class="impact-ring"></span><span class="impact-dust"></span>
        ${Array.from({length:6},(_,i)=>`<span class="debris debris-${i+1}"></span>`).join("")}
        <img class="flag-layer base" src="${layer(this.faction,"base")}" alt="">
        <img class="flag-layer pole" src="${layer(this.faction,"pole")}" alt="">
        <div class="cloth-slices"></div>
        <img class="flag-layer tassel" src="${layer(this.faction,"tassel")}" alt="">
      </div>`;
    const slices = root.querySelector(".cloth-slices");
    Array.from({length:flagGeometry.slices},(_,i)=>{
      const amp=i/(flagGeometry.slices-1), span=document.createElement("span"), img=document.createElement("img");
      span.className="cloth-slice"; span.style.left=`${i*10}%`;
      span.style.setProperty("--wave-y",`${(amp*5).toFixed(2)}px`);
      span.style.setProperty("--wave-y-soft",`${(amp*2.5).toFixed(2)}px`);
      span.style.setProperty("--wave-compress",(1-amp*.012).toFixed(4));
      span.style.setProperty("--wave-expand",(1+amp*.009).toFixed(4));
      span.style.setProperty("--wave-skew",`${(amp*.5).toFixed(3)}deg`);
      span.style.setProperty("--wave-skew-neg",`${(amp*-.45).toFixed(3)}deg`);
      span.style.setProperty("--wave-skew-mid",`${(amp*.3).toFixed(3)}deg`);
      span.style.setProperty("--wave-bright",(1+amp*.045).toFixed(4));
      span.style.setProperty("--wave-dark",(1-amp*.03).toFixed(4));
      span.style.setProperty("--slice-delay",`${i*-34}ms`);
      img.src=layer(this.faction,"cloth"); img.alt=""; img.style.left=`${i*-100}%`;
      span.append(img); slices.append(span);
    });
    return root;
  }
}

