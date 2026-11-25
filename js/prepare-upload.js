(function (root) {
  var MAX_VIDEO_SECONDS = 60;
  var MAX_FILE_BYTES = 40 * 1024 * 1024;
  var PHOTO_EDGE = 3200;
  var PHOTO_QUALITY = 0.92;

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

  function isAppleTouch() {
    var ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function shrinkPhoto(file) {
    var type = String(file.type || "");
    if (type !== "image/jpeg" && type !== "image/webp") return Promise.resolve(file);
    if (typeof createImageBitmap !== "function") return Promise.resolve(file);
    // Decoding a full iPhone photo on the page freezes the photo checkmarks
    // when another download is already in memory. The server still keeps the
    // same 3200-pixel JPEG quality.
    if (isAppleTouch()) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bitmap) {
      var edge = Math.max(bitmap.width, bitmap.height);
      var alreadyClear = edge <= PHOTO_EDGE && type === "image/jpeg" && file.size <= 8 * 1024 * 1024;
      if (alreadyClear) {
        if (bitmap.close) bitmap.close();
        return file;
      }
      var scale = Math.min(1, PHOTO_EDGE / Math.max(edge, 1));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          var name = String(file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", PHOTO_QUALITY);
      });
    }).catch(function () { return file; });
  }

  function prepareShareFile(file) {
    if (!file) return Promise.resolve(file);
    if (file.size > MAX_FILE_BYTES) {
      return Promise.reject(new Error("That file is too large for this site. Please use a photo or a video under 40 MB."));
    }
    if (String(file.type || "").indexOf("video/") === 0) {
      return videoLength(file).then(function (seconds) {
        if (seconds > MAX_VIDEO_SECONDS + 0.4) {
          throw new Error("Videos can be up to 1 minute. Choose a shorter clip.");
        }
        return file;
      });
    }
    if (String(file.type || "").indexOf("image/") === 0) return shrinkPhoto(file);
    return Promise.resolve(file);
  }

  root.prepareShareFile = prepareShareFile;
})(window);
