const videoElement = document.querySelector('.input_video');
const canvas = document.querySelector('.output_canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let GRID_SIZE = 12;
let CONFIDENCE_THRESHOLD = 0.5;

document.getElementById("gridSize").oninput = e => {
  GRID_SIZE = parseInt(e.target.value);
};

document.getElementById("confidence").oninput = e => {
  CONFIDENCE_THRESHOLD = parseFloat(e.target.value);
  document.getElementById("confVal").innerText = CONFIDENCE_THRESHOLD;
};

let socket;

function connectESP32(ip){
  socket = new WebSocket(`ws://${ip}:81`);

  socket.onopen = () => console.log("Connected to ESP32");
  socket.onerror = err => console.log("WebSocket error", err);
}

    
let cvReady = false;

// ---- Perspective Corners ----
let corners = [
  { x: 200, y: 200 },
  { x: canvas.width - 200, y: 200 },
  { x: canvas.width - 200, y: canvas.height - 200 },
  { x: 200, y: canvas.height - 200 }
];

let dragging = null;

canvas.addEventListener('mousedown', e => {
  corners.forEach((c, i) => {
    if (Math.hypot(e.clientX - c.x, e.clientY - c.y) < 15)
      dragging = i;
  });
});

canvas.addEventListener('mousemove', e => {
  if (dragging !== null) {
    corners[dragging].x = e.clientX;
    corners[dragging].y = e.clientY;
  }
});

canvas.addEventListener('mouseup', () => dragging = null);

// ---- OpenCV Homography ----

function computeHomographies() {

  const src = cv.matFromArray(4,1,cv.CV_32FC2,[
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y
  ]);

  const dst = cv.matFromArray(4,1,cv.CV_32FC2,[
    0,0,
    1,0,
    1,1,
    0,1
  ]);

  const H = cv.getPerspectiveTransform(src,dst);
  const Hinv = cv.getPerspectiveTransform(dst,src);

  src.delete();
  dst.delete();

  return { H, Hinv };
}

function warpPoint(H,x,y){
  const src = cv.matFromArray(1,1,cv.CV_32FC2,[x,y]);
  const dst = new cv.Mat();
  cv.perspectiveTransform(src,dst,H);
  const out = {x: dst.data32F[0], y: dst.data32F[1]};
  src.delete();
  dst.delete();
  return out;
}

// ---- Draw Perspective Grid ----

function drawPerspectiveGrid(Hinv){

  ctx.strokeStyle="rgba(255,255,255,0.3)";
  ctx.lineWidth=1;

  // Vertical lines
  for(let i=0;i<=GRID_SIZE;i++){
    ctx.beginPath();
    for(let j=0;j<=GRID_SIZE;j++){
      const p = warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
      if(j===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  }

  // Horizontal lines
  for(let j=0;j<=GRID_SIZE;j++){
    ctx.beginPath();
    for(let i=0;i<=GRID_SIZE;i++){
      const p = warpPoint(Hinv,i/GRID_SIZE,j/GRID_SIZE);
      if(i===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  }

  // Draw corners
  corners.forEach(c=>{
    ctx.beginPath();
    ctx.arc(c.x,c.y,8,0,2*Math.PI);
    ctx.fillStyle="yellow";
    ctx.fill();
  });
}

// ---- Highlight Cell ----

function highlightCell(Hinv,row,col,color){

  const p1 = warpPoint(Hinv,col/GRID_SIZE,row/GRID_SIZE);
  const p2 = warpPoint(Hinv,(col+1)/GRID_SIZE,row/GRID_SIZE);
  const p3 = warpPoint(Hinv,(col+1)/GRID_SIZE,(row+1)/GRID_SIZE);
  const p4 = warpPoint(Hinv,col/GRID_SIZE,(row+1)/GRID_SIZE);

  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.moveTo(p1.x,p1.y);
  ctx.lineTo(p2.x,p2.y);
  ctx.lineTo(p3.x,p3.y);
  ctx.lineTo(p4.x,p4.y);
  ctx.closePath();
  ctx.fill();
}

// ---- Pose ----

function onResults(results){
  if(!cvReady) return;

  ctx.save();
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Mirror camera
  ctx.scale(-1,1);
  ctx.drawImage(results.image,-canvas.width,0,canvas.width,canvas.height);
  ctx.restore();

  const {H,Hinv}=computeHomographies();
  drawPerspectiveGrid(Hinv);

  if(!results.poseLandmarks) return;

  const hands=[
    {lm: results.poseLandmarks[15], color:"rgba(255,0,0,0.4)"},
    {lm: results.poseLandmarks[16], color:"rgba(0,0,255,0.4)"}
  ];

 let ledData = {
  left: null,
  right: null
};

hands.forEach((h,index)=>{

  if(h.lm.visibility < CONFIDENCE_THRESHOLD) return;

  const px=(1-h.lm.x)*canvas.width;
  const py=h.lm.y*canvas.height;

  const warped=warpPoint(H,px,py);

  if(warped.x>=0 && warped.x<=1 &&
     warped.y>=0 && warped.y<=1){

    const col=Math.floor(warped.x*GRID_SIZE);
    const row=Math.floor(warped.y*GRID_SIZE);

    highlightCell(Hinv,row,col,h.color);

    // Convert to 3x3 LED grid
    const ledCol=Math.floor(col/(GRID_SIZE/3));
    const ledRow=Math.floor(row/(GRID_SIZE/3));

    if(index===0) ledData.left=[ledRow,ledCol];
    else ledData.right=[ledRow,ledCol];
  }
    ctx.beginPath();
    ctx.arc(px,py,6,0,2*Math.PI);
    ctx.fillStyle="white";
    ctx.fill();
});


  
  H.delete();
  Hinv.delete();
  if(socket && socket.readyState === 1){
  socket.send(JSON.stringify(ledData));
}

}

// ---- OpenCV Ready ----
cv['onRuntimeInitialized']=()=>{ cvReady=true; };

// ---- MediaPipe Init ----
const pose=new Pose({
  locateFile:file=>
  `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity:1,
  smoothLandmarks:true,
  minDetectionConfidence:0.5,
  minTrackingConfidence:0.5
});

pose.onResults(onResults);

const camera=new Camera(videoElement,{
  onFrame:async()=>{await pose.send({image:videoElement});},
  width:1280,
  height:720
});

camera.start();
