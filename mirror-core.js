/* Geometry and gesture state shared by the app and its tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MirrorCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
  function projectPoint(p,width,height,videoWidth,videoHeight){
    const scale=Math.max(width/videoWidth,height/videoHeight);
    return{x:width-((p.x*videoWidth)*scale+(width-videoWidth*scale)/2),y:(p.y*videoHeight)*scale+(height-videoHeight*scale)/2};
  }
  function jointAngle(a,b,c){
    const u=[a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)],v=[c.x-b.x,c.y-b.y,(c.z||0)-(b.z||0)];
    const denominator=Math.hypot(...u)*Math.hypot(...v);
    return denominator?Math.acos(clamp(u.reduce((sum,n,i)=>sum+n*v[i],0)/denominator,-1,1))*180/Math.PI:0;
  }
  function fingerExtended(points,base){
    return jointAngle(points[base],points[base+1],points[base+3])>149&&distance(points[base+3],points[0])>distance(points[base+1],points[0])*1.07;
  }
  function handPose(points){
    if(!points||points.length<21)return'lift';
    // A physical finger is often curved or foreshortened toward the camera.
    // Lift only for a clearly folded index, rather than demanding a perfect pose.
    const folded=jointAngle(points[5],points[6],points[8])<105&&distance(points[8],points[0])<distance(points[6],points[0])*.96;
    if(folded)return'lift';
    return [9,13,17].every(i=>fingerExtended(points,i))?'wipe':'write';
  }
  class HandStrokeTracker{
    constructor(){this.hands=[];this.nextId=0;}
    reset(){this.hands=[];}
    update(landmarks,world,now,width,height,videoWidth,videoHeight,brush=11){
      const result={strokes:[],tips:[],hands:landmarks.length};
      const candidates=this.hands.filter(h=>now-h.seen<1200),used=new Set(),updated=[];
      for(let i=0;i<landmarks.length;i++){
        const points=landmarks[i];if(points.length<21)continue;
        let hand=null,best=.23;
        for(const candidate of candidates){if(used.has(candidate.id))continue;const d=Math.hypot(candidate.wrist.x-points[0].x,candidate.wrist.y-points[0].y);if(d<best){best=d;hand=candidate;}}
        if(!hand)hand={id:++this.nextId,seen:now,wrist:points[0],pose:'lift',pending:'lift',stable:0,points:new Map()};
        used.add(hand.id);
        const gap=now-hand.seen,pose=handPose(world?.[i]?.length===21?world[i]:points);
        hand.stable=hand.pending===pose?hand.stable+1:1;hand.pending=pose;
        const nextPose=pose;
        if(gap>1200||nextPose!==hand.pose)hand.points.clear();
        hand.pose=nextPose;hand.wrist=points[0];hand.seen=now;
        const indices=nextPose==='wipe'?[4,8,12,16,20]:[8];
        const nextPoints=new Map();
        for(const index of indices){
          const raw=projectPoint(points[index],width,height,videoWidth,videoHeight);
          if(raw.x<0||raw.x>width||raw.y<0||raw.y>height)continue;
          const previous=hand.points.get(index),dt=clamp((gap||40)/1000,.01,.5);
          let point=raw;
          if(previous&&gap<=1200){const speed=Math.hypot(raw.x-previous.raw.x,raw.y-previous.raw.y)/dt;const alpha=1-Math.exp(-2*Math.PI*(3+speed*.018)*dt);point={x:previous.x+(raw.x-previous.x)*alpha,y:previous.y+(raw.y-previous.y)*alpha};}
          const active=nextPose!=='lift',radius=nextPose==='wipe'?brush*2.8:brush;
          if(active){const jump=previous?Math.hypot(point.x-previous.x,point.y-previous.y):0;const connect=previous&&gap<=1200&&jump<Math.hypot(width,height)*.25;result.strokes.push({from:connect?previous:point,to:point,radius});nextPoints.set(index,{...point,raw});}
          result.tips.push({...point,id:hand.id+'-'+index,active});
        }
        hand.points=nextPoints;updated.push(hand);
      }
      this.hands=updated;return result;
    }
  }
  function mouthRatio(points){
    if(!points||points.length<309)return 0;
    const span=Math.hypot(points[78].x-points[308].x,points[78].y-points[308].y);
    return span>1e-6?Math.hypot(points[13].x-points[14].x,points[13].y-points[14].y)/span:0;
  }
  class MouthGesture{
    constructor(){this.reset();}
    reset(){this.open=false;this.smoothed=null;this.candidateAt=null;}
    update(points,now){
      if(!points?.length){this.reset();return false;}
      const value=mouthRatio(points);this.smoothed=this.smoothed===null?value:this.smoothed*.35+value*.65;
      if(this.open){if(this.smoothed<.15)this.reset();}
      else if(this.smoothed>.24){if(this.candidateAt===null)this.candidateAt=now;if(now-this.candidateAt>=90)this.open=true;}
      else this.candidateAt=null;
      return this.open;
    }
  }
  class FogMask{
    constructor(canvas,width,height,scale=1){this.canvas=canvas;this.context=canvas.getContext('2d');this.carry=0;this.resize(width,height,scale,false);}
    resize(width,height,scale=1,preserve=true){
      let previous=null;if(preserve&&this.canvas.width>1){previous=this.canvas.ownerDocument?.createElement('canvas');if(previous){previous.width=this.canvas.width;previous.height=this.canvas.height;previous.getContext('2d').drawImage(this.canvas,0,0);}}
      this.width=width;this.height=height;this.canvas.width=Math.max(1,Math.round(width*scale));this.canvas.height=Math.max(1,Math.round(height*scale));this.context.setTransform(scale,0,0,scale,0,0);
      if(previous)this.context.drawImage(previous,0,0,previous.width,previous.height,0,0,width,height);else this.fresh();
    }
    fresh(){const c=this.context;c.globalCompositeOperation='source-over';c.fillStyle='#fff';c.fillRect(0,0,this.width,this.height);this.carry=0;}
    clear(){this.context.clearRect(0,0,this.width,this.height);this.carry=0;}
    dot(x,y,radius){const c=this.context;c.globalCompositeOperation='destination-out';const g=c.createRadialGradient(x,y,radius*.74,x,y,radius);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.8,'rgba(0,0,0,.9)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(x-radius,y-radius,radius*2,radius*2);c.globalCompositeOperation='source-over';}
    stroke(from,to,radius){const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/(radius*.25)));for(let i=0;i<=n;i++){const t=i/n;this.dot(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t,radius);}}
    advance(seconds,returnTime){this.carry+=seconds*255/returnTime;const amount=Math.floor(this.carry);if(!amount)return false;this.carry-=amount;const c=this.context;c.globalCompositeOperation='lighter';c.fillStyle='rgba(255,255,255,'+Math.min(amount,255)/255+')';c.fillRect(0,0,this.width,this.height);c.globalCompositeOperation='source-over';return true;}
  }
  return{projectPoint,jointAngle,fingerExtended,handPose,HandStrokeTracker,FogMask,mouthRatio,MouthGesture};
});
