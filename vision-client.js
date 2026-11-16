/* Captures real HTMLVideoElement camera pixels without a GPU/bitmap dependency. */
(function(root){
  'use strict';
  class VisionClient{
    constructor(video,{onResult,onStatus,onError,workerUrl='./tracking-worker.js?v=3'}={}){
      this.video=video;this.onResult=onResult||(()=>{});this.onStatus=onStatus||(()=>{});this.onError=onError||(()=>{});this.workerUrl=workerUrl;
      this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('2d',{willReadFrequently:true});this.worker=null;this.ready=false;this.busy=false;this.lastVideoTime=-1;this.lastSent=0;this.frameId=0;this.timer=null;this.startTimer=null;
    }
    start(){
      this.stop();this.onStatus('Loading hand tracking…');
      try{this.worker=new Worker(this.workerUrl);}catch(error){this.onError(error);return;}
      const current=this.worker;
      current.onmessage=({data})=>{
        if(this.worker!==current)return;
        if(data.type==='ready'){clearTimeout(this.startTimer);this.ready=true;this.onStatus(data.faceReady?'Hand + mouth tracking ready':'Hand tracking ready · mouth loading');}
        else if(data.type==='face-ready')this.onStatus('Hand + mouth tracking ready');
        else if(data.type==='face-error')this.onStatus('Hand tracking ready · mouth unavailable');
        else if(data.type==='landmarks'){this.onResult(data);}
        else if(data.type==='frame-done'){this.busy=false;clearTimeout(this.timer);}
        else if(data.type==='frame-error'){this.onStatus('Tracking retrying…');this.onError(new Error(data.message),false);}
        else if(data.type==='error'){this.onError(new Error(data.message));this.stop();}
      };
      current.onerror=event=>{if(this.worker===current){this.onError(new Error(event.message||'Tracking worker failed'));this.stop();}};
      this.startTimer=setTimeout(()=>{if(this.worker===current&&!this.ready){this.onError(new Error('Tracking models took too long to load. Try tracking again.'));this.stop();}},90000);
      current.postMessage({type:'init'});
    }
    capture(now){
      const video=this.video;
      if(!this.worker||!this.ready||this.busy||document.hidden||video.readyState<2||!video.videoWidth||video.currentTime===this.lastVideoTime||now-this.lastSent<55)return;
      const width=320,height=Math.max(1,Math.round(width*video.videoHeight/video.videoWidth));
      if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
      try{
        this.context.drawImage(video,0,0,width,height);
        const image=this.context.getImageData(0,0,width,height);
        this.busy=true;this.lastVideoTime=video.currentTime;this.lastSent=now;
        const frameId=++this.frameId,current=this.worker;
        // No queue: only the current frame is in flight, so lag cannot accumulate.
        current.postMessage({type:'frame',pixels:image.data.buffer,width,height,timestamp:now,frameId},[image.data.buffer]);
        clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.worker===current&&this.busy){this.onError(new Error('Camera tracking stopped responding. Restart tracking.'));this.stop();}},15000);
      }catch(error){this.busy=false;this.onError(error,false);}
    }
    stop(){clearTimeout(this.timer);clearTimeout(this.startTimer);if(this.worker)this.worker.terminate();this.worker=null;this.ready=false;this.busy=false;this.lastVideoTime=-1;}
  }
  root.VisionClient=VisionClient;
})(typeof globalThis!=='undefined'?globalThis:this);
