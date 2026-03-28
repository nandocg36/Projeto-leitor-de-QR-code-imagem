const MAX_SCAN_EDGE = 1200;
const PDFJS_VERSION = "4.10.38";
const PDF_MODULE = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDF_WORKER = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

const fileInput = document.getElementById("file-input");
const pickBtn = document.getElementById("pick-btn");
const clearBtn = document.getElementById("clear-btn");
const preview = document.getElementById("preview");
const previewPlaceholder = document.getElementById("preview-placeholder");
const resultValue = document.getElementById("result-value");
const statusEl = document.getElementById("status");
const installBtn = document.getElementById("install-btn");
const installHint = document.getElementById("install-hint");

let objectUrl = null;
let deferredPrompt = null;

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function revokePreviewUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function clearAll() {
  revokePreviewUrl();
  fileInput.value = "";
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  previewPlaceholder.classList.remove("hidden");
  resultValue.textContent = "Nenhum resultado ainda.";
  resultValue.classList.add("empty");
  resultValue.innerHTML = "";
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

function decodeQrFromImage(img) {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) {
    return null;
  }

  const { width, height } = scaleDimensions(naturalW, naturalH);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return decodeQrFromImageData(imageData);
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
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.classList.add("hidden");
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
      const thumb = canvas.toDataURL("image/png");
      preview.src = thumb;
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
  resultValue.textContent = "Não foi encontrado nenhum QR neste PDF.";
  resultValue.classList.add("empty");
  setStatus("Tente PDF com QR maior ou exporte a página como imagem.", "info");
}

function processImageFile(file) {
  revokePreviewUrl();
  objectUrl = URL.createObjectURL(file);
  preview.onload = function () {
    try {
      const code = decodeQrFromImage(preview);
      if (code && code.data) {
        showResult(code.data);
        setStatus("QR lido com sucesso.", "ok");
      } else {
        resultValue.textContent = "Não foi encontrado nenhum QR nesta imagem.";
        resultValue.classList.add("empty");
        setStatus(
          "Tente outro recorte, maior resolução ou melhor iluminação.",
          "info"
        );
      }
    } catch (e) {
      resultValue.textContent = "Erro ao processar a imagem.";
      resultValue.classList.add("empty");
      setStatus(e.message || "Erro desconhecido.", "err");
    }
  };
  preview.onerror = function () {
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
      resultValue.textContent = "Erro ao processar o PDF.";
      resultValue.classList.add("empty");
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

pickBtn.addEventListener("click", function () {
  fileInput.click();
});

fileInput.addEventListener("change", function () {
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    processFile(file);
  }
});

clearBtn.addEventListener("click", clearAll);

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
