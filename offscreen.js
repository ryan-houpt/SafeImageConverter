/**
 * Safe Image Format Converter — Offscreen Document
 *
 * Receives image data (base64) from the background service worker,
 * draws it onto a canvas, converts to the requested format,
 * and returns base64 blob data with its MIME type.
 */

const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen' || message.action !== 'convert') return;

  handleConversion(message)
    .then(sendResponse)
    .catch(() => sendResponse(null));

  return true;
});

async function handleConversion(message) {
  const {
    imageBase64,
    format,
    quality,
    jpgBackground,
    removePreviewBackground: shouldRemovePreviewBackground
  } = message;

  const binary = atob(imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes]);

  const img = await loadImage(blob);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d', {
    willReadFrequently: shouldRemovePreviewBackground === true
  });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.drawImage(img, 0, 0);

  const outputFormat = Object.prototype.hasOwnProperty.call(MIME_TYPES, format)
    ? format
    : 'png';

  if (shouldRemovePreviewBackground) {
    removePreviewBackground(ctx, canvas.width, canvas.height);
  }

  if (outputFormat === 'jpg') {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = jpgBackground === 'black' ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  const mimeType = MIME_TYPES[outputFormat] || MIME_TYPES.png;
  const qualityParam = (outputFormat === 'jpg' || outputFormat === 'webp') ? quality : undefined;
  const resultBlob = await canvasToBlob(canvas, mimeType, qualityParam);
  const resultBase64 = await blobToBase64(resultBlob);

  URL.revokeObjectURL(img.src);

  return { base64: resultBase64, mimeType, format: outputFormat };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas toBlob failed'));
      }
    }, mimeType, quality);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function removePreviewBackground(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const backgroundProfile = getPreviewBackgroundProfile(data, width, height);

  if (!backgroundProfile) {
    return;
  }

  function enqueue(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;

    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;

    const offset = pixelIndex * 4;
    if (!matchesBackgroundPalette(data, offset, backgroundProfile.palette)) return;

    stack.push(pixelIndex);
  }

  let matchingCornerCount = 0;
  for (const corner of backgroundProfile.corners) {
    if (matchesBackgroundPalette(data, ((corner.y * width) + corner.x) * 4, backgroundProfile.palette)) {
      matchingCornerCount += 1;
      enqueue(corner.x, corner.y);
    }
  }

  const minimumMatchingCorners = backgroundProfile.corners.length === 4
    ? 3
    : backgroundProfile.corners.length;
  if (matchingCornerCount < minimumMatchingCorners) {
    return;
  }

  while (stack.length > 0) {
    const pixelIndex = stack.pop();
    const offset = pixelIndex * 4;
    data[offset + 3] = 0;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  ctx.putImageData(imageData, 0, 0);
}

function getPreviewBackgroundProfile(data, width, height) {
  const corners = getUniqueCornerPoints(width, height);
  const palette = detectBackgroundPalette(data, width, height, corners);

  if (palette.length === 0) {
    return null;
  }

  let matchingCornerCount = 0;
  for (const corner of corners) {
    if (matchesBackgroundPalette(data, ((corner.y * width) + corner.x) * 4, palette)) {
      matchingCornerCount += 1;
    }
  }

  const minimumMatchingCorners = corners.length === 4 ? 3 : corners.length;
  if (matchingCornerCount < minimumMatchingCorners) {
    return null;
  }

  return {
    corners,
    palette,
    kind: classifyBackgroundPalette(palette)
  };
}

function detectBackgroundPalette(data, width, height, corners) {
  const palette = [];
  const maxScanDistance = Math.min(32, Math.max(width, height) - 1);

  function addColorFromPoint(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = ((y * width) + x) * 4;
    if (!isNeutralLightPixel(data, offset)) return;

    const color = {
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2]
    };

    if (palette.some((entry) => colorDistance(entry, color) <= 18)) return;
    palette.push(color);
  }

  for (const corner of corners) {
    addColorFromPoint(corner.x, corner.y);
  }

  const directions = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 }
  ];

  corners.forEach((corner, index) => {
    const horizontalDirection = directions[index % 2 === 0 ? 0 : 2];
    const verticalDirection = directions[index < 2 ? 1 : 3];

    scanFromCorner(corner, horizontalDirection.dx, horizontalDirection.dy);
    scanFromCorner(corner, verticalDirection.dx, verticalDirection.dy);
  });

  return palette.slice(0, 2);

  function scanFromCorner(corner, dx, dy) {
    for (let distance = 1; distance <= maxScanDistance && palette.length < 2; distance++) {
      addColorFromPoint(corner.x + (dx * distance), corner.y + (dy * distance));
    }
  }
}

function classifyBackgroundPalette(palette) {
  if (palette.length >= 2 && colorDistance(palette[0], palette[1]) >= 18) {
    return 'checker';
  }

  return 'white';
}

function getUniqueCornerPoints(width, height) {
  const points = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 }
  ];

  const uniquePoints = [];
  const seen = new Set();
  for (const point of points) {
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePoints.push(point);
  }

  return uniquePoints;
}

function isNeutralLightPixel(data, offset) {
  return data[offset + 3] > 0 &&
    Math.max(data[offset], data[offset + 1], data[offset + 2]) -
      Math.min(data[offset], data[offset + 1], data[offset + 2]) <= 20 &&
    ((data[offset] + data[offset + 1] + data[offset + 2]) / 3) >= 185;
}

function matchesBackgroundPalette(data, offset, palette) {
  if (data[offset + 3] === 0) return false;

  const pixel = {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2]
  };

  return palette.some((color) => colorDistance(color, pixel) <= 22);
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b)
  );
}
