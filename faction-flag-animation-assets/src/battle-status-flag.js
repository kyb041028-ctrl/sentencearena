import { FactionFlagEffect } from "./faction-flag-effect.js";
import { BalancedFactionFlagsEffect } from "./balanced-faction-flags-effect.js";

/**
 * UI integration entry point. Existing score/state calculations stay outside this module.
 * @param {{status:'DOMINANT'|'LEADING'|'BALANCED'|'INSUFFICIENT', faction?:'pioneer'|'central'|'guardian'}} input
 */
export function renderBattleStatusFlag({ status, faction }) {
  if (status === "INSUFFICIENT") return null;
  const container = document.createElement("div");
  container.className = "battle-status-flag-slot";
  container.style.pointerEvents = "none";
  if (status === "BALANCED") {
    container.append(new BalancedFactionFlagsEffect().render());
    return container;
  }
  if ((status === "DOMINANT" || status === "LEADING") && faction) {
    container.append(new FactionFlagEffect({ faction }).render());
    return container;
  }
  return null;
}

