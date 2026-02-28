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
let holdTimers = {
  leftHand: {},
  rightHand: {},
  leftFoot: {},
  rightFoot: {}
};

let filledCells = {
  leftHand: {},
  rightHand: {},
  leftFoot: {},
  rightFoot: {}
};

const HOLD_DURATION = 1000; // milliseconds

let filledSequence = []; // for end-climb animation
let reviewMode = false;  // true when showing end-climb replay

// Muted colors
const LIMB_COLORS = {
  leftHand: "rgba(180,100,100,0.4)",
  rightHand: "rgba(100,100,180,0.4)",
  leftFoot: "rgba(100,180,100,0.4)",
  rightFoot: "rgba(180,180,100,0.4)"
};

const FILLED_COLORS = {
  leftHand: "rgba(180,100,100,0.25)",
  rightHand: "rgba(100,100,180,0.25)",
  leftFoot: "rgba(100,180,100,0.25)",
  rightFoot: "rgba(180,180,100,0.25)"
};

// ------------------ HAND SPEED TRACKING ------------------
let speedHistory = {
  leftHand: [],
  rightHand: [],
  leftFoot: [],
  rightFoot: []
};
const SPEED_WINDOW = 5; // rolling average over last 5 moves

// ---------------------- RESET BUTTON ----------------------
const resetBtn = document.getElementById("resetBtn");
if(resetBtn){
  resetBtn.addEventListener("click", () => {
    Object.keys(filledCells).forEach(l => filledCells[l] = {});
    Object.keys(holdTimers).forEach(l => holdTimers[l] = {});
    filledSequence = [];
  });
}

