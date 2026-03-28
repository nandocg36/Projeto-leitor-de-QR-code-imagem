(function () {
  "use strict";

  const MAX_SCAN_EDGE = 1200;
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

    if (typeof jsQR !== "function") {
      throw new Error("Biblioteca jsQR não carregou.");
    }
    return jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
  }

  function processFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("Escolha um ficheiro de imagem (PNG, JPEG, WebP, etc.).", "err");
      return;
    }

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
})();
