/* Reusable six-second achievement format. Change artwork/copy without moving phase boundaries. */
(function(root){'use strict';
const phases=Object.freeze([
 Object.freeze({id:'walk',start:0,end:2}),
 Object.freeze({id:'reaction',start:2,end:3}),
 Object.freeze({id:'card',start:3,end:4}),
 Object.freeze({id:'award',start:4,end:5}),
 Object.freeze({id:'collection',start:5,end:6})
]);
const format=Object.freeze({duration:6,phases,phaseAt(time){const t=Math.max(0,Math.min(6,Number(time)||0));return phases.find(p=>t<p.end)||phases[phases.length-1];}});
if(typeof module==='object'&&module.exports)module.exports=format;else root.ACHIEVEMENT_FORMAT=format;
})(typeof window==='object'?window:globalThis);