// ---------------------- GRID SIZE RESET ----------------------
const gridInput = document.getElementById("gridSize");
if(gridInput){
  gridInput.addEventListener("input", () => {
    Object.keys(filledCells).forEach(l => filledCells[l] = {});
    Object.keys(holdTimers).forEach(l => holdTimers[l] = {});
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

let moveCounter = 0; // Add this near the top, after your filledSequence declaration

function markFilledCell(limb, row, col){
  const key = `${row},${col}`;
  const now = performance.now();

  // Determine hold duration from holdTimers
  let duration = 0;
  if(holdTimers[limb][key]){
    duration = holdTimers[limb][key].total || (now - holdTimers[limb][key].start);
  }

  // Only create new move if it doesn't exist
  if(!filledCells[limb][key]){
    filledCells[limb][key] = true;
    filledSequence.push({
      sequence: ++moveCounter,
      limb: limb,    
      row,
      col,
      timestamp: now,
      duration
    });
  } else {
    // Update duration if already filled (limb held longer)
    const move = filledSequence.find(m => m.limb===limb && m.row===row && m.col===col);
    if(move) move.duration = Math.max(move.duration, duration);
  }

  updateStatsUI();  
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

// ------------------ Hand Speed Rolling Average ------------------
function computeLimbSpeeds() {
  const speeds = {};

  const limbs = ['leftHand','rightHand','leftFoot','rightFoot'];

  limbs.forEach(limb => {
    const moves = filledSequence.filter(m => m.limb === limb);
    speeds[limb] = { values: [], avg: 0 };

    if(moves.length >= 2){
      for(let i = 1; i < moves.length; i++){
        const prev = moves[i-1];
        const curr = moves[i];

        const dx = curr.col - prev.col;
        const dy = curr.row - prev.row;
        const dist = Math.hypot(dx, dy);

        const dt = (curr.timestamp - prev.timestamp) / 1000;
        const speed = dt > 0 ? dist / dt : 0;

        speeds[limb].values.push(speed);
      }

      speeds[limb].avg = speeds[limb].values.length
        ? speeds[limb].values.reduce((a,b)=>a+b,0) / speeds[limb].values.length
        : 0;
    }
  });

  return speeds;
}

function updateLimbSpeedPanel() {
  const speeds = computeLimbSpeeds();

  let panel = document.getElementById('handSpeedPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'handSpeedPanel';
    panel.style.position = 'fixed';
    panel.style.top = '20px';
    panel.style.left = '20px';
    panel.style.padding = '8px 12px';
    panel.style.background = 'rgba(0,0,0,0.6)';
    panel.style.color = 'white';
    panel.style.borderRadius = '8px';
    panel.style.fontFamily = 'appFont';
    panel.style.fontSize = '14px';
    panel.style.zIndex = 1000;
    document.body.appendChild(panel);
  }

  // Store history
  Object.keys(speedHistory).forEach(limb => {
    speedHistory[limb].push(speeds[limb].avg);
    if(speedHistory[limb].length > 50)
      speedHistory[limb].shift();
  });

  panel.innerHTML = `
    LH: ${speeds.leftHand.avg.toFixed(2)} moves/sec<br>
    RH: ${speeds.rightHand.avg.toFixed(2)} moves/sec<br>
    LF: ${speeds.leftFoot.avg.toFixed(2)} moves/sec<br>
    RF: ${speeds.rightFoot.avg.toFixed(2)} moves/sec
  `;
}

// ------------------ Pose + Hand + Grid ------------------
function onResults(results){
  if(reviewMode) return; // skip drawing in review mode
  if(!cvReady) return;

  ctx.save();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.scale(-1,1);
  ctx.drawImage(results.image,-canvas.width,0,canvas.width,canvas.height);
  ctx.restore();

  const {H,Hinv} = computeHomographies();
  drawPerspectiveGrid(Hinv);

  const now = performance.now();
  let ledData = {
    leftHand: null,
    rightHand: null,
    leftFoot: null,
    rightFoot: null
  };

  if(results.poseLandmarks){
    const limbs = [
      { name: 'leftHand',  lm: results.poseLandmarks[15] },  // LEFT_WRIST
      { name: 'rightHand', lm: results.poseLandmarks[16] },  // RIGHT_WRIST
      { name: 'leftFoot',  lm: results.poseLandmarks[27] },  // LEFT_ANKLE
      { name: 'rightFoot', lm: results.poseLandmarks[28] }   // RIGHT_ANKLE
    ];

    limbs.forEach(limb => {
      if(!limb.lm || limb.lm.visibility < CONFIDENCE_THRESHOLD) return;

      const limbName = limb.name;

      const px = (1 - limb.lm.x) * canvas.width;
      const py = limb.lm.y * canvas.height;

      const warped = warpPoint(H, px, py);

      if(warped.x>=0 && warped.x<=1 && warped.y>=0 && warped.y<=1){

        const col = Math.floor(warped.x*GRID_SIZE);
        const row = Math.floor(warped.y*GRID_SIZE);
        const key = `${row},${col}`;

        ledData[limbName] = [row, col];

        highlightCell(Hinv,row,col,LIMB_COLORS[limbName]);

        if(!holdTimers[limbName][key]){
          holdTimers[limbName][key] = { start: performance.now(), total: 0 };
        } else {
          holdTimers[limbName][key].total =
            performance.now() - holdTimers[limbName][key].start;
        }

        const progress =
          Math.min(holdTimers[limbName][key].total / HOLD_DURATION, 1);

        ctx.beginPath();
        ctx.arc(px, py, 8, -Math.PI/2, -Math.PI/2 + progress*2*Math.PI);
        ctx.strokeStyle = LIMB_COLORS[limbName];
        ctx.lineWidth = 2;
        ctx.stroke();

        if(progress >= 1) markFilledCell(limbName,row,col);
      }

      ctx.beginPath();
      ctx.arc(px,py,6,0,2*Math.PI);
      ctx.fillStyle="white";
      ctx.fill();
    });

  } else {
    Object.keys(holdTimers).forEach(l => holdTimers[l] = {});
  }

  // Draw filled cells
  Object.keys(filledCells).forEach(limbName => {
    Object.keys(filledCells[limbName]).forEach(k=>{
      const [row,col]=k.split(",").map(Number);
      highlightCell(Hinv,row,col,FILLED_COLORS[limbName]);
    });
  });

  // ------------------ HAND SPEED PANEL ------------------
  updateLimbSpeedPanel();

  H.delete(); Hinv.delete();

  // ------------------ ESP32 LED update ------------------
  if(characteristic){
    const buffer = new Uint8Array(8);

    const limbsOrder = [
      'leftHand',
      'rightHand',
      'leftFoot',
      'rightFoot'
    ];

    limbsOrder.forEach((limb, i) => {
      if(ledData[limb]){
        buffer[i*2]     = ledData[limb][0]; // row
        buffer[i*2 + 1] = ledData[limb][1]; // col
      } else {
        buffer[i*2]     = 255;
        buffer[i*2 + 1] = 255;
      }
    });

    latestBuffer = buffer;
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

// ------------------ CURRENT MOVE PANEL ------------------
function updateCurrentMovePanel(idx) {
  const panel = document.getElementById('currentMovePanel');

  if (idx < 0 || idx >= filledSequence.length) {
    panel.style.display = 'none';
    return;
  }

  const move = filledSequence[idx];
  panel.style.display = 'block';

  const limb = move.limb;
  const isHand = limb.includes('Hand');
  const isLeft = limb.includes('left');

  const limbText = limb
    .replace('Hand',' HAND')
    .replace('Foot',' FOOT')
    .toUpperCase();

  const seconds = move.duration / 1000;
  const durationSec = seconds.toFixed(1);

  const overlayImage =
    isHand
      ? (isLeft ? 'images/l-hand.png' : 'images/r-hand.png')
      : (isLeft ? 'images/l-foot.png' : 'images/r-foot.png');

  panel.innerHTML = `
    <div style="position:relative; width:100%; margin-bottom:14px;">

      <img src="images/bg.png"
           style="width:100%; height:auto; display:block; object-fit:contain;">

      <img id="panelOverlay"
           src="${overlayImage}"
           style="
             position:absolute;
             top:0;
             left:0;
             width:100%;
             height:100%;
             object-fit:contain;
             opacity:0;
             transition:opacity 0.2s ease;
           ">

      <div id="moveBadge"
           style="
             position:absolute;
             top:8px;
             right:8px;
             background:rgba(0,0,0,0.6);
             padding:4px 8px;
             font-size:11px;
             font-weight:600;
             letter-spacing:1px;
             border-radius:12px;
             backdrop-filter:blur(4px);
             transform:scale(0.8);
             opacity:0;
             transition:all 0.25s ease;
           ">
        #${idx + 1}
      </div>
    </div>

    <div id="panelTextBlock"
         style="
           display:flex;
           flex-direction:column;
           gap:6px;
           text-transform:uppercase;
           letter-spacing:1px;
         ">

      <div style="font-size:16px; font-weight:600;">
        ${limbText}
      </div>

      <div style="font-size:12px; opacity:0.8;">
        ROW ${move.row}  •  COL ${move.col}
      </div>

      <div style="font-size:12px; opacity:0.8;">
        HOLD TIME ${durationSec}S
      </div>

    </div>
  `;

  const overlay = document.getElementById('panelOverlay');
  const badge = document.getElementById('moveBadge');

  let opacity = seconds / 10;
  opacity = Math.max(0, Math.min(opacity, 1));
  overlay.style.opacity = opacity;

  requestAnimationFrame(() => {
    badge.style.opacity = 1;
    badge.style.transform = 'scale(1.15)';
    setTimeout(() => {
      badge.style.transform = 'scale(1)';
    }, 120);
  });
}

function hideCurrentMovePanel() {
  document.getElementById('currentMovePanel').style.display = 'none';
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

function computeStats() {
  const stats = {
    totalMoves: filledSequence.length,
    leftMoves: filledSequence.filter(m => m.limb==='leftHand').length,
    rightMoves: filledSequence.filter(m => m.limb==='rightHand').length,
    leftFootMoves: filledSequence.filter(m => m.limb==='leftFoot').length,
    rightFootMoves: filledSequence.filter(m => m.limb==='rightFoot').length,
    avgHoldLeft: 0,
    avgHoldRight: 0,
    maxHold: 0
  };

  const leftDurations = filledSequence
    .filter(m => m.limb==='leftHand')
    .map(m => m.duration);

  const rightDurations = filledSequence
    .filter(m => m.limb==='rightHand')
    .map(m => m.duration);

  stats.avgHoldLeft = leftDurations.length
    ? leftDurations.reduce((a,b)=>a+b,0)/leftDurations.length
    : 0;

  stats.avgHoldRight = rightDurations.length
    ? rightDurations.reduce((a,b)=>a+b,0)/rightDurations.length
    : 0;

  stats.maxHold = filledSequence.length
    ? Math.max(...filledSequence.map(m=>m.duration))
    : 0;

  return stats;
}

function updateStatsUI() {
  const stats = computeStats();
  // stats are computed internally and used in code, but not displayed
}

function showReplayPanel() {
  const panel = document.getElementById('replayPanel');
  const { gridWidth, gridHeight, offsetX, offsetY } = getReplayGridDimensions();

  const padding = 16; // extra pixels around the grid
  panel.style.width = gridWidth + padding * 2 + "px";
  panel.style.height = gridHeight + padding * 2 + "px";

  panel.style.display = "block";
}

function hideReplayPanel() {
  const panel = document.getElementById('replayPanel');
  panel.style.display = "none";
}

// Optional: handle resize while replaying
window.addEventListener("resize", () => {
  if (reviewMode) showReplayPanel();
});

function endClimb() {
  if (reviewMode) return;
  if (filledSequence.length === 0) {
    alert("No moves recorded to replay!");
    return;
  }

  reviewMode = true;

  showReplayPanel(); 

  // Show stats for replay mode
  updateStatsUI();

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
      const color = FILLED_COLORS[item.limb];
      highlightCellSimple(item.row, item.col, color);
    }
    currentIndex = idx;
    replaySlider.value = idx;

    // ✅ Update the current move panel
    updateCurrentMovePanel(idx - 1); // show the last move drawn
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
    hideReplayPanel();  // hide panel
    hideReplayBar();
    hideCurrentMovePanel();
    Object.keys(filledCells).forEach(l => filledCells[l] = {});
    Object.keys(holdTimers).forEach(l => holdTimers[l] = {});
    filledSequence.length = 0;
    reviewMode = false;
    showControls();
    moveCounter = 0;
    updateStatsUI();
  };

  // 7️⃣ Handle window resize mid-replay
  window.addEventListener('resize', () => {
    if (reviewMode) redrawFromSlider(currentIndex);
  });
}
