// ------------------ CAMERA SETTINGS ------------------
  const camWidth = 1280;
  const camHeight = 720;

  const videoElement = document.querySelector('.input_video');
  const canvas = document.querySelector('.output_canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = camWidth;
  canvas.height = camHeight;
  canvas.style.width = '100vw';
  canvas.style.height = 'auto';

  let GRID_SIZE = 12;
  let CONFIDENCE_THRESHOLD = 0.5;
  let autoMode = false;

  document.getElementById("gridSize").oninput = e => GRID_SIZE = parseInt(e.target.value);
  document.getElementById("confidence").oninput = e => {
    CONFIDENCE_THRESHOLD = parseFloat(e.target.value);
    document.getElementById("confVal").innerText = CONFIDENCE_THRESHOLD;
  };
  document.getElementById("manualBtn").onclick = ()=> autoMode=false;
  document.getElementById("autoBtn").onclick = ()=> autoMode=true;

  // ------------------ ESP32 ------------------
  let socket;
  function connectESP32(ip){
    socket = new WebSocket(`ws://${ip}:81`);
    socket.onopen = () => console.log("Connected to ESP32");
    socket.onerror = err => console.log("WebSocket error", err);
  }

  // ------------------ PERSPECTIVE GRID ------------------
  let corners = [
    { x: 200, y: 200 },
    { x: camWidth-200, y: 200 },
    { x: camWidth-200, y: camHeight-200 },
    { x: 200, y: camHeight-200 }
  ];

  let dragging = null;
let hoverIndex = null;

// Convert pointer position (CSS space) → canvas pixel space
function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// Detect hover corner
function detectHover(pos) {
  hoverIndex = null;
  corners.forEach((c, i) => {
    if (Math.hypot(pos.x - c.x, pos.y - c.y) < 15) {
      hoverIndex = i;
    }
  });
}

// ----- POINTER DOWN -----
function pointerDown(e) {
  if (autoMode) return;

  const pos = getCanvasCoordinates(e);
  detectHover(pos);

  if (hoverIndex !== null) {
    dragging = hoverIndex;
  }
}

// ----- POINTER MOVE -----
function pointerMove(e) {
  const pos = getCanvasCoordinates(e);

  if (!autoMode) detectHover(pos);

  if (dragging !== null && !autoMode) {
    corners[dragging].x = pos.x;
    corners[dragging].y = pos.y;
  }
}

// ----- POINTER UP -----
function pointerUp() {
  dragging = null;
}

// Desktop
canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
canvas.addEventListener('mouseup', pointerUp);
canvas.addEventListener('mouseleave', pointerUp);

// Touch
canvas.addEventListener('touchstart', pointerDown, { passive: false });
canvas.addEventListener('touchmove', pointerMove, { passive: false });
canvas.addEventListener('touchend', pointerUp);

  function computeHomographies() {
    const src = cv.matFromArray(4,1,cv.CV_32FC2,[
      corners[0].x,corners[0].y,
      corners[1].x,corners[1].y,
      corners[2].x,corners[2].y,
      corners[3].x,corners[3].y
    ]);
    const dst = cv.matFromArray(4,1,cv.CV_32FC2,[0,0,1,0,1,1,0,1]);
    const H = cv.getPerspectiveTransform(src,dst);
    const Hinv = cv.getPerspectiveTransform(dst,src);
    src.delete(); dst.delete();
    return {H,Hinv};
  }

  function warpPoint(H,x,y){
    const src = cv.matFromArray(1,1,cv.CV_32FC2,[x,y]);
    const dst = new cv.Mat();
    cv.perspectiveTransform(src,dst,H);
    const out = { 
      x: dst.data32F[0], 
      y: dst.data32F[1] 
    };
    src.delete(); dst.delete();
    return out;
  }

  function drawPerspectiveGrid(Hinv){
    ctx.strokeStyle="rgba(255,255,255,0.3)";
    ctx.lineWidth=1;
    for(let i=0;i<=GRID_SIZE;i++){
      ctx.beginPath();
      for(let j=0;j<=GRID_SIZE;j++){
        const p=warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
        if(j===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
    }
    for(let j=0;j<=GRID_SIZE;j++){
      ctx.beginPath();
      for(let i=0;i<=GRID_SIZE;i++){
        const p=warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
        if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
    }
    corners.forEach((c,i)=>{
      ctx.beginPath();
      ctx.arc(c.x,c.y,10,0,2*Math.PI);

      if(autoMode){
        ctx.fillStyle = "lime";
      } else if(i === dragging){
        ctx.fillStyle = "orange";      // dragging
      } else if(i === hoverIndex){
        ctx.fillStyle = "cyan";        // hover highlight
      } else {
        ctx.fillStyle = "yellow";      // normal manual
      }

      ctx.fill();
    });
  }

  function highlightCell(Hinv,row,col,color){
    const p1 = warpPoint(Hinv,col/GRID_SIZE,row/GRID_SIZE);
    const p2 = warpPoint(Hinv,(col+1)/GRID_SIZE,row/GRID_SIZE);
    const p3 = warpPoint(Hinv,(col+1)/GRID_SIZE,(row+1)/GRID_SIZE);
    const p4 = warpPoint(Hinv,col/GRID_SIZE,(row+1)/GRID_SIZE);
    ctx.fillStyle=color; ctx.beginPath();
    ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.fill();
  }

  // ------------------ AR.js ------------------
  let arToolkitSource, arToolkitContext;
  let markers = {};

  function initAR() {
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({alpha:true});
    renderer.setSize(camWidth, camHeight);
    renderer.domElement.style.position='absolute';
    renderer.domElement.style.top='0px';
    renderer.domElement.style.left='0px';
    renderer.domElement.style.pointerEvents='none';
    document.body.appendChild(renderer.domElement);

    arToolkitSource = new THREEx.ArToolkitSource({
      sourceType:'webcam',
      sourceWidth: camWidth,
      sourceHeight: camHeight
    });
    arToolkitSource.init(()=>onResize());
    window.addEventListener('resize',()=>onResize());
    function onResize(){
      arToolkitSource.onResizeElement();
      arToolkitSource.copyElementSizeTo(renderer.domElement);
      if(arToolkitContext.arController)
        arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
    }

    arToolkitContext = new THREEx.ArToolkitContext({
      cameraParametersUrl:'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
      detectionMode:'mono'
    });
    arToolkitContext.init(()=>camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));

    const markerIDs = ['marker0.patt','marker1.patt','marker2.patt','marker3.patt'];
    markerIDs.forEach((id,index)=>{
      const markerRoot = new THREE.Group();
      scene.add(markerRoot);
      markers[index] = markerRoot;
      new THREEx.ArMarkerControls(arToolkitContext, markerRoot, { type:'pattern', patternUrl:id });
    });

    // ---------------- MIRRORED CORNERS PROJECTION ----------------
    function updateCornersFromMarkers(){
      if(!autoMode) return;
      Object.keys(markers).forEach(i=>{
        const m = markers[i];
        if(!m.visible) return;
        const projected = m.position.clone().project(camera); // [-1,1]
        // Mirror X to match mirrored video feed
        const x = canvas.width * (1 - (projected.x+1)/2);
        const y = canvas.height * (1 - (projected.y+1)/2);
        corners[i].x = x;
        corners[i].y = y;
      });
    }

    function render(){
      requestAnimationFrame(render);
      if(arToolkitSource.ready) arToolkitContext.update(arToolkitSource.domElement);
      updateCornersFromMarkers();
      renderer.render(scene,camera);
    }
    render();
  }
  initAR();

  // ------------------ OpenCV ------------------
  let cvReady = false;
  cv['onRuntimeInitialized']=()=>{ cvReady=true; };

  // ------------------ MediaPipe Pose ------------------
  const pose = new Pose({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
  pose.setOptions({ modelComplexity:1, smoothLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
  pose.onResults(onResults);

  const cameraMP = new Camera(videoElement,{ onFrame: async()=>{ await pose.send({image:videoElement}); }, width:camWidth, height:camHeight });
  cameraMP.start();

  // ------------------ Pose + Hand + Grid ------------------
  function onResults(results){
    if(!cvReady) return;

    ctx.save();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.scale(-1,1); // mirror video
    ctx.drawImage(results.image,-canvas.width,0,canvas.width,canvas.height);
    ctx.restore();

    const {H,Hinv} = computeHomographies();
    drawPerspectiveGrid(Hinv);

    if(!results.poseLandmarks) return;

    const hands = [
      { lm: results.poseLandmarks[15], color:"rgba(255,0,0,0.4)" },
      { lm: results.poseLandmarks[16], color:"rgba(0,0,255,0.4)" }
    ];

    let ledData = { left:null, right:null };
    hands.forEach((h,index)=>{
      if(h.lm.visibility<CONFIDENCE_THRESHOLD) return;
      const px = (1-h.lm.x)*canvas.width;
      const py = h.lm.y*canvas.height;
      const warped = warpPoint(H,px,py);
      if(warped.x>=0 && warped.x<=1 && warped.y>=0 && warped.y<=1){
        const col=Math.floor(warped.x*GRID_SIZE);
        const row=Math.floor(warped.y*GRID_SIZE);
        highlightCell(Hinv,row,col,h.color);
        const ledCol=Math.floor(col/(GRID_SIZE/3));
        const ledRow=Math.floor(row/(GRID_SIZE/3));
        if(index===0) ledData.left=[ledRow,ledCol]; else ledData.right=[ledRow,ledCol];
      }
      ctx.beginPath(); ctx.arc(px,py,6,0,2*Math.PI); ctx.fillStyle="white"; ctx.fill();
    });

    if(socket && socket.readyState===1) socket.send(JSON.stringify(ledData));
  }