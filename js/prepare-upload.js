(function (root) {
  var MAX_EDGE = 2560;
  var MAX_VIDEO_SECONDS = 60;
  var JPEG_QUALITY = 0.85;

  function videoLength(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement("video");
      function finish(value) {
        URL.revokeObjectURL(url);
        video.removeAttribute("src");
        resolve(value);
      }
      video.preload = "metadata";
      video.onloadedmetadata = function () { finish(Number(video.duration) || 0); };
      video.onerror = function () { finish(0); };
      video.src = url;
    });
  }

  function shrinkPhoto(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type || "")) return Promise.resolve(file);
    if (file.size < 700 * 1024) return Promise.resolve(file);
    if (typeof createImageBitmap !== "function") return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bitmap) {
      var edge = Math.max(bitmap.width, bitmap.height) || 1;
      var alreadyFits = edge <= MAX_EDGE && file.type === "image/jpeg" && file.size < 2.5 * 1024 * 1024;
      if (alreadyFits) {
        if (bitmap.close) bitmap.close();
        return file;
      }
      var scale = Math.min(1, MAX_EDGE / edge);
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      var context = canvas.getContext("2d", { alpha: false });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size * 0.98) {
            resolve(file);
            return;
          }
          var name = String(file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", JPEG_QUALITY);
      });
    }).catch(function () { return file; });
  }

  function prepareShareFile(file) {
    if (!file) return Promise.resolve(file);
    if (String(file.type || "").indexOf("video/") === 0) {
      return videoLength(file).then(function (seconds) {
        if (seconds > MAX_VIDEO_SECONDS + 0.4) {
          throw new Error("Videos can be up to 1 minute. Choose a shorter clip.");
        }
        return file;
      });
    }
    return shrinkPhoto(file);
  }

  root.prepareShareFile = prepareShareFile;
})(window);
