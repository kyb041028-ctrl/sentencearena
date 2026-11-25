(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FirstCitizenQuestPlacement=factory();})(typeof window==='undefined'?this:window,function(){
  'use strict';
  return function place(target,tip,viewport,preferSide){
    const gap=18,margin=12,top=viewport.top+8;
    const clamp=(v,min,max)=>Math.max(min,Math.min(Math.max(min,max),v));
    const alignedX=clamp(target.left,margin,viewport.width-tip.width-margin);
    const alignedY=clamp(target.top,top,viewport.height-tip.height-margin);
    const below={x:alignedX,y:target.bottom+gap,side:'below'};
    const above={x:alignedX,y:target.top-tip.height-gap,side:'above'};
    const right={x:target.right+gap,y:alignedY,side:'right'};
    const left={x:target.left-tip.width-gap,y:alignedY,side:'left'};
    const options=preferSide?[right,left,above,below]:[below,above,right,left];
    const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    const expanded={left:target.left-7,right:target.right+7,top:target.top-7,bottom:target.bottom+7};
    let best=null;
    options.forEach((option,index)=>{
      const x=clamp(option.x,margin,viewport.width-tip.width-margin),y=clamp(option.y,top,viewport.height-tip.height-margin);
      const rect={left:x,right:x+tip.width,top:y,bottom:y+tip.height};
      const area=overlap(rect,expanded);
      const overflow=Math.max(0,rect.right-viewport.width)+Math.max(0,rect.bottom-viewport.height);
      const score=area*1000+overflow*10000+index;
      if(!best||score<best.score)best={x,y,side:option.side,overlap:area,score};
    });
    return best;
  };
});
