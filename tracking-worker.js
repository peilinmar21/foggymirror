/* Camera pixels, hands, and facial landmarks are processed locally only. */
'use strict';
let hands=null,face=null,initializing=null,faceLoading=null,lastFaceAt=-Infinity,lastFace=[],faceError=null,busy=false;
const local=path=>new URL(path,self.location.href).href;
async function loadFace(){
  importScripts('./vendor/tfjs/face-detection.min.js','./vendor/tfjs/face-landmarks-detection.min.js');
  face=await faceLandmarksDetection.createDetector(faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,{
    runtime:'tfjs',refineLandmarks:false,maxFaces:1,
    detectorModelUrl:local('./vendor/tfjs/models/face-detector/model.json'),
    landmarkModelUrl:local('./vendor/tfjs/models/face-landmarks/model.json')
  });
}
async function initialize(){
  if(initializing)return initializing;
  initializing=(async()=>{
    importScripts('./vendor/tfjs/tf.min.js','./vendor/tfjs/tf-backend-wasm.min.js','./vendor/tfjs/hand-pose-detection.min.js');
    tf.wasm.setWasmPaths(local('./vendor/tfjs/wasm/'));tf.wasm.setThreadsCount(1);
    if(!await tf.setBackend('wasm'))throw new Error('The tracking runtime could not start.');await tf.ready();
    hands=await handPoseDetection.createDetector(handPoseDetection.SupportedModels.MediaPipeHands,{
      runtime:'tfjs',modelType:'lite',maxHands:2,
      detectorModelUrl:local('./vendor/tfjs/models/detector/model.json'),landmarkModelUrl:local('./vendor/tfjs/models/landmarks/model.json')
    });
    self.postMessage({type:'ready',faceReady:false,engine:'wasm'});
    // Loading mouth tracking never holds up the hand camera pipeline.
    faceLoading=loadFace().then(()=>self.postMessage({type:'face-ready'})).catch(error=>{faceError=error.message;self.postMessage({type:'face-error',message:error.message});});
  })();return initializing;
}
self.onmessage=async({data})=>{
  if(data.type==='init'){try{await initialize();}catch(error){self.postMessage({type:'error',message:error.message});}return;}
  if(data.type!=='frame')return;
  if(busy||!hands){self.postMessage({type:'frame-done',frameId:data.frameId});return;}
  busy=true;const started=performance.now();
  try{
    const pixels=new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height);
    const found=await hands.estimateHands(pixels,{flipHorizontal:false,staticImageMode:false});
    const usable=found.filter(hand=>(hand.score??1)>.45&&hand.keypoints?.length===21);
    let faceUpdated=false;
    if(face&&data.timestamp-lastFaceAt>=180){
      try{const faces=await face.estimateFaces(pixels,{flipHorizontal:false,staticImageMode:false});lastFace=faces[0]?.keypoints||[];faceUpdated=true;lastFaceAt=data.timestamp;}
      catch(error){lastFace=[];faceUpdated=true;faceError=error.message;self.postMessage({type:'face-error',message:error.message});face?.dispose?.();face=null;}
    }
    self.postMessage({
      type:'landmarks',frameId:data.frameId,timestamp:data.timestamp,inferenceMs:performance.now()-started,
      landmarks:usable.map(hand=>hand.keypoints.map(p=>({x:p.x/data.width,y:p.y/data.height,z:0}))),worldLandmarks:usable.map(hand=>hand.keypoints3D||[]),
      faceUpdated,faceLandmarks:lastFace,faceReady:!!face,faceError
    });
  }catch(error){self.postMessage({type:'frame-error',frameId:data.frameId,message:error.message});}
  finally{busy=false;self.postMessage({type:'frame-done',frameId:data.frameId});}
};
