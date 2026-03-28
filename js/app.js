const MAX_SCAN_EDGE = 1200;
const PDFJS_VERSION = "4.10.38";
const PDF_MODULE = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDF_WORKER = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

const SCREEN_BTN_LABEL = "Capturar ecrã";
const SCREEN_BTN_STOP = "Parar análise";

const fileInput = document.getElementById("file-input");
const pickBtn = document.getElementById("pick-btn");
const screenBtn = document.getElementById("screen-btn");
const clearBtn = document.getElementById("clear-btn");
const copyBtn = document.getElementById("copy-btn");
const preview = document.getElementById("preview");
const screenVideo = document.getElementById("screen-preview");
const previewPlaceholder = document.getElementById("preview-placeholder");
const resultValue = document.getElementById("result-value");
const statusEl = document.getElementById("status");
const installBtn = document.getElementById("install-btn");
const installHint = document.getElementById("install-hint");

let objectUrl = null;
let deferredPrompt = null;
let lastDecodedText = "";
let screenStream = null;
let screenRafId = null;
let screenScanning = false;

if (!navigator.mediaDevices?.getDisplayMedia) {
  screenBtn.disabled = true;
  screenBtn.title =
    "Indisponível neste browser (comum em alguns telemóveis). Use imagem ou PDF.";
}

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function setScreenButtonLabel(scanning) {
  screenBtn.textContent = scanning ? SCREEN_BTN_STOP : SCREEN_BTN_LABEL;
}

function revokePreviewUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function stopScreenCapture() {
  screenScanning = false;
  if (screenRafId != null) {
    cancelAnimationFrame(screenRafId);
    screenRafId = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(function (t) {
      t.stop();
    });
    screenStream = null;
  }
  screenVideo.pause();
  screenVideo.srcObject = null;
  screenVideo.classList.add("hidden");
  setScreenButtonLabel(false);
}

function clearResultDisplay(message, isEmpty) {
  lastDecodedText = "";
  copyBtn.disabled = true;
  resultValue.classList.toggle("empty", isEmpty !== false);
  resultValue.textContent = message;
  resultValue.innerHTML = "";
}

function clearAll() {
  stopScreenCapture();
  revokePreviewUrl();
  fileInput.value = "";
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  previewPlaceholder.textContent = "Pré-visualização";
  previewPlaceholder.classList.remove("hidden");
  clearResultDisplay("Nenhum resultado ainda.", true);
  setStatus("", "");
}

function isProbablyUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function showResult(text) {
  lastDecodedText = text;
  copyBtn.disabled = !text;
  resultValue.classList.remove("empty");
  if (isProbablyUrl(text)) {
    const href = new URL(text).href.replace(/"/g, "&quot;");
    resultValue.innerHTML =
      '<a href="' +
      href +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(text) +
      "</a>";
  } else {
    resultValue.textContent = text;
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scaleDimensions(w, h) {
  const max = Math.max(w, h);
  if (max <= MAX_SCAN_EDGE) {
    return { width: w, height: h };
  }
  const scale = MAX_SCAN_EDGE / max;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

function decodeQrFromImageData(imageData) {
  if (typeof jsQR !== "function") {
    throw new Error("Biblioteca jsQR não carregou.");
  }
  return jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
}

function decodeQrFromCanvasSource(source) {
  const naturalW = source.videoWidth || source.naturalWidth || source.width;
  const naturalH = source.videoHeight || source.naturalHeight || source.height;
  if (!naturalW || !naturalH) {
    return null;
  }
  const { width, height } = scaleDimensions(naturalW, naturalH);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return decodeQrFromImageData(imageData);
}

function decodeQrFromImage(img) {
  return decodeQrFromCanvasSource(img);
}

function snapshotSourceToDataUrl(source) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) {
    return "";
  }
  const { width, height } = scaleDimensions(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function isPdfFile(file) {
  if (!file) {
    return false;
  }
  if (file.type === "application/pdf") {
    return true;
  }
  return /\.pdf$/i.test(file.name || "");
}

async function renderPdfPageForScan(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxDim = Math.max(baseViewport.width, baseViewport.height);
  const scale = maxDim > MAX_SCAN_EDGE ? MAX_SCAN_EDGE / maxDim : 1;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, imageData };
}

async function processPdf(file) {
  stopScreenCapture();
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  screenVideo.classList.add("hidden");
  previewPlaceholder.classList.remove("hidden");

  setStatus("A carregar PDF…", "info");

  let pdfjsLib;
  try {
    pdfjsLib = await import(/* webpackIgnore: true */ PDF_MODULE);
  } catch {
    setStatus("Não foi possível carregar o leitor de PDF (rede).", "err");
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;

  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data }).promise;
  } catch {
    setStatus("PDF inválido ou protegido.", "err");
    return;
  }

  const numPages = pdf.numPages;
  let previewDataUrl = null;

  for (let p = 1; p <= numPages; p++) {
    setStatus("A analisar página " + p + " de " + numPages + "…", "info");
    const page = await pdf.getPage(p);
    const { canvas, imageData } = await renderPdfPageForScan(page);
    if (!previewDataUrl) {
      previewDataUrl = canvas.toDataURL("image/png");
    }
    const code = decodeQrFromImageData(imageData);
    if (code && code.data) {
      showResult(code.data);
      preview.src = canvas.toDataURL("image/png");
      preview.classList.remove("hidden");
      previewPlaceholder.classList.add("hidden");
      setStatus("QR lido com sucesso (PDF, página " + p + ").", "ok");
      return;
    }
  }

  if (previewDataUrl) {
    preview.src = previewDataUrl;
    preview.classList.remove("hidden");
    previewPlaceholder.classList.add("hidden");
  }
  clearResultDisplay("Não foi encontrado nenhum QR neste PDF.", true);
  setStatus("Tente PDF com QR maior ou exporte a página como imagem.", "info");
}

function processImageFile(file) {
  stopScreenCapture();
  revokePreviewUrl();
  objectUrl = URL.createObjectURL(file);
  screenVideo.classList.add("hidden");
  preview.onload = function () {
    try {
      const code = decodeQrFromImage(preview);
      if (code && code.data) {
        showResult(code.data);
        setStatus("QR lido com sucesso.", "ok");
      } else {
        clearResultDisplay(
          "Não foi encontrado nenhum QR nesta imagem.",
          true
        );
        setStatus(
          "Tente outro recorte, maior resolução ou melhor iluminação.",
          "info"
        );
      }
    } catch (e) {
      clearResultDisplay("Erro ao processar a imagem.", true);
      setStatus(e.message || "Erro desconhecido.", "err");
    }
  };
  preview.onerror = function () {
    clearResultDisplay("Não foi possível carregar a imagem.", true);
    setStatus("Não foi possível carregar a imagem.", "err");
  };
  preview.src = objectUrl;
  preview.classList.remove("hidden");
  previewPlaceholder.classList.add("hidden");
  setStatus("A processar…", "info");
}

function processFile(file) {
  if (!file) {
    return;
  }
  if (isPdfFile(file)) {
    processPdf(file).catch(function (e) {
      clearResultDisplay("Erro ao processar o PDF.", true);
      setStatus(e.message || "Erro desconhecido.", "err");
    });
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("Escolha uma imagem ou um PDF.", "err");
    return;
  }
  processImageFile(file);
}

function screenScanTick() {
  if (!screenScanning || !screenStream) {
    return;
  }
  const code = decodeQrFromCanvasSource(screenVideo);
  if (code && code.data) {
    const thumb = snapshotSourceToDataUrl(screenVideo);
    stopScreenCapture();
    if (thumb) {
      preview.src = thumb;
      preview.classList.remove("hidden");
    }
    previewPlaceholder.classList.add("hidden");
    screenVideo.classList.add("hidden");
    showResult(code.data);
    setStatus("QR lido a partir do ecrã.", "ok");
    return;
  }
  screenRafId = requestAnimationFrame(screenScanTick);
}

async function startScreenCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("Captura de ecrã não disponível neste dispositivo.", "err");
    return;
  }
  stopScreenCapture();
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  clearResultDisplay("Nenhum resultado ainda.", true);
  previewPlaceholder.textContent = "A analisar o ecrã partilhado…";
  previewPlaceholder.classList.remove("hidden");

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (e) {
    previewPlaceholder.textContent = "Pré-visualização";
    if (e.name === "NotAllowedError") {
      setStatus("Partilha de ecrã cancelada.", "info");
    } else {
      setStatus(e.message || "Não foi possível capturar o ecrã.", "err");
    }
    return;
  }

  const track = screenStream.getVideoTracks()[0];
  if (track) {
    track.addEventListener("ended", function () {
      if (!screenScanning) {
        return;
      }
      stopScreenCapture();
      previewPlaceholder.textContent = "Pré-visualização";
      if (!preview.getAttribute("src")) {
        previewPlaceholder.classList.remove("hidden");
      }
      setStatus("Partilha de ecrã terminada.", "info");
    });
  }

  screenVideo.srcObject = screenStream;
  try {
    await screenVideo.play();
  } catch {
    stopScreenCapture();
    previewPlaceholder.textContent = "Pré-visualização";
    setStatus("Não foi possível reproduzir o vídeo do ecrã.", "err");
    return;
  }

  screenVideo.classList.remove("hidden");
  previewPlaceholder.classList.add("hidden");
  screenScanning = true;
  setScreenButtonLabel(true);
  setStatus(
    "Mostre o QR no ecrã partilhado. Pode parar com «Parar análise» ou «Limpar».",
    "info"
  );
  screenRafId = requestAnimationFrame(screenScanTick);
}

async function copyDecodedText() {
  if (!lastDecodedText) {
    setStatus("Nada para copiar — leia um QR primeiro.", "info");
    return;
  }
  try {
    await navigator.clipboard.writeText(lastDecodedText);
    setStatus("Copiado para a área de transferência.", "ok");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = lastDecodedText;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      setStatus("Copiado.", "ok");
    } catch {
      setStatus("Não foi possível copiar (permissão ou browser).", "err");
    }
    document.body.removeChild(ta);
  }
}

pickBtn.addEventListener("click", function () {
  fileInput.click();
});

screenBtn.addEventListener("click", function () {
  if (screenScanning) {
    stopScreenCapture();
    screenVideo.classList.add("hidden");
    previewPlaceholder.textContent = "Pré-visualização";
    if (!preview.getAttribute("src")) {
      previewPlaceholder.classList.remove("hidden");
    }
    setStatus("Análise do ecrã interrompida.", "info");
    return;
  }
  startScreenCapture();
});

fileInput.addEventListener("change", function () {
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    processFile(file);
  }
});

clearBtn.addEventListener("click", clearAll);

copyBtn.addEventListener("click", function () {
  copyDecodedText();
});

preview.addEventListener("click", function () {
  if (!preview.classList.contains("hidden") && lastDecodedText) {
    copyDecodedText();
  }
});

window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredPrompt = e;
  installHint.classList.remove("hidden");
});

installBtn.addEventListener("click", async function () {
  if (!deferredPrompt) {
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === "accepted") {
    installHint.classList.add("hidden");
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch(function () {
        /* offline ou file:// */
      });
  });
}
