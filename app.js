const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const canvasCtx = canvasElement.getContext('2d');

canvasElement.width = window.innerWidth;
canvasElement.height = window.innerHeight;

const GRID_SIZE = 12;

function drawGrid() {
  const cellWidth = canvasElement.width / GRID_SIZE;
  const cellHeight = canvasElement.height / GRID_SIZE;

  canvasCtx.strokeStyle = "rgba(255,255,255,0.3)";
  for (let i = 0; i <= GRID_SIZE; i++) {
    // Vertical
    canvasCtx.beginPath();
    canvasCtx.moveTo(i * cellWidth, 0);
    canvasCtx.lineTo(i * cellWidth, canvasElement.height);
    canvasCtx.stroke();

    // Horizontal
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, i * cellHeight);
    canvasCtx.lineTo(canvasElement.width, i * cellHeight);
    canvasCtx.stroke();
  }
}

function getGridPosition(landmark) {
  const col = Math.floor(landmark.x * GRID_SIZE);
  const row = Math.floor(landmark.y * GRID_SIZE);
  return { row, col };
}

function onResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  canvasCtx.drawImage(
    results.image,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );

  drawGrid();

  if (results.poseLandmarks) {
    const landmarks = results.poseLandmarks;

    const keyPoints = {
      leftHand: landmarks[15],
      rightHand: landmarks[16],
      leftFoot: landmarks[27],
      rightFoot: landmarks[28]
    };

    for (const key in keyPoints) {
      const point = keyPoints[key];
      const gridPos = getGridPosition(point);

      console.log(key, gridPos);

      // Draw circle
      canvasCtx.beginPath();
      canvasCtx.arc(
        point.x * canvasElement.width,
        point.y * canvasElement.height,
        10,
        0,
        2 * Math.PI
      );
      canvasCtx.fillStyle = "red";
      canvasCtx.fill();
    }
  }

  canvasCtx.restore();
}

const pose = new Pose({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

pose.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await pose.send({ image: videoElement });
  },
  width: 1280,
  height: 720,
});

camera.start();
