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

let GRID_SIZE = 5;
let CONFIDENCE_THRESHOLD = 0.5;
let autoMode = false;
let latestBuffer = null;

// ---------------------- HOLD-TO-FILL & PERSISTENT FILLS ----------------------
let holdTimers = { left: {}, right: {} };
const HOLD_DURATION = 1000; // milliseconds

let filledCells = { left: {}, right: {} };
let filledSequence = []; // for end-climb animation
let reviewMode = false;  // true when showing end-climb replay

// Muted colors
const HAND_COLORS = { left: "rgba(180,100,100,0.4)", right: "rgba(100,100,180,0.4)" };
const FILLED_COLORS = { left: "rgba(180,100,100,0.25)", right: "rgba(100,100,180,0.25)" };

// ---------------------- RESET BUTTON ----------------------
const resetBtn = document.getElementById("resetBtn");
if(resetBtn){
  resetBtn.addEventListener("click", () => {
    filledCells.left = {};
    filledCells.right = {};
    holdTimers.left = {};
    holdTimers.right = {};
    filledSequence = [];
  });
}

// ---------------------- GRID SIZE RESET ----------------------
const gridInput = document.getElementById("gridSize");
if(gridInput){
  gridInput.addEventListener("input", () => {
    filledCells.left = {};
    filledCells.right = {};
    holdTimers.left = {};
    holdTimers.right = {};
    filledSequence = [];
  });
}

document.getElementById("gridSize").oninput = e => GRID_SIZE = parseInt(e.target.value);
document.getElementById("confidence").oninput = e => {
  CONFIDENCE_THRESHOLD = parseFloat(e.target.value);
  document.getElementById("confVal").innerText = CONFIDENCE_THRESHOLD;
};
document.getElementById("manualBtn").onclick = ()=> autoMode=false;
document.getElementById("autoBtn").onclick = ()=> autoMode=true;

function markFilledCell(hand, row, col){
  const key = `${row},${col}`;
  if(hand === 'left'){
    if(!filledCells.left[key]){
      filledCells.left[key] = true;
      filledSequence.push({hand:'left', row, col});
    }
  } else {
    if(!filledCells.right[key]){
      filledCells.right[key] = true;
      filledSequence.push({hand:'right', row, col});
    }
  }
}

// ------------------ ESP32 BLE ------------------
let device;
let characteristic;

