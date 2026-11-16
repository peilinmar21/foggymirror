(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const {FogMask,HandStrokeTracker,MouthGesture}=MirrorCore;
  const video=$('reflection'),glass=$('mist'),context=glass.getContext('2d');
  const maskCanvas=document.createElement('canvas'),mistLayer=document.createElement('canvas');
  const mistContext=mistLayer.getContext('2d'),soft=document.createElement('canvas'),softContext=soft.getContext('2d');
  const grain=document.createElement('canvas');grain.width=grain.height=160;
  const grainContext=grain.getContext('2d'),noise=grainContext.createImageData(160,160);
  let seed=2197;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  for(let i=0;i<noise.data.length;i+=4){const shade=random()>.5?255:55;noise.data[i]=noise.data[i+1]=noise.data[i+2]=shade;noise.data[i+3]=Math.floor(random()*15);}
  grainContext.putImageData(noise,0,0);
  const droplets=Array.from({length:140},()=>({x:random(),y:random(),r:.6+random()*2,l:random()*18}));
  let width=1,height=1,scale=1,mask=new FogMask(maskCanvas,1,1),brush=11,returnTime=45,paused=false;
  let stream=null,opening=false,cameraEpoch=0,started=false,client=null,workerReady=false,mouthOpen=false,lastFaceAt=0;
  let trackingWanted=true,lastRender=0,lastStatusAt=0;
  let hideTimer,noticeTimer,lastHandsAt=0,dirty=true,keyboardPoint=null,keyboardNavigation=false;
  const tracker=new HandStrokeTracker(),mouth=new MouthGesture(),pointers=new Map(),tipElements=new Map();

  function notify(message,sticky=false){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').classList.add('visible');if(!sticky)noticeTimer=setTimeout(()=>$('notice').classList.remove('visible'),4500);}
  function hideControls(){if(keyboardNavigation&&$('chrome').contains(document.activeElement))return;$('chrome').classList.add('hidden');$('chrome').inert=true;document.body.classList.remove('chrome-visible');}
  function showControls(){if(!started)return;clearTimeout(hideTimer);$('chrome').inert=false;$('chrome').classList.remove('hidden');document.body.classList.add('chrome-visible');hideTimer=setTimeout(hideControls,3500);}
  function clearTips(){for(const tip of tipElements.values())tip.remove();tipElements.clear();}
  function renderTips(tips){
    const ids=new Set();
    for(const tip of tips){ids.add(tip.id);let element=tipElements.get(tip.id);if(!element){element=document.createElement('div');element.className='finger-dot';$('fingertips').append(element);tipElements.set(tip.id,element);}element.style.left=tip.x+'px';element.style.top=tip.y+'px';element.classList.toggle('hover',!tip.active);}
    for(const [id,tip] of tipElements)if(!ids.has(id)){tip.remove();tipElements.delete(id);}
  }
  function resize(){
    const rect=$('mirror').getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);scale=Math.min(window.devicePixelRatio||1,1,1100/Math.max(width,height));
    for(const canvas of [glass,mistLayer]){canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext('2d').setTransform(scale,0,0,scale,0,0);}
    mask.resize(width,height,scale);soft.width=Math.max(1,Math.round(width/7));soft.height=Math.max(1,Math.round(height/7));tracker.reset();pointers.clear();keyboardPoint=null;clearTips();dirty=true;
  }
  function drawReflection(target,targetWidth,targetHeight){
    const ratio=Math.max(targetWidth/video.videoWidth,targetHeight/video.videoHeight),dw=video.videoWidth*ratio,dh=video.videoHeight*ratio;
    target.save();target.translate(targetWidth,0);target.scale(-1,1);target.drawImage(video,(targetWidth-dw)/2,(targetHeight-dh)/2,dw,dh);target.restore();
  }
  function paintMist(now){
    const f=mistContext;f.clearRect(0,0,width,height);
    if(stream&&video.readyState>=2){
      softContext.clearRect(0,0,soft.width,soft.height);drawReflection(softContext,soft.width,soft.height);
      f.save();f.filter='blur(14px)';f.drawImage(soft,-18,-18,width+36,height+36);f.restore();
      const haze=f.createLinearGradient(0,0,width*.65,height);haze.addColorStop(0,'rgba(235,235,235,.52)');haze.addColorStop(.48,'rgba(222,222,222,.43)');haze.addColorStop(1,'rgba(207,207,207,.55)');f.fillStyle=haze;f.fillRect(0,0,width,height);
    }else{const haze=f.createLinearGradient(0,0,width,height);haze.addColorStop(0,'#c8c8c8');haze.addColorStop(.48,'#b6b6b6');haze.addColorStop(1,'#a9a9a9');f.fillStyle=haze;f.fillRect(0,0,width,height);}
    const glow=f.createRadialGradient(width*.32,height*.25,0,width*.32,height*.25,width*.8);glow.addColorStop(0,'rgba(255,255,255,.14)');glow.addColorStop(1,'rgba(255,255,255,0)');f.fillStyle=glow;f.fillRect(0,0,width,height);
    f.fillStyle=f.createPattern(grain,'repeat');f.fillRect(0,0,width,height);
    for(const drop of droplets){const x=drop.x*width,y=drop.y*height;f.beginPath();f.ellipse(x,y,drop.r*.5,drop.r,0,0,Math.PI*2);f.fillStyle='rgba(255,255,255,.11)';f.fill();f.beginPath();f.moveTo(x,y+drop.r);f.lineTo(x-.3,y+drop.r+drop.l);f.strokeStyle='rgba(255,255,255,.045)';f.lineWidth=.7;f.stroke();}
    context.clearRect(0,0,width,height);context.globalCompositeOperation='source-over';context.drawImage(mistLayer,0,0,width,height);context.globalCompositeOperation='destination-in';context.drawImage(maskCanvas,0,0,width,height);context.globalCompositeOperation='source-over';dirty=false;
  }
  function handleLandmarks(data){
    if(!stream||!trackingWanted||document.hidden)return;
    const now=performance.now();
    // Accept completed frames on slower devices. A single in-flight capture
    // prevents an old-frame queue; do not silently discard all CPU results.
    if(data.faceUpdated){
      lastFaceAt=now;const wasOpen=mouthOpen;mouthOpen=mouth.update(data.faceLandmarks,now);
      if(mouthOpen&&!wasOpen){tracker.reset();notify('Mouth open — fog returning.');}
    }
    if(!mouthOpen){
      const result=tracker.update(data.landmarks||[],data.worldLandmarks||[],now,width,height,video.videoWidth,video.videoHeight,brush);
      for(const stroke of result.strokes){mask.stroke(stroke.from,stroke.to,stroke.radius);dirty=true;}
      renderTips(result.tips);if(result.hands)lastHandsAt=now;
    }else{clearTips();tracker.reset();}
    const handCount=data.landmarks?.length||0;
    if(now-lastStatusAt>500){lastStatusAt=now;$('tracking-status').textContent=(handCount?'Hand found':'Show your hand to the camera')+' · '+(data.faceReady?(mouthOpen?'Mouth open — fogging':data.faceLandmarks?.length?'Mouth closed':'Face not in view'):data.faceError?'Mouth tracking unavailable':'Mouth tracking loading')+' · '+Math.round(data.inferenceMs||0)+' ms';}
  }
  function updateTrackingUi(){
    const active=trackingWanted&&workerReady;
    $('tracking-toggle').setAttribute('aria-pressed',String(active));
    $('tracking-toggle').setAttribute('aria-label',active?'Turn fingertip tracking off':'Start or retry fingertip tracking');
    $('tracking-toggle').title=active?'Fingertip tracking is on':'Start or retry fingertip tracking';
  }
  function stopTracking(){
    client?.stop();client=null;workerReady=false;tracker.reset();mouth.reset();mouthOpen=false;clearTips();updateTrackingUi();
  }
  function trackingFailed(message){stopTracking();$('tracking-status').textContent=message||'Tracking stopped';notify(message||'Camera tracking stopped. Use the hand button to retry.');showControls();}
  function startTracking(){
    stopTracking();if(!stream||!trackingWanted)return;
    if(!window.Worker){trackingFailed('This browser does not support camera tracking. Use a current Chrome or Safari browser.');return;}
    notify('Loading hand and mouth tracking…',true);
    client=new VisionClient(video,{
      onResult:handleLandmarks,
      onStatus:message=>{
        workerReady=!!client?.ready;updateTrackingUi();$('tracking-status').textContent=message;
        if(workerReady){notify(message);lastHandsAt=performance.now();}
      },
      onError:(error,fatal=true)=>{if(fatal)trackingFailed(error.message);else $('tracking-status').textContent=error.message;}
    });
    client.start();
  }
  function animate(now){
    if(stream&&trackingWanted)client?.capture(now);
    if(!document.hidden&&now-lastRender>=1000/24){
      const dt=Math.min((now-(lastRender||now))/1000,.15);lastRender=now;
      if(mouthOpen&&now-lastFaceAt>1800){mouth.reset();mouthOpen=false;}
      if(mouthOpen){if(mask.advance(dt,.7))dirty=true;}else if(!paused&&mask.advance(dt,returnTime))dirty=true;
      if(dirty||stream)paintMist(now);
      if(tipElements.size&&now-lastHandsAt>1800){clearTips();tracker.reset();}

    }
    requestAnimationFrame(animate);
  }
  function cameraUi(live){
    document.body.classList.toggle('live',live);$('camera-toggle').setAttribute('aria-label',live?'Turn camera off':'Turn camera on');$('camera-toggle').title=live?'Turn camera off':'Turn camera on';
    $('start').querySelector('span').textContent='Open mirror';if(!live)$('tracking-status').textContent='Camera off';
  }
  function stopCamera(){
    cameraEpoch++;opening=false;stopTracking();if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;cameraUi(false);dirty=true;
  }
  async function openCamera(){
    $('camera-error').hidden=true;
    if(opening){stopCamera();notify('Camera request cancelled.');return;}
    if(!navigator.mediaDevices?.getUserMedia){$('entry').hidden=false;$('camera-error').textContent='Open this mirror in a new HTTPS browser tab to use the camera. You can still use touch or mouse.';$('camera-error').hidden=false;return;}
    const epoch=++cameraEpoch;opening=true;$('start').querySelector('span').textContent='Opening camera · cancel';let pending=null;
    try{
      pending=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
      if(epoch!==cameraEpoch){pending.getTracks().forEach(track=>track.stop());return;}
      stream=pending;video.srcObject=stream;await video.play();
      if(epoch!==cameraEpoch)return;
      opening=false;started=true;document.body.classList.add('started');cameraUi(true);$('entry').hidden=true;mask.fresh();dirty=true;
      for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(stream===pending){stopCamera();notify('Camera stopped. Use the camera button to reconnect.');showControls();}});
      showControls();startTracking();
    }catch(error){
      if(pending)pending.getTracks().forEach(track=>track.stop());if(epoch!==cameraEpoch)return;stream=null;opening=false;video.srcObject=null;cameraUi(false);$('entry').hidden=false;
      const messages={NotAllowedError:'Allow camera access in your browser’s site settings, then try again. You can also use touch or mouse.',NotFoundError:'No camera was found. Connect one and try again, or use touch or mouse.',NotReadableError:'The camera may be open in another app. Close it there and try again.'};
      $('camera-error').textContent=messages[error.name]||'The camera could not open. Try again in a new browser tab, or use touch or mouse.';$('camera-error').hidden=false;
    }
  }
  $('start').addEventListener('click',openCamera);
  $('without-camera').addEventListener('click',()=>{if(opening)stopCamera();started=true;document.body.classList.add('started');$('entry').hidden=true;notify('Drag on the mist to write.');showControls();});
  $('camera-toggle').addEventListener('click',()=>{if(stream||opening){stopCamera();notify('Camera off. Touch and mouse still work.');}else openCamera();});
  $('tracking-toggle').addEventListener('click',()=>{if(!stream){notify('Turn on your camera to track your fingertip.');return;}if(workerReady&&trackingWanted){trackingWanted=false;stopTracking();notify('Finger tracking off.');}else{trackingWanted=true;startTracking();}});
  $('show-controls').addEventListener('click',()=>{showControls();$('camera-toggle').focus();});
  $('chrome').addEventListener('pointermove',showControls);$('chrome').addEventListener('focusin',showControls);$('chrome').addEventListener('focusout',()=>{clearTimeout(hideTimer);hideTimer=setTimeout(hideControls,3000);});
  $('brush').addEventListener('input',e=>{brush=Number(e.target.value);tracker.reset();showControls();});
  $('return-time').addEventListener('input',e=>{returnTime=Number(e.target.value);$('return-output').value=returnTime+'s';showControls();});
  function togglePause(){paused=!paused;$('pause').setAttribute('aria-pressed',String(paused));$('pause').setAttribute('aria-label',paused?'Resume returning mist':'Pause returning mist');$('pause').title=paused?'Resume returning mist':'Pause returning mist';notify(paused?'Mist paused. Your marks can stay.':'The mist is returning.');}
  $('pause').addEventListener('click',togglePause);
  $('fresh').addEventListener('click',()=>{mask.fresh();dirty=true;tracker.reset();notify('Fresh mist.');});
  $('clear').addEventListener('click',()=>{mask.clear();dirty=true;notify('Clear glass.');});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('mirror').requestFullscreen)await $('mirror').requestFullscreen();else notify('Use your browser’s full-screen option.');}catch{notify('Use your browser’s full-screen option.');}});
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Enter full screen');resize();});

  function pointerPoint(e){const r=glass.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  glass.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();const p=pointerPoint(e);pointers.set(e.pointerId,p);glass.setPointerCapture(e.pointerId);mask.dot(p.x,p.y,brush*(e.pointerType==='touch'?1.4:1));dirty=true;$('notice').classList.remove('visible');hideControls();});
  glass.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)){if(e.pointerType==='mouse'&&e.clientY>height-65)showControls();return;}
    for(const event of (e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])){const next=pointerPoint(event);mask.stroke(pointers.get(e.pointerId),next,brush*(e.pointerType==='touch'?1.4:1));pointers.set(e.pointerId,next);}dirty=true;
  });
  const release=e=>{pointers.delete(e.pointerId);if(glass.hasPointerCapture(e.pointerId))glass.releasePointerCapture(e.pointerId);};
  glass.addEventListener('pointerup',release);glass.addEventListener('pointercancel',release);glass.addEventListener('lostpointercapture',e=>pointers.delete(e.pointerId));
  glass.addEventListener('keydown',e=>{
    const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!directions[e.key])return;e.preventDefault();const previous=keyboardPoint||{x:width/2,y:height/2},d=directions[e.key],step=e.shiftKey?23:8;keyboardPoint={x:Math.max(0,Math.min(width,previous.x+d[0]*step)),y:Math.max(0,Math.min(height,previous.y+d[1]*step))};mask.stroke(previous,keyboardPoint,brush);dirty=true;
  });
  glass.addEventListener('blur',()=>keyboardPoint=null);
  document.addEventListener('pointerdown',()=>keyboardNavigation=false);
  document.addEventListener('keydown',e=>{if(e.key==='Tab'){keyboardNavigation=true;showControls();return;}if(e.key==='Escape'){if(opening)stopCamera();keyboardPoint=null;hideControls();return;}if(e.target instanceof HTMLInputElement||e.target instanceof HTMLButtonElement)return;if(e.code==='Space'&&started){e.preventDefault();togglePause();}if(e.key.toLowerCase()==='r'&&started){mask.fresh();dirty=true;}});
  document.addEventListener('visibilitychange',()=>{lastRender=0;tracker.reset();mouth.reset();mouthOpen=false;clearTips();dirty=true;});
  window.addEventListener('pagehide',stopCamera);
  new ResizeObserver(resize).observe($('mirror'));resize();updateTrackingUi();requestAnimationFrame(animate);
})();