async function connectBLE(){
  device = await navigator.bluetooth.requestDevice({
    filters: [{ name: "ESP32_LED_GRID" }],
    optionalServices: ["12345678-1234-1234-1234-1234567890ab"]
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService("12345678-1234-1234-1234-1234567890ab");
  characteristic = await service.getCharacteristic("abcdefab-1234-1234-1234-abcdefabcdef");
  console.log("Connected to ESP32 via BLE");
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

function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;

  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function detectHover(pos) {
  hoverIndex = null;
  corners.forEach((c, i) => {
    if (Math.hypot(pos.x - c.x, pos.y - c.y) < 15) hoverIndex = i;
  });
}

function pointerDown(e){
  if(autoMode || reviewMode) return;
  const pos = getCanvasCoordinates(e);
  detectHover(pos);
  if(hoverIndex!==null) dragging = hoverIndex;
}
function pointerMove(e){
  const pos = getCanvasCoordinates(e);
  if(!autoMode && !reviewMode) detectHover(pos);
  if(dragging!==null && !autoMode && !reviewMode){
    corners[dragging].x = pos.x;
    corners[dragging].y = pos.y;
  }
}
function pointerUp(){ dragging=null; }

canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
canvas.addEventListener('mouseup', pointerUp);
canvas.addEventListener('mouseleave', pointerUp);
canvas.addEventListener('touchstart', pointerDown,{passive:false});
canvas.addEventListener('touchmove', pointerMove,{passive:false});
canvas.addEventListener('touchend', pointerUp);

function computeHomographies(){
  const src = cv.matFromArray(4,1,cv.CV_32FC2,[corners[0].x,corners[0].y,corners[1].x,corners[1].y,corners[2].x,corners[2].y,corners[3].x,corners[3].y]);
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
  const out = { x: dst.data32F[0], y: dst.data32F[1] };
  src.delete(); dst.delete();
  return out;
}

// Hover scales
const hoverScales = new Array(corners.length).fill(0);

function drawPerspectiveGrid(Hinv){
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;

  for(let i=0;i<=GRID_SIZE;i++){
    ctx.beginPath();
    for(let j=0;j<=GRID_SIZE;j++){
      const p = warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
      if(j===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  }

  for(let j=0;j<=GRID_SIZE;j++){
    ctx.beginPath();
    for(let i=0;i<=GRID_SIZE;i++){
      const p = warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
      if(i===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  }

  const animationStep = 0.25;
  corners.forEach((c,i)=>{
    if(i===hoverIndex) hoverScales[i]+=animationStep;
    else hoverScales[i]-=animationStep;
    if(hoverScales[i]>1) hoverScales[i]=1;
    if(hoverScales[i]<0) hoverScales[i]=0;
  });

  corners.forEach((c,i)=>{
    const radius=6;
    let innerColor,outerColor=null,drawOuter=false;
    if(autoMode) innerColor="#649664";
    else if(i===dragging){ innerColor="#6496C8"; outerColor="#6496C8"; drawOuter=true; }
    else if(i===hoverIndex){ innerColor="#FFFFFF"; outerColor="#FFFFFF"; drawOuter=true; }
    else innerColor="#FFFFFF";

    ctx.beginPath();
    ctx.arc(c.x,c.y,radius,0,2*Math.PI);
    ctx.fillStyle=innerColor;
    ctx.fill();

    if(drawOuter && outerColor){
      ctx.beginPath();
      const outerRadius = radius+3*hoverScales[i];
      ctx.arc(c.x,c.y,outerRadius,0,2*Math.PI);
      ctx.strokeStyle=outerColor;
      ctx.lineWidth=2;
      ctx.stroke();
    }
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
let arToolkitSource, arToolkitContext, markers={};
function initAR(){
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({alpha:true});
  renderer.setSize(camWidth,camHeight);
  renderer.domElement.style.position='absolute';
  renderer.domElement.style.top='0px';
  renderer.domElement.style.left='0px';
  renderer.domElement.style.pointerEvents='none';
  document.body.appendChild(renderer.domElement);

  arToolkitSource = new THREEx.ArToolkitSource({ sourceType:'webcam', sourceWidth:camWidth, sourceHeight:camHeight });
  arToolkitSource.init(()=>onResize());
  window.addEventListener('resize',()=>onResize());
  function onResize(){
    arToolkitSource.onResizeElement();
    arToolkitSource.copyElementSizeTo(renderer.domElement);
    if(arToolkitContext.arController) arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
  }

  arToolkitContext = new THREEx.ArToolkitContext({ cameraParametersUrl:'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat', detectionMode:'mono' });
  arToolkitContext.init(()=>camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));

  const markerIDs = ['marker0.patt','marker1.patt','marker2.patt','marker3.patt'];
  markerIDs.forEach((id,index)=>{
    const markerRoot = new THREE.Group();
    scene.add(markerRoot);
    markers[index]=markerRoot;
    new THREEx.ArMarkerControls(arToolkitContext, markerRoot, { type:'pattern', patternUrl:id });
  });

  function updateCornersFromMarkers(){
    if(!autoMode) return;
    Object.keys(markers).forEach(i=>{
      const m = markers[i];
      if(!m.visible) return;
      const projected = m.position.clone().project(camera);
      const x = canvas.width * (1-(projected.x+1)/2);
      const y = canvas.height * (1-(projected.y+1)/2);
      corners[i].x=x; corners[i].y=y;
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
let cvReady=false;
cv['onRuntimeInitialized']=()=>{ cvReady=true; };

// ------------------ MediaPipe Pose ------------------
const pose = new Pose({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
pose.setOptions({ modelComplexity:1, smoothLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
pose.onResults(onResults);

const cameraMP = new Camera(videoElement,{ onFrame: async()=>{ await pose.send({image:videoElement}); }, width:camWidth, height:camHeight });
cameraMP.start();

// ------------------ Pose + Hand + Grid ------------------
function onResults(results){
  if(reviewMode) return; // <-- just skip drawing, camera keeps running
    if(!cvReady) return;

    ctx.save();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.scale(-1,1);
    ctx.drawImage(results.image,-canvas.width,0,canvas.width,canvas.height);
    ctx.restore();

  const {H,Hinv} = computeHomographies();
  drawPerspectiveGrid(Hinv);

  const now = performance.now();
  let ledData = { left:null, right:null };

  if(results.poseLandmarks){
    const hands = [
      { lm: results.poseLandmarks[15], color: HAND_COLORS.left },
      { lm: results.poseLandmarks[16], color: HAND_COLORS.right }
    ];

    hands.forEach((h,index)=>{
      if(h.lm.visibility < CONFIDENCE_THRESHOLD) return;
      const px = (1-h.lm.x)*canvas.width;
      const py = h.lm.y*canvas.height;
      const warped = warpPoint(H,px,py);

      if(warped.x>=0 && warped.x<=1 && warped.y>=0 && warped.y<=1){
        const col = Math.floor(warped.x*GRID_SIZE);
        const row = Math.floor(warped.y*GRID_SIZE);

        highlightCell(Hinv,row,col,index===0?HAND_COLORS.left:HAND_COLORS.right);

        if(index===0){ 
          ledData.left = [Math.floor(col/(GRID_SIZE/3)), Math.floor(row/(GRID_SIZE/3))];
          const key=`${row},${col}`;
          if(holdTimers.left[key]){
            if(now-holdTimers.left[key]>=HOLD_DURATION) markFilledCell('left',row,col);
          } else { holdTimers.left={}; holdTimers.left[key]=now; }
        } else {
          ledData.right = [Math.floor(col/(GRID_SIZE/3)), Math.floor(row/(GRID_SIZE/3))];
          const key=`${row},${col}`;
          if(holdTimers.right[key]){
            if(now-holdTimers.right[key]>=HOLD_DURATION) markFilledCell('right',row,col);
          } else { holdTimers.right={}; holdTimers.right[key]=now; }
        }
      }

      ctx.beginPath();
      ctx.arc(px,py,6,0,2*Math.PI);
      ctx.fillStyle="white";
      ctx.fill();
    });
  } else { holdTimers.left={}; holdTimers.right={}; }

  Object.keys(filledCells.left).forEach(k=>{
    const [row,col]=k.split(",").map(Number);
    highlightCell(Hinv,row,col,FILLED_COLORS.left);
  });
  Object.keys(filledCells.right).forEach(k=>{
    const [row,col]=k.split(",").map(Number);
    highlightCell(Hinv,row,col,FILLED_COLORS.right);
  });

  H.delete(); Hinv.delete();

  if(characteristic){
    const buffer=new Uint8Array(4);
    if(ledData.left){ buffer[0]=ledData.left[0]; buffer[1]=ledData.left[1]; }
    else { buffer[0]=255; buffer[1]=255; }
    if(ledData.right){ buffer[2]=ledData.right[0]; buffer[3]=ledData.right[1]; }
    else { buffer[2]=255; buffer[3]=255; }
    latestBuffer=buffer;
  }
}

setInterval(()=>{
  if(!characteristic || !latestBuffer) return;
  characteristic.writeValueWithoutResponse(latestBuffer);
},50);

// ------------------ CANVAS RESIZE ------------------
function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let newWidth = vw;
  let newHeight = vw * (camHeight / camWidth);

  if (newHeight > vh) {
    const scale = vh / newHeight;
    newWidth *= scale;
    newHeight *= scale;
  }

  const scaleX = newWidth / canvas.width;
  const scaleY = newHeight / canvas.height;

  // Scale corners proportionally
  corners.forEach(c => {
    c.x *= scaleX;
    c.y *= scaleY;
  });

  canvas.width = newWidth;
  canvas.height = newHeight;
  canvas.style.width = `${newWidth}px`;
  canvas.style.height = `${newHeight}px`;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ------------------ END CLIMB / REPLAY ------------------
function highlightCellSimple(row, col, color) {
  const { gridWidth, gridHeight, offsetX, offsetY } = getReplayGridDimensions();
  const wStep = gridWidth / GRID_SIZE;
  const hStep = gridHeight / GRID_SIZE;
  ctx.fillStyle = color;
  ctx.fillRect(offsetX + col * wStep, offsetY + row * hStep, wStep, hStep);
}

function hideControls() {
  const topBar = document.querySelector('.top-controls');
  const bottomBar = document.querySelector('.bottom-controls');

  const topHeight = topBar.offsetHeight + 20;      // extra margin
  const bottomHeight = bottomBar.offsetHeight + 20;

  topBar.style.transition = 'transform 0.5s ease';
  bottomBar.style.transition = 'transform 0.5s ease';

  topBar.style.transform = `translate(-50%, -${topHeight}px)`;
  bottomBar.style.transform = `translate(-50%, ${bottomHeight}px)`;

  setTimeout(() => {
    topBar.style.transform = `translate(-50%, -500px)`;
  }, 500);
}

function showControls() {
  const topBar = document.querySelector('.top-controls');
  const bottomBar = document.querySelector('.bottom-controls');
  topBar.style.transform = 'translate(-50%, 0)';
  bottomBar.style.transform = 'translate(-50%, 0)';
}

function showReplayBar() {
  const replayBar = document.getElementById('replayBar');
  const height = replayBar.offsetHeight + 20;

  replayBar.style.display = 'flex';

  // 1️⃣ Set initial position offscreen
  replayBar.style.transform = `translate(-50%, ${height}px)`;

  // 2️⃣ Set transition
  replayBar.style.transition = 'transform 0.5s ease';

  // 3️⃣ Force reflow
  replayBar.getBoundingClientRect();

  // 4️⃣ Move to final position (slide up)
  replayBar.style.transform = 'translate(-50%, 0)';
}

function hideReplayBar() {
  const replayBar = document.getElementById('replayBar');
  const height = replayBar.offsetHeight + 20;

  // Set transition (if not already)
  replayBar.style.transition = 'transform 0.5s ease';

  // Slide down
  replayBar.style.transform = `translate(-50%, ${height}px)`;

  replayBar.addEventListener('transitionend', () => {
    replayBar.style.display = 'none';
  }, { once: true });
}

// ------------------ END CLIMB / REPLAY ------------------
function getReplayGridDimensions() {
  const gridHeight = canvas.height * 0.7;
  const gridWidth = gridHeight; // square grid
  const offsetX = (canvas.width - gridWidth) / 2;
  const offsetY = (canvas.height - gridHeight) / 2;
  return { gridWidth, gridHeight, offsetX, offsetY };
}

function drawSimpleGrid() {
  const { gridWidth, gridHeight, offsetX, offsetY } = getReplayGridDimensions();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;

  const wStep = gridWidth / GRID_SIZE;
  const hStep = gridHeight / GRID_SIZE;

  for (let i = 0; i <= GRID_SIZE; i++) {
    // vertical
    ctx.beginPath();
    ctx.moveTo(offsetX + i * wStep, offsetY);
    ctx.lineTo(offsetX + i * wStep, offsetY + gridHeight);
    ctx.stroke();
    // horizontal
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + i * hStep);
    ctx.lineTo(offsetX + gridWidth, offsetY + i * hStep);
    ctx.stroke();
  }
}

function highlightCellSimple(row, col, color) {
  const { gridWidth, gridHeight, offsetX, offsetY } = getReplayGridDimensions();
  const wStep = gridWidth / GRID_SIZE;
  const hStep = gridHeight / GRID_SIZE;
  ctx.fillStyle = color;
  ctx.fillRect(offsetX + col * wStep, offsetY + row * hStep, wStep, hStep);
}

function endClimb() {
  if (reviewMode) return;
  if (filledSequence.length === 0) {
    alert("No moves recorded to replay!");
    return;
  }

  reviewMode = true;

  // 1️⃣ Draw grid immediately
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSimpleGrid();

  // 2️⃣ Hide top/bottom bars
  hideControls();

  const replayBar = document.getElementById('replayBar');
  const replaySlider = document.getElementById('replaySlider');
  const replayResetBtn = document.getElementById('replayResetBtn');
  const bottomBar = document.querySelector('.bottom-controls');

  // 3️⃣ Configure slider
  replaySlider.min = 0;
  replaySlider.max = filledSequence.length;
  replaySlider.value = 0;

  let currentIndex = 0;
  let animating = true;
  let intervalId;

  function redrawFromSlider(idx) {
    drawSimpleGrid();
    for (let i = 0; i < idx; i++) {
      const item = filledSequence[i];
      const color = item.hand === 'left' ? FILLED_COLORS.left : FILLED_COLORS.right;
      highlightCellSimple(item.row, item.col, color);
    }
    currentIndex = idx;
    replaySlider.value = idx;
  }

  // 4️⃣ When bottom bar finishes sliding, show replay bar
  function showReplayAfterBottom() {
    bottomBar.removeEventListener('transitionend', showReplayAfterBottom);

    // small delay before showing replay bar
    const delay = 200; // milliseconds
    setTimeout(() => {
      const height = replayBar.offsetHeight + 20;
      replayBar.style.display = 'flex';
      replayBar.style.transition = 'transform 0.5s ease';
      replayBar.style.transform = `translate(-50%, ${height}px)`; // start offscreen

      // force reflow
      replayBar.getBoundingClientRect();

      // slide up
      requestAnimationFrame(() => {
        replayBar.style.transform = 'translate(-50%, 0)';
      });

      // start animation after replay bar finishes sliding
      replayBar.addEventListener('transitionend', () => {
        intervalId = setInterval(() => {
          if (animating && currentIndex < filledSequence.length) {
            redrawFromSlider(currentIndex + 1);
          } else if (currentIndex >= filledSequence.length) {
            clearInterval(intervalId);
          }
        }, 200);
      }, { once: true });

    }, delay);
  }

  bottomBar.addEventListener('transitionend', showReplayAfterBottom);

  // 5️⃣ Slider interaction
  ['input','mousedown','mouseup','touchstart','touchend'].forEach(evt => {
    replaySlider.addEventListener(evt, e => {
      if (evt === 'input') {
        animating = false;
        redrawFromSlider(parseInt(e.target.value));
      } else if (evt === 'mousedown' || evt === 'touchstart') animating = false;
      else if (evt === 'mouseup' || evt === 'touchend') animating = true;
    });
  });

  // 6️⃣ Reset button
  replayResetBtn.onclick = () => {
    clearInterval(intervalId);
    hideReplayBar();
    filledCells.left = {};
    filledCells.right = {};
    holdTimers.left = {};
    holdTimers.right = {};
    filledSequence.length = 0;
    reviewMode = false;
    showControls();
  };

  // 7️⃣ Handle window resize mid-replay
  window.addEventListener('resize', () => {
    if (reviewMode) redrawFromSlider(currentIndex);
  });
}
